'use strict';

const { randomUUID } = require('node:crypto');
const { withAdminCors, buildCors } = require('./_http.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  isMissingColumnError,
  isMissingRelationError,
  normaliseDocumentType,
  recordCandidateActivity,
  resolveSupabaseAuthUser,
  trimString,
  upsertCandidateProfile,
} = require('./_candidate-portal.js');
const {
  ALLOWED_DOCUMENT_EXTENSIONS,
  CANDIDATE_DOCS_BUCKET,
  MAX_DOCUMENT_SIZE_BYTES,
  buildPortalStoragePath,
  fileExtensionFromName,
  isPortalStoragePathOwnedByUser,
  presentCandidateDocument,
  presentCandidateDocuments,
  withDocumentVerificationMeta,
} = require('./_candidate-docs.js');

function header(event, name) {
  if (!event?.headers) return '';
  const direct = event.headers[name];
  if (direct) return direct;
  const lower = String(name || '').toLowerCase();
  const key = Object.keys(event.headers).find((item) => item.toLowerCase() === lower);
  return key ? event.headers[key] : '';
}

function respond(event, statusCode, body) {
  return {
    statusCode,
    headers: {
      ...buildCors(event),
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch {
    return {};
  }
}

function coded(statusCode, message, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code || message;
  return error;
}

function buildAccessToken(event, body = {}) {
  return trimString(
    (header(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
    || body.access_token,
    8000,
  );
}

async function requireCandidateContext(event, body = {}) {
  if (!hasSupabase()) {
    throw coded(503, supabaseStatus().error || 'Candidate document tools are unavailable right now.', 'supabase_unavailable');
  }

  const supabase = getSupabase(event);
  const accessToken = buildAccessToken(event, body);
  const authUser = await resolveSupabaseAuthUser(supabase, accessToken);

  if (!authUser?.id || !authUser?.email) {
    throw coded(401, 'Please sign in to manage candidate documents.', 'candidate_not_authenticated');
  }

  const now = new Date().toISOString();
  const candidateResult = await upsertCandidateProfile(
    supabase,
    { email: authUser.email },
    {
      authUser,
      now,
      includeNulls: false,
      touchPortalLogin: true,
    },
  );
  const candidate = candidateResult?.candidate || candidateResult;
  if (!candidate?.id) {
    throw coded(500, 'Candidate profile could not be linked for document upload.', 'candidate_profile_unavailable');
  }

  return { supabase, authUser, candidate, now };
}

function validateDocumentRequest({ fileName, mimeType, sizeBytes }) {
  const cleanName = trimString(fileName, 280);
  if (!cleanName) {
    throw coded(400, 'Choose a file before uploading.', 'candidate_document_name_required');
  }

  const extension = fileExtensionFromName(cleanName);
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(extension)) {
    throw coded(400, 'Upload a PDF, Word document, or supported image file such as JPG, PNG, WEBP, HEIC, or TIFF.', 'candidate_document_type_invalid');
  }

  const bytes = Number(sizeBytes || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw coded(400, 'The selected file could not be read.', 'candidate_document_size_required');
  }
  if (bytes > MAX_DOCUMENT_SIZE_BYTES) {
    throw coded(400, 'Files must be 15 MB or smaller.', 'candidate_document_too_large');
  }

  return {
    fileName: cleanName,
    mimeType: trimString(mimeType, 120) || null,
    sizeBytes: bytes,
    extension,
  };
}

async function listCandidateDocuments(supabase, candidateId) {
  const rich = await supabase
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', String(candidateId))
    .order('uploaded_at', { ascending: false });

  if (!rich.error) return Array.isArray(rich.data) ? rich.data : [];
  if (!isMissingColumnError(rich.error) && !isMissingRelationError(rich.error)) {
    throw rich.error;
  }
  if (isMissingRelationError(rich.error)) {
    return [];
  }

  const legacy = await supabase
    .from('candidate_documents')
    .select('id,candidate_id,label,filename,url,storage_key,created_at,meta')
    .eq('candidate_id', String(candidateId))
    .order('created_at', { ascending: false });

  if (legacy.error) {
    if (isMissingRelationError(legacy.error)) return [];
    throw legacy.error;
  }
  return Array.isArray(legacy.data) ? legacy.data : [];
}

async function findExistingDocumentByPath(supabase, candidateId, storagePath) {
  const rich = await supabase
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', String(candidateId))
    .eq('storage_path', storagePath)
    .limit(1)
    .maybeSingle();

  if (!rich.error) return rich.data || null;
  if (!isMissingColumnError(rich.error)) throw rich.error;

  const legacy = await supabase
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', String(candidateId))
    .eq('storage_key', storagePath)
    .limit(1)
    .maybeSingle();

  if (legacy.error && !isMissingColumnError(legacy.error)) {
    throw legacy.error;
  }
  return legacy.data || null;
}

async function insertDocumentRecord(supabase, payload) {
  const richInsert = await supabase
    .from('candidate_documents')
    .insert(payload)
    .select('*')
    .single();

  if (!richInsert.error) return richInsert;
  if (!isMissingColumnError(richInsert.error)) return richInsert;

  return supabase
    .from('candidate_documents')
    .insert({
      candidate_id: payload.candidate_id,
      label: payload.label,
      filename: payload.filename,
      storage_key: payload.storage_path || payload.storage_key,
      url: null,
      meta: payload.meta,
      created_at: payload.uploaded_at,
    })
    .select('*')
    .single();
}

async function removeStorageObject(supabase, storagePath) {
  if (!storagePath) return;
  const remove = await supabase.storage.from(CANDIDATE_DOCS_BUCKET).remove([storagePath]);
  if (remove?.error) {
    throw remove.error;
  }
}

async function createPrepareUploadResponse(ctx, body) {
  const validated = validateDocumentRequest({
    fileName: body.file_name,
    mimeType: body.mime_type,
    sizeBytes: body.size_bytes,
  });
  const storagePath = buildPortalStoragePath(
    ctx.authUser.id,
    `${randomUUID().slice(0, 8)}-${validated.fileName}`,
    Date.now(),
  );

  if (!storagePath || !isPortalStoragePathOwnedByUser(storagePath, ctx.authUser.id)) {
    throw coded(500, 'A secure storage path could not be prepared.', 'candidate_document_storage_path_invalid');
  }

  const signed = await ctx.supabase
    .storage
    .from(CANDIDATE_DOCS_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signed.error || !signed.data?.token) {
    throw signed.error || coded(500, 'A secure upload link could not be created.', 'candidate_document_signed_upload_failed');
  }

  return {
    ok: true,
    action: 'prepare_upload',
    candidateId: String(ctx.candidate.id),
    upload: {
      bucket: CANDIDATE_DOCS_BUCKET,
      path: signed.data.path || storagePath,
      token: signed.data.token,
    },
    document: {
      document_type: normaliseDocumentType(body.document_type),
      label: trimString(body.label, 240) || null,
      original_filename: validated.fileName,
      mime_type: validated.mimeType,
      file_size_bytes: validated.sizeBytes,
      file_extension: validated.extension,
    },
  };
}

async function createFinalizeUploadResponse(ctx, body) {
  const validated = validateDocumentRequest({
    fileName: body.file_name,
    mimeType: body.mime_type,
    sizeBytes: body.size_bytes,
  });
  const storagePath = trimString(body.storage_path, 500);
  if (!storagePath || !isPortalStoragePathOwnedByUser(storagePath, ctx.authUser.id)) {
    throw coded(403, 'That upload path is not valid for this candidate account.', 'candidate_document_storage_forbidden');
  }

  const existing = await findExistingDocumentByPath(ctx.supabase, ctx.candidate.id, storagePath);
  if (existing) {
    const document = await presentCandidateDocument(ctx.supabase, existing);
    return {
      ok: true,
      action: 'finalize_upload',
      document,
      deduped: true,
    };
  }

  const existsResult = await ctx.supabase
    .storage
    .from(CANDIDATE_DOCS_BUCKET)
    .exists(storagePath);
  if (existsResult.error) {
    throw existsResult.error;
  }
  if (!existsResult.data) {
    throw coded(400, 'The uploaded file could not be found in secure storage. Please upload it again.', 'candidate_document_missing_object');
  }

  const uploadedAt = new Date().toISOString();
  const documentType = normaliseDocumentType(body.document_type);
  const payload = {
    candidate_id: String(ctx.candidate.id),
    owner_auth_user_id: ctx.authUser.id,
    document_type: documentType,
    label: trimString(body.label, 240) || trimString(validated.fileName, 240) || 'Document',
    original_filename: validated.fileName,
    filename: validated.fileName,
    file_extension: validated.extension || null,
    mime_type: validated.mimeType,
    file_size_bytes: validated.sizeBytes,
    storage_bucket: CANDIDATE_DOCS_BUCKET,
    storage_path: storagePath,
    storage_key: storagePath,
    uploaded_at: uploadedAt,
    updated_at: uploadedAt,
    meta: withDocumentVerificationMeta(documentType, {
      uploaded_via: 'candidate_portal',
      owner_user_id: ctx.authUser.id,
      source: 'candidate_documents_function',
    }),
  };

  const insert = await insertDocumentRecord(ctx.supabase, payload);
  if (insert.error) {
    throw insert.error;
  }

  await recordCandidateActivity(
    ctx.supabase,
    String(ctx.candidate.id),
    'document_uploaded',
    `${payload.label} uploaded from the candidate dashboard.`,
    {
      actorRole: 'candidate',
      actorIdentifier: ctx.authUser.id,
      meta: {
        source: 'candidate_dashboard',
        document_id: insert.data?.id || null,
        document_type: payload.document_type,
        storage_path: storagePath,
      },
      now: uploadedAt,
    },
  ).catch(() => null);

  const document = await presentCandidateDocument(ctx.supabase, insert.data);
  return {
    ok: true,
    action: 'finalize_upload',
    document,
    deduped: false,
  };
}

async function createDeleteResponse(ctx, body) {
  const documentId = trimString(body.document_id || body.id, 120);
  if (!documentId) {
    throw coded(400, 'Choose a document to delete.', 'candidate_document_id_required');
  }

  const existing = await ctx.supabase
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', String(ctx.candidate.id))
    .eq('id', documentId)
    .maybeSingle();

  if (existing.error) {
    if (isMissingRelationError(existing.error)) {
      throw coded(404, 'That document could not be found.', 'candidate_document_not_found');
    }
    throw existing.error;
  }
  if (!existing.data) {
    throw coded(404, 'That document could not be found.', 'candidate_document_not_found');
  }

  const storagePath = trimString(existing.data.storage_path || existing.data.storage_key, 500);
  if (storagePath && isPortalStoragePathOwnedByUser(storagePath, ctx.authUser.id)) {
    await removeStorageObject(ctx.supabase, storagePath);
  }

  const removeRecord = await ctx.supabase
    .from('candidate_documents')
    .delete()
    .eq('id', documentId);

  if (removeRecord.error) {
    throw removeRecord.error;
  }

  await recordCandidateActivity(
    ctx.supabase,
    String(ctx.candidate.id),
    'document_deleted',
    `${trimString(existing.data.label || existing.data.original_filename || existing.data.filename, 240) || 'Document'} deleted from the candidate dashboard.`,
    {
      actorRole: 'candidate',
      actorIdentifier: ctx.authUser.id,
      meta: {
        source: 'candidate_dashboard',
        document_id: documentId,
        storage_path: storagePath || null,
      },
      now: new Date().toISOString(),
    },
  ).catch(() => null);

  return {
    ok: true,
    action: 'delete',
    deleted: true,
    documentId,
  };
}

async function createListResponse(ctx) {
  const rows = await listCandidateDocuments(ctx.supabase, ctx.candidate.id);
  const documents = await presentCandidateDocuments(ctx.supabase, rows || []);
  return {
    ok: true,
    action: 'list',
    candidateId: String(ctx.candidate.id),
    documents,
  };
}

async function baseHandler(event = {}) {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return respond(event, 200, { ok: true });
  }
  if (method !== 'POST') {
    return respond(event, 405, { ok: false, code: 'method_not_allowed' });
  }

  try {
    const body = parseBody(event);
    const action = trimString(body.action, 80) || 'list';
    const ctx = await requireCandidateContext(event, body);

    if (action === 'prepare_upload') {
      return respond(event, 200, await createPrepareUploadResponse(ctx, body));
    }
    if (action === 'finalize_upload') {
      return respond(event, 200, await createFinalizeUploadResponse(ctx, body));
    }
    if (action === 'delete') {
      return respond(event, 200, await createDeleteResponse(ctx, body));
    }
    if (action === 'list') {
      return respond(event, 200, await createListResponse(ctx));
    }

    return respond(event, 400, {
      ok: false,
      code: 'candidate_document_action_invalid',
      message: 'Unknown candidate document action.',
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.code) || 500;
    return respond(event, statusCode, {
      ok: false,
      code: error?.code || 'candidate_documents_failed',
      message: error?.message || 'Candidate document request failed.',
    });
  }
}

module.exports = {
  handler: withAdminCors(baseHandler),
  _buildAccessToken: buildAccessToken,
  _buildPortalStoragePath: buildPortalStoragePath,
  _isPortalStoragePathOwnedByUser: isPortalStoragePathOwnedByUser,
  _validateDocumentRequest: validateDocumentRequest,
};
