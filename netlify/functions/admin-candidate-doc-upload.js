// netlify/functions/admin-candidate-doc-upload.js
const { withAdminCors } = require('./_http.js');
const { randomUUID } = require('node:crypto');
const { getContext } = require('./_auth.js');
const { slugify } = require('./_jobs-helpers.js');
const { CANDIDATE_DOCS_BUCKET, presentCandidateDocument } = require('./_candidate-docs.js');

function ensureBuffer(base64) {
  try {
    return Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
}

function isMissingColumnError(error) {
  return /column "?[a-zA-Z0-9_]+"? does not exist/i.test(error?.message || '');
}

function inferDocumentType(name, label) {
  const raw = String(label || name || '').trim().toLowerCase();
  if (!raw) return 'other';
  if (/\b(cv|resume)\b/.test(raw)) return 'cv';
  if (/cover[\s_-]?letter/.test(raw)) return 'cover_letter';
  if (/right[\s_-]?to[\s_-]?work/.test(raw)) return 'right_to_work';
  if (/\b(cert|certificate|certification)\b/.test(raw)) return 'certificate';
  return 'other';
}

async function insertDocumentRecord(supabase, payload) {
  const richInsert = await supabase
    .from('candidate_documents')
    .insert(payload)
    .select('id,candidate_id,label,filename,url,storage_key,created_at,meta')
    .single();

  if (!richInsert.error) return richInsert;
  if (!isMissingColumnError(richInsert.error)) return richInsert;

  return supabase
    .from('candidate_documents')
    .insert({
      candidate_id: payload.candidate_id,
      label: payload.label,
      filename: payload.filename,
      storage_key: payload.storage_key,
      url: null,
      meta: payload.meta,
      created_at: payload.uploaded_at,
    })
    .select('id,candidate_id,label,filename,url,storage_key,created_at,meta')
    .single();
}

const baseHandler = async (event, context) => {
  try {
    const { supabase, user } = await getContext(event, context, { requireAdmin: true });
    const { candidateId, name, contentType, data, label } = JSON.parse(event.body || '{}');

    if (!candidateId || !data || !name) {
      return { statusCode: 400, body: JSON.stringify({ error: 'candidateId, name, data required' }) };
    }

    const buffer = ensureBuffer(data);
    if (!buffer || !buffer.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'invalid file data' }) };
    }

    const safeName = slugify(name.replace(/\.[^.]+$/, '')) || 'cv';
    const ext = (name.includes('.') ? name.split('.').pop() : 'dat') || 'dat';
    const key = `candidate-${candidateId}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}.${ext}`;
    const uploadedAt = new Date().toISOString();
    const documentType = inferDocumentType(name, label);

    const storage = supabase.storage.from(CANDIDATE_DOCS_BUCKET);
    const uploadRes = await storage.upload(key, buffer, {
      contentType: contentType || 'application/octet-stream',
      upsert: false,
    });
    if (uploadRes.error) throw uploadRes.error;

    const { data: record, error } = await insertDocumentRecord(supabase, {
      candidate_id: candidateId,
      document_type: documentType,
      label: label || name,
      original_filename: name,
      filename: name,
      file_extension: ext.toLowerCase(),
      mime_type: contentType || 'application/octet-stream',
      file_size_bytes: buffer.length,
      storage_bucket: CANDIDATE_DOCS_BUCKET,
      storage_path: key,
      storage_key: key,
      uploaded_at: uploadedAt,
      updated_at: uploadedAt,
      url: null,
      meta: {
        access_mode: 'signed_url',
        content_type: contentType || 'application/octet-stream',
        size_bytes: buffer.length,
        uploaded_by_email: user?.email || null,
        uploaded_by_id: user?.id || user?.sub || null,
      },
    });

    if (error) throw error;

    const document = await presentCandidateDocument(supabase, record);

    return { statusCode: 200, body: JSON.stringify({ document }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Upload failed' }) };
  }
};

exports.handler = withAdminCors(baseHandler);
