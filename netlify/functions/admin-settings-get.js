// netlify/functions/admin-settings-get.js
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { fetchSettings, DEFAULT_SETTINGS } = require('./_settings-helpers.js');

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const keys = event.httpMethod === 'GET'
      ? Object.keys(DEFAULT_SETTINGS)
      : (JSON.parse(event.body || '{}').keys || Object.keys(DEFAULT_SETTINGS));
    const { settings, source, missing, supabase, error } = await fetchSettings(event, keys);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, settings, source, missing, supabase, error }),
    };
  } catch (err) {
    const status = err.code === 401 ? 403 : err.code === 403 ? 403 : 500;
    return {
      statusCode: status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message || 'Unexpected error', code: err.code || 'settings_error' }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
