const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPortalStoragePath,
  fileExtensionFromName,
  isPortalStoragePathOwnedByUser,
  normaliseCandidateDocument,
  presentCandidateDocument,
  slugifyFilename,
} = require('../netlify/functions/_candidate-docs.js');

test('normaliseCandidateDocument trims fields and preserves safe metadata', () => {
  const record = normaliseCandidateDocument({
    id: ' doc-1 ',
    candidate_id: ' cand-1 ',
    owner_auth_user_id: ' user-1 ',
    document_type: ' right_to_work ',
    label: ' CV ',
    original_filename: ' Passport Scan.pdf ',
    filename: ' Ava OBrien CV.pdf ',
    storage_bucket: ' candidate-docs ',
    storage_path: ' portal/user-1/passport-scan.pdf ',
    storage_key: ' portal/user-1/passport-scan.pdf ',
    uploaded_at: '2026-03-15T11:00:00Z',
    url: ' https://legacy.example/doc.pdf ',
    meta: { uploaded_by_email: 'ops@hmj-global.com' },
  });

  assert.deepEqual(record, {
    id: 'doc-1',
    candidate_id: 'cand-1',
    owner_auth_user_id: 'user-1',
    document_type: 'right_to_work',
    label: 'CV',
    original_filename: 'Passport Scan.pdf',
    filename: 'Ava OBrien CV.pdf',
    file_extension: 'pdf',
    mime_type: null,
    file_size_bytes: null,
    storage_bucket: 'candidate-docs',
    storage_path: 'portal/user-1/passport-scan.pdf',
    storage_key: 'portal/user-1/passport-scan.pdf',
    url: 'https://legacy.example/doc.pdf',
    uploaded_at: '2026-03-15T11:00:00Z',
    created_at: '2026-03-15T11:00:00Z',
    updated_at: null,
    is_primary: false,
    meta: { uploaded_by_email: 'ops@hmj-global.com' },
    verification_required: true,
    verification_status: 'pending',
    verified_at: null,
    verified_by: null,
    verification_notes: null,
    reviewed_at: null,
    reviewed_by: null,
  });
});

test('presentCandidateDocument prefers a signed storage URL when storage metadata exists', async () => {
  const supabase = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'candidate-docs');
        return {
          async createSignedUrl(path, ttlSeconds) {
            assert.equal(path, 'portal/user-1/cv.pdf');
            assert.equal(ttlSeconds, 3600);
            return {
              data: { signedUrl: 'https://signed.example/portal/user-1/cv.pdf?token=abc' },
              error: null,
            };
          },
        };
      },
    },
  };

  const record = await presentCandidateDocument(supabase, {
    id: 'doc-1',
    label: 'CV',
    filename: 'cv.pdf',
    storage_path: 'portal/user-1/cv.pdf',
    storage_key: 'portal/user-1/cv.pdf',
    url: 'https://legacy.example/cv.pdf',
  });

  assert.equal(record.url, 'https://signed.example/portal/user-1/cv.pdf?token=abc');
  assert.equal(record.download_url, 'https://signed.example/portal/user-1/cv.pdf?token=abc');
  assert.equal(record.access_mode, 'signed_url');
  assert.equal(record.legacy_url, 'https://legacy.example/cv.pdf');
});

test('presentCandidateDocument falls back to the legacy URL when signing is unavailable', async () => {
  const supabase = {
    storage: {
      from() {
        return {
          async createSignedUrl() {
            return { data: null, error: new Error('storage unavailable') };
          },
        };
      },
    },
  };

  const record = await presentCandidateDocument(supabase, {
    id: 'doc-2',
    label: 'Contract',
    filename: 'contract.pdf',
    storage_path: 'portal/user-1/contract.pdf',
    storage_key: 'portal/user-1/contract.pdf',
    url: 'https://legacy.example/contract.pdf',
  });

  assert.equal(record.url, 'https://legacy.example/contract.pdf');
  assert.equal(record.download_url, 'https://legacy.example/contract.pdf');
  assert.equal(record.access_mode, 'signed_url');
});

test('portal storage helpers keep candidate documents inside the portal namespace', () => {
  const storagePath = buildPortalStoragePath('user-99', 'Passport Scan 2026.PNG', 12345);
  assert.equal(storagePath, 'portal/user-99/12345-passport-scan-2026.png');
  assert.equal(fileExtensionFromName('Passport Scan 2026.PNG'), 'png');
  assert.equal(slugifyFilename('Passport Scan 2026.PNG'), 'passport-scan-2026.png');
  assert.equal(isPortalStoragePathOwnedByUser(storagePath, 'user-99'), true);
  assert.equal(isPortalStoragePathOwnedByUser(storagePath, 'user-100'), false);
});
