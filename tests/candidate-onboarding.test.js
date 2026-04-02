const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCandidatePortalDeepLink,
  candidateRequiresOnboarding,
  normaliseDocumentType,
  summariseOnboarding,
} = require('../netlify/functions/_candidate-onboarding.js');

test('normaliseDocumentType recognises onboarding document categories', () => {
  assert.equal(normaliseDocumentType('Passport'), 'passport');
  assert.equal(normaliseDocumentType('Visa / permit'), 'visa_permit');
  assert.equal(normaliseDocumentType('Qualification certificate'), 'qualification_certificate');
  assert.equal(normaliseDocumentType('Bank document'), 'bank_document');
  assert.equal(normaliseDocumentType('Reference'), 'reference');
});

test('candidateRequiresOnboarding defaults to recruitment profile mode until explicitly enabled', () => {
  assert.equal(candidateRequiresOnboarding({}), false);
  assert.equal(candidateRequiresOnboarding({ onboarding_mode: true }), true);
  assert.equal(candidateRequiresOnboarding({ onboarding_mode: 'true' }), true);
});

test('summariseOnboarding does not flag payroll blockers for recruitment-profile candidates', () => {
  const profileOnly = summariseOnboarding({
    candidate: {},
    documents: [],
    paymentDetails: { completion: { complete: false } },
  });

  assert.equal(profileOnly.onboardingMode, false);
  assert.equal(profileOnly.hasRightToWork, false);
  assert.equal(profileOnly.hasPaymentDetails, false);
  assert.deepEqual(profileOnly.missing, []);
  assert.equal(profileOnly.onboardingComplete, false);

  const missing = summariseOnboarding({
    candidate: { onboarding_mode: true },
    documents: [],
    paymentDetails: { completion: { complete: false } },
  });

  assert.equal(missing.onboardingMode, true);
  assert.deepEqual(missing.missing, ['right_to_work', 'payment_details']);

  const pendingVerification = summariseOnboarding({
    candidate: { onboarding_mode: true },
    documents: [{ document_type: 'passport' }],
    paymentDetails: { completion: { complete: true } },
  });

  assert.equal(pendingVerification.hasRightToWork, false);
  assert.equal(pendingVerification.hasRightToWorkUpload, true);
  assert.equal(pendingVerification.hasRightToWorkPendingVerification, true);
  assert.equal(pendingVerification.hasPaymentDetails, true);

  const complete = summariseOnboarding({
    candidate: { onboarding_mode: true },
    documents: [{ document_type: 'passport', meta: { verification_status: 'verified' } }],
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
    documents: ['passport', 'reference'],
  });

  assert.match(url, /^https:\/\/preview\.hmj-global\.com\/candidates\?/);
  assert.match(url, /candidate_tab=documents/);
  assert.match(url, /candidate_focus=right_to_work/);
  assert.match(url, /candidate_onboarding=1/);
  assert.match(url, /candidate_docs=passport%2Creference|candidate_docs=passport,reference/);
});
