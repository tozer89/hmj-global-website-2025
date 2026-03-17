const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAssignmentReferenceLookup,
  buildClientCodeMap,
  decorateAssignmentRowWithTimesheetPortal,
} = require('../netlify/functions/_timesheet-portal-assignment-meta.js');

test('assignment meta overlay enriches website assignments from mirrored TSP jobs', () => {
  const lookup = buildAssignmentReferenceLookup([
    {
      id: 'job-1',
      reference: 'ARAFRANK-5448',
      clientCode: 'ARA01',
      clientName: '',
      assignmentDescription: 'ARA industrial engineering Ltd - Other',
      branchName: 'ARA Industrial Engineering Ltd',
      costCentre: 'ARA Industrial Engineering - MISC',
      ir35Status: 'N/A',
      assignedApprovers: ['Luke Mooney'],
      assignedContractors: [],
      candidateName: 'Bogdan-Adrian Zamfir',
      assignmentCategory: 'Contractor',
      active: true,
      lastModified: '2026-03-17T10:00:00Z',
    },
  ]);
  const clientCodeMap = buildClientCodeMap([
    { client_code: 'ARA01', name: 'ARA Industrial Engineering Ltd' },
  ]);

  const row = decorateAssignmentRowWithTimesheetPortal({
    id: 44,
    as_ref: 'ARAFRANK-5448',
    candidate_name: 'Bogdan-Adrian Zamfir',
  }, lookup, clientCodeMap);

  assert.equal(row.client_name, 'ARA Industrial Engineering Ltd');
  assert.equal(row.assignment_description, 'ARA industrial engineering Ltd - Other');
  assert.equal(row.branch_name, 'ARA Industrial Engineering Ltd');
  assert.equal(row.cost_centre, 'ARA Industrial Engineering - MISC');
  assert.equal(row.ir35_status, 'N/A');
  assert.equal(row.assigned_approvers, 'Luke Mooney');
  assert.equal(row.assigned_contractors, 'Bogdan-Adrian Zamfir');
  assert.equal(row.timesheet_portal_reference, 'ARAFRANK-5448');
  assert.equal(row.timesheet_portal_active, true);
});

test('assignment meta overlay falls back cleanly when no TSP row matches', () => {
  const row = decorateAssignmentRowWithTimesheetPortal({
    id: 45,
    as_ref: 'LOCAL-1001',
    candidate_name: 'Joseph Tozer',
    assignment_description: 'Electrical package',
    branch_name: 'Macclesfield',
    cost_centre: 'A+C Electrical - Hull',
  }, buildAssignmentReferenceLookup([]), new Map());

  assert.equal(row.assignment_description, 'Electrical package');
  assert.equal(row.branch_name, 'Macclesfield');
  assert.equal(row.cost_centre, 'A+C Electrical - Hull');
  assert.equal(row.assigned_contractors, 'Joseph Tozer');
  assert.equal(row.timesheet_portal_active, null);
});
