'use strict';

const CANDIDATE_DOCS_BUCKET = 'candidate-docs';
const CANDIDATE_DOCS_STORAGE_PREFIX = 'portal';
const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp'];
const VERIFICATION_REQUIRED_DOCUMENT_TYPES = new Set([
  'passport',
  'right_to_work',
  'visa_permit',
  'certificate',
  'qualification_certificate',
  'reference',
  'bank_document',
]);
const VERIFICATION_STATUSES = new Set(['pending', 'verified', 'rejected']);
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

function normaliseDocumentType(value) {
  const raw = trimString(value, 80).toLowerCase();
  if (!raw) return 'other';
  if (raw === 'cv' || raw === 'resume') return 'cv';
  if (raw === 'cover_letter' || raw === 'cover letter') return 'cover_letter';
  if (raw === 'certificate' || raw === 'certification') return 'certificate';
  if (raw === 'qualification_certificate' || raw === 'qualification / certificate') return 'qualification_certificate';
  if (raw === 'passport') return 'passport';
  if (raw === 'right_to_work' || raw === 'right to work') return 'right_to_work';
  if (raw === 'reference' || raw === 'references') return 'reference';
  if (raw === 'visa_permit' || raw === 'visa / permit' || raw === 'visa' || raw === 'permit') return 'visa_permit';
  if (raw === 'bank_document' || raw === 'bank document') return 'bank_document';
  if (/\b(cv|resume)\b/.test(raw)) return 'cv';
  if (/cover[\s_-]?letter/.test(raw)) return 'cover_letter';
  if (/\bpassport\b/.test(raw)) return 'passport';
  if (/right[\s_-]?to[\s_-]?work|share[\s_-]?code/.test(raw)) return 'right_to_work';
  if (/\b(reference|references|referee)\b/.test(raw)) return 'reference';
  if (/\bvisa\b|\bpermit\b|\bbrp\b|\bresidence\b/.test(raw)) return 'visa_permit';
  if (/\bqualification\b|\bcertificate\b|\bcertification\b|\bcard\b|\bticket\b/.test(raw)) return 'qualification_certificate';
  if (/\b(bank|void cheque|void check)\b/.test(raw)) return 'bank_document';
  return 'other';
}

function documentRequiresVerification(documentType) {
  return VERIFICATION_REQUIRED_DOCUMENT_TYPES.has(normaliseDocumentType(documentType));
}

function normaliseVerificationStatus(value, documentType) {
  const raw = trimString(value, 40).toLowerCase();
  if (raw && VERIFICATION_STATUSES.has(raw)) return raw;
  return documentRequiresVerification(documentType) ? 'pending' : null;
}

function readDocumentVerification(meta = {}, documentType = 'other') {
  const source = toSafeMeta(meta);
  const required = documentRequiresVerification(documentType);
  const status = normaliseVerificationStatus(
    source.verification_status || source.verificationStatus,
    documentType,
  );
  return {
    required,
    status,
    verified_at: source.verified_at || source.verifiedAt || null,
    verified_by: trimString(source.verified_by || source.verifiedBy, 240) || null,
    verification_notes: trimString(source.verification_notes || source.verificationNotes, 2000) || null,
    reviewed_at: source.reviewed_at || source.reviewedAt || null,
    reviewed_by: trimString(source.reviewed_by || source.reviewedBy, 240) || null,
  };
}

function withDocumentVerificationMeta(documentType, meta = {}, updates = {}) {
  const type = normaliseDocumentType(documentType);
  const merged = {
    ...toSafeMeta(meta),
    ...toSafeMeta(updates),
  };
  if (!documentRequiresVerification(type)) {
    delete merged.verification_status;
    delete merged.verificationStatus;
    return merged;
  }
  merged.verification_status = normaliseVerificationStatus(
    merged.verification_status || merged.verificationStatus,
    type,
  );
  delete merged.verificationStatus;
  return merged;
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
  const documentType = normaliseDocumentType(row.document_type);
  const storagePath = trimString(row.storage_path || row.storage_key, 500) || null;
  const fileSizeBytes = Number(row.file_size_bytes);
  const meta = toSafeMeta(row.meta);
  const verification = readDocumentVerification(meta, documentType);
  return {
    id: trimString(row.id, 120) || null,
    candidate_id: trimString(row.candidate_id, 120) || null,
    owner_auth_user_id: trimString(row.owner_auth_user_id, 120) || null,
    document_type: documentType,
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
    meta,
    verification_required: verification.required,
    verification_status: verification.status,
    verified_at: verification.verified_at,
    verified_by: verification.verified_by,
    verification_notes: verification.verification_notes,
    reviewed_at: verification.reviewed_at,
    reviewed_by: verification.reviewed_by,
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
  documentRequiresVerification,
  fileExtensionFromName,
  isPortalStoragePathOwnedByUser,
  normaliseDocumentType,
  normaliseCandidateDocument,
  presentCandidateDocument,
  presentCandidateDocuments,
  readDocumentVerification,
  resolveCandidateDocumentUrl,
  slugifyFilename,
  withDocumentVerificationMeta,
};
