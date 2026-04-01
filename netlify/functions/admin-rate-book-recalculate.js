const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { recordAudit } = require('./_audit.js');
const {
  RATE_BOOK_MARKET_TABLE,
  RATE_BOOK_RATE_TABLE,
  RATE_BOOK_SETTINGS_TABLE,
  marketFromRow,
  rateFromRow,
  settingsFromRow,
  calculateChargeFromPay,
  pickCurrentRates,
  insertRateBookAuditLog,
  isMissingTableError,
} = require('./_rate-book-helpers.js');

async function loadMarkets(supabase) {
  const result = await supabase
    .from(RATE_BOOK_MARKET_TABLE)
    .select('*');
  if (result.error) throw result.error;
  return (result.data || []).map(marketFromRow);
}

async function loadSettings(supabase) {
  const result = await supabase
    .from(RATE_BOOK_SETTINGS_TABLE)
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (result.error) throw result.error;
  return settingsFromRow((result.data || [])[0] || {});
}

const baseHandler = async (event, context) => {
  try {
    const { user } = await getContext(event, context, { requireAdmin: true });
    const supabase = getSupabase(event);
    const body = JSON.parse(event.body || '{}');
    const forceOverride = body?.forceOverride === true;
    const roleIds = Array.isArray(body?.roleIds) ? body.roleIds.map(String).filter(Boolean) : [];
    const marketCodeFilter = String(body?.marketCode || '').trim().toUpperCase();

    const [markets, settings, ratesResult] = await Promise.all([
      loadMarkets(supabase),
      loadSettings(supabase),
      supabase
        .from(RATE_BOOK_RATE_TABLE)
        .select('*'),
    ]);

    if (ratesResult.error) throw ratesResult.error;

    const marketById = new Map(markets.map((market) => [market.id, market]));
    const currentRates = pickCurrentRates((ratesResult.data || []).map(rateFromRow));
    const updates = [];

    currentRates.forEach((rate) => {
      if (roleIds.length && !roleIds.includes(String(rate.roleId))) return;
      const market = marketById.get(rate.marketId);
      if (!market) return;
      if (marketCodeFilter && market.code !== marketCodeFilter) return;
      if (!forceOverride && rate.isChargeOverridden) return;
      const recalculated = calculateChargeFromPay(rate.payRate, settings, market.currency);
      if (recalculated === null) return;
      if (rate.chargeRate !== null && Math.abs(Number(rate.chargeRate) - recalculated) < 0.009) return;
      updates.push({
        id: rate.id,
        charge_rate: recalculated,
        is_charge_overridden: false,
        updated_by_email: user?.email || null,
      });
    });

    if (updates.length) {
      const result = await supabase
        .from(RATE_BOOK_RATE_TABLE)
        .upsert(updates, { onConflict: 'id', ignoreDuplicates: false });
      if (result.error) throw result.error;
    }

    await Promise.all([
      insertRateBookAuditLog(supabase, {
        entityType: 'rate_book_recalculate',
        entityId: null,
        action: 'recalculated',
        beforeJson: null,
        afterJson: {
          updatedCount: updates.length,
          marketCode: marketCodeFilter || null,
          forceOverride,
        },
        changedBy: user?.email || '',
      }),
      recordAudit({
        actor: user,
        action: 'rate_book_recalculated',
        targetType: 'rate_book_rates',
        targetId: null,
        meta: {
          updatedCount: updates.length,
          marketCode: marketCodeFilter || null,
          forceOverride,
        },
      }),
    ]);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        updatedCount: updates.length,
      }),
    };
  } catch (error) {
    const schemaIssue = isMissingTableError(error, RATE_BOOK_MARKET_TABLE)
      || isMissingTableError(error, RATE_BOOK_RATE_TABLE)
      || isMissingTableError(error, RATE_BOOK_SETTINGS_TABLE);
    const status = error?.code === 401
      ? 401
      : error?.code === 403
        ? 403
        : error?.code === 400
          ? 400
          : schemaIssue
            ? 409
            : 500;

    return {
      statusCode: status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: schemaIssue
          ? 'Rate Book recalculation tables are not ready in this environment yet.'
          : (error?.message || 'Rate Book recalculation failed'),
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
