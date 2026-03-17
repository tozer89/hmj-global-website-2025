const test = require('node:test');
const assert = require('node:assert/strict');

const {
  _buildPublicApplicationStoragePath,
  _inferPublicApplicationDocumentType,
  _isApplicationStoragePathOwnedBySubmission,
  _validateApplicationDocumentRequest,
  _buildApplicationDocumentPayload,
} = require('../netlify/functions/contact-application-documents.js');

test('public application document endpoint builds scoped storage paths per candidate submission', () => {
  const storagePath = _buildPublicApplicationStoragePath(
    'candidate-42',
    'submission-99',
    'Joseph Tozer CV.pdf',
    12345,
  );

  assert.equal(storagePath, 'applications/candidate-42/submission-99/12345-joseph-tozer-cv.pdf');
  assert.equal(_isApplicationStoragePathOwnedBySubmission(storagePath, 'candidate-42', 'submission-99'), true);
  assert.equal(_isApplicationStoragePathOwnedBySubmission(storagePath, 'candidate-42', 'submission-11'), false);
});

test('public application document endpoint infers CV and cover-letter categories from public field names', () => {
  assert.equal(_inferPublicApplicationDocumentType({
    fieldName: 'cv',
    fileName: 'candidate.pdf',
  }), 'cv');

  assert.equal(_inferPublicApplicationDocumentType({
    fieldName: 'cover_letter',
    fileName: 'cover-letter.docx',
  }), 'cover_letter');
});

test('public application document endpoint validates upload metadata with the shared candidate-doc limits', () => {
  const metadata = _validateApplicationDocumentRequest({
    fileName: 'application-cv.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
  });

  assert.deepEqual(metadata, {
    fileName: 'application-cv.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    extension: 'pdf',
  });
});

test('public application document endpoint builds candidate document rows with contact-form linkage metadata', () => {
  const payload = _buildApplicationDocumentPayload(
    {
      id: 'cand-1',
      auth_user_id: 'user-1',
    },
    {
      id: 'app-1',
      job_id: 'job-42',
      job_title: 'Senior Planner',
    },
    {
      submission_id: 'submission-1',
      field_name: 'cv',
      document_type: 'cv',
      label: '',
    },
    {
      fileName: 'Planner CV.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 8192,
      extension: 'pdf',
    },
    'applications/cand-1/submission-1/123-planner-cv.pdf',
    '2026-03-17T16:00:00.000Z',
  );

  assert.equal(payload.candidate_id, 'cand-1');
  assert.equal(payload.owner_auth_user_id, 'user-1');
  assert.equal(payload.document_type, 'cv');
  assert.equal(payload.label, 'CV');
  assert.equal(payload.storage_bucket, 'candidate-docs');
  assert.equal(payload.storage_path, 'applications/cand-1/submission-1/123-planner-cv.pdf');
  assert.equal(payload.meta.uploaded_via, 'contact_form');
  assert.equal(payload.meta.source_submission_id, 'submission-1');
  assert.equal(payload.meta.application_id, 'app-1');
  assert.equal(payload.meta.job_id, 'job-42');
});
