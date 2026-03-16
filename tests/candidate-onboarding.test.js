const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCandidatePortalDeepLink,
  normaliseDocumentType,
  summariseOnboarding,
} = require('../netlify/functions/_candidate-onboarding.js');

test('normaliseDocumentType recognises onboarding document categories', () => {
  assert.equal(normaliseDocumentType('Passport'), 'passport');
  assert.equal(normaliseDocumentType('Visa / permit'), 'visa_permit');
  assert.equal(normaliseDocumentType('Qualification certificate'), 'qualification_certificate');
  assert.equal(normaliseDocumentType('Bank document'), 'bank_document');
});

test('summariseOnboarding flags missing RTW and payment details cleanly', () => {
  const missing = summariseOnboarding({
    candidate: {},
    documents: [],
    paymentDetails: { completion: { complete: false } },
  });

  assert.equal(missing.hasRightToWork, false);
  assert.equal(missing.hasPaymentDetails, false);
  assert.deepEqual(missing.missing, ['right_to_work', 'payment_details']);

  const complete = summariseOnboarding({
    candidate: {},
    documents: [{ document_type: 'passport' }],
    paymentDetails: { completion: { complete: true } },
  });

  assert.equal(complete.onboardingComplete, true);
  assert.equal(complete.hasRightToWork, true);
  assert.equal(complete.hasPaymentDetails, true);
});

test('buildCandidatePortalDeepLink routes users back into the onboarding documents target', () => {
  const url = buildCandidatePortalDeepLink({
    headers: {
      host: 'preview.hmj-global.com',
      'x-forwarded-proto': 'https',
    },
  }, {
    tab: 'documents',
    focus: 'right_to_work',
    onboarding: true,
  });

  assert.match(url, /^https:\/\/preview\.hmj-global\.com\/candidates\.html\?/);
  assert.match(url, /candidate_tab=documents/);
  assert.match(url, /candidate_focus=right_to_work/);
  assert.match(url, /candidate_onboarding=1/);
});
