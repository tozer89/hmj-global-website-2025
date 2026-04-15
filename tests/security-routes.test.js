const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('netlify config blocks direct access to internal source, env, and template files', () => {
  const toml = read('netlify.toml');

  [
    '/hmj.env',
    '/hmj 2.env',
    '/hmj%202.env',
    '/sent_client_contact.php',
    '/send_cv.php',
    '/send_contact.php',
    '/package.json',
    '/package-lock.json',
    '/deno.lock',
    '/.gitignore',
    '/netlify.toml',
    '/scripts/*',
    '/tests/*',
    '/docs/*',
    '/supabase/*',
    '/tmp/*',
    '/output/*',
    '/netlify/*',
    '/admin-v2/*',
    '/admininvitetemplate.html',
    '/adminconfirmationtemplate.html',
    '/HMJ Website Plan.docx',
    '/HMJ%20Website%20Plan.docx',
    '/HMJ-Website-Recommendations.docx',
  ].forEach((route) => {
    assert.match(toml, new RegExp(`from = "${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  });

  assert.match(toml, /to = "\/404\.html"/);
  assert.match(toml, /status = 404/);
  assert.match(toml, /force = true/);
});
