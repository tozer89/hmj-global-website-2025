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
  normaliseRoleInput,
  normaliseRateInput,
  ensureUniqueRoleSlug,
  settingsFromRow,
  insertRateBookAuditLog,
  isMissingTableError,
} = require('./_rate-book-helpers.js');

async function loadMarkets(supabase) {
  const result = await supabase
    .from(RATE_BOOK_MARKET_TABLE)
    .select('*')
    .order('display_order', { ascending: true });

  if (result.error) throw result.error;
  return result.data || [];
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
    const rows = Array.isArray(body?.rows) ? body.rows : [];

    if (!rows.length) {
      const error = new Error('Import rows are required.');
      error.code = 400;
      throw error;
    }

    const [markets, settings] = await Promise.all([
      loadMarkets(supabase),
      loadSettings(supabase),
    ]);

    const imported = [];

    for (const row of rows) {
      const rolePayload = normaliseRoleInput(row, user);
      const existingRoleResult = await supabase
        .from(RATE_BOOK_ROLE_TABLE)
        .select('id, slug')
        .eq('slug', rolePayload.slug)
        .maybeSingle();
      if (existingRoleResult.error) throw existingRoleResult.error;

      rolePayload.id = rolePayload.id || existingRoleResult.data?.id || randomUUID();
      rolePayload.slug = await ensureUniqueRoleSlug(supabase, rolePayload.slug, rolePayload.id);
      rolePayload.created_by_email = rolePayload.created_by_email || user?.email || null;

      const roleResult = await supabase
        .from(RATE_BOOK_ROLE_TABLE)
        .upsert(rolePayload, { onConflict: 'id', ignoreDuplicates: false })
        .select('*')
        .single();

      if (roleResult.error) throw roleResult.error;

      const existingRatesResult = await supabase
        .from(RATE_BOOK_RATE_TABLE)
        .select('*')
        .eq('role_id', roleResult.data.id);

      if (existingRatesResult.error) throw existingRatesResult.error;

      const existingRates = new Map(
        (existingRatesResult.data || []).map((rate) => [`${rate.market_id}:${rate.effective_from || ''}`, rate])
      );

      const rateEntries = Array.isArray(row.marketRates)
        ? row.marketRates
        : Object.entries(row.rates || {}).map(([marketCode, rate]) => ({
          marketCode,
          ...rate,
          isFeatured: row.featured === true,
        }));

      const ratePayloads = rateEntries.map((entry) => {
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
        payload.created_by_email = existing?.created_by_email || user?.email || null;
        return payload;
      });

      if (ratePayloads.length) {
        const ratesResult = await supabase
          .from(RATE_BOOK_RATE_TABLE)
          .upsert(ratePayloads, { onConflict: 'id', ignoreDuplicates: false });
        if (ratesResult.error) throw ratesResult.error;
      }

      imported.push({
        id: roleResult.data.id,
        slug: roleResult.data.slug,
        name: roleResult.data.name,
        ratesImported: ratePayloads.length,
      });
    }

    await Promise.all([
      insertRateBookAuditLog(supabase, {
        entityType: 'rate_book_import',
        entityId: null,
        action: 'imported',
        beforeJson: null,
        afterJson: {
          importedCount: imported.length,
          rows: imported,
        },
        changedBy: user?.email || '',
      }),
      recordAudit({
        actor: user,
        action: 'rate_book_imported',
        targetType: 'rate_book_import',
        targetId: null,
        meta: {
          importedCount: imported.length,
          roles: imported.slice(0, 20),
        },
      }),
    ]);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        importedCount: imported.length,
        rows: imported,
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
          ? 'Rate Book import tables are not ready in this environment yet.'
          : (error?.message || 'Rate Book import failed'),
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
