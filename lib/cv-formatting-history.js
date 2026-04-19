'use strict';

const { randomUUID } = require('node:crypto');
const { isMissingTableError, slugify } = require('../netlify/functions/_jobs-helpers.js');

const CV_FORMATTING_RUNS_TABLE = 'cv_formatting_runs';
const CV_FORMATTING_FILES_TABLE = 'cv_formatting_files';
const DEFAULT_BUCKET = 'cv-formatting-files';
const DEFAULT_HISTORY_LIMIT = 10;
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60;
const DEFAULT_STORAGE_TIMEOUT_MS = 10000;

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  return maxLength && maxLength > 0 ? text.slice(0, maxLength) : text;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values, maxLength) {
  const seen = new Set();
  const output = [];
  safeArray(values).forEach((value) => {
    const text = trimString(value, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    output.push(text);
  });
  return output;
}

function getHistoryBucketName() {
  return trimString(process.env.CV_FORMATTING_UPLOAD_BUCKET) || DEFAULT_BUCKET;
}

function isMissingBucketError(error, bucketName = '') {
  if (!error) return false;
  const code = String(error.code || error.status || error.statusCode || '').toUpperCase();
  const bucket = trimString(bucketName).toLowerCase();
  const sources = [
    String(error.message || '').toLowerCase(),
    String(error.details || '').toLowerCase(),
    String(error.hint || '').toLowerCase(),
  ].filter(Boolean);
  const mentionsBucket = !bucket || sources.some((source) => source.includes(bucket));
  return (
    code === '404' ||
    sources.some((source) => (
      source.includes('bucket') &&
      (source.includes('not found') || source.includes('does not exist')) &&
      mentionsBucket
    ))
  );
}

function fileExtension(fileName) {
  const text = trimString(fileName).toLowerCase();
  const index = text.lastIndexOf('.');
  return index === -1 ? '' : text.slice(index + 1);
}

function guessContentType(fileName, fallback) {
  const ext = fileExtension(fileName);
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return trimString(fallback) || 'application/octet-stream';
}

function buildStorageKey(runId, kind, fileName) {
  const ext = fileExtension(fileName) || 'bin';
  const base = trimString(fileName).replace(/[\\/]+/g, '-').replace(/[^\x20-\x7E]+/g, ' ') || `${kind}-${Date.now()}`;
  const stem = slugify(base.replace(/\.[^.]+$/, '')) || `${kind}-${Date.now()}`;
  return `cv-formatting/${runId}/${Date.now()}-${kind}-${randomUUID().slice(0, 8)}-${stem}.${ext}`;
}

function withTimeout(task, timeoutMs, onTimeoutMessage) {
  const safeTimeout = Math.max(1000, Number(timeoutMs) || DEFAULT_STORAGE_TIMEOUT_MS);
  let timer = null;
  return Promise.race([
    Promise.resolve().then(task).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(trimString(onTimeoutMessage) || `Operation timed out after ${safeTimeout}ms.`);
        error.statusCode = 504;
        error.code = 'history_timeout';
        reject(error);
      }, safeTimeout);
    }),
  ]);
}

function actorEmailFromUser(user) {
  return trimString(user?.email || user?.user_metadata?.email, 240);
}

function normaliseStoredFile(row) {
  const kind = trimString(row?.kind);
  return {
    id: trimString(row?.id),
    kind,
    label: kind === 'candidate_cv'
      ? 'Candidate CV'
      : kind === 'job_spec'
        ? 'Job spec'
        : kind === 'formatted_output'
          ? 'Formatted output'
          : 'Stored file',
    original_filename: trimString(row?.original_filename),
    mime_type: trimString(row?.mime_type),
    file_size_bytes: Number.isFinite(Number(row?.file_size_bytes)) ? Number(row.file_size_bytes) : null,
    storage_bucket: trimString(row?.storage_bucket),
    storage_path: trimString(row?.storage_path),
    created_at: trimString(row?.created_at),
    download_url: trimString(row?.download_url),
  };
}

async function createSignedUrl(supabase, file, options = {}) {
  const record = normaliseStoredFile(file);
  if (!record.storage_bucket || !record.storage_path || !supabase?.storage?.from) return null;
  const ttlSeconds = Math.max(60, Math.min(Number(options.ttlSeconds) || DEFAULT_SIGNED_URL_TTL_SECONDS, 86400));
  try {
    const signed = await supabase.storage.from(record.storage_bucket).createSignedUrl(record.storage_path, ttlSeconds);
    return signed?.data?.signedUrl || null;
  } catch (error) {
    console.warn('[cv-formatting-history] signed URL generation failed', error?.message || error);
    return null;
  }
}

async function presentStoredFile(supabase, row, options = {}) {
  const record = normaliseStoredFile(row);
  const signedUrl = await createSignedUrl(supabase, record, options);
  return {
    ...record,
    download_url: signedUrl,
    access_mode: signedUrl ? 'signed_url' : 'unavailable',
  };
}

async function presentStoredFiles(supabase, rows, options = {}) {
  const files = [];
  for (const row of safeArray(rows)) {
    files.push(await presentStoredFile(supabase, row, options));
  }
  return files;
}

function buildRunSummary(row, files) {
  const safeFiles = safeArray(files);
  return {
    id: trimString(row?.id),
    created_at: trimString(row?.created_at),
    updated_at: trimString(row?.updated_at),
    completed_at: trimString(row?.completed_at),
    actor_email: trimString(row?.actor_email),
    status: trimString(row?.status) || 'completed',
    source: trimString(row?.source) || 'fallback',
    model: trimString(row?.model),
    candidate_reference: trimString(row?.candidate_reference),
    target_role: trimString(row?.target_role),
    candidate_file_name: trimString(row?.candidate_file_name),
    job_spec_file_name: trimString(row?.job_spec_file_name),
    output_file_name: trimString(row?.output_file_name),
    warning_count: Number.isFinite(Number(row?.warning_count)) ? Number(row.warning_count) : safeArray(row?.warnings_json).length,
    error_message: trimString(row?.error_message),
    options: safeObject(row?.options_json),
    profile: safeObject(row?.profile_json),
    analysis: safeObject(row?.analysis_json),
    ai_attempts: safeArray(row?.ai_attempts_json),
    files: safeFiles,
    downloads: {
      candidate_cv: safeFiles.find((file) => file.kind === 'candidate_cv') || null,
      job_spec: safeFiles.find((file) => file.kind === 'job_spec') || null,
      formatted_output: safeFiles.find((file) => file.kind === 'formatted_output') || null,
    },
  };
}

async function createRunPlaceholder({ supabase, runId, user, candidateFile, jobSpecFile, options }) {
  const payload = {
    id: runId,
    created_by: user?.id || user?.sub || null,
    actor_email: actorEmailFromUser(user) || null,
    status: 'processing',
    source: 'pending',
    model: null,
    candidate_reference: null,
    target_role: trimString(options?.targetRoleOverride) || null,
    candidate_file_name: trimString(candidateFile?.name) || null,
    job_spec_file_name: trimString(jobSpecFile?.name) || null,
    output_file_name: null,
    options_json: safeObject(options),
    profile_json: {},
    analysis_json: {},
    ai_attempts_json: [],
    warning_count: 0,
    error_message: null,
    completed_at: null,
  };

  const { data, error } = await supabase
    .from(CV_FORMATTING_RUNS_TABLE)
    .upsert(payload, { onConflict: 'id' })
    .select('id,created_at,updated_at,completed_at,actor_email,status,source,model,candidate_reference,target_role,candidate_file_name,job_spec_file_name,output_file_name,warning_count,error_message,options_json,profile_json,analysis_json,ai_attempts_json')
    .single();

  if (error) {
    if (isMissingTableError(error, CV_FORMATTING_RUNS_TABLE)) {
      return { enabled: false, record: null, warnings: ['History tables are not configured in this environment yet.'] };
    }
    throw error;
  }

  return { enabled: true, record: data, warnings: [] };
}

async function uploadStoredArtifact({ supabase, runId, user, file, kind, timeoutMs }) {
  if (!file) return { saved: false, row: null, warning: '' };
  const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(String(file.data || ''), 'base64');
  if (!buffer.length) {
    return { saved: false, row: null, warning: `${trimString(file.name) || 'File'} could not be stored because its payload was empty.` };
  }

  const bucket = getHistoryBucketName();
  const storagePath = buildStorageKey(runId, kind, file.name);
  const contentType = guessContentType(file.name, file.contentType || file.type);

  const response = await withTimeout(
    () => supabase.storage.from(bucket).upload(storagePath, buffer, {
      contentType,
      upsert: false,
      metadata: {
        uploaded_by: actorEmailFromUser(user) || '',
        original_name: trimString(file.name),
        run_id: runId,
        kind,
      },
    }),
    timeoutMs,
    `Storage upload timed out for ${trimString(file.name) || 'file'}.`
  );

  if (response?.error) {
    if (isMissingBucketError(response.error, bucket)) {
      return { saved: false, row: null, warning: 'History storage bucket is not configured in this environment yet.' };
    }
    throw response.error;
  }

  return {
    saved: true,
    row: {
      kind,
      original_filename: trimString(file.name),
      mime_type: contentType,
      file_size_bytes: Number.isFinite(Number(file.size)) ? Number(file.size) : buffer.byteLength,
      storage_bucket: bucket,
      storage_path: storagePath,
    },
    warning: '',
  };
}

async function cleanupStoredArtifacts({ supabase, files, timeoutMs }) {
  const grouped = new Map();
  safeArray(files).forEach((file) => {
    const bucket = trimString(file?.storage_bucket);
    const path = trimString(file?.storage_path);
    if (!bucket || !path) return;
    const bucketPaths = grouped.get(bucket) || [];
    bucketPaths.push(path);
    grouped.set(bucket, bucketPaths);
  });

  const warnings = [];
  for (const [bucket, paths] of grouped.entries()) {
    try {
      const response = await withTimeout(
        () => supabase.storage.from(bucket).remove(paths),
        timeoutMs,
        `Storage cleanup timed out for ${bucket}.`
      );
      if (response?.error && !isMissingBucketError(response.error, bucket)) {
        warnings.push(`History cleanup could not remove ${paths.length} stored file${paths.length === 1 ? '' : 's'} from ${bucket}.`);
      }
    } catch (error) {
      warnings.push(`History cleanup could not remove ${paths.length} stored file${paths.length === 1 ? '' : 's'} from ${bucket}.`);
      console.warn('[cv-formatting-history] cleanup failed', error?.message || error);
    }
  }

  return warnings;
}

async function saveArtifactRows({ supabase, runId, files, timeoutMs }) {
  const payload = safeArray(files)
    .filter((file) => file && file.storage_path)
    .map((file) => ({
      formatting_run_id: runId,
      kind: trimString(file.kind),
      original_filename: trimString(file.original_filename),
      mime_type: trimString(file.mime_type),
      file_size_bytes: Number.isFinite(Number(file.file_size_bytes)) ? Number(file.file_size_bytes) : null,
      storage_bucket: trimString(file.storage_bucket),
      storage_path: trimString(file.storage_path),
    }));

  if (!payload.length) {
    return { enabled: true, saved: false, records: [], warnings: [] };
  }

  const { data, error } = await supabase
    .from(CV_FORMATTING_FILES_TABLE)
    .insert(payload)
    .select('id,created_at,kind,original_filename,mime_type,file_size_bytes,storage_bucket,storage_path');

  if (error) {
    if (isMissingTableError(error, CV_FORMATTING_FILES_TABLE)) {
      const cleanupWarnings = await cleanupStoredArtifacts({ supabase, files: payload, timeoutMs });
      return {
        enabled: false,
        saved: false,
        records: [],
        warnings: ['History file metadata tables are not configured in this environment yet.'].concat(cleanupWarnings),
      };
    }
    throw error;
  }

  return { enabled: true, saved: true, records: safeArray(data), warnings: [] };
}

async function storeInputArtifacts({ supabase, runId, user, candidateFile, jobSpecFile, timeoutMs }) {
  const warnings = [];
  const uploads = [];

  const candidateUpload = await uploadStoredArtifact({
    supabase,
    runId,
    user,
    file: candidateFile,
    kind: 'candidate_cv',
    timeoutMs,
  });
  if (candidateUpload.warning) warnings.push(candidateUpload.warning);
  if (candidateUpload.row) uploads.push(candidateUpload.row);

  const jobSpecUpload = await uploadStoredArtifact({
    supabase,
    runId,
    user,
    file: jobSpecFile,
    kind: 'job_spec',
    timeoutMs,
  });
  if (jobSpecUpload.warning) warnings.push(jobSpecUpload.warning);
  if (jobSpecUpload.row) uploads.push(jobSpecUpload.row);

  const saved = await saveArtifactRows({ supabase, runId, files: uploads, timeoutMs });
  return {
    enabled: saved.enabled,
    warnings: warnings.concat(saved.warnings || []),
    records: saved.saved ? saved.records : uploads,
  };
}

async function completeRun({
  supabase,
  runId,
  user,
  result,
  outputFile,
  timeoutMs,
  extraWarnings = [],
}) {
  const warnings = uniqueStrings(extraWarnings, 280);
  const uploadedOutput = await uploadStoredArtifact({
    supabase,
    runId,
    user,
    file: outputFile,
    kind: 'formatted_output',
    timeoutMs,
  });
  if (uploadedOutput.warning) warnings.push(uploadedOutput.warning);

  const savedOutput = await saveArtifactRows({
    supabase,
    runId,
    files: uploadedOutput.row ? [uploadedOutput.row] : [],
    timeoutMs,
  });
  warnings.push(...uniqueStrings(savedOutput.warnings, 280));

  const analysis = safeObject(result?.analysis);
  const aiAttempts = safeArray(analysis.aiAttempts || result?.aiAttempts || []);
  const historyWarnings = uniqueStrings(warnings, 280);
  const analysisPayload = {
    ...analysis,
    historyWarnings,
  };
  const payload = {
    status: 'completed',
    source: trimString(result?.source) || 'fallback',
    model: trimString(result?.model) || null,
    candidate_reference: trimString(result?.profile?.candidateReference) || null,
    target_role: trimString(result?.profile?.targetRole) || null,
    output_file_name: trimString(result?.fileName) || trimString(outputFile?.name) || null,
    options_json: safeObject(analysisPayload.optionsUsed),
    profile_json: safeObject(result?.profile),
    analysis_json: analysisPayload,
    ai_attempts_json: aiAttempts,
    warning_count: safeArray(analysisPayload.warnings).length + historyWarnings.length,
    error_message: null,
    completed_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(CV_FORMATTING_RUNS_TABLE)
    .update(payload)
    .eq('id', runId)
    .select('id,created_at,updated_at,completed_at,actor_email,status,source,model,candidate_reference,target_role,candidate_file_name,job_spec_file_name,output_file_name,warning_count,error_message,options_json,profile_json,analysis_json,ai_attempts_json')
    .single();

  if (error) {
    if (isMissingTableError(error, CV_FORMATTING_RUNS_TABLE)) {
      return { enabled: false, run: null, warnings: ['History tables are not configured in this environment yet.'] };
    }
    throw error;
  }

  const runFiles = await listRunFiles(supabase, runId, { ttlSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS });
  return {
    enabled: true,
    run: buildRunSummary(data, runFiles.files),
    warnings,
  };
}

async function failRun({ supabase, runId, error, analysis = {}, timeoutMs }) {
  const safeError = trimString(error?.message || 'CV formatting failed.', 280);
  const historyWarnings = uniqueStrings(analysis?.historyWarnings, 280);
  const analysisPayload = {
    ...safeObject(analysis),
    historyWarnings,
  };
  const payload = {
    status: 'failed',
    source: trimString(analysisPayload?.source) || 'fallback',
    model: trimString(analysisPayload?.model) || null,
    target_role: trimString(analysisPayload?.targetRole) || null,
    candidate_reference: trimString(analysisPayload?.candidateReference) || null,
    options_json: safeObject(analysisPayload?.optionsUsed),
    analysis_json: safeObject(analysisPayload),
    ai_attempts_json: safeArray(analysisPayload?.aiAttempts),
    warning_count: safeArray(analysisPayload?.warnings).length + historyWarnings.length,
    error_message: safeError,
    completed_at: new Date().toISOString(),
  };

  const response = await withTimeout(
    () => supabase
      .from(CV_FORMATTING_RUNS_TABLE)
      .update(payload)
      .eq('id', runId)
      .select('id')
      .single(),
    timeoutMs,
    'History failure state save timed out.'
  ).catch((saveError) => {
    if (isMissingTableError(saveError, CV_FORMATTING_RUNS_TABLE)) {
      return { missing: true };
    }
    throw saveError;
  });

  if (response && response.missing) {
    return { enabled: false, warnings: ['History tables are not configured in this environment yet.'] };
  }

  if (response?.error) {
    throw response.error;
  }

  return { enabled: true, warnings: [] };
}

async function listRunFiles(supabase, runId, options = {}) {
  const safeRunId = trimString(runId);
  if (!safeRunId) return { enabled: true, files: [] };
  const { data, error } = await supabase
    .from(CV_FORMATTING_FILES_TABLE)
    .select('id,created_at,kind,original_filename,mime_type,file_size_bytes,storage_bucket,storage_path')
    .eq('formatting_run_id', safeRunId)
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingTableError(error, CV_FORMATTING_FILES_TABLE)) {
      return { enabled: false, files: [] };
    }
    throw error;
  }

  return {
    enabled: true,
    files: await presentStoredFiles(supabase, data, options),
  };
}

async function listFormattingRuns(supabase, limit = DEFAULT_HISTORY_LIMIT, options = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_HISTORY_LIMIT, 20));
  const { data, error } = await supabase
    .from(CV_FORMATTING_RUNS_TABLE)
    .select('id,created_at,updated_at,completed_at,actor_email,status,source,model,candidate_reference,target_role,candidate_file_name,job_spec_file_name,output_file_name,warning_count,error_message,options_json,profile_json,analysis_json,ai_attempts_json')
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (error) {
    if (isMissingTableError(error, CV_FORMATTING_RUNS_TABLE)) {
      return { enabled: false, runs: [], warnings: ['History tables are not configured in this environment yet.'] };
    }
    throw error;
  }

  const runs = safeArray(data);
  const runIds = runs.map((row) => trimString(row?.id)).filter(Boolean);
  let filesByRunId = new Map();

  if (runIds.length) {
    const filesResponse = await supabase
      .from(CV_FORMATTING_FILES_TABLE)
      .select('id,created_at,formatting_run_id,kind,original_filename,mime_type,file_size_bytes,storage_bucket,storage_path')
      .in('formatting_run_id', runIds)
      .order('created_at', { ascending: true });

    if (filesResponse.error) {
      if (!isMissingTableError(filesResponse.error, CV_FORMATTING_FILES_TABLE)) {
        throw filesResponse.error;
      }
    } else {
      const grouped = new Map();
      safeArray(filesResponse.data).forEach((row) => {
        const key = trimString(row?.formatting_run_id);
        if (!key) return;
        const bucket = grouped.get(key) || [];
        bucket.push(row);
        grouped.set(key, bucket);
      });
      filesByRunId = grouped;
    }
  }

  const presentedRuns = [];
  for (const run of runs) {
    const files = await presentStoredFiles(supabase, filesByRunId.get(trimString(run?.id)) || [], options);
    presentedRuns.push(buildRunSummary(run, files));
  }

  return { enabled: true, runs: presentedRuns, warnings: [] };
}

module.exports = {
  CV_FORMATTING_FILES_TABLE,
  CV_FORMATTING_RUNS_TABLE,
  buildStorageKey,
  completeRun,
  createRunPlaceholder,
  failRun,
  getHistoryBucketName,
  listFormattingRuns,
  listRunFiles,
  presentStoredFile,
  presentStoredFiles,
  storeInputArtifacts,
};
