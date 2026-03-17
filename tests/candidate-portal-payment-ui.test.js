const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('candidate portal switches between recruitment profile and live onboarding states', () => {
  const source = read('assets/js/candidates.portal.js');

  assert.match(source, /RECRUITMENT_PROFILE_TABS = DASHBOARD_TABS\.filter\(\(tab\) => tab !== 'payment'\)/);
  assert.match(source, /function candidateOnboardingMode/);
  assert.match(source, /Live assignment onboarding/);
  assert.match(source, /Recruitment profile active/);
  assert.match(source, /Emergency contact \(next of kin\)/);
  assert.match(source, /name="onboarding_mode"/);
  assert.match(source, /data-dashboard-form="payment"/);
  assert.match(source, /Payroll details/);
  assert.match(source, /data-dashboard-focus="right_to_work"/);
  assert.match(source, /loadCandidatePaymentDetails/);
  assert.match(source, /saveCandidatePaymentDetails/);
  assert.match(source, /candidate_tab/);
  assert.match(source, /candidate_focus/);
  assert.match(source, /candidate_docs/);
  assert.match(source, /parseRequestedDocumentList/);
  assert.match(source, /requestedDocumentListText/);
  assert.match(source, /value: 'cover_letter', label: 'Cover letter'/);
  assert.match(source, /value: 'bank_document', label: 'Bank document'/);
});
