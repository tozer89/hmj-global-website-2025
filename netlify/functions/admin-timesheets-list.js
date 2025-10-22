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

  let query = supabase
    .from('timesheets')
    .select(`
      id,
      assignment_id,
      candidate_id,
      candidate_name,
      contractor_name,
      contractor_email,
      client_name,
      project_name,
      week_start,
      week_ending,
      status,
      submitted_at,
      approved_at,
      approved_by,
      approver_email,
      ts_ref,
      assignment_ref,
      total_hours,
      ot_hours,
      rate_pay,
      rate_charge,
      currency,
      pay_amount,
      charge_amount,
      gp_amount,
      h_mon,
      h_tue,
      h_wed,
      h_thu,
      h_fri,
      h_sat,
      h_sun,
      assignments:assignment_id!inner (
        client_id,
        client_name,
        project_id,
        project_name,
        contractor_id,
        contractor_name,
        contractor_email
      )
    `)
    .order('week_ending', { ascending: false })
    .order('id', { ascending: false });

  if (status)   query = query.eq('status', status);
  if (client_id)query = query.eq('assignments.client_id', client_id);
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
  const items = (data || []).map((row) => {
    const dayKeys = ['h_mon', 'h_tue', 'h_wed', 'h_thu', 'h_fri', 'h_sat', 'h_sun'];
    const stdHours = dayKeys.reduce((sum, key) => sum + Number(row[key] || 0), 0);
    const otHours = Number(row.ot_hours || 0);
    const rateStd = Number(row.rate_pay || 0);
    const rateOt = Number(row.rate_charge || 0);
    return {
      id: row.id,
      assignment_id: row.assignment_id,
      candidate_id: row.candidate_id,
      candidate_name: row.candidate_name,
      contractor_id: row.assignments?.contractor_id,
      contractor_name: row.contractor_name || row.assignments?.contractor_name,
      contractor_email: row.contractor_email || row.assignments?.contractor_email,
      client_id: row.assignments?.client_id,
      client_name: row.client_name || row.assignments?.client_name,
      project_id: row.assignments?.project_id,
      project_name: row.project_name || row.assignments?.project_name,
      status: row.status,
      week_start: row.week_start,
      week_ending: row.week_ending,
      submitted_at: row.submitted_at,
      approved_at: row.approved_at,
      approved_by: row.approved_by,
      approver_email: row.approver_email,
      ts_ref: row.ts_ref,
      assignment_ref: row.assignment_ref,
      std: stdHours,
      ot: otHours,
      rate_std: rateStd,
      rate_ot: rateOt,
      currency: row.currency || 'GBP',
      pay_amount: row.pay_amount,
      charge_amount: row.charge_amount,
      gp_amount: row.gp_amount,
    };
  });

  return jsonOk({ ok: true, items, trace });
});
