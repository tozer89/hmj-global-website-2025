// /.netlify/functions/admin-audit-list
const { withSupabase, jsonOk, jsonError } = require('./_supabase.js');

module.exports.handler = withSupabase(async ({ event, supabase, trace }) => {
  let limit = 10;
  if (event.httpMethod === 'POST' && event.body) {
    try { const b = JSON.parse(event.body || '{}'); if (b.limit) limit = Math.max(1, Math.min(100, Number(b.limit))); } catch {}
  } else if (event.httpMethod === 'GET' && event.queryStringParameters?.limit) {
    limit = Math.max(1, Math.min(100, Number(event.queryStringParameters.limit)));
  }

  const { data, error } = await supabase
    .from('admin_audit_logs')
    .select('*')
    .order('at', { ascending: false })
    .limit(limit);

  if (error) return jsonError(500, 'query_failed', error.message, { trace });

  const items = (data || []).map(r => ({
    id: r.id,
    at: r.at || r.created_at,
    actor_email: r.actor_email,
    action: r.action,
    target_type: r.target_type,
    target_id: r.target_id,
    summary: r.meta ? JSON.stringify(r.meta) : ''
  }));

  return jsonOk({ ok: true, items, trace });
});
