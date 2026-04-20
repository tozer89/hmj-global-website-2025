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
      autoSignedIn: false,
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
      autoSignedIn: false,
    }
  );
});

test('classifyCandidateSignupResult marks live session signups as auto-signed-in', async () => {
  const { classifyCandidateSignupResult } = await loadAuthUtils();

  assert.deepEqual(
    classifyCandidateSignupResult({
      user: {
        id: 'user-3',
        identities: [{ identity_id: 'email-2' }],
      },
      session: {
        access_token: 'token',
      },
    }),
    {
      state: 'created',
      verificationEmailExpected: false,
      autoSignedIn: true,
    }
  );
});

test('validateCandidateRegistrationPayment enforces onboarding bank details for local and IBAN flows', async () => {
  const {
    normaliseCandidateRegistrationPaymentMethod,
    validateCandidateRegistrationPayment,
  } = await loadAuthUtils();

  assert.equal(
    normaliseCandidateRegistrationPaymentMethod({
      accountCurrency: 'EUR',
      paymentMethod: '',
    }),
    'iban_swift'
  );

  assert.deepEqual(
    validateCandidateRegistrationPayment({
      active: true,
      accountCurrency: 'GBP',
      paymentMethod: 'gbp_local',
      accountHolderName: 'Jamie Bennett',
      bankName: 'Barclays',
      bankLocationOrCountry: '',
      sortCode: '12-34-56',
      accountNumber: '12345678',
    }),
    {
      active: true,
      valid: false,
      tone: 'error',
      text: 'Enter the bank location or country before you submit onboarding.',
      paymentMethod: 'gbp_local',
      focusKey: 'bankLocationOrCountry',
    }
  );

  assert.deepEqual(
    validateCandidateRegistrationPayment({
      active: true,
      accountCurrency: 'EUR',
      paymentMethod: '',
      accountHolderName: 'Jamie Bennett',
      bankName: 'AIB',
      bankLocationOrCountry: 'Ireland',
      iban: 'IE29AIBK93115212345678',
      swiftBic: 'AIBKIE2D',
    }),
    {
      active: true,
      valid: true,
      tone: 'success',
      text: 'Secure payment details are ready for encrypted HMJ payroll storage.',
      paymentMethod: 'iban_swift',
      focusKey: '',
    }
  );
});
