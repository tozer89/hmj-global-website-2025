'use strict';

const CANDIDATE_DOCS_BUCKET = 'candidate-docs';
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

function normaliseCandidateDocument(row = {}) {
  return {
    id: trimString(row.id, 120) || null,
    candidate_id: trimString(row.candidate_id, 120) || null,
    label: trimString(row.label, 240) || null,
    filename: trimString(row.filename, 280) || null,
    storage_key: trimString(row.storage_key, 500) || null,
    url: trimString(row.url, 2000) || null,
    created_at: row.created_at || null,
    meta: toSafeMeta(row.meta),
  };
}

async function resolveCandidateDocumentUrl(supabase, row, options = {}) {
  const record = normaliseCandidateDocument(row);
  const fallbackUrl = record.url || null;
  if (!record.storage_key || !supabase?.storage?.from) {
    return fallbackUrl;
  }

  const ttlSeconds = Math.max(
    60,
    Math.min(Number(options.ttlSeconds) || DEFAULT_SIGNED_URL_TTL_SECONDS, 86400),
  );

  try {
    const storage = supabase.storage.from(CANDIDATE_DOCS_BUCKET);
    const signed = await storage.createSignedUrl(record.storage_key, ttlSeconds);
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
    kind: record.label || record.filename || 'Candidate document',
    url: accessUrl,
    access_mode: record.storage_key ? 'signed_url' : (record.url ? 'legacy_url' : 'unavailable'),
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
  CANDIDATE_DOCS_BUCKET,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  normaliseCandidateDocument,
  presentCandidateDocument,
  presentCandidateDocuments,
  resolveCandidateDocumentUrl,
};
