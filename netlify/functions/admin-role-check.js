// netlify/functions/admin-role-check.js
const { getContext } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    const { user, roles } = await getContext(event, context, { requireAdmin: true });
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({ ok: true, email: user?.email || '', roles: roles || [] }),
    };
  } catch (err) {
    const status = err?.code === 401 ? 401 : err?.code === 403 ? 403 : 500;
    return {
      statusCode: status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({ ok: false, error: err?.message || 'admin_check_failed', code: err?.code || 'admin_check_failed' }),
    };
  }
};
