const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('candidate registration page exposes a dedicated onboarding right-to-work evidence selector and upload field', () => {
  const html = read('candidates.html');
  const document = new JSDOM(html).window.document;

  const typeField = document.querySelector('#candidateRightToWorkDocumentType');
  const fileField = document.querySelector('#candidateRightToWorkDocument');
  const status = document.querySelector('#candidateRightToWorkDocumentStatus');

  assert.ok(typeField);
  assert.equal(typeField.getAttribute('name'), 'right_to_work_document_type');
  const optionValues = Array.from(typeField.querySelectorAll('option')).map((option) => option.getAttribute('value'));
  ['passport', 'id_card', 'visa', 'brp', 'share_code', 'settlement', 'other'].forEach((value) => {
    assert.ok(optionValues.includes(value), `expected ${value} onboarding evidence option`);
  });
  assert.ok(fileField);
  assert.equal(fileField.getAttribute('name'), null);
  assert.match(fileField.getAttribute('accept') || '', /\.pdf/);
  assert.match(fileField.getAttribute('accept') || '', /\.webp/);
  assert.match(fileField.getAttribute('accept') || '', /\.heic/);
  assert.match(fileField.getAttribute('accept') || '', /\.tiff/);
  assert.ok(status);
  assert.match(status.textContent || '', /Required for onboarding/i);
});

test('candidate registration script uploads required onboarding evidence before allowing native submit', () => {
  const source = read('assets/js/candidates.portal.js');

  assert.match(source, /candidate-registration-documents/);
  assert.match(source, /function validateRegistrationRightToWorkDocument\(/);
  assert.match(source, /right_to_work_evidence_type/);
  assert.match(source, /function normaliseRightToWorkEvidenceType\(/);
  assert.match(source, /starterCvField/);
  assert.match(source, /documentType:\s*'cv'/);
  assert.match(source, /function persistRegistrationDocuments\(/);
  assert.match(source, /documentType,\s*evidenceType/);
  assert.match(source, /await syncRegistrationSubmissionContext\(syncResult, submissionId, registrationDocuments\)/);
  assert.match(source, /ensureHiddenField\('candidate_id', syncResult\.candidateId\)/);
  assert.match(source, /ensureHiddenField\('source_submission_id', submissionId\)/);
});

test('candidate registration documents function defaults public uploads to candidate registration context', () => {
  const source = read('netlify/functions/candidate-registration-documents.js');

  assert.match(source, /source_context = 'candidate_registration'/);
  assert.match(source, /_handlePublicCandidateDocumentEvent/);
});
