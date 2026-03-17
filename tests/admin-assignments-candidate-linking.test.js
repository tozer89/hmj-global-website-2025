const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('assignments admin editor supports website candidate pairing alongside contractor ids', () => {
  const source = read('admin/assignments.html');

  assert.match(source, /\['candidate_id','Website candidate'\]/);
  assert.match(source, /key==='candidate_id'/);
  assert.match(source, /dropdowns\.candidates/);
  assert.match(source, /payload\.candidate_id = form\.candidate_id == null/);
  assert.match(source, /btnSyncTsp/);
  assert.match(source, /admin-assignments-sync-timesheet-portal/);
  assert.match(source, /btnRefresh'\)\.onclick = \(\)=>\{ page=1; syncFromTsp\(\); \}/);
  assert.match(source, /autoSyncAttempted = true/);
});

test('assignment dropdown endpoint exposes website candidates for pairing', () => {
  const source = read('netlify/functions/admin-assignments-dropdowns.js');

  assert.match(source, /from\('candidates'\)/);
  assert.match(source, /select\('id,full_name,first_name,last_name,email,status,payroll_ref'\)/);
  assert.match(source, /candidates,/);
});

test('assignment save, list and publish flows preserve candidate_id', () => {
  const saveSource = read('netlify/functions/admin-assignments-save.js');
  const listSource = read('netlify/functions/admin-assignments-list.js');
  const publishSource = read('netlify/functions/admin-assignments-publish.js');

  assert.match(saveSource, /candidate_id:/);
  assert.match(saveSource, /currency: assignment\.currency \|\| 'GBP'/);
  assert.match(saveSource, /candidate_id or contractor_id, job_title, start_date are required for new assignments/);
  assert.match(listSource, /'candidate_id',/);
  assert.match(listSource, /const clientName = String\(body\.client_name \|\| ''\)\.trim\(\)/);
  assert.match(publishSource, /if \(!assignment\.candidate_id && !assignment\.contractor_id\)/);
  assert.match(publishSource, /\.eq\('id', assignment\.candidate_id\)/);
});

test('assignment sync endpoint and schema scripts include TSP source tracking', () => {
  const syncSource = read('netlify/functions/admin-assignments-sync-timesheet-portal.js');
  const helperSource = read('netlify/functions/_assignments-sync.js');

  assert.match(syncSource, /listTimesheetPortalAssignments/);
  assert.match(syncSource, /const reference = String\(assignment\.reference \|\| assignment\.id \|\| ''\)\.trim\(\)/);
  assert.match(helperSource, /matchCandidateForTimesheetPortalAssignment/);
  assert.match(syncSource, /\.upsert\(payloads\)/);
});
