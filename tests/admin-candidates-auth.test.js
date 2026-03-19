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
  assert.match(html, /\/admin\/common\.js\?v=36/);
  assert.match(html, /\/js\/candidate-active-assignments-core\.js\?v=2/);
  assert.match(html, /\/admin\/candidates\.js\?v=23/);
  assert.match(html, /id="bulk-intro-email"/);
  assert.match(html, /id="bulk-send-email"/);
  assert.match(html, /id="bulk-copy-emails"/);
  assert.match(html, /id="bulk-rtw-reminder"/);
  assert.match(html, /id="btn-select-missing-rtw"/);
  assert.match(html, /id="btn-select-visible"/);
  assert.match(html, /id="bulk-doc-request"/);
  assert.match(html, /id="active-filter-chips"/);
  assert.match(html, /id="candidate-template-xlsx"/);
  assert.match(html, /id="btn-refresh-tsp"/);
  assert.match(html, /id="btn-sync-tsp"/);
  assert.match(html, /id="btn-sync-tsp-portal"/);
  assert.match(html, /id="btn-new-inline"/);
  assert.match(html, /id="btn-refresh-verify"/);
  assert.match(html, /id="btn-select-to-verify"/);
  assert.match(html, /id="outreach-status"/);
  assert.match(html, /id="doc-request-dialog"/);
  assert.match(html, /id="doc-request-copy-link"/);
  assert.match(html, /id="bulk-email-dialog"/);
  assert.match(html, /id="bulk-email-preset"/);
  assert.match(html, /id="bulk-email-subject"/);
  assert.match(html, /id="bulk-email-body"/);
  assert.match(html, /id="bulk-email-primary-action"/);
  assert.match(html, /id="bulk-email-preview-shell"/);
  assert.match(html, /id="dw-payment"/);
  assert.match(html, /id="dw-assignments"/);
  assert.match(html, /id="candidate-source-tabs"/);
  assert.match(html, /id="candidate-table"/);
  assert.match(html, /id="candidate-thead"/);
  assert.match(html, /data-source-tab="website"/);
  assert.match(html, /data-source-tab="timesheet-portal-active"/);
  assert.match(html, /data-source-tab="timesheet-portal"/);
  assert.match(html, /data-source-tab="combined"/);
  assert.match(html, />\s*Website only\s*<span class="source-tab__count" data-source-count="website">/);
  assert.match(html, />\s*TSP active assignments\s*<span class="source-tab__count" data-source-count="timesheet-portal-active">/);
  assert.match(html, />\s*Timesheet Portal only\s*<span class="source-tab__count" data-source-count="timesheet-portal">/);
  assert.match(html, />\s*Combined \/ all\s*<span class="source-tab__count" data-source-count="combined">/);
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

test('Netlify admin route rules allow owner-role users onto protected admin pages', () => {
  const config = read('netlify.toml');
  assert.match(config, /from = "\/admin\/candidates\.html"[\s\S]*conditions = \{ Role = \["admin", "owner"\] \}/);
  assert.match(config, /from = "\/admin\/timesheets\.html"[\s\S]*conditions = \{ Role = \["admin", "owner"\] \}/);
  assert.match(config, /from = "\/admin\/reports\.html"[\s\S]*conditions = \{ Role = \["admin", "owner"\] \}/);
});

test('candidate row actions use closest() event delegation so button text clicks still resolve the action', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /target\.closest\('\[data-role\]'\)/);
  assert.match(source, /rawTarget && rawTarget\.parentElement instanceof Element/);
  assert.match(source, /elements\.inlineNew = qs\('#btn-new-inline'\);/);
  assert.match(source, /if \(elements\.inlineNew\) elements\.inlineNew\.addEventListener\('click', \(\) => createNewCandidate\(\)\);/);
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
  assert.match(source, /Candidate path/);
  assert.match(source, /Live onboarding/);
  assert.match(source, /Recruitment profile/);
  assert.match(source, /Next of kin full name/);
  assert.match(source, /Next of kin telephone number/);
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
  assert.match(source, /data-account-action="copy_access_link"/);
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
  assert.match(source, /function renderReferenceCell/);
  assert.match(source, /function renderActiveFilterChips/);
  assert.match(source, /function selectVisibleCandidates/);
  assert.match(source, /function bulkCopyEmails/);
  assert.match(source, /function buildBulkEmailAudience/);
  assert.match(source, /function renderBulkEmailPreview/);
  assert.match(source, /function sendBulkEmailWizard/);
  assert.match(source, /admin-candidate-bulk-email/);
  assert.match(source, /function renderTableHeader/);
  assert.match(source, /function buildActiveAssignmentRow/);
  assert.match(source, /data-role="open-assignment"/);
  assert.match(source, /data-role="open-timesheets"/);
  assert.match(source, /data-role="copy-assignment-code"/);
  assert.match(source, /function assignmentSearchUrl/);
  assert.match(source, /function timesheetsSearchUrl/);
  assert.match(source, /function refreshActiveAssignments/);
  assert.match(source, /function bulkIntroEmail/);
  assert.match(source, /function ensureWebsiteCandidateForOutreach/);
  assert.match(source, /function ensureWebsiteCandidatesForOutreach/);
  assert.match(source, /function currentSelectionOptions/);
  assert.match(source, /function primaryActiveAssignment/);
  assert.match(source, /function buildSourceDatasets/);
  assert.match(source, /function normalizeTimesheetPortalCandidate/);
  assert.match(source, /function renderSourceTabs/);
  assert.match(source, /elements\.sourceTabs = Array\.from\(document\.querySelectorAll\('\[data-source-tab\]'\)\)/);
  assert.match(source, /website:\s*\{\s*label:\s*'Website only'\s*\}/);
  assert.match(source, /'timesheet-portal-active':\s*\{\s*label:\s*'TSP active assignments'\s*\}/);
  assert.match(source, /const activeAssignmentRows = websiteRows/);
  assert.match(source, /const websiteOnlyRows = websiteRows\.filter\(\(candidate\) => !candidate\?\.timesheet_portal_match\);/);
  assert.match(source, /const timesheetPortalOnlyRows = timesheetPortalRows\.filter\(\(candidate\) => !findWebsiteMatch\(candidate, websiteLookups\)\);/);
  assert.match(source, /const combinedRows = websiteRows\.concat\(timesheetPortalOnlyRows\);/);
  assert.match(source, /Select this row to create an HMJ candidate profile automatically when you send intro, RTW, or document outreach\./);
});

test('candidate admin normalises and labels recruitment profile versus live onboarding mode', () => {
  const source = read('admin/candidates.js');
  assert.match(source, /function candidateOnboardingMode/);
  assert.match(source, /onboarding_mode: candidateOnboardingMode\(row\)/);
  assert.match(source, /Payroll onboarding starts only when HMJ marks a live placement/);
  assert.match(source, /This section is only used when a candidate is completing live assignment onboarding/);
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
