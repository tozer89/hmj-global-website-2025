const { DEFAULT_SETTINGS, fiscalWeekNumber } = require('./_settings-helpers.js');

let staticTimesheets = [];
try {
  const seed = require('../../data/timesheets.json');
  if (Array.isArray(seed?.timesheets)) staticTimesheets = seed.timesheets;
  else if (Array.isArray(seed)) staticTimesheets = seed;
} catch (err) {
  console.warn('[timesheets] unable to pre-load static dataset', err?.message || err);
}

function toTimesheet(row = {}, baseWeekEnding = DEFAULT_SETTINGS.fiscal_week1_ending) {
  const hours = ['h_mon', 'h_tue', 'h_wed', 'h_thu', 'h_fri', 'h_sat', 'h_sun'];
  const totals = hours.reduce((sum, key) => sum + Number(row[key] || 0), 0);
  const weekEnding = row.week_ending || row.weekEnding || null;
  return {
    id: Number(row.id) || row.id || null,
    assignment_id: row.assignment_id || null,
    candidate_id: row.candidate_id || null,
    candidate_name: row.candidate_name || null,
    contractor_name: row.contractor_name || row.candidate_name || null,
    contractor_email: row.contractor_email || null,
    client_name: row.client_name || row.assignment?.clientName || null,
    project_name: row.project_name || row.assignment?.projectName || null,
    week_start: row.week_start || null,
    week_ending: row.week_ending || null,
    status: row.status || 'draft',
    submitted_at: row.submitted_at || null,
    approved_at: row.approved_at || null,
    approved_by: row.approved_by || null,
    approver_email: row.approver_email || null,
    ts_ref: row.ts_ref || null,
    assignment_ref: row.assignment_ref || row.assignment?.ref || null,
    total_hours: Number(row.total_hours || totals || 0),
    ot_hours: Number(row.ot_hours || 0),
    rate_pay: Number(row.rate_pay || row.assignment?.ratePay || 0),
    rate_charge: Number(row.rate_charge || row.assignment?.rateCharge || 0),
    currency: row.currency || row.assignment?.currency || 'GBP',
    pay_amount: Number(row.pay_amount || 0),
    charge_amount: Number(row.charge_amount || 0),
    gp_amount: Number(row.gp_amount || 0),
    h_mon: Number(row.h_mon || 0),
    h_tue: Number(row.h_tue || 0),
    h_wed: Number(row.h_wed || 0),
    h_thu: Number(row.h_thu || 0),
    h_fri: Number(row.h_fri || 0),
    h_sat: Number(row.h_sat || 0),
    h_sun: Number(row.h_sun || 0),
    assignment: row.assignment || null,
    candidate: row.candidate || null,
    payroll_status: row.payroll_status || null,
    week_ending: weekEnding,
    week_no: fiscalWeekNumber(weekEnding, baseWeekEnding),
  };
}

function loadStaticTimesheets(baseWeekEnding = DEFAULT_SETTINGS.fiscal_week1_ending) {
  if (!staticTimesheets.length) return [];
  return staticTimesheets.map((row) => toTimesheet(row, baseWeekEnding));
}

module.exports = {
  loadStaticTimesheets,
  toTimesheet,
};
