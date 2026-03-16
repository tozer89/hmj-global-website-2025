const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('candidates admin page uses the current shared admin bootstrap assets', () => {
  const html = read('admin/candidates.html');

  assert.match(html, /identity-loader\.js\?v=3/);
  assert.match(html, /\/admin\/common\.js\?v=34/);
  assert.match(html, /\/admin\/candidates\.js\?v=8/);
  assert.match(html, /id="bulk-rtw-reminder"/);
  assert.match(html, /id="btn-select-missing-rtw"/);
  assert.match(html, /id="bulk-doc-request"/);
  assert.match(html, /id="candidate-template-xlsx"/);
  assert.match(html, /id="btn-refresh-tsp"/);
  assert.match(html, /id="dw-assignments"/);
});

test('candidates debug badge distinguishes cookie-backed admin auth from a missing session', () => {
  const source = read('admin/candidates.js');

  assert.match(source, /auth: cookie session/);
  assert.match(source, /cookie-backed session/);
});

test('candidate admin functions allow valid cookie-backed admin sessions without a bearer token precheck', () => {
  const files = [
    'netlify/functions/admin-candidates-save.js',
    'netlify/functions/admin-candidates-delete.js',
    'netlify/functions/admin-candidates-list.js',
    'netlify/functions/admin-candidates-get.js',
    'netlify/functions/admin-candidates-export.js',
    'netlify/functions/admin-candidates-import.js',
  ];

  files.forEach((file) => {
    const source = read(file);
    assert.match(source, /withAdminCors\(baseHandler,\s*\{\s*requireToken:\s*false\s*\}\)/, `${file} should disable the preflight token gate`);
  });
});

test('candidate row actions use closest() event delegation so button text clicks still resolve the action', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /target\.closest\('\[data-role\]'\)/);
  assert.match(source, /rawTarget && rawTarget\.parentElement instanceof Element/);
});

test('candidate normalizer keeps synthetic display names out of persisted full_name payloads', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /const storedFullName = row\.full_name \|\| row\.fullName \|\| '';/);
  assert.match(source, /const displayName = storedFullName \|\| derivedFullName \|\| 'Candidate';/);
  assert.match(source, /full_name: storedFullName \|\| ''/);
  assert.match(source, /name: displayName/);
});

test('candidate drawer includes admin document upload controls and avoids deleting legacy link-only docs', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /data-doc-upload/);
  assert.match(source, /data-doc-input/);
  assert.match(source, /admin-candidate-doc-upload/);
  assert.match(source, /admin-candidate-doc-delete/);
  assert.match(source, /const canDelete = !!\(doc\.id && \(doc\.storage_path \|\| doc\.storage_key \|\| doc\.candidate_id \|\| doc\.meta\)\);/);
});

test('candidate admin UI exposes onboarding reminder controls and uses the reminder endpoint', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /admin-candidate-onboarding-reminders/);
  assert.match(source, /data-onboarding-action="send-rtw-reminder"/);
  assert.match(source, /data-onboarding-action="send-doc-request"/);
  assert.match(source, /function selectMissingRtw/);
  assert.match(source, /function sendDocumentRequests/);
});

test('candidate admin UI renders and binds assignment pairing controls in the drawer', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /elements\.dwAssignments = qs\('#dw-assignments'\);/);
  assert.match(source, /function renderAssignments/);
  assert.match(source, /data-assignment-link/);
  assert.match(source, /admin-candidate-assignment-link/);
});

test('candidate admin UI exposes import and timesheet portal comparison controls', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /admin-candidates-import/);
  assert.match(source, /admin-candidates-timesheet-compare/);
  assert.match(source, /function previewCandidateImport/);
  assert.match(source, /function confirmCandidateImport/);
  assert.match(source, /function refreshTimesheetPortalCompare/);
});

test('candidate drawer exposes an explicit save path instead of relying on blur only', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /data-action="save-profile"/);
  assert.match(source, /function saveCandidatePatch/);
  assert.match(source, /Use Save changes before closing/);
});
