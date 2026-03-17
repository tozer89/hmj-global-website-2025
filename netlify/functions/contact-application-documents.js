'use strict';

const { randomUUID } = require('node:crypto');
const { buildCors } = require('./_http.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  isMissingColumnError,
  isMissingRelationError,
  recordCandidateActivity,
  trimString,
} = require('./_candidate-portal.js');
const {
  ALLOWED_DOCUMENT_EXTENSIONS,
  CANDIDATE_DOCS_BUCKET,
  MAX_DOCUMENT_SIZE_BYTES,
  fileExtensionFromName,
  normaliseDocumentType,
  presentCandidateDocument,
  slugifyFilename,
  withDocumentVerificationMeta,
} = require('./_candidate-docs.js');

const PUBLIC_APPLICATION_STORAGE_PREFIX = 'applications';

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

function validateDocumentRequest({ fileName, mimeType, sizeBytes }) {
  const cleanName = trimString(fileName, 280);
  if (!cleanName) {
    throw coded(400, 'Choose a file before uploading.', 'application_document_name_required');
  }

  const extension = fileExtensionFromName(cleanName);
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(extension)) {
    throw coded(400, 'Upload a PDF, Word document, or image file.', 'application_document_type_invalid');
  }

  const bytes = Number(sizeBytes || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw coded(400, 'The selected file could not be read.', 'application_document_size_required');
  }
  if (bytes > MAX_DOCUMENT_SIZE_BYTES) {
    throw coded(400, 'Files must be 15 MB or smaller.', 'application_document_too_large');
  }

  return {
    fileName: cleanName,
    mimeType: trimString(mimeType, 120) || null,
    sizeBytes: bytes,
    extension,
  };
}

function inferDocumentType({ documentType, fieldName, label, fileName }) {
  const requested = normaliseDocumentType(documentType);
  if (requested && requested !== 'other') return requested;

  const raw = [
    trimString(fieldName, 120),
    trimString(label, 240),
    trimString(fileName, 280),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!raw) return 'cv';
  if (/\b(cv|resume)\b/.test(raw)) return 'cv';
  if (/cover[\s_-]?letter/.test(raw)) return 'cover_letter';
  if (/\bpassport\b/.test(raw)) return 'passport';
  if (/right[\s_-]?to[\s_-]?work|share[\s_-]?code/.test(raw)) return 'right_to_work';
  if (/\b(reference|references|referee)\b/.test(raw)) return 'reference';
  if (/\b(visa|permit|brp|residence)\b/.test(raw)) return 'visa_permit';
  if (/\b(cert|certificate|certification|qualification|ticket|card)\b/.test(raw)) return 'qualification_certificate';
  if (/\b(bank|void cheque|void check)\b/.test(raw)) return 'bank_document';
  return 'other';
}

function buildPublicApplicationStoragePath(candidateId, submissionId, filename, timestamp = Date.now()) {
  const safeCandidateId = trimString(candidateId, 120);
  const safeSubmissionId = trimString(submissionId, 160);
  const safeFilename = slugifyFilename(filename);
  if (!safeCandidateId || !safeSubmissionId || !safeFilename) return '';
  return `${PUBLIC_APPLICATION_STORAGE_PREFIX}/${safeCandidateId}/${safeSubmissionId}/${timestamp}-${safeFilename}`;
}

function isApplicationStoragePathOwnedBySubmission(storagePath, candidateId, submissionId) {
  const path = trimString(storagePath, 500);
  const safeCandidateId = trimString(candidateId, 120);
  const safeSubmissionId = trimString(submissionId, 160);
  if (!path || !safeCandidateId || !safeSubmissionId) return false;
  return path.startsWith(`${PUBLIC_APPLICATION_STORAGE_PREFIX}/${safeCandidateId}/${safeSubmissionId}/`);
}

async function getCandidateById(supabase, candidateId) {
  const { data, error } = await supabase
    .from('candidates')
    .select('id,email,auth_user_id,first_name,last_name,full_name')
    .eq('id', String(candidateId))
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      throw coded(503, 'Candidate profiles are unavailable right now.', 'candidate_profiles_unavailable');
    }
    throw error;
  }
  if (!data) {
    throw coded(404, 'Candidate profile could not be found for this application.', 'application_candidate_not_found');
  }
  return data;
}

async function resolveLinkedApplication(supabase, candidateId, applicationId, submissionId) {
  const safeApplicationId = trimString(applicationId, 120);
  const safeSubmissionId = trimString(submissionId, 160);

  if (!safeApplicationId && !safeSubmissionId) return null;

  let query = supabase
    .from('job_applications')
    .select('id,candidate_id,job_id,job_title,source_submission_id')
    .eq('candidate_id', String(candidateId))
    .limit(1);

  if (safeApplicationId) {
    query = query.eq('id', safeApplicationId);
  } else {
    query = query.eq('source_submission_id', safeSubmissionId);
  }

  const { data, error } = await query.maybeSingle();
  if (!error) return data || null;
  if (isMissingRelationError(error) || isMissingColumnError(error)) {
    return null;
  }
  throw error;
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

  if (legacy.error && !isMissingColumnError(legacy.error) && !isMissingRelationError(legacy.error)) {
    throw legacy.error;
  }
  return legacy.data || null;
}

async function findDuplicateDocumentByFingerprint(supabase, candidateId, payload) {
  let query = supabase
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', String(candidateId))
    .eq('document_type', payload.document_type)
    .eq('original_filename', payload.original_filename)
    .eq('file_size_bytes', payload.file_size_bytes)
    .order('uploaded_at', { ascending: false })
    .limit(1);

  let result = await query.maybeSingle();
  if (!result.error) return result.data || null;
  if (!isMissingColumnError(result.error)) throw result.error;

  query = supabase
    .from('candidate_documents')
    .select('*')
    .eq('candidate_id', String(candidateId))
    .eq('document_type', payload.document_type)
    .eq('filename', payload.filename)
    .order('created_at', { ascending: false })
    .limit(1);

  result = await query.maybeSingle();
  if (result.error && !isMissingRelationError(result.error) && !isMissingColumnError(result.error)) {
    throw result.error;
  }
  return result.data || null;
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
      document_type: payload.document_type,
      label: payload.label,
      original_filename: payload.original_filename,
      filename: payload.filename,
      storage_path: payload.storage_path,
      storage_key: payload.storage_key,
      uploaded_at: payload.uploaded_at,
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

function buildDocumentPayload(candidate, linkedApplication, body, validated, storagePath, now) {
  const documentType = inferDocumentType({
    documentType: body.document_type,
    fieldName: body.field_name,
    label: body.label,
    fileName: validated.fileName,
  });
  const label = trimString(body.label, 240)
    || (documentType === 'cv' ? 'CV' : validated.fileName);

  return {
    candidate_id: String(candidate.id),
    owner_auth_user_id: trimString(candidate.auth_user_id, 120) || null,
    document_type: documentType,
    label,
    original_filename: validated.fileName,
    filename: validated.fileName,
    file_extension: validated.extension || null,
    mime_type: validated.mimeType,
    file_size_bytes: validated.sizeBytes,
    storage_bucket: CANDIDATE_DOCS_BUCKET,
    storage_path: storagePath,
    storage_key: storagePath,
    uploaded_at: now,
    updated_at: now,
    meta: withDocumentVerificationMeta(documentType, {
      uploaded_via: 'contact_form',
      source: 'public_application',
      field_name: trimString(body.field_name, 120) || null,
      source_submission_id: trimString(body.submission_id, 160) || null,
      application_id: linkedApplication?.id || trimString(body.application_id, 120) || null,
      job_id: linkedApplication?.job_id || null,
      job_title: linkedApplication?.job_title || null,
      content_type: validated.mimeType,
      size_bytes: validated.sizeBytes,
    }),
  };
}

async function createPrepareUploadResponse(supabase, body) {
  const candidateId = trimString(body.candidate_id, 120);
  const submissionId = trimString(body.submission_id, 160);
  if (!candidateId || !submissionId) {
    throw coded(400, 'Candidate and submission details are required before uploading documents.', 'application_document_context_required');
  }

  await getCandidateById(supabase, candidateId);

  const validated = validateDocumentRequest({
    fileName: body.file_name,
    mimeType: body.mime_type,
    sizeBytes: body.size_bytes,
  });

  const storagePath = buildPublicApplicationStoragePath(
    candidateId,
    submissionId,
    `${randomUUID().slice(0, 8)}-${validated.fileName}`,
    Date.now(),
  );

  if (!storagePath || !isApplicationStoragePathOwnedBySubmission(storagePath, candidateId, submissionId)) {
    throw coded(500, 'A secure storage path could not be prepared.', 'application_document_storage_path_invalid');
  }

  const signed = await supabase
    .storage
    .from(CANDIDATE_DOCS_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signed.error || !signed.data?.token) {
    throw signed.error || coded(500, 'A secure upload link could not be created.', 'application_document_signed_upload_failed');
  }

  return {
    ok: true,
    action: 'prepare_upload',
    candidateId: String(candidateId),
    upload: {
      bucket: CANDIDATE_DOCS_BUCKET,
      path: signed.data.path || storagePath,
      token: signed.data.token,
    },
    document: {
      document_type: inferDocumentType({
        documentType: body.document_type,
        fieldName: body.field_name,
        label: body.label,
        fileName: validated.fileName,
      }),
      label: trimString(body.label, 240) || null,
      original_filename: validated.fileName,
      mime_type: validated.mimeType,
      file_size_bytes: validated.sizeBytes,
      file_extension: validated.extension,
    },
  };
}

async function createFinalizeUploadResponse(supabase, body) {
  const candidateId = trimString(body.candidate_id, 120);
  const submissionId = trimString(body.submission_id, 160);
  const storagePath = trimString(body.storage_path, 500);

  if (!candidateId || !submissionId || !storagePath) {
    throw coded(400, 'Candidate, submission, and storage details are required to finalise the upload.', 'application_document_finalize_required');
  }

  if (!isApplicationStoragePathOwnedBySubmission(storagePath, candidateId, submissionId)) {
    throw coded(403, 'That upload path is not valid for this application.', 'application_document_storage_forbidden');
  }

  const candidate = await getCandidateById(supabase, candidateId);
  const linkedApplication = await resolveLinkedApplication(
    supabase,
    candidateId,
    body.application_id,
    submissionId,
  );

  const validated = validateDocumentRequest({
    fileName: body.file_name,
    mimeType: body.mime_type,
    sizeBytes: body.size_bytes,
  });

  const existing = await findExistingDocumentByPath(supabase, candidateId, storagePath);
  if (existing) {
    const document = await presentCandidateDocument(supabase, existing);
    return {
      ok: true,
      action: 'finalize_upload',
      document,
      deduped: true,
    };
  }

  const existsResult = await supabase
    .storage
    .from(CANDIDATE_DOCS_BUCKET)
    .exists(storagePath);
  if (existsResult.error) {
    throw existsResult.error;
  }
  if (!existsResult.data) {
    throw coded(400, 'The uploaded file could not be found in secure storage. Please upload it again.', 'application_document_missing_object');
  }

  const now = new Date().toISOString();
  const payload = buildDocumentPayload(candidate, linkedApplication, body, validated, storagePath, now);
  const duplicate = await findDuplicateDocumentByFingerprint(supabase, candidateId, payload);

  if (duplicate) {
    if ((duplicate.storage_path || duplicate.storage_key) !== storagePath) {
      await removeStorageObject(supabase, storagePath).catch(() => null);
    }
    const document = await presentCandidateDocument(supabase, duplicate);
    return {
      ok: true,
      action: 'finalize_upload',
      document,
      deduped: true,
    };
  }

  const insert = await insertDocumentRecord(supabase, payload);
  if (insert.error) {
    throw insert.error;
  }

  await recordCandidateActivity(
    supabase,
    String(candidate.id),
    'document_uploaded',
    `${payload.label} uploaded from the public application form.`,
    {
      actorRole: 'candidate',
      actorIdentifier: trimString(candidate.auth_user_id, 120) || trimString(candidate.email, 320) || null,
      meta: {
        source: 'contact_form',
        document_id: insert.data?.id || null,
        document_type: payload.document_type,
        application_id: linkedApplication?.id || trimString(body.application_id, 120) || null,
        source_submission_id: submissionId,
        storage_path: storagePath,
      },
      now,
    },
  ).catch(() => null);

  const document = await presentCandidateDocument(supabase, insert.data);
  return {
    ok: true,
    action: 'finalize_upload',
    document,
    deduped: false,
  };
}

async function createFailureReportResponse(supabase, body) {
  const candidateId = trimString(body.candidate_id, 120);
  const submissionId = trimString(body.submission_id, 160);
  if (!candidateId || !submissionId) {
    throw coded(400, 'Candidate and submission details are required for attachment diagnostics.', 'application_document_failure_context_required');
  }

  const candidate = await getCandidateById(supabase, candidateId);
  const linkedApplication = await resolveLinkedApplication(
    supabase,
    candidateId,
    body.application_id,
    submissionId,
  );

  const fileName = trimString(body.file_name, 280) || 'Application document';
  const documentType = inferDocumentType({
    documentType: body.document_type,
    fieldName: body.field_name,
    label: body.label,
    fileName,
  });

  await recordCandidateActivity(
    supabase,
    String(candidate.id),
    'document_upload_failed',
    `${fileName} could not be attached automatically after the public application form was submitted.`,
    {
      actorRole: 'system',
      actorIdentifier: 'contact_form',
      meta: {
        source: 'contact_form',
        file_name: fileName,
        document_type: documentType,
        application_id: linkedApplication?.id || trimString(body.application_id, 120) || null,
        source_submission_id: submissionId,
        error_message: trimString(body.error_message, 500) || 'Document ingestion failed.',
      },
      now: new Date().toISOString(),
    },
  ).catch(() => null);

  return {
    ok: true,
    action: 'report_failure',
    reported: true,
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

  if (!hasSupabase()) {
    return respond(event, 503, {
      ok: false,
      code: 'supabase_unavailable',
      message: supabaseStatus().error || 'Supabase client unavailable',
    });
  }

  try {
    const body = parseBody(event);
    const action = trimString(body.action, 80) || 'prepare_upload';
    const supabase = getSupabase(event);

    if (action === 'prepare_upload') {
      return respond(event, 200, await createPrepareUploadResponse(supabase, body));
    }
    if (action === 'finalize_upload') {
      return respond(event, 200, await createFinalizeUploadResponse(supabase, body));
    }
    if (action === 'report_failure') {
      return respond(event, 200, await createFailureReportResponse(supabase, body));
    }

    return respond(event, 400, {
      ok: false,
      code: 'application_document_action_invalid',
      message: 'Unknown application document action.',
    });
  } catch (error) {
    console.warn('[contact-application-documents] failed', error?.message || error);
    return respond(event, Number(error?.statusCode) || 500, {
      ok: false,
      code: error?.code || 'application_document_failed',
      message: error?.message || 'Application document request failed.',
    });
  }
}

module.exports = {
  handler: baseHandler,
  _buildPublicApplicationStoragePath: buildPublicApplicationStoragePath,
  _inferPublicApplicationDocumentType: inferDocumentType,
  _isApplicationStoragePathOwnedBySubmission: isApplicationStoragePathOwnedBySubmission,
  _validateApplicationDocumentRequest: validateDocumentRequest,
  _buildApplicationDocumentPayload: buildDocumentPayload,
};
