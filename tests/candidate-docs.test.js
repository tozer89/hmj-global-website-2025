const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normaliseCandidateDocument,
  presentCandidateDocument,
} = require('../netlify/functions/_candidate-docs.js');

test('normaliseCandidateDocument trims fields and preserves safe metadata', () => {
  const record = normaliseCandidateDocument({
    id: ' doc-1 ',
    candidate_id: ' cand-1 ',
    label: ' CV ',
    filename: ' Ava OBrien CV.pdf ',
    storage_key: ' candidate-1/cv.pdf ',
    url: ' https://legacy.example/doc.pdf ',
    meta: { uploaded_by_email: 'ops@hmj-global.com' },
  });

  assert.deepEqual(record, {
    id: 'doc-1',
    candidate_id: 'cand-1',
    label: 'CV',
    filename: 'Ava OBrien CV.pdf',
    storage_key: 'candidate-1/cv.pdf',
    url: 'https://legacy.example/doc.pdf',
    created_at: null,
    meta: { uploaded_by_email: 'ops@hmj-global.com' },
  });
});

test('presentCandidateDocument prefers a signed storage URL when storage metadata exists', async () => {
  const supabase = {
    storage: {
      from(bucket) {
        assert.equal(bucket, 'candidate-docs');
        return {
          async createSignedUrl(path, ttlSeconds) {
            assert.equal(path, 'candidate-1/cv.pdf');
            assert.equal(ttlSeconds, 3600);
            return {
              data: { signedUrl: 'https://signed.example/candidate-1/cv.pdf?token=abc' },
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
    storage_key: 'candidate-1/cv.pdf',
    url: 'https://legacy.example/cv.pdf',
  });

  assert.equal(record.url, 'https://signed.example/candidate-1/cv.pdf?token=abc');
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
    storage_key: 'candidate-1/contract.pdf',
    url: 'https://legacy.example/contract.pdf',
  });

  assert.equal(record.url, 'https://legacy.example/contract.pdf');
  assert.equal(record.access_mode, 'signed_url');
});
