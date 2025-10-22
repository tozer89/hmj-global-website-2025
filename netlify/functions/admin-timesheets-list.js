const { getContext } = require('./_auth.js');
const { supabase, hasSupabase, jsonOk, jsonError, supabaseStatus } = require('./_supabase.js');
const { loadStaticTimesheets } = require('./_timesheets-helpers.js');
const { fetchSettings, DEFAULT_SETTINGS, fiscalWeekNumber } = require('./_settings-helpers.js');

function normaliseSupabaseRows(data = [], baseWeekEnding = DEFAULT_SETTINGS.fiscal_week1_ending) {
  return data.map((row) => {
    const dayKeys = ['h_mon', 'h_tue', 'h_wed', 'h_thu', 'h_fri', 'h_sat', 'h_sun'];
    const stdHours = dayKeys.reduce((sum, key) => sum + Number(row[key] || 0), 0);
    const otHours = Number(row.ot_hours || 0);
    const rateStd = Number(row.rate_pay || 0);
    const rateOt = Number(row.rate_charge || 0);

    const assignment = row.assignments || {};
    const project = assignment.projects || assignment.project || {};
    const client = project.clients || project.client || {};

    const weekEnding = row.week_ending || null;

    return {
      id: row.id,
      assignment_id: row.assignment_id,
      candidate_id: row.candidate_id || assignment.candidate_id || null,
      candidate_name: row.candidate_name || assignment.candidate_name || null,
      contractor_id: assignment.contractor_id || null,
      contractor_name: assignment.contractor_name || null,
      contractor_email: assignment.contractor_email || null,
      client_id: client.id || project.client_id || assignment.client_id || null,
      client_name: row.client_name || assignment.client_name || client.name || null,
      project_id: assignment.project_id || project.id || null,
      project_name: row.project_name || project.name || null,
      status: row.status,
      week_start: row.week_start,
      week_ending: weekEnding,
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
      week_no: fiscalWeekNumber(weekEnding, baseWeekEnding),
    };
  });
}

function normaliseStaticRows(rows = [], baseWeekEnding = DEFAULT_SETTINGS.fiscal_week1_ending) {
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
    week_no: fiscalWeekNumber(row.week_ending, baseWeekEnding),
  }));
}

function filterRows(rows, { q, status, clientId, week, weekNumber }) {
  const needle = (q || '').toLowerCase();
  const weekNeedle = week ? String(week) : '';
  return rows.filter((row) => {
    if (status && row.status !== status) return false;
    if (clientId && Number(row.client_id) !== Number(clientId)) return false;
    if (weekNeedle && String(row.week_ending) !== weekNeedle) return false;
    if (Number.isFinite(weekNumber) && weekNumber && Number(row.week_no || 0) !== Number(weekNumber)) return false;
    if (needle) {
      const haystack = [
        row.candidate_name,
        row.client_name,
        row.project_name,
        row.assignment_ref,
        row.ts_ref,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

function shouldFallback(err) {
  if (!err) return false;
  const msg = String(err.message || err);
  if (/column .+ does not exist/i.test(msg)) return true;
  if (/relation .+ does not exist/i.test(msg)) return true;
  if (/permission denied/i.test(msg)) return true;
  if (/violates row-level security/i.test(msg)) return true;
  return false;
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
  const weekNumber = body.week_number ? Number(body.week_number) : body.weekNo ? Number(body.weekNo) : null;

  const settingsPromise = fetchSettings(event, ['fiscal_week1_ending']);

  const serveStatic = async (reason, auth = null) => {
    const { settings, source: settingsSource } = await settingsPromise;
    const baseWeekEnding = settings.fiscal_week1_ending || DEFAULT_SETTINGS.fiscal_week1_ending;
    const staticRows = normaliseStaticRows(loadStaticTimesheets(baseWeekEnding), baseWeekEnding);
    const filtered = filterRows(staticRows, { q, status, clientId, week, weekNumber });
    console.warn('[timesheets] using static fallback dataset (%d rows)', filtered.length);
    return jsonOk({
      ok: true,
      items: filtered,
      readOnly: true,
      source: 'static',
      supabase: supabaseStatus(),
      trace,
      auth,
      config: { week1Ending: baseWeekEnding, source: settingsSource },
    });
  };

  try {
    await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    console.warn('[timesheets] auth failed — serving static dataset', err?.message || err);
    return serveStatic(err?.message || 'auth_failed', { ok: false, status: err?.code || 403, error: err?.message || 'Unauthorized' });
  }

  try {
    const { settings, source: settingsSource } = await settingsPromise;
    const baseWeekEnding = settings.fiscal_week1_ending || DEFAULT_SETTINGS.fiscal_week1_ending;

    if (!hasSupabase()) {
      return serveStatic(supabaseStatus().error || 'supabase_unavailable');
    }

    let query = supabase
      .from('timesheets')
      .select(`
        id,
        assignment_id,
        candidate_id,
        candidate_name,
        client_name,
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
          contractor_id,
          project_id,
          site_id,
          client_name,
          projects:project_id (
            id,
            name,
            client_id
          )
        )
      `)
      .order('week_ending', { ascending: false })
      .order('id', { ascending: false });

    if (status) query = query.eq('status', status);
    if (week) query = query.eq('week_ending', week);
    if (Number.isFinite(weekNumber) && weekNumber) {
      // derive start/end window based on base week ending
      const offset = Number(weekNumber) - 1;
      const baseDate = new Date(`${baseWeekEnding}T00:00:00Z`);
      if (!Number.isNaN(baseDate.getTime())) {
        const target = new Date(baseDate.getTime() + offset * 7 * 86400000);
        const iso = target.toISOString().slice(0, 10);
        query = query.eq('week_ending', iso);
      }
    }
    if (q) {
      query = query.or(
        [
          `candidate_name.ilike.%${q}%`,
          `client_name.ilike.%${q}%`,
          `assignment_ref.ilike.%${q}%`,
          `ts_ref.ilike.%${q}%`,
        ].join(',')
      );
    }

    const { data, error } = await query;
    if (error) {
      if (shouldFallback(error)) {
        console.warn('[timesheets] supabase query failed (%s) — using static fallback', error.message);
        return serveStatic(error.message, { ok: false, error: error.message, status: 503 });
      }
      return jsonError(500, 'query_failed', error.message, { trace });
    }

    const normalised = normaliseSupabaseRows(data || [], baseWeekEnding);
    const filtered = filterRows(normalised, { q, status, clientId, week, weekNumber });
    return jsonOk({
      ok: true,
      items: filtered,
      trace,
      supabase: supabaseStatus(),
      config: { week1Ending: baseWeekEnding, source: settingsSource },
    });
  } catch (err) {
    return jsonError(500, 'unhandled', err.message || 'Unexpected error', { trace });
  }
};
