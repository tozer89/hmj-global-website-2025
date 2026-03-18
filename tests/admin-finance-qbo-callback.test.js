'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function withMockedModule(modulePath, exportsValue) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue,
  };
  return () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
}

test('QBO callback accepts signed-state flow without relying on admin token cookie', async () => {
  const restoreStore = withMockedModule('../netlify/functions/_finance-store.js', {
    getFinanceSchemaStatus: async () => ({ ready: true }),
    readQboRuntimeStatus: async () => ({}),
    saveQboRuntimeStatus: async () => ({}),
  });
  const restoreQbo = withMockedModule('../netlify/functions/_finance-qbo.js', {
    parseSignedState: () => ({
      userId: 'admin-user',
      email: 'info@hmj-global.com',
      returnTo: 'https://hmjg.netlify.app/admin/finance/quickbooks.html',
    }),
    exchangeCodeForTokens: async () => ({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    }),
    tokenExpiryIso: () => '2026-03-18T12:00:00.000Z',
    connectFromCallback: async () => ({}),
    resolveQboEnvironment: () => 'production',
    appendQueryParams: (target, params) => {
      const url = new URL(target);
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value) url.searchParams.set(key, value);
      });
      return url.toString();
    },
    buildReturnUrl: () => 'https://hmjg.netlify.app/admin/finance/quickbooks.html',
    logQbo: () => {},
    normalizeReturnTo: (_event, value) => value || 'https://hmjg.netlify.app/admin/finance/quickbooks.html',
  });

  const callbackPath = require.resolve('../netlify/functions/admin-finance-qbo-callback.js');
  delete require.cache[callbackPath];
  const mod = require('../netlify/functions/admin-finance-qbo-callback.js');

  try {
    const response = await mod.handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: {
        state: 'signed-state',
        code: 'auth-code',
        realmId: '12345',
      },
    }, {});

    assert.equal(response.statusCode, 302);
    assert.match(response.headers.location, /qbo=connected/);
  } finally {
    delete require.cache[callbackPath];
    restoreStore();
    restoreQbo();
  }
});

test('QBO callback resolves nonce-only state from pending runtime auth context', async () => {
  const restoreStore = withMockedModule('../netlify/functions/_finance-store.js', {
    getFinanceSchemaStatus: async () => ({ ready: true }),
    readQboRuntimeStatus: async () => ({
      pendingAuth: {
        nonce: 'pending-nonce',
        userId: 'admin-user',
        email: 'info@hmj-global.com',
        returnTo: 'https://hmjg.netlify.app/admin/finance/quickbooks.html',
      },
    }),
    saveQboRuntimeStatus: async () => ({}),
  });
  const restoreQbo = withMockedModule('../netlify/functions/_finance-qbo.js', {
    parseSignedState: () => ({
      nonce: 'pending-nonce',
    }),
    exchangeCodeForTokens: async () => ({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    }),
    tokenExpiryIso: () => '2026-03-18T12:00:00.000Z',
    connectFromCallback: async () => ({}),
    resolveQboEnvironment: () => 'production',
    appendQueryParams: (target, params) => {
      const url = new URL(target);
      Object.entries(params || {}).forEach(([key, value]) => {
        if (value) url.searchParams.set(key, value);
      });
      return url.toString();
    },
    buildReturnUrl: () => 'https://hmjg.netlify.app/admin/finance/quickbooks.html',
    logQbo: () => {},
    normalizeReturnTo: (_event, value) => value || 'https://hmjg.netlify.app/admin/finance/quickbooks.html',
  });

  const callbackPath = require.resolve('../netlify/functions/admin-finance-qbo-callback.js');
  delete require.cache[callbackPath];
  const mod = require('../netlify/functions/admin-finance-qbo-callback.js');

  try {
    const response = await mod.handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: {
        state: 'signed-state',
        code: 'auth-code',
        realmId: '12345',
      },
    }, {});

    assert.equal(response.statusCode, 302);
    assert.match(response.headers.location, /qbo=connected/);
  } finally {
    delete require.cache[callbackPath];
    restoreStore();
    restoreQbo();
  }
});
