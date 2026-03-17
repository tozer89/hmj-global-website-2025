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
  assert.match(html, /\/admin\/candidates\.js\?v=15/);
  assert.match(html, /id="bulk-rtw-reminder"/);
  assert.match(html, /id="btn-select-missing-rtw"/);
  assert.match(html, /id="bulk-doc-request"/);
  assert.match(html, /id="candidate-template-xlsx"/);
  assert.match(html, /id="btn-refresh-tsp"/);
  assert.match(html, /id="btn-sync-tsp"/);
  assert.match(html, /id="btn-sync-tsp-portal"/);
  assert.match(html, /id="btn-refresh-verify"/);
  assert.match(html, /id="btn-select-to-verify"/);
  assert.match(html, /id="outreach-status"/);
  assert.match(html, /id="doc-request-dialog"/);
  assert.match(html, /id="doc-request-copy-link"/);
  assert.match(html, /id="dw-payment"/);
  assert.match(html, /id="dw-assignments"/);
  assert.match(html, /id="candidate-source-tabs"/);
  assert.match(html, /data-source-tab="website"/);
  assert.match(html, /data-source-tab="timesheet-portal"/);
  assert.match(html, /data-source-tab="combined"/);
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

test('candidate drawer includes admin payment editing plus typed document upload controls', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /function renderPayment/);
  assert.match(source, /admin-candidate-payment-details/);
  assert.match(source, /data-action="save-payment-details"/);
  assert.match(source, /data-action="load-payment-details"/);
  assert.match(source, /data-doc-upload/);
  assert.match(source, /data-doc-input/);
  assert.match(source, /data-doc-type/);
  assert.match(source, /data-doc-label/);
  assert.match(source, /Right to work/);
  assert.match(source, /Qualifications & certificates/);
  assert.match(source, /admin-candidate-doc-upload/);
  assert.match(source, /admin-candidate-doc-delete/);
  assert.match(source, /const canDelete = !!\(doc\.id && \(doc\.storage_path \|\| doc\.storage_key \|\| doc\.candidate_id \|\| doc\.meta\)\);/);
});

test('candidate admin document endpoints request and return typed document metadata', () => {
  const uploadSource = read('netlify/functions/admin-candidate-doc-upload.js');
  const listSource = read('netlify/functions/admin-candidate-docs-list.js');
  const getSource = read('netlify/functions/admin-candidates-get.js');

  assert.match(uploadSource, /requestedDocumentType/);
  assert.match(uploadSource, /document_type: documentType/);
  assert.match(listSource, /document_type,label,filename,original_filename,url,storage_path,storage_key,uploaded_at/);
  assert.match(getSource, /document_type,label,filename,original_filename,url,storage_path,storage_key,uploaded_at/);
});

test('candidate admin UI exposes onboarding reminder controls and uses the reminder endpoint', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /admin-candidate-onboarding-reminders/);
  assert.match(source, /data-onboarding-action="send-rtw-reminder"/);
  assert.match(source, /data-onboarding-action="send-doc-request"/);
  assert.match(source, /function selectMissingRtw/);
  assert.match(source, /function openDocumentRequestDialog/);
  assert.match(source, /function sendOnboardingRequest/);
  assert.match(source, /function refreshOutreachReadiness/);
  assert.match(source, /function copyCandidateUploadLink/);
  assert.match(source, /function showOutreachConfigurationError/);
  assert.match(source, /data-onboarding-action="copy-upload-link"/);
  assert.match(source, /recently_sent/);
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
  assert.match(source, /admin-candidates-sync-timesheet-portal/);
  assert.match(source, /function runTimesheetPortalCandidateSync/);
  assert.match(source, /function previewCandidateImport/);
  assert.match(source, /function confirmCandidateImport/);
  assert.match(source, /function refreshTimesheetPortalCompare/);
});

test('candidate admin UI can switch between website, timesheet portal, and combined data tabs', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /sourceTab:\s*'website'/);
  assert.match(source, /function setSourceTab/);
  assert.match(source, /function buildSourceDatasets/);
  assert.match(source, /function normalizeTimesheetPortalCandidate/);
  assert.match(source, /function renderSourceTabs/);
  assert.match(source, /elements\.sourceTabs = Array\.from\(document\.querySelectorAll\('\[data-source-tab\]'\)\)/);
});

test('candidate admin UI exposes the document verification queue and review actions', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /admin-candidate-doc-verification-queue/);
  assert.match(source, /admin-candidate-doc-verify/);
  assert.match(source, /function refreshVerificationQueue/);
  assert.match(source, /function renderVerificationQueue/);
  assert.match(source, /data-doc-verify/);
  assert.match(source, /data-doc-reject/);
  assert.match(source, /data-doc-reset/);
});

test('candidate drawer exposes an explicit save path instead of relying on blur only', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /data-action="save-profile"/);
  assert.match(source, /function saveCandidatePatch/);
  assert.match(source, /Unsaved profile or payment changes/);
});
