const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadAuthUtils() {
  const moduleUrl = pathToFileURL(
    path.resolve(__dirname, '../js/hmj-candidate-auth-utils.mjs')
  ).href;
  return import(`${moduleUrl}?t=${Date.now()}`);
}

test('validateCandidatePassword requires length, a letter, a number, and a matching confirmation', async () => {
  const { validateCandidatePassword } = await loadAuthUtils();

  assert.deepEqual(
    validateCandidatePassword({
      accountEnabled: true,
      password: 'short',
      confirmPassword: 'short',
    }),
    {
      active: true,
      valid: false,
      tone: 'warn',
      text: 'Use at least 8 characters, including at least one letter and one number.',
    }
  );

  assert.deepEqual(
    validateCandidatePassword({
      accountEnabled: true,
      password: 'StrongPass1',
      confirmPassword: 'StrongPass2',
    }),
    {
      active: true,
      valid: false,
      tone: 'error',
      text: 'The password fields do not match yet.',
    }
  );

  assert.deepEqual(
    validateCandidatePassword({
      accountEnabled: true,
      password: 'StrongPass1',
      confirmPassword: 'StrongPass1',
    }),
    {
      active: true,
      valid: true,
      tone: 'success',
      text: 'Password confirmed. Your account can be created when you submit the form.',
    }
  );
});

test('validateCandidatePassword treats unchecked account creation as valid', async () => {
  const { validateCandidatePassword } = await loadAuthUtils();

  assert.deepEqual(
    validateCandidatePassword({
      accountEnabled: false,
      password: '',
      confirmPassword: '',
    }),
    {
      active: false,
      valid: true,
      tone: 'success',
      text: 'Account creation is off. Your profile will still be sent to HMJ.',
    }
  );
});

test('classifyCandidateSignupResult avoids false-positive success states for existing accounts', async () => {
  const { classifyCandidateSignupResult } = await loadAuthUtils();

  assert.deepEqual(
    classifyCandidateSignupResult({
      user: {
        id: 'user-1',
        identities: [],
      },
      session: null,
    }),
    {
      state: 'existing',
      verificationEmailExpected: false,
    }
  );

  assert.deepEqual(
    classifyCandidateSignupResult({
      user: {
        id: 'user-2',
        identities: [{ identity_id: 'email-1' }],
      },
      session: null,
    }),
    {
      state: 'created',
      verificationEmailExpected: true,
    }
  );
});
