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
  assert.match(html, /\/admin\/candidates\.js\?v=5/);
  assert.match(html, /id="bulk-rtw-reminder"/);
  assert.match(html, /id="btn-select-missing-rtw"/);
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
  assert.match(source, /function selectMissingRtw/);
});
