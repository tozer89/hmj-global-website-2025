#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const logic = require(path.join(__dirname, '..', 'admin', 'payroll-logic.js'));
const { applyFilters, computeTotals, detectIssues, friendlyErrorMessage, prepareAuditPayload } = logic;

function loadSampleRows() {
  const file = path.join(__dirname, '..', 'data', 'timesheets.json');
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = Array.isArray(payload?.timesheets) ? payload.timesheets : [];
  return entries.map((ts) => ({
    id: ts.id,
    weekEnding: ts.week_ending,
    payrollStatus: ts.payroll_status || ts.status,
    status: ts.status,
    totals: {
      hours: Number(ts.total_hours),
      ot: Number(ts.ot_hours),
      pay: Number(ts.pay_amount),
      charge: Number(ts.charge_amount),
    },
    candidateName: ts.candidate_name,
    candidate: { payrollRef: ts.candidate?.payrollRef || ts.candidate?.payroll_ref },
    assignment: {
      clientName: ts.client_name,
      jobTitle: ts.assignment?.jobTitle || ts.assignment?.job_title,
      poNumber: ts.assignment?.poNumber || ts.assignment?.po_number,
    },
  }));
}

function main() {
  const rows = loadSampleRows();
  assert(rows.length > 0, 'Sample rows should be available');

  const issues = detectIssues(rows);

  // All filters load without errors
  const filters = {
    status: 'paid',
    search: '',
    client: 'DataCore',
    candidate: '',
    invoiceRef: '',
    costCentre: '',
    poNumber: '',
    weekFrom: '',
    weekTo: '',
    quick: null,
    showIssues: false,
    showNotes: false,
  };
  const filtered = applyFilters(rows, filters, { issues });
  assert(Array.isArray(filtered), 'Filtered result should be an array');

  // Totals recalc when filters change
  const totalsAll = computeTotals(rows);
  const totalsFiltered = computeTotals(filtered);
  assert(totalsFiltered.grossPay <= totalsAll.grossPay + 1e-6, 'Filtered gross pay should not exceed total');

  // Audit payload includes notes and status
  const auditPayload = prepareAuditPayload('paid', 'Followed up with contractor');
  assert.strictEqual(auditPayload.status, 'paid');
  assert.strictEqual(auditPayload.note, 'Followed up with contractor');

  // Friendly auth errors for 403 responses
  const msg = friendlyErrorMessage(new Error('403 Forbidden'));
  assert(/Session expired/i.test(msg), '403 errors should surface session expired message');

  console.log('✅ Payroll page smoke checks passed.');
}

main();
