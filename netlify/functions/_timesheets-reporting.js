const { supabaseStatus, hasSupabase, getSupabase } = require('./_supabase.js');
const { loadStaticTimesheets } = require('./_timesheets-helpers.js');
const { fetchSettings, DEFAULT_SETTINGS, fiscalWeekNumber } = require('./_settings-helpers.js');

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function sumDayHours(row) {
  const keys = ['h_mon', 'h_tue', 'h_wed', 'h_thu', 'h_fri', 'h_sat', 'h_sun'];
  return keys.reduce((sum, key) => sum + toNumber(row[key]), 0);
}

function normalizeTimesheet(row = {}, baseWeekEnding = DEFAULT_SETTINGS.fiscal_week1_ending) {
  const assignment = row.assignments || row.assignment || {};
  const project = assignment.projects || assignment.project || {};
  const client = project.clients || project.client || {};

  const totalHours = toNumber(row.total_hours || row.totalHours || sumDayHours(row));
  const otHours = toNumber(row.ot_hours || row.otHours);
  const stdHours = Math.max(totalHours - otHours, 0);
  const payAmountRaw = row.pay_amount ?? row.payAmount;
  const chargeAmountRaw = row.charge_amount ?? row.chargeAmount;
  const gpAmountRaw = row.gp_amount ?? row.gpAmount;
  const payAmount = toNumber(payAmountRaw) || toNumber(row.rate_pay) * (stdHours + otHours);
  const chargeAmount = toNumber(chargeAmountRaw) || toNumber(row.rate_charge) * (stdHours + otHours);
  const gpAmount = Number.isFinite(Number(gpAmountRaw)) ? toNumber(gpAmountRaw) : chargeAmount - payAmount;

  const clientId = client.id || assignment.client_id || row.client_id || null;
  const clientName = row.client_name || assignment.client_name || client.name || null;
  const contractorEmail = assignment.contractor_email || row.contractor_email || null;
  const contractorName = assignment.contractor_name || row.contractor_name || row.candidate_name || null;
  const contractorId = assignment.contractor_id || row.contractor_id || row.candidate_id || null;
  const weekEnding = row.week_ending || row.weekEnding || null;

  return {
    id: row.id,
    assignment_id: row.assignment_id || assignment.id || null,
    assignment_ref: row.assignment_ref || assignment.as_ref || assignment.ref || null,
    ts_ref: row.ts_ref || null,
    candidate_name: row.candidate_name || contractorName,
    contractor_id: contractorId,
    contractor_name: contractorName,
    contractor_email: contractorEmail,
    client_id: clientId,
    client_name: clientName,
    week_ending: weekEnding,
    status: row.status || null,
    payroll_status: (row.payroll_status || row.pay_status || row.status || 'draft').toLowerCase(),
    total_hours: totalHours,
    std_hours: stdHours,
    ot_hours: otHours,
    pay_amount: payAmount,
    charge_amount: chargeAmount,
    gp_amount: gpAmount,
    week_no: fiscalWeekNumber(weekEnding, baseWeekEnding),
  };
}

function buildAvailableFilters(rows = []) {
  const weeks = new Set();
  const clientMap = new Map();
  rows.forEach((row) => {
    if (row.week_ending) weeks.add(row.week_ending);
    const key = row.client_id || row.client_name;
    if (key) {
      if (!clientMap.has(key)) {
        clientMap.set(key, { value: String(key), label: row.client_name || String(key) });
      }
    }
  });

  const sortedWeeks = Array.from(weeks).sort((a, b) => (a < b ? 1 : -1));
  const clients = Array.from(clientMap.values()).sort((a, b) => a.label.localeCompare(b.label));

  return {
    weeks: sortedWeeks.map((value) => ({ value, label: value })),
    clients,
  };
}

function applyFilters(rows, { weekEnding, clientFilter }) {
  const clientNeedle = clientFilter ? String(clientFilter).toLowerCase() : null;
  return rows.filter((row) => {
    if (weekEnding && row.week_ending !== weekEnding) return false;
    if (clientNeedle) {
      const idMatch = row.client_id ? String(row.client_id).toLowerCase() === clientNeedle : false;
      const nameMatch = row.client_name ? row.client_name.toLowerCase() === clientNeedle : false;
      if (!idMatch && !nameMatch) return false;
    }
    return true;
  });
}

async function loadTimesheetRows(event, { limit = 1000 } = {}) {
  const settings = await fetchSettings(event, ['fiscal_week1_ending']);
  const baseWeekEnding = settings.settings?.fiscal_week1_ending || DEFAULT_SETTINGS.fiscal_week1_ending;

  const respond = (rows, source, warning = null) => ({
    rows,
    source,
    warning,
    supabase: supabaseStatus(),
    config: { week1Ending: baseWeekEnding, source: settings.source },
  });

  const fallbackRows = () => loadStaticTimesheets(baseWeekEnding).map((row) => normalizeTimesheet(row, baseWeekEnding));

  if (!hasSupabase()) {
    return respond(fallbackRows(), 'static', settings.error || 'Supabase unavailable');
  }

  const supabase = getSupabase(event);
  const { data, error } = await supabase
    .from('timesheets')
    .select(
      `id, assignment_id, assignment_ref, candidate_id, candidate_name, contractor_email, contractor_name, client_name,
       week_ending, status, payroll_status, total_hours, ot_hours, rate_pay, rate_charge, pay_amount, charge_amount, gp_amount,
       assignments:assignment_id (id, contractor_id, contractor_email, contractor_name, client_id, client_name,
         projects:project_id (id, name, client_id, clients:client_id (id, name))
       )`
    )
    .order('week_ending', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 1000, 50), 2000));

  if (error) {
    console.warn('[timesheets-reporting] supabase query failed — using static fallback', error.message);
    return respond(fallbackRows(), 'static-error', error.message);
  }

  const rows = (data || []).map((row) => normalizeTimesheet(row, baseWeekEnding));
  if (!rows.length) {
    const fallback = fallbackRows();
    if (fallback.length) {
      return respond(fallback, 'static-empty', 'No live rows returned; showing fallback data.');
    }
  }

  return respond(rows, 'supabase');
}

module.exports = {
  toNumber,
  normalizeTimesheet,
  buildAvailableFilters,
  applyFilters,
  loadTimesheetRows,
};
