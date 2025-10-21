// /.netlify/functions/admin-timesheets-list
const { withSupabase, jsonOk, jsonError } = require('./_supabase.js');

module.exports.handler = withSupabase(async ({ event, supabase, trace, debug }) => {
  // Parse filters from POST body or GET query
  let body = {};
  if (event.httpMethod === 'POST' && event.body) {
    try { body = JSON.parse(event.body || '{}'); } catch {}
  } else if (event.httpMethod === 'GET' && event.queryStringParameters) {
    body = event.queryStringParameters;
  }

  const q         = (body.q || '').trim();
  const status    = (body.status || '').trim();
  const client_id = body.client_id ? Number(body.client_id) : null;
  const week      = body.week || null;

  // v_timesheets_admin columns per your screenshots:
  // id, week_ending, status, assignment_id, contractor_id, contractor_name, contractor_email,
  // project_id, project_name, client_id, client_name, total_hours
  let query = supabase
    .from('v_timesheets_admin')
    .select('*')
    .order('week_ending', { ascending: false })
    .order('id', { ascending: false });

  if (status)   query = query.eq('status', status);
  if (client_id)query = query.eq('client_id', client_id);
  if (week)     query = query.eq('week_ending', week);

  if (q) {
    // basic ilike across common columns
    query = query.or(
      [
        `contractor_email.ilike.%${q}%`,
        `client_name.ilike.%${q}%`,
        `project_name.ilike.%${q}%`
      ].join(',')
    );
  }

  const { data, error } = await query;
  if (error) return jsonError(500, 'query_failed', error.message, { trace });

  // Normalize fields expected by the UI (std/ot/rates may be absent in view)
  const items = (data || []).map(r => ({
    ...r,
    std: Number(r.std ?? 0),
    ot:  Number(r.ot ?? 0),
    rate_std: Number(r.rate_std ?? 0),
    rate_ot:  Number(r.rate_ot ?? 0),
  }));

  return jsonOk({ ok: true, items, trace });
});
