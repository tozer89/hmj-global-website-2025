const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAuthHandoffUrl,
  isAdminPath,
  isCandidateAuthRoute,
  isCandidatePath,
  parseAuthState,
} = require('../js/hmj-auth-flow.js');

test('parseAuthState recognises invite links in the URL hash', () => {
  const state = parseAuthState({
    pathname: '/',
    hash: '#invite_token=abc123&type=invite&email=test%40hmj-global.com',
  });

  assert.equal(state.intent, 'invite');
  assert.equal(state.hasTokenPayload, true);
  assert.equal(state.usesHashPayload, true);
  assert.equal(state.authParams.invite_token, 'abc123');
});

test('parseAuthState recognises recovery links from access token callbacks', () => {
  const state = parseAuthState({
    pathname: '/index.html',
    hash: '#access_token=jwt&type=recovery&refresh_token=refresh',
  });

  assert.equal(state.intent, 'recovery');
  assert.equal(state.hasTokenPayload, true);
  assert.equal(state.authParams.access_token, 'jwt');
  assert.equal(state.authParams.refresh_token, 'refresh');
});

test('parseAuthState keeps auth errors visible for friendly UI handling', () => {
  const state = parseAuthState({
    pathname: '/',
    hash: '#error=access_denied&error_description=Link%20expired',
  });

  assert.equal(state.hasError, true);
  assert.equal(state.isAuthCallback, true);
  assert.equal(state.authParams.error_description, 'Link expired');
});

test('buildAuthHandoffUrl preserves the original callback hash when moving to admin', () => {
  const url = buildAuthHandoffUrl('/admin/', {
    pathname: '/',
    hash: '#recovery_token=secret&type=recovery',
  });

  assert.equal(url, '/admin/#recovery_token=secret&type=recovery');
});

test('buildAuthHandoffUrl preserves callback search params when present', () => {
  const url = buildAuthHandoffUrl('/admin/', {
    pathname: '/',
    search: '?confirmation_token=abc123',
  });

  assert.equal(url, '/admin/?confirmation_token=abc123');
});

test('isAdminPath recognises the HMJ admin route family', () => {
  assert.equal(isAdminPath('/admin/'), true);
  assert.equal(isAdminPath('/admin/jobs.html'), true);
  assert.equal(isAdminPath('/'), false);
  assert.equal(isAdminPath('/timesheets.html'), false);
});

test('isCandidatePath recognises the HMJ candidate route family', () => {
  assert.equal(isCandidatePath('/candidates.html'), true);
  assert.equal(isCandidatePath('/candidates'), true);
  assert.equal(isCandidatePath('/'), false);
  assert.equal(isCandidatePath('/admin/'), false);
});

test('isCandidateAuthRoute keeps candidate auth callbacks on the candidate page', () => {
  assert.equal(isCandidateAuthRoute({
    pathname: '/candidates.html',
    search: '?candidate_auth=verified',
  }), true);
  assert.equal(isCandidateAuthRoute({
    pathname: '/index.html',
    search: '?candidate_action=recovery',
  }), true);
  assert.equal(isCandidateAuthRoute({
    pathname: '/admin/',
    search: '',
  }), false);
});
