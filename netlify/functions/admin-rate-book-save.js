const { randomUUID } = require('node:crypto');
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { recordAudit } = require('./_audit.js');
const {
  RATE_BOOK_ROLE_TABLE,
  RATE_BOOK_MARKET_TABLE,
  RATE_BOOK_RATE_TABLE,
  RATE_BOOK_SETTINGS_TABLE,
  roleFromRow,
  rateFromRow,
  settingsFromRow,
  normaliseRoleInput,
  normaliseRateInput,
  ensureUniqueRoleSlug,
  insertRateBookAuditLog,
  isMissingTableError,
} = require('./_rate-book-helpers.js');

async function loadSettings(supabase) {
  const result = await supabase
    .from(RATE_BOOK_SETTINGS_TABLE)
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (result.error) throw result.error;
  return settingsFromRow((result.data || [])[0] || {});
}

async function loadMarkets(supabase) {
  const result = await supabase
    .from(RATE_BOOK_MARKET_TABLE)
    .select('*')
    .order('display_order', { ascending: true });

  if (result.error) throw result.error;
  return result.data || [];
}

async function loadRoleBundle(supabase, roleId) {
  const [roleResult, rateResult] = await Promise.all([
    supabase
      .from(RATE_BOOK_ROLE_TABLE)
      .select('*')
      .eq('id', roleId)
      .maybeSingle(),
    supabase
      .from(RATE_BOOK_RATE_TABLE)
      .select('*')
      .eq('role_id', roleId),
  ]);

  if (roleResult.error) throw roleResult.error;
  if (rateResult.error) throw rateResult.error;

  return {
    role: roleResult.data ? roleFromRow(roleResult.data) : null,
    rates: (rateResult.data || []).map(rateFromRow),
  };
}

const baseHandler = async (event, context) => {
  try {
    const { user } = await getContext(event, context, { requireAdmin: true });
    const supabase = getSupabase(event);
    const body = JSON.parse(event.body || '{}');
    const roleInput = body?.role;
    const ratesInput = Array.isArray(body?.rates) ? body.rates : [];

    if (!roleInput || typeof roleInput !== 'object') {
      const error = new Error('Role payload is required.');
      error.code = 400;
      throw error;
    }

    const [markets, settings] = await Promise.all([
      loadMarkets(supabase),
      loadSettings(supabase),
    ]);

    const beforeBundle = roleInput.id
      ? await loadRoleBundle(supabase, String(roleInput.id))
      : { role: null, rates: [] };

    const rolePayload = normaliseRoleInput(roleInput, user);
    rolePayload.id = rolePayload.id || randomUUID();
    rolePayload.slug = await ensureUniqueRoleSlug(supabase, rolePayload.slug, rolePayload.id);

    if (!roleInput.id) {
      rolePayload.created_by_email = user?.email || null;
    }

    const roleResult = await supabase
      .from(RATE_BOOK_ROLE_TABLE)
      .upsert(rolePayload, { onConflict: 'id', ignoreDuplicates: false })
      .select('*')
      .single();

    if (roleResult.error) throw roleResult.error;

    const existingRates = new Map(
      beforeBundle.rates.map((rate) => [`${rate.marketId}:${rate.effectiveFrom}`, rate])
    );
    const ratePayloads = ratesInput.map((entry) => {
      const payload = normaliseRateInput(
        {
          ...entry,
          roleId: roleResult.data.id,
        },
        markets,
        settings,
        user
      );
      const existing = existingRates.get(`${payload.market_id}:${payload.effective_from}`);
      payload.id = payload.id || existing?.id || randomUUID();
      if (!existing) payload.created_by_email = user?.email || null;
      return payload;
    });

    if (ratePayloads.length) {
      const ratesResult = await supabase
        .from(RATE_BOOK_RATE_TABLE)
        .upsert(ratePayloads, { onConflict: 'id', ignoreDuplicates: false });
      if (ratesResult.error) throw ratesResult.error;
    }

    const afterBundle = await loadRoleBundle(supabase, roleResult.data.id);

    await Promise.all([
      insertRateBookAuditLog(supabase, {
        entityType: 'rate_book_role',
        entityId: roleResult.data.id,
        action: beforeBundle.role ? 'updated' : 'created',
        beforeJson: beforeBundle,
        afterJson: afterBundle,
        changedBy: user?.email || '',
      }),
      recordAudit({
        actor: user,
        action: beforeBundle.role ? 'rate_book_role_updated' : 'rate_book_role_created',
        targetType: 'rate_book_role',
        targetId: roleResult.data.id,
        meta: {
          role: afterBundle.role,
          ratesUpdated: ratePayloads.length,
        },
      }),
    ]);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        role: afterBundle.role,
        rates: afterBundle.rates,
      }),
    };
  } catch (error) {
    const schemaIssue = isMissingTableError(error, RATE_BOOK_ROLE_TABLE)
      || isMissingTableError(error, RATE_BOOK_MARKET_TABLE)
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
          ? 'Rate Book tables are not ready in this environment yet.'
          : (error?.message || 'Rate Book save failed'),
        code: schemaIssue ? 'schema_mismatch' : undefined,
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
