const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createShareAccessToken,
  verifyShareAccessToken,
  buildTokenizedJobDetailPath,
} = require('../netlify/functions/_job-detail-tokens.js');

test('share access tokens verify against the expected job id and expiry', () => {
  process.env.HMJ_JOB_SPEC_SIGNING_SECRET = 'test-secret';
  const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const token = createShareAccessToken({ jobId: 'role-9', expiresAt });

  assert.ok(token);
  assert.equal(verifyShareAccessToken(token, 'role-9'), true);
  assert.equal(verifyShareAccessToken(token, 'role-10'), false);
});

test('share access tokens reject expired values', () => {
  process.env.HMJ_JOB_SPEC_SIGNING_SECRET = 'test-secret';
  const token = createShareAccessToken({
    jobId: 'role-11',
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });

  assert.ok(token);
  assert.equal(verifyShareAccessToken(token, 'role-11'), false);
});

test('tokenized detail paths include both id and token when present', () => {
  const path = buildTokenizedJobDetailPath({ jobId: 'role-12', token: 'abc123' });
  assert.equal(path, '/jobs/spec.html?id=role-12&token=abc123');
});
