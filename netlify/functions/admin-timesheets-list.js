const { getContext } = require('./_auth.js');
const { supabase, hasSupabase, jsonOk, jsonError, supabaseStatus } = require('./_supabase.js');
const { loadStaticTimesheets } = require('./_timesheets-helpers.js');

function normaliseSupabaseRows(data = []) {
  return data.map((row) => {
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
}

function normaliseStaticRows(rows = []) {
  return rows.map((row) => ({
    id: row.id,
    assignment_id: row.assignment_id,
    candidate_id: row.candidate_id,
    candidate_name: row.candidate_name,
    contractor_id: row.assignment?.contractorId || null,
    contractor_name: row.contractor_name || row.assignment?.contractorName || row.candidate_name,
    contractor_email: row.contractor_email || row.candidate?.email || null,
    client_id: row.client_id || row.assignment?.clientId || null,
    client_name: row.client_name || row.assignment?.clientName || null,
    project_id: row.project_id || row.assignment?.projectId || null,
    project_name: row.project_name || row.assignment?.projectName || null,
    status: row.status,
    week_start: row.week_start,
    week_ending: row.week_ending,
    submitted_at: row.submitted_at,
    approved_at: row.approved_at,
    approved_by: row.approved_by,
    approver_email: row.approver_email,
    ts_ref: row.ts_ref,
    assignment_ref: row.assignment_ref || row.assignment?.ref || null,
    std: Math.max(0, Number(row.total_hours || 0) - Number(row.ot_hours || 0)),
    ot: Number(row.ot_hours || 0),
    rate_std: Number(row.rate_pay || 0),
    rate_ot: Number(row.rate_charge || 0),
    currency: row.currency || 'GBP',
    pay_amount: row.pay_amount,
    charge_amount: row.charge_amount,
    gp_amount: row.gp_amount,
  }));
}

function filterRows(rows, { q, status, clientId, week }) {
  const needle = (q || '').toLowerCase();
  const weekNeedle = week ? String(week) : '';
  return rows.filter((row) => {
    if (status && row.status !== status) return false;
    if (clientId && Number(row.client_id) !== Number(clientId)) return false;
    if (weekNeedle && String(row.week_ending) !== weekNeedle) return false;
    if (needle) {
      const haystack = [
        row.candidate_name,
        row.contractor_email,
        row.client_name,
        row.project_name,
        row.assignment_ref,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

module.exports.handler = async (event, context) => {
  const trace = `ts-${Date.now()}`;

  let body = {};
  if (event.httpMethod === 'POST' && event.body) {
    try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  } else if (event.httpMethod === 'GET' && event.queryStringParameters) {
    body = event.queryStringParameters;
  }

  const q = (body.q || '').trim();
  const status = (body.status || '').trim();
  const clientId = body.client_id ? Number(body.client_id) : null;
  const week = body.week || null;

  try {
    await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    const statusCode = err.code === 401 ? 401 : err.code === 403 ? 403 : 500;
    return jsonError(statusCode, 'unauthorized', err.message || 'Unauthorized', { trace });
  }

  try {
    if (!hasSupabase()) {
      const staticRows = normaliseStaticRows(loadStaticTimesheets());
      const filtered = filterRows(staticRows, { q, status, clientId, week });
      console.warn('[timesheets] using static fallback dataset (%d rows)', filtered.length);
      return jsonOk({ ok: true, items: filtered, readOnly: true, source: 'static', supabase: supabaseStatus(), trace });
    }

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

    if (status) query = query.eq('status', status);
    if (clientId) query = query.eq('assignments.client_id', clientId);
    if (week) query = query.eq('week_ending', week);
    if (q) {
      query = query.or(
        [
          `contractor_email.ilike.%${q}%`,
          `client_name.ilike.%${q}%`,
          `project_name.ilike.%${q}%`,
        ].join(',')
      );
    }

    const { data, error } = await query;
    if (error) return jsonError(500, 'query_failed', error.message, { trace });

    return jsonOk({ ok: true, items: normaliseSupabaseRows(data || []), trace });
  } catch (err) {
    return jsonError(500, 'unhandled', err.message || 'Unexpected error', { trace });
  }
};
