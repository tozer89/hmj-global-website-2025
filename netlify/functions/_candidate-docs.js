'use strict';

const CANDIDATE_DOCS_BUCKET = 'candidate-docs';
const CANDIDATE_DOCS_STORAGE_PREFIX = 'portal';
const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp'];
const DEFAULT_SIGNED_URL_TTL_SECONDS = Math.max(
  300,
  Math.min(Number(process.env.CANDIDATE_DOC_SIGNED_URL_TTL_SECONDS) || 3600, 86400),
);

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function toSafeMeta(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function fileExtensionFromName(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function slugifyFilename(name) {
  const raw = trimString(name, 240) || 'document';
  const extension = fileExtensionFromName(raw);
  const stem = raw
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'document';
  return extension ? `${stem}.${extension}` : stem;
}

function buildPortalStoragePath(userId, filename, timestamp = Date.now()) {
  const safeUserId = trimString(userId, 120);
  const safeFilename = slugifyFilename(filename);
  if (!safeUserId || !safeFilename) return '';
  return `${CANDIDATE_DOCS_STORAGE_PREFIX}/${safeUserId}/${timestamp}-${safeFilename}`;
}

function isPortalStoragePathOwnedByUser(storagePath, userId) {
  const path = trimString(storagePath, 500);
  const safeUserId = trimString(userId, 120);
  if (!path || !safeUserId) return false;
  return path.startsWith(`${CANDIDATE_DOCS_STORAGE_PREFIX}/${safeUserId}/`);
}

function normaliseCandidateDocument(row = {}) {
  const storagePath = trimString(row.storage_path || row.storage_key, 500) || null;
  const fileSizeBytes = Number(row.file_size_bytes);
  return {
    id: trimString(row.id, 120) || null,
    candidate_id: trimString(row.candidate_id, 120) || null,
    owner_auth_user_id: trimString(row.owner_auth_user_id, 120) || null,
    document_type: trimString(row.document_type, 80) || 'other',
    label: trimString(row.label, 240) || null,
    original_filename: trimString(row.original_filename, 280) || trimString(row.filename, 280) || null,
    filename: trimString(row.filename, 280) || null,
    file_extension: trimString(row.file_extension, 32) || fileExtensionFromName(row.original_filename || row.filename) || null,
    mime_type: trimString(row.mime_type, 120) || null,
    file_size_bytes: row.file_size_bytes == null || row.file_size_bytes === '' || !Number.isFinite(fileSizeBytes)
      ? null
      : fileSizeBytes,
    storage_bucket: trimString(row.storage_bucket, 120) || CANDIDATE_DOCS_BUCKET,
    storage_path: storagePath,
    storage_key: trimString(row.storage_key, 500) || storagePath,
    url: trimString(row.url, 2000) || null,
    uploaded_at: row.uploaded_at || row.created_at || null,
    created_at: row.created_at || row.uploaded_at || null,
    updated_at: row.updated_at || null,
    is_primary: !!row.is_primary,
    meta: toSafeMeta(row.meta),
  };
}

async function resolveCandidateDocumentUrl(supabase, row, options = {}) {
  const record = normaliseCandidateDocument(row);
  const fallbackUrl = record.url || null;
  const storagePath = record.storage_path || record.storage_key;
  if (!storagePath || !supabase?.storage?.from) {
    return fallbackUrl;
  }

  const ttlSeconds = Math.max(
    60,
    Math.min(Number(options.ttlSeconds) || DEFAULT_SIGNED_URL_TTL_SECONDS, 86400),
  );

  try {
    const storage = supabase.storage.from(record.storage_bucket || CANDIDATE_DOCS_BUCKET);
    const signed = await storage.createSignedUrl(storagePath, ttlSeconds);
    if (!signed?.error && signed?.data?.signedUrl) {
      return signed.data.signedUrl;
    }
  } catch (error) {
    console.warn('[candidate-docs] signed URL generation failed', error?.message || error);
  }

  return fallbackUrl;
}

async function presentCandidateDocument(supabase, row, options = {}) {
  const record = normaliseCandidateDocument(row);
  const accessUrl = await resolveCandidateDocumentUrl(supabase, record, options);
  return {
    ...record,
    kind: record.label || record.original_filename || record.filename || 'Candidate document',
    url: accessUrl,
    download_url: accessUrl,
    access_mode: (record.storage_path || record.storage_key) ? 'signed_url' : (record.url ? 'legacy_url' : 'unavailable'),
    legacy_url: record.url || null,
  };
}

async function presentCandidateDocuments(supabase, rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  for (const row of list) {
    out.push(await presentCandidateDocument(supabase, row, options));
  }
  return out;
}

module.exports = {
  ALLOWED_DOCUMENT_EXTENSIONS,
  CANDIDATE_DOCS_BUCKET,
  CANDIDATE_DOCS_STORAGE_PREFIX,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  MAX_DOCUMENT_SIZE_BYTES,
  buildPortalStoragePath,
  fileExtensionFromName,
  isPortalStoragePathOwnedByUser,
  normaliseCandidateDocument,
  presentCandidateDocument,
  presentCandidateDocuments,
  resolveCandidateDocumentUrl,
  slugifyFilename,
};
