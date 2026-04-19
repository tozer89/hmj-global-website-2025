'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const bullhornPath = require.resolve('../netlify/functions/_bullhorn.js');
const servicePath = require.resolve('../netlify/functions/_bullhorn-service.js');

function restoreEnv(saved) {
  Object.entries(saved).forEach(([key, value]) => {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  });
}

async function withBullhornEnv(run) {
  const saved = {
    BULLHORN_CLIENT_ID: process.env.BULLHORN_CLIENT_ID,
    BULLHORN_CLIENT_SECRET: process.env.BULLHORN_CLIENT_SECRET,
    BULLHORN_REDIRECT_URI: process.env.BULLHORN_REDIRECT_URI,
    BULLHORN_API_USERNAME: process.env.BULLHORN_API_USERNAME,
    HMJ_FINANCE_SECRET: process.env.HMJ_FINANCE_SECRET,
  };

  process.env.BULLHORN_CLIENT_ID = 'client-id';
  process.env.BULLHORN_CLIENT_SECRET = 'client-secret';
  process.env.BULLHORN_REDIRECT_URI = 'https://hmj-global.com/api/connectors/bullhorn/callback';
  process.env.BULLHORN_API_USERNAME = 'api.user@example.com';
  process.env.HMJ_FINANCE_SECRET = 'bullhorn-test-secret';

  delete require.cache[bullhornPath];
  delete require.cache[servicePath];

  try {
    await run();
  } finally {
    restoreEnv(saved);
    delete require.cache[bullhornPath];
    delete require.cache[servicePath];
  }
}

test('Bullhorn authorize URL generation preserves the registered callback URI and signed state', async () => {
  await withBullhornEnv(async () => {
    const mod = require('../netlify/functions/_bullhorn.js');
    const auth = mod.buildAuthorizeUrl({
      config: mod.resolveBullhornConfig(),
      loginInfo: {
        oauthBaseUrl: 'https://auth-emea.bullhornstaffing.com/oauth/',
        restBaseUrl: 'https://rest-emea.bullhornstaffing.com/rest-services/',
      },
      user: {
        id: 'admin-1',
        email: 'info@hmj-global.com',
      },
      returnTo: 'https://hmj-global.com/admin/candidates.html?tab=ops',
      nonce: 'fixed-nonce',
    });

    const url = new URL(auth.url);
    assert.equal(url.origin, 'https://auth-emea.bullhornstaffing.com');
    assert.equal(url.pathname, '/oauth/authorize');
    assert.equal(url.searchParams.get('client_id'), 'client-id');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://hmj-global.com/api/connectors/bullhorn/callback');
    assert.equal(url.searchParams.get('username'), 'api.user@example.com');

    const state = mod.parseSignedState(url.searchParams.get('state'));
    assert.equal(state.nonce, 'fixed-nonce');
    assert.equal(state.userId, 'admin-1');
    assert.equal(state.email, 'info@hmj-global.com');
    assert.equal(state.returnTo, 'https://hmj-global.com/admin/candidates.html?tab=ops');
  });
});

test('Bullhorn callback state validation rejects tampered state', async () => {
  await withBullhornEnv(async () => {
    const mod = require('../netlify/functions/_bullhorn.js');
    const state = mod.buildSignedState({
      provider: 'bullhorn',
      nonce: 'nonce-1',
      iat: Date.now(),
    });

    const tampered = `${state.slice(0, -1)}x`;
    assert.throws(
      () => mod.parseSignedState(tampered),
      /could not be verified/i
    );
  });
});

test('Bullhorn code exchange posts the expected OAuth payload', async () => {
  await withBullhornEnv(async () => {
    const mod = require('../netlify/functions/_bullhorn.js');
    const calls = [];
    const token = await mod.exchangeCodeForToken({
      config: mod.resolveBullhornConfig(),
      loginInfo: {
        oauthBaseUrl: 'https://auth-emea.bullhornstaffing.com/oauth/',
      },
      code: 'oauth-code-123',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            expires_in: 600,
            token_type: 'Bearer',
          }),
        };
      },
    });

    assert.equal(token.accessToken, 'access-1');
    assert.equal(token.refreshToken, 'refresh-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://auth-emea.bullhornstaffing.com/oauth/token');
    assert.match(calls[0].init.body, /grant_type=authorization_code/);
    assert.match(calls[0].init.body, /code=oauth-code-123/);
    assert.match(calls[0].init.body, /redirect_uri=https%3A%2F%2Fhmj-global.com%2Fapi%2Fconnectors%2Fbullhorn%2Fcallback/);
  });
});

test('Bullhorn refresh persists rotated refresh tokens', async () => {
  await withBullhornEnv(async () => {
    const service = require('../netlify/functions/_bullhorn-service.js');
    const { createMemoryBullhornStore } = require('../netlify/functions/_bullhorn-store.js');
    const store = createMemoryBullhornStore({
      connection: {
        apiUsername: 'api.user@example.com',
        oauthBaseUrl: 'https://auth-emea.bullhornstaffing.com/oauth/',
        restLoginUrl: 'https://rest-emea.bullhornstaffing.com/rest-services/',
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        accessTokenExpiresAt: '2000-01-01T00:00:00.000Z',
        metadata: {
          restBaseUrl: 'https://rest-emea.bullhornstaffing.com/rest-services/',
        },
      },
    });

    const refreshed = await service.refreshBullhornConnection({}, {
      store,
      config: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'https://hmj-global.com/api/connectors/bullhorn/callback',
      },
      connection: await store.readConnection(),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 900,
          token_type: 'Bearer',
        }),
      }),
    });

    assert.equal(refreshed.accessToken, 'new-access');
    assert.equal(refreshed.refreshToken, 'new-refresh');
    const persisted = await store.readConnection();
    assert.equal(persisted.refreshToken, 'new-refresh');
    assert.equal(persisted.accessToken, 'new-access');
  });
});

test('Bullhorn REST login response parsing returns BhRestToken and restUrl', async () => {
  await withBullhornEnv(async () => {
    const mod = require('../netlify/functions/_bullhorn.js');
    const result = await mod.loginToRest('access-123', {
      restBaseUrl: 'https://rest-emea.bullhornstaffing.com/rest-services/',
    }, {
      fetchImpl: async (url) => {
        assert.match(url, /access_token=access-123/);
        assert.match(url, /version=%2A|version=\*/);
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            BhRestToken: 'bhrest-1',
            restUrl: 'https://rest-emea.bullhornstaffing.com/rest-services/2.0/',
          }),
        };
      },
    });

    assert.equal(result.bhRestToken, 'bhrest-1');
    assert.equal(result.restUrl, 'https://rest-emea.bullhornstaffing.com/rest-services/2.0/');
  });
});

test('Bullhorn callback route and docs are registered', async () => {
  await withBullhornEnv(async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const config = fs.readFileSync(path.join(process.cwd(), 'netlify.toml'), 'utf8');
    const note = fs.readFileSync(path.join(process.cwd(), 'docs/bullhorn-integration.md'), 'utf8');

    assert.match(config, /from = "\/api\/connectors\/bullhorn\/callback"[\s\S]*to = "\/\.netlify\/functions\/admin-bullhorn-callback"[\s\S]*status = 200/);
    assert.match(note, /BULLHORN_CLIENT_ID/);
    assert.match(note, /BULLHORN_CLIENT_SECRET/);
    assert.match(note, /BULLHORN_REDIRECT_URI/);
    assert.match(note, /BULLHORN_API_USERNAME/);
    assert.match(note, /https:\/\/hmj-global\.com\/api\/connectors\/bullhorn\/callback/);
  });
});
