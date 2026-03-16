const test = require('node:test');
const assert = require('node:assert/strict');

const {
  _buildAccessToken,
  _buildPortalStoragePath,
  _isPortalStoragePathOwnedByUser,
  _validateDocumentRequest,
} = require('../netlify/functions/candidate-documents.js');

test('candidate document endpoint extracts bearer access tokens from headers', () => {
  const token = _buildAccessToken({
    headers: {
      authorization: 'Bearer test-access-token',
    },
  }, {});

  assert.equal(token, 'test-access-token');
});

test('candidate document endpoint validates supported upload metadata', () => {
  const metadata = _validateDocumentRequest({
    fileName: 'Passport.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
  });

  assert.deepEqual(metadata, {
    fileName: 'Passport.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    extension: 'jpg',
  });
});

test('candidate document endpoint rejects unsupported upload types', () => {
  assert.throws(() => _validateDocumentRequest({
    fileName: 'passport.exe',
    mimeType: 'application/octet-stream',
    sizeBytes: 2048,
  }), /Upload a PDF, Word document, or image file/i);
});

test('candidate document endpoint keeps storage paths inside the candidate portal namespace', () => {
  const storagePath = _buildPortalStoragePath('user-42', 'Passport Front.png', 999);
  assert.equal(storagePath, 'portal/user-42/999-passport-front.png');
  assert.equal(_isPortalStoragePathOwnedByUser(storagePath, 'user-42'), true);
  assert.equal(_isPortalStoragePathOwnedByUser(storagePath, 'user-77'), false);
});
