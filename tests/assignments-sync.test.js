const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCandidateLookups,
  matchCandidateForTimesheetPortalAssignment,
  mergeTimesheetPortalAssignment,
} = require('../netlify/functions/_assignments-sync.js');

test('matchCandidateForTimesheetPortalAssignment matches by email before payroll ref or name', () => {
  const candidates = [
    { id: 'candidate-1', email: 'joe@example.com', full_name: 'Joseph Tozer', payroll_ref: '5580' },
    { id: 'candidate-2', email: 'someone@example.com', full_name: 'Joseph Tozer', payroll_ref: '9988' },
  ];
  const lookups = buildCandidateLookups(candidates);
  const result = matchCandidateForTimesheetPortalAssignment({
    candidateEmail: 'JOE@example.com',
    payrollRef: '9988',
    candidateName: 'Joseph Tozer',
  }, lookups);

  assert.equal(result.candidate.id, 'candidate-1');
  assert.equal(result.matchedBy, 'email');
});

test('mergeTimesheetPortalAssignment preserves manual data while applying remote fields', () => {
  const payload = mergeTimesheetPortalAssignment({
    assignment: {
      id: 'job-99',
      reference: 'AS-99',
      title: 'Senior Planner',
      status: 'Active',
      clientName: 'BluePeak Pharma',
      clientSite: 'Manufacturing Hub',
      startDate: '2026-03-15',
      endDate: '2026-12-31',
      currency: 'EUR',
      ratePay: 55,
      chargeStd: 82,
      contractorId: '5580',
      consultantName: 'James Holloway',
      active: true,
    },
    existing: {
      id: 44,
      candidate_id: 'candidate-7',
      notes: 'Keep this note',
      project_id: 12,
      site_id: 13,
      auto_ts: true,
      approver: 'approver@example.com',
      po_number: 'PO-77',
    },
    candidate: { id: 'candidate-7', full_name: 'Joseph Tozer', payroll_ref: '5580' },
    matchedBy: 'payroll_ref',
  });

  assert.equal(payload.id, 44);
  assert.equal(payload.candidate_id, 'candidate-7');
  assert.equal(payload.contractor_id, 5580);
  assert.equal(payload.job_title, 'Senior Planner');
  assert.equal(payload.client_name, 'BluePeak Pharma');
  assert.equal(payload.client_site, 'Manufacturing Hub');
  assert.equal(payload.currency, 'EUR');
  assert.equal(payload.rate_pay, 55);
  assert.equal(payload.charge_std, 82);
  assert.equal(payload.project_id, 12);
  assert.equal(payload.site_id, 13);
  assert.equal(payload.auto_ts, true);
  assert.equal(payload.notes, 'Keep this note');
});

test('mergeTimesheetPortalAssignment tolerates a missing existing row during first sync', () => {
  const payload = mergeTimesheetPortalAssignment({
    assignment: {
      id: 'job-101',
      reference: 'AS-101',
      title: 'Package Manager',
      candidateName: 'Jordan Smith',
      clientName: 'SA3GRP',
      contractorId: '8842',
      active: true,
    },
    existing: null,
    candidate: null,
    matchedBy: null,
  });

  assert.equal(payload.id, undefined);
  assert.equal(payload.as_ref, 'AS-101');
  assert.equal(payload.contractor_id, 8842);
  assert.equal(payload.candidate_id, null);
  assert.equal(payload.client_name, 'SA3GRP');
  assert.equal(payload.currency, 'GBP');
});
