const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('candidate registration page exposes an optional secure payment gate with non-Netlify fields', () => {
  const html = read('candidates.html');
  const document = new JSDOM(html).window.document;

  const toggle = document.querySelector('#candidatePaymentOptIn');
  const panel = document.querySelector('#candidatePaymentPanel');
  const sensitiveFields = Array.from(document.querySelectorAll('#candidatePaymentPanel [data-payment-sensitive]'));
  const namedPaymentFields = Array.from(document.querySelectorAll('#candidatePaymentPanel [name]'));

  assert.ok(toggle);
  assert.ok(panel);
  assert.equal(toggle.getAttribute('aria-controls'), 'candidatePaymentPanel');
  assert.equal(namedPaymentFields.length, 0);
  assert.ok(sensitiveFields.length >= 4);
});

test('candidate registration script only sends payment details through the background sync path', () => {
  const source = read('assets/js/candidates.portal.js');

  assert.match(source, /function paymentValidationState\(/);
  assert.match(source, /function buildRegistrationPaymentDetails\(/);
  assert.match(source, /payment_details:\s*paymentDetails/);
  assert.match(source, /await backgroundSyncCandidatePayload\(payload,\s*\{\s*awaitResponse:\s*true\s*\}\)/);
  assert.match(source, /candidatePaymentOptIn/);
  assert.match(source, /candidatePaymentPanel/);
});

test('shared candidate sync helper supports awaited secure sync responses', () => {
  const source = read('js/hmj-candidate-portal.js');

  assert.match(source, /backgroundSyncCandidatePayload\(basePayload = \{\}, options = \{\}\)/);
  assert.match(source, /const awaitResponse = options && options\.awaitResponse === true/);
  assert.match(source, /if \(!awaitResponse && navigator\.sendBeacon\)/);
  assert.match(source, /Candidate profile sync failed/);
});

test('candidate portal sync persists optional registration payment details via the existing secure table', () => {
  const source = read('netlify/functions/candidate-portal-sync.js');

  assert.match(source, /buildPaymentWritePayload/);
  assert.match(source, /candidate_payment_details/);
  assert.match(source, /payment_details/);
  assert.match(source, /paymentSaved:/);
});
