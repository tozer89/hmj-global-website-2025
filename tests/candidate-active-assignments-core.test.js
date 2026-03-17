const test = require('node:test');
const assert = require('node:assert/strict');

const helpers = require('../js/candidate-active-assignments-core.js');

test('reference token matching can resolve assignment refs embedded in TSP assignment codes', () => {
  const lookups = helpers.buildAssignmentLookups([
    {
      id: 23,
      as_ref: 'SA3FRA 5588',
      status: 'draft',
      active: true,
      start_date: '2026-03-02',
      end_date: '2026-12-31',
      client_name: 'SA3',
      job_title: 'Electrician',
    },
    {
      id: 24,
      as_ref: 'PLC-SA3GRP-FRA87-5078',
      status: 'live',
      active: true,
      start_date: '2026-03-01',
      end_date: '2026-12-31',
      client_name: 'SA3 Group',
      job_title: 'Supervisor',
    },
  ], new Date('2026-03-17T12:00:00Z'));

  const summary = helpers.summariseCandidateAssignments({
    id: 'candidate-1',
    payroll_ref: '5588',
    ref: '5588',
  }, lookups);

  const second = helpers.summariseCandidateAssignments({
    id: 'candidate-2',
    payroll_ref: '5078',
    ref: '5078',
  }, lookups);

  assert.equal(summary.count, 1);
  assert.equal(summary.primary.client_name, 'SA3');
  assert.equal(second.count, 1);
  assert.equal(second.primary.job_title, 'Supervisor');
});

test('candidate reference digits are enough to match an assignment code token', () => {
  const lookups = helpers.buildAssignmentLookups([
    {
      id: 88,
      as_ref: 'PLC-SA3GRP-FRA87-5449',
      status: 'live',
      active: true,
      start_date: '2026-03-01',
      end_date: '2026-12-31',
    },
  ], new Date('2026-03-17T12:00:00Z'));

  const summary = helpers.summariseCandidateAssignments({
    ref: '5449',
  }, lookups);

  assert.equal(summary.count, 1);
  assert.equal(summary.primary.reference, 'PLC-SA3GRP-FRA87-5449');
});

test('inactive or ended assignments are excluded from the active-assignment tab set', () => {
  const lookups = helpers.buildAssignmentLookups([
    {
      id: 1,
      as_ref: 'LIVE-5588',
      status: 'live',
      active: true,
      start_date: '2026-03-01',
      end_date: '2026-12-31',
    },
    {
      id: 2,
      as_ref: 'OLD-5588',
      status: 'complete',
      active: false,
      start_date: '2025-01-01',
      end_date: '2025-12-31',
    },
    {
      id: 3,
      as_ref: 'ENDED-5588',
      status: 'draft',
      active: true,
      start_date: '2026-01-01',
      end_date: '2026-03-01',
    },
  ], new Date('2026-03-17T12:00:00Z'));

  const summary = helpers.summariseCandidateAssignments({
    payroll_ref: '5588',
  }, lookups);

  assert.equal(summary.count, 1);
  assert.equal(summary.primary.reference, 'LIVE-5588');
});

test('assignment normalizer preserves the extra TSP assignment fields used in admin tables', () => {
  const row = helpers.normaliseAssignmentRow({
    id: 9,
    as_ref: 'ARAFRANK-5448',
    client_name: 'ARA Industrial Engineering Ltd',
    assignment_description: 'ARA industrial engineering Ltd - Other',
    branch_name: 'ARA Industrial Engineering Ltd',
    cost_centre: 'ARA Industrial Engineering - MISC',
    ir35_status: 'N/A',
    assigned_approvers: 'Luke Mooney',
    assigned_contractors: 'Bogdan-Adrian Zamfir',
    assignment_category: 'Contractor',
    last_modified: '2026-03-17T10:00:00Z',
  });

  assert.equal(row.assignment_description, 'ARA industrial engineering Ltd - Other');
  assert.equal(row.branch_name, 'ARA Industrial Engineering Ltd');
  assert.equal(row.cost_centre, 'ARA Industrial Engineering - MISC');
  assert.equal(row.ir35_status, 'N/A');
  assert.equal(row.assigned_approvers, 'Luke Mooney');
  assert.equal(row.assigned_contractors, 'Bogdan-Adrian Zamfir');
  assert.equal(row.assignment_category, 'Contractor');
  assert.equal(row.last_modified, '2026-03-17T10:00:00Z');
});
