// netlify/functions/admin-audit-list.js
const { getContext } = require('./_timesheet-helpers');

exports.handler = async (event, context) => {
  try {
    const { supabase } = await getContext(context, { requireAdmin: true });

    const { since = null, limit = 200 } = JSON.parse(event.body || '{}');
    let q = supabase.from('admin_audit_logs')
      .select('id,created_at,actor_email,action,target_type,target_id,meta')
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(limit) || 200, 1000));

    if (since) q = q.gte('created_at', since);

    const { data, error } = await q;
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
