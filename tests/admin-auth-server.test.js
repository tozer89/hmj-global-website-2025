const test = require('node:test');
const assert = require('node:assert/strict');

function resetModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('resolveIdentityBase ignores untrusted forwarded hosts and falls back to trusted site config', () => {
  const envSnapshot = {
    HMJ_IDENTITY_BASE: process.env.HMJ_IDENTITY_BASE,
    HMJ_CANONICAL_SITE_URL: process.env.HMJ_CANONICAL_SITE_URL,
    SITE_URL: process.env.SITE_URL,
    URL: process.env.URL,
    DEPLOY_URL: process.env.DEPLOY_URL,
  };

  process.env.HMJ_IDENTITY_BASE = '';
  process.env.HMJ_CANONICAL_SITE_URL = '';
  process.env.SITE_URL = '';
  process.env.URL = 'https://hmjg.netlify.app';
  process.env.DEPLOY_URL = '';

  resetModule('../netlify/functions/_http.js');
  resetModule('../netlify/functions/_auth.js');

  const { resolveIdentityBase } = require('../netlify/functions/_auth.js');
  const resolved = resolveIdentityBase({
    headers: {
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
    },
  });

  assert.equal(resolved, 'https://hmjg.netlify.app/.netlify/identity');

  restoreEnv(envSnapshot);
  resetModule('../netlify/functions/_http.js');
  resetModule('../netlify/functions/_auth.js');
});

test('identity proxy only grants credentialed CORS to trusted origins', async () => {
  const envSnapshot = {
    HMJ_CANONICAL_SITE_URL: process.env.HMJ_CANONICAL_SITE_URL,
    SITE_URL: process.env.SITE_URL,
    URL: process.env.URL,
    DEPLOY_URL: process.env.DEPLOY_URL,
  };

  process.env.HMJ_CANONICAL_SITE_URL = '';
  process.env.SITE_URL = '';
  process.env.URL = 'https://hmjg.netlify.app';
  process.env.DEPLOY_URL = '';

  resetModule('../netlify/functions/_http.js');
  resetModule('../netlify/functions/identity-proxy.js');

  const { handler } = require('../netlify/functions/identity-proxy.js');

  const blocked = await handler({
    httpMethod: 'OPTIONS',
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(blocked.statusCode, 200);
  assert.equal(blocked.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(blocked.headers['Access-Control-Allow-Credentials'], undefined);

  const allowed = await handler({
    httpMethod: 'OPTIONS',
    headers: { origin: 'https://hmj-global.com' },
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers['Access-Control-Allow-Origin'], 'https://hmj-global.com');
  assert.equal(allowed.headers['Access-Control-Allow-Credentials'], 'true');

  restoreEnv(envSnapshot);
  resetModule('../netlify/functions/_http.js');
  resetModule('../netlify/functions/identity-proxy.js');
});
