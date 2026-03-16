const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('candidate portal exposes the payment tab and deep-link onboarding controls', () => {
  const source = read('assets/js/candidates.portal.js');

  assert.match(source, /DASHBOARD_TABS = \['profile', 'applications', 'documents', 'payment', 'settings'\]/);
  assert.match(source, /data-dashboard-form="payment"/);
  assert.match(source, /data-dashboard-focus="right_to_work"/);
  assert.match(source, /loadCandidatePaymentDetails/);
  assert.match(source, /saveCandidatePaymentDetails/);
  assert.match(source, /candidate_tab/);
  assert.match(source, /candidate_focus/);
});
