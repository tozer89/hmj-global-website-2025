const test = require('node:test');
const assert = require('node:assert/strict');

const {
  duplicateSummary,
  rightToWorkSummary,
  stripSensitiveCandidateFields,
} = require('../netlify/functions/_candidate-onboarding-admin.js');

test('stripSensitiveCandidateFields removes legacy raw bank identifiers from admin payloads', () => {
  const sanitized = stripSensitiveCandidateFields({
    id: 'candidate-1',
    bank_name: 'Legacy Bank',
    bank_sort_code: '12-34-56',
    bank_account: '12345678',
    bank_iban: 'GB00BANK00000000000000',
    bank_swift: 'BANKGB22',
    tax_id: 'AB123456C',
  });

  assert.equal('bank_name' in sanitized, false);
  assert.equal('bank_sort_code' in sanitized, false);
  assert.equal('bank_account' in sanitized, false);
  assert.equal('bank_iban' in sanitized, false);
  assert.equal('bank_swift' in sanitized, false);
  assert.equal('tax_id' in sanitized, false);
});

test('rightToWorkSummary reports evidence type and verification metadata from stored documents', () => {
  const summary = rightToWorkSummary(
    { right_to_work_evidence_type: 'share_code' },
    [{
      id: 'doc-1',
      document_type: 'right_to_work',
      label: 'Share code evidence',
      uploaded_at: '2026-03-31T10:00:00.000Z',
      meta: {
        verification_status: 'verified',
        verified_by: 'ops@hmj-global.com',
        verified_at: '2026-03-31T11:00:00.000Z',
        verification_notes: 'Share code checked against online service.',
        right_to_work_evidence_type: 'share_code',
      },
    }],
  );

  assert.equal(summary.documentStatus, 'approved');
  assert.equal(summary.verified, true);
  assert.equal(summary.verifiedBy, 'ops@hmj-global.com');
  assert.equal(summary.verifiedAt, '2026-03-31T11:00:00.000Z');
  assert.equal(summary.evidenceType, 'share_code');
  assert.equal(summary.evidenceTypeLabel, 'Share code');
  assert.equal(summary.documentLabel, 'Share code evidence');
});

test('duplicateSummary highlights matching candidate email records for onboarding triage', () => {
  const candidatesByEmail = new Map([
    ['starter@example.com', [
      { id: 'cand-1', email: 'starter@example.com', full_name: 'Starter One', onboarding_mode: true, onboarding_status: 'new', status: 'active' },
      { id: 'cand-2', email: 'starter@example.com', full_name: 'Starter Two', onboarding_mode: false, onboarding_status: null, status: 'archived' },
    ]],
  ]);

  const summary = duplicateSummary(
    { id: 'cand-1', email: 'starter@example.com' },
    candidatesByEmail,
  );

  assert.equal(summary.duplicateEmailCount, 1);
  assert.equal(summary.duplicateEmails[0].id, 'cand-2');
  assert.equal(summary.duplicateEmails[0].name, 'Starter Two');
  assert.equal(summary.duplicateEmails[0].status, 'archived');
});
