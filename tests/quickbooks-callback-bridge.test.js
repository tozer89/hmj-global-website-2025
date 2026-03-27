'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const functionPath = require.resolve('../netlify/functions/quickbooks-callback-bridge.js');
const TARGET_ENV = 'HMJ_ASSISTANT_QBO_CALLBACK_TARGET';
const ALLOWED_HOSTS_ENV = 'HMJ_ASSISTANT_QBO_ALLOWED_HOSTS';

function loadBridge() {
  delete require.cache[functionPath];
  return require('../netlify/functions/quickbooks-callback-bridge.js');
}

async function withEnv(overrides, run) {
  const previous = {
    [TARGET_ENV]: process.env[TARGET_ENV],
    [ALLOWED_HOSTS_ENV]: process.env[ALLOWED_HOSTS_ENV],
  };

  Object.entries(overrides || {}).forEach(([key, value]) => {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  });

  try {
    await run();
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    });
    delete require.cache[functionPath];
  }
}

test('QuickBooks callback bridge redirects to a validated callback target and preserves the full raw query string', async () => {
  await withEnv({
    [TARGET_ENV]: 'http://mac-mini.tail4f54d6.ts.net:4012/api/connectors/quickbooks/callback',
    [ALLOWED_HOSTS_ENV]: 'mac-mini.tail4f54d6.ts.net',
  }, async () => {
    const { handler } = loadBridge();
    const rawQuery = 'code=a%2Bb&state=s%3D1&realmId=12345&error=access_denied&error_description=two%20words&scope=one&scope=two';

    const response = await handler({
      httpMethod: 'GET',
      rawUrl: `https://hmj-global.com/api/connectors/quickbooks/callback?${rawQuery}`,
      rawQuery: 'this=should-not-win',
      queryStringParameters: {
        code: 'decoded-value-that-should-not-be-used',
      },
    });

    assert.equal(response.statusCode, 302);
    assert.equal(
      response.headers.location,
      'http://mac-mini.tail4f54d6.ts.net:4012/api/connectors/quickbooks/callback?' + rawQuery
    );
    assert.equal(response.headers['cache-control'], 'no-store, no-cache, must-revalidate, private');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
    assert.match(response.body, /Continue to HMJ Assistant/);
    assert.doesNotMatch(response.body, /decoded-value-that-should-not-be-used/);
  });
});

test('QuickBooks callback bridge returns a truthful operator page when the callback target is missing', async () => {
  await withEnv({
    [TARGET_ENV]: null,
    [ALLOWED_HOSTS_ENV]: null,
  }, async () => {
    const { handler } = loadBridge();
    const response = await handler({
      httpMethod: 'GET',
      rawUrl: 'https://hmj-global.com/api/connectors/quickbooks/callback?code=secret-code&state=opaque-state',
    });

    assert.equal(response.statusCode, 500);
    assert.match(response.body, /QuickBooks callback is not configured correctly/);
    assert.match(response.body, /callback bridge is deployed/);
    assert.match(response.body, /assistant callback target is missing or invalid/);
    assert.match(response.body, /HMJ_ASSISTANT_QBO_CALLBACK_TARGET/);
    assert.doesNotMatch(response.body, /secret-code/);
    assert.doesNotMatch(response.body, /opaque-state/);
  });
});

test('QuickBooks callback bridge blocks invalid target hosts and paths with a truthful operator page', async () => {
  const invalidTargets = [
    'http://assistant.example.com/api/connectors/quickbooks/callback',
    'https://assistant.example.com/api/connectors/quickbooks/not-the-callback',
    'https://assistant.example.com/api/connectors/quickbooks/callback?source=netlify',
  ];

  for (const target of invalidTargets) {
    await withEnv({
      [TARGET_ENV]: target,
      [ALLOWED_HOSTS_ENV]: 'assistant.example.com',
    }, async () => {
      const { handler } = loadBridge();
      const response = await handler({
        httpMethod: 'GET',
        rawUrl: 'https://hmj-global.com/api/connectors/quickbooks/callback?code=abc123',
      });

      assert.equal(response.statusCode, 500);
      assert.match(response.body, /QuickBooks callback is not configured correctly/);
      assert.match(response.body, /assistant callback target is missing or invalid/);
      assert.match(response.body, /Check <code>HMJ_ASSISTANT_QBO_CALLBACK_TARGET<\/code>/);
      assert.doesNotMatch(response.body, /assistant\.example\.com\/api\/connectors/);
    });
  }
});

test('QuickBooks callback bridge blocks targets not present in the optional host allowlist', async () => {
  await withEnv({
    [TARGET_ENV]: 'https://assistant.example.com/api/connectors/quickbooks/callback',
    [ALLOWED_HOSTS_ENV]: 'other.example.com',
  }, async () => {
    const { handler } = loadBridge();
    const response = await handler({
      httpMethod: 'GET',
      rawUrl: 'https://hmj-global.com/api/connectors/quickbooks/callback?state=opaque',
    });

    assert.equal(response.statusCode, 500);
    assert.match(response.body, /HMJ_ASSISTANT_QBO_ALLOWED_HOSTS/);
  });
});

test('QuickBooks callback bridge still forwards safely when no OAuth query params are present', async () => {
  await withEnv({
    [TARGET_ENV]: 'https://assistant.example.com/api/connectors/quickbooks/callback',
    [ALLOWED_HOSTS_ENV]: 'assistant.example.com',
  }, async () => {
    const { handler } = loadBridge();
    const response = await handler({
      httpMethod: 'GET',
      rawUrl: 'https://hmj-global.com/api/connectors/quickbooks/callback',
    });

    assert.equal(response.statusCode, 302);
    assert.equal(
      response.headers.location,
      'https://assistant.example.com/api/connectors/quickbooks/callback'
    );
  });
});

test('QuickBooks callback bridge is GET-only', async () => {
  await withEnv({
    [TARGET_ENV]: 'https://assistant.example.com/api/connectors/quickbooks/callback',
    [ALLOWED_HOSTS_ENV]: 'assistant.example.com',
  }, async () => {
    const { handler } = loadBridge();
    const response = await handler({
      httpMethod: 'POST',
      rawUrl: 'https://hmj-global.com/api/connectors/quickbooks/callback?code=abc123',
    });

    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.allow, 'GET');
    assert.match(response.body, /Only GET is supported/);
  });
});

test('Netlify config and internal doc describe the exact callback bridge route and env vars', () => {
  const config = fs.readFileSync(path.join(process.cwd(), 'netlify.toml'), 'utf8');
  const note = fs.readFileSync(path.join(process.cwd(), 'docs/quickbooks-callback-bridge.md'), 'utf8');

  assert.match(config, /from = "\/api\/connectors\/quickbooks\/callback"[\s\S]*to = "\/\.netlify\/functions\/quickbooks-callback-bridge"[\s\S]*status = 200/);
  assert.match(config, /HMJ_ASSISTANT_QBO_CALLBACK_TARGET/);
  assert.match(config, /HMJ_ASSISTANT_QBO_ALLOWED_HOSTS/);
  assert.doesNotMatch(config, /from = "\/api\/\*"/);

  assert.match(note, /https:\/\/hmj-global\.com\/api\/connectors\/quickbooks\/callback/);
  assert.match(note, /HMJ_ASSISTANT_QBO_CALLBACK_TARGET/);
  assert.match(note, /HMJ_ASSISTANT_QBO_ALLOWED_HOSTS/);
  assert.match(note, /Intuit redirect URI must match/);
  assert.match(note, /browser.*reach the private assistant callback target/i);
});
