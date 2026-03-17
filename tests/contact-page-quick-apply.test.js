const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();

test('contact page includes the quick-apply card and updated script assets', () => {
  const html = fs.readFileSync(path.join(ROOT, 'contact.html'), 'utf8');

  assert.match(html, /id="candidateQuickApplyCard"/);
  assert.match(html, /id="candidateQuickApplyButton"/);
  assert.match(html, /id="candidateQuickApplyToggleForm"/);
  assert.match(html, /id="fullApplicationCard"/);
  assert.match(html, /src="js\/contact-quick-apply-core\.js\?v=1"/);
  assert.match(html, /src="assets\/js\/contact\.portal\.js\?v=4"/);
});

test('contact portal script wires the authenticated quick-apply flow without replacing the legacy form submit path', () => {
  const source = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'contact.portal.js'), 'utf8');

  assert.match(source, /loadCandidateApplications/);
  assert.match(source, /loadCandidateDocuments/);
  assert.match(source, /backgroundSyncCandidatePayload\(payload,\s*\{\s*awaitResponse:\s*true\s*\}\)/);
  assert.match(source, /submitQuickApplyToNetlify/);
  assert.match(source, /contact-application-documents/);
  assert.match(source, /persistPublicApplicationDocuments/);
  assert.match(source, /HTMLFormElement\.prototype\.submit\.call\(form\)/);
  assert.match(source, /source:\s*'candidate_quick_apply'/);
  assert.match(source, /form\.addEventListener\('submit'/);
});
