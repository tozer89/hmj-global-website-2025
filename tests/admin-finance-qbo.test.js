'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('QBO diagnostics reflect missing redirect and configured client credentials', async () => {
  process.env.QBO_CLIENT_ID = 'client-id';
  process.env.QBO_CLIENT_SECRET = 'client-secret';
  process.env.HMJ_FINANCE_SECRET = 'finance-secret';
  process.env.URL = 'https://hmjg.netlify.app';

  delete require.cache[require.resolve('../netlify/functions/_finance-qbo.js')];
  const qbo = require('../netlify/functions/_finance-qbo.js');

  const diagnostics = qbo.buildQboDiagnostics({ headers: {} }, null, true);
  assert.equal(diagnostics.configured, true);
  assert.equal(diagnostics.connectReady, true);
  assert.match(diagnostics.redirectUri, /admin-finance-qbo-callback/);
});

test('QBO auth URL includes accounting scope and state signature', async () => {
  process.env.QBO_CLIENT_ID = 'client-id';
  process.env.QBO_CLIENT_SECRET = 'client-secret';
  process.env.HMJ_FINANCE_SECRET = 'finance-secret';
  process.env.URL = 'https://hmjg.netlify.app';

  delete require.cache[require.resolve('../netlify/functions/_finance-qbo.js')];
  const qbo = require('../netlify/functions/_finance-qbo.js');

  const auth = qbo.buildAuthUrl({
    event: { headers: {} },
    user: { id: 'admin-user', email: 'info@hmj-global.com' },
    returnTo: 'https://hmjg.netlify.app/admin/finance/quickbooks.html',
  });

  assert.match(auth.url, /com\.intuit\.quickbooks\.accounting/);
  assert.match(auth.url, /response_type=code/);
  assert.match(auth.url, /appcenter\.intuit\.com\/app\/connect\/oauth2/);
  assert.ok(auth.state.includes('.'));
  assert.equal(auth.pendingState.email, 'info@hmj-global.com');
  assert.equal(auth.pendingState.returnTo, 'https://hmjg.netlify.app/admin/finance/quickbooks.html');
});

test('QBO auth URL normalises off-site return targets back to HMJ finance', async () => {
  process.env.QBO_CLIENT_ID = 'client-id';
  process.env.QBO_CLIENT_SECRET = 'client-secret';
  process.env.HMJ_FINANCE_SECRET = 'finance-secret';
  process.env.HMJ_CANONICAL_SITE_URL = 'https://hmjg.netlify.app';

  delete require.cache[require.resolve('../netlify/functions/_finance-qbo.js')];
  const qbo = require('../netlify/functions/_finance-qbo.js');

  const auth = qbo.buildAuthUrl({
    event: { headers: { origin: 'https://preview--hmjg.netlify.app' } },
    user: { id: 'admin-user', email: 'info@hmj-global.com' },
    returnTo: 'https://evil.example.com/steal-me',
  });

  const state = qbo.parseSignedState(auth.state);
  assert.ok(state.nonce);
  assert.equal(auth.pendingState.returnTo, 'https://hmjg.netlify.app/admin/finance/quickbooks.html');
});

test('QBO diagnostics normalize confusable unicode in client credentials', async () => {
  process.env.QBO_CLIENT_ID = [
    'АBK',
    '×KРD',
    'FpdmPTzKpc',
    'сТf5U4bl',
    'ЕHAvhm8',
    'МyЕCsNR9UYnoEBXfLS',
  ].join('');
  process.env.QBO_CLIENT_SECRET = 'client-secret';
  process.env.HMJ_FINANCE_SECRET = 'finance-secret';
  process.env.QBO_REDIRECT_URI = 'https://hmjg.netlify.app/.netlify/functions/admin-finance-qbo-callback';
  process.env.HMJ_CANONICAL_SITE_URL = 'https://hmjg.netlify.app';

  delete require.cache[require.resolve('../netlify/functions/_finance-qbo.js')];
  const qbo = require('../netlify/functions/_finance-qbo.js');

  const expectedNormalized = [
    'ABKXKPDF',
    'pdmPTzKp',
    'ccTf5U4b',
    'lEHAvhm8',
    'MyECsNR9',
    'UYnoEBXfLS',
  ].join('');
  const normalized = qbo.normalizeQboCredential(process.env.QBO_CLIENT_ID);
  assert.equal(normalized.normalized, expectedNormalized);
  assert.equal(normalized.hadNonAscii, true);

  const diagnostics = qbo.buildQboDiagnostics({ headers: {} }, null, true);
  assert.equal(diagnostics.connectReady, true);
  assert.equal(diagnostics.clientIdNormalized, true);
  assert.match(diagnostics.warnings.join(' '), /Unicode lookalike characters/);

  const auth = qbo.buildAuthUrl({
    event: { headers: {} },
    user: { id: 'admin-user', email: 'info@hmj-global.com' },
    returnTo: 'https://hmjg.netlify.app/admin/finance/quickbooks.html',
  });

  assert.match(auth.url, new RegExp(`client_id=${expectedNormalized}`));
});
