// netlify/functions/admin-audit-list.js
const { supabase, getContext } = require('./_timesheet-helpers');

exports.handler = async (event, context) => {
  try {
    const { user } = await getContext(context);
    const roles = user?.app_metadata?.roles || user?.roles || [];
    if (!roles.includes('admin')) throw Object.assign(new Error('Forbidden'), { code: 401 });

    const { limit = 100 } = JSON.parse(event.body || '{}');
    const { data, error } = await supabase
      .from('admin_audit_logs')
      .select('*').order('at', { ascending: false }).limit(Math.min(limit, 500));
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
