const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('admin build env bootstrap only exposes the identity URL to the browser', () => {
  const pluginSource = read('netlify/plugins/admin-build-info/index.js');
  const generatedEnv = read('admin/__env.js');
  const placeholderEnv = read('admin/__env 2.js');

  assert.match(pluginSource, /ADMIN_IDENTITY_URL/);
  assert.doesNotMatch(pluginSource, /FORCE_ADMIN_KEY/);
  assert.doesNotMatch(pluginSource, /ALWAYS_ADMIN_EMAILS/);

  assert.match(generatedEnv, /ADMIN_IDENTITY_URL/);
  assert.doesNotMatch(generatedEnv, /FORCE_ADMIN_KEY/);
  assert.doesNotMatch(generatedEnv, /ALWAYS_ADMIN_EMAILS/);

  assert.match(placeholderEnv, /ADMIN_IDENTITY_URL/);
  assert.doesNotMatch(placeholderEnv, /FORCE_ADMIN_KEY/);
  assert.doesNotMatch(placeholderEnv, /ALWAYS_ADMIN_EMAILS/);
});
