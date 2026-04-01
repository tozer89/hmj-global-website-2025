const { randomUUID } = require('node:crypto');
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { recordAudit } = require('./_audit.js');
const {
  RATE_BOOK_SETTINGS_TABLE,
  normaliseSettingsInput,
  settingsFromRow,
  insertRateBookAuditLog,
  isMissingTableError,
} = require('./_rate-book-helpers.js');

async function loadCurrentSettings(supabase) {
  const result = await supabase
    .from(RATE_BOOK_SETTINGS_TABLE)
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (result.error) throw result.error;
  return result.data?.[0] || null;
}

const baseHandler = async (event, context) => {
  try {
    const { user } = await getContext(event, context, { requireAdmin: true });
    const supabase = getSupabase(event);
    const body = JSON.parse(event.body || '{}');
    const settingsInput = body?.settings;

    if (!settingsInput || typeof settingsInput !== 'object') {
      const error = new Error('Settings payload is required.');
      error.code = 400;
      throw error;
    }

    const beforeRow = await loadCurrentSettings(supabase);
    const payload = normaliseSettingsInput(
      {
        ...settingsInput,
        updatedByEmail: user?.email || null,
      },
      beforeRow || {}
    );

    payload.id = payload.id || beforeRow?.id || randomUUID();

    const result = await supabase
      .from(RATE_BOOK_SETTINGS_TABLE)
      .upsert(payload, { onConflict: 'id', ignoreDuplicates: false })
      .select('*')
      .single();

    if (result.error) throw result.error;

    await Promise.all([
      insertRateBookAuditLog(supabase, {
        entityType: 'rate_book_settings',
        entityId: result.data.id,
        action: beforeRow ? 'updated' : 'created',
        beforeJson: beforeRow,
        afterJson: result.data,
        changedBy: user?.email || '',
      }),
      recordAudit({
        actor: user,
        action: 'rate_book_settings_saved',
        targetType: 'rate_book_settings',
        targetId: result.data.id,
        meta: settingsFromRow(result.data),
      }),
    ]);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        settings: settingsFromRow(result.data),
      }),
    };
  } catch (error) {
    const schemaIssue = isMissingTableError(error, RATE_BOOK_SETTINGS_TABLE);
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
          ? 'Rate Book settings are not ready in this environment yet.'
          : (error?.message || 'Rate Book settings save failed'),
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
