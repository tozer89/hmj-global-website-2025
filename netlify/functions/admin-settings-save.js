// netlify/functions/admin-settings-save.js
const { getContext } = require('./_auth.js');
const { saveSettings, fetchSettings } = require('./_settings-helpers.js');

exports.handler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const payload = JSON.parse(event.body || '{}');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid payload' }) };
    }

    const entries = Object.entries(payload.settings || payload)
      .filter(([key]) => typeof key === 'string');

    if (!entries.length) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'No settings supplied' }) };
    }

    const toSave = Object.fromEntries(entries);
    const { data } = await saveSettings(event, toSave);
    const { settings, source, supabase } = await fetchSettings(event, entries.map(([key]) => key));

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, data, settings, source, supabase }),
    };
  } catch (err) {
    const status = err.code === 401 ? 401 : err.code === 403 ? 403 : err.code === 'supabase_unavailable' ? 503 : 500;
    return {
      statusCode: status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message || 'Unexpected error', code: err.code || 'settings_error' }),
    };
  }
};
