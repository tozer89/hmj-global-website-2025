const test = require('node:test');
const assert = require('node:assert/strict');

process.env.HMJ_PAYMENT_DETAILS_SECRET = process.env.HMJ_PAYMENT_DETAILS_SECRET || 'hmj-test-secret';

const {
  buildPaymentWritePayload,
  paymentDetailsSummary,
  presentCandidatePaymentDetails,
} = require('../netlify/functions/_candidate-payment-details.js');

test('buildPaymentWritePayload encrypts and masks GBP account details', () => {
  const payload = buildPaymentWritePayload('candidate-1', 'auth-1', {
    account_currency: 'GBP',
    payment_method: 'gbp_local',
    account_holder_name: 'Joseph Tozer',
    bank_name: 'Bank of HMJ',
    bank_location_or_country: 'United Kingdom',
    sort_code: '12-34-56',
    account_number: '12345678',
  });

  assert.equal(payload.account_currency, 'GBP');
  assert.equal(payload.payment_method, 'gbp_local');
  assert.equal(payload.sort_code_masked, '••-••-56');
  assert.equal(payload.account_number_masked, '••••5678');
  assert.equal(payload.last_four, '5678');
  assert.notEqual(payload.encrypted_sort_code, '123456');
  assert.notEqual(payload.encrypted_account_number, '12345678');

  const presented = presentCandidatePaymentDetails(payload, { includeSensitive: true });
  assert.equal(presented.values.sortCode, '123456');
  assert.equal(presented.values.accountNumber, '12345678');
});

test('buildPaymentWritePayload preserves existing encrypted identifiers when a user edits non-sensitive fields only', () => {
  const existing = buildPaymentWritePayload('candidate-1', 'auth-1', {
    account_currency: 'GBP',
    payment_method: 'gbp_local',
    account_holder_name: 'Joseph Tozer',
    bank_name: 'Bank of HMJ',
    bank_location_or_country: 'United Kingdom',
    sort_code: '12-34-56',
    account_number: '12345678',
  });

  const payload = buildPaymentWritePayload('candidate-1', 'auth-1', {
    account_currency: 'GBP',
    payment_method: 'gbp_local',
    account_holder_name: 'Joseph Tozer',
    bank_name: 'Bank of HMJ Payroll',
    bank_location_or_country: 'United Kingdom',
  }, existing);

  assert.equal(payload.encrypted_sort_code, existing.encrypted_sort_code);
  assert.equal(payload.encrypted_account_number, existing.encrypted_account_number);
  assert.equal(payload.sort_code_masked, existing.sort_code_masked);
  assert.equal(payload.account_number_masked, existing.account_number_masked);
  assert.equal(payload.bank_name, 'Bank of HMJ Payroll');
});

test('paymentDetailsSummary falls back to masked legacy candidate bank data without exposing raw identifiers', () => {
  const summary = paymentDetailsSummary(null, {
    id: 'candidate-legacy',
    bank_name: 'Legacy Bank',
    bank_account: '12345678',
    bank_sort_code: '12-34-56',
    updated_at: '2026-03-16T10:00:00.000Z',
  });

  assert.equal(summary.bankName, 'Legacy Bank');
  assert.equal(summary.lastFour, '5678');
  assert.equal(summary.masked.sortCode, '••-••-56');
  assert.equal(summary.masked.accountNumber, '••••5678');
  assert.equal(summary.completion.complete, true);
});
