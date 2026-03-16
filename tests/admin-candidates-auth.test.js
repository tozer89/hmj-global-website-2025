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
  assert.match(html, /\/admin\/candidates\.js\?v=3/);
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
