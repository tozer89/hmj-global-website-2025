'use strict';

const { randomUUID } = require('node:crypto');

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');
const { formatClientReadyCv } = require('../../lib/cv-formatter-core.js');
const {
  completeRun,
  createRunPlaceholder,
  failRun,
  storeInputArtifacts,
} = require('../../lib/cv-formatting-history.js');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const HISTORY_TIMEOUT_MS = 12000;
const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx']);

const MIME_BY_EXTENSION = Object.freeze({
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  return maxLength && maxLength > 0 ? text.slice(0, maxLength) : text;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return null;
  }
}

function uniqueStrings(values, maxLength) {
  const seen = new Set();
  const output = [];
  const input = Array.isArray(values) ? values : [];
  input.forEach((value) => {
    const text = trimString(value, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    output.push(text);
  });
  return output;
}

function fileExtension(fileName) {
  const text = trimString(fileName).toLowerCase();
  const index = text.lastIndexOf('.');
  return index === -1 ? '' : text.slice(index + 1);
}

function guessContentType(extension, fallback) {
  const ext = trimString(extension).toLowerCase();
  return MIME_BY_EXTENSION[ext] || trimString(fallback) || 'application/octet-stream';
}

function decodeBase64Payload(data) {
  const raw = trimString(data).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!raw) return null;
  const remainder = raw.length % 4;
  if (remainder === 1) return null;
  const padded = remainder ? `${raw}${'='.repeat(4 - remainder)}` : raw;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(padded)) {
    return null;
  }

  try {
    const buffer = Buffer.from(padded, 'base64');
    if (!buffer.length) return null;
    const canonicalInput = padded.replace(/=+$/, '');
    const canonicalOutput = buffer.toString('base64').replace(/=+$/, '');
    return canonicalInput === canonicalOutput ? buffer : null;
  } catch {
    return null;
  }
}

function buildClientError(message, statusCode, details) {
  const error = new Error(message);
  error.statusCode = Number(statusCode) || 400;
  if (details && typeof details === 'object') {
    error.details = details;
  }
  return error;
}

function normaliseUpload(file, label) {
  if (!file || typeof file !== 'object') {
    return null;
  }

  const name = trimString(file.name, 180);
  const extension = fileExtension(name);
  const contentType = trimString(file.contentType || file.type, 120).toLowerCase();
  const claimedSize = Number(file.size) || 0;
  const data = trimString(file.data);

  if (!name || !data) {
    throw buildClientError(`${label} is missing a file name or file content.`, 400);
  }

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw buildClientError(`${label} must be a PDF, DOC, or DOCX file.`, 400, {
      file: name,
      extension,
    });
  }

  if (claimedSize > MAX_FILE_BYTES) {
    throw buildClientError(`${label} must be ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB or smaller.`, 400);
  }

  const buffer = decodeBase64Payload(data);
  if (!buffer) {
    throw buildClientError(`${label} could not be decoded. Please re-upload the file and try again.`, 400, {
      file: name,
    });
  }

  if (buffer.byteLength <= 0 || buffer.byteLength > MAX_FILE_BYTES) {
    throw buildClientError(`${label} must be between 1 byte and ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`, 400, {
      file: name,
      decoded_size_bytes: buffer.byteLength,
    });
  }

  return {
    name,
    extension,
    contentType: guessContentType(extension, contentType),
    size: buffer.byteLength,
    data,
    buffer,
  };
}

function buildHistoryPayload({ runId, requested, enabled, saved, warnings, run }) {
  const safeWarnings = uniqueStrings(warnings, 280);
  let status = 'disabled';
  if (requested && run) {
    status = 'saved';
  } else if (requested && enabled) {
    status = 'active';
  } else if (requested && safeWarnings.length) {
    status = 'unavailable';
  }

  return {
    runId: trimString(runId),
    requested: !!requested,
    enabled: !!enabled,
    saved: !!saved,
    status,
    warnings: safeWarnings,
    run: run || null,
  };
}

function buildAuditMeta({ candidateFile, jobSpecFile, options, result, history, error }) {
  return {
    candidate_file_name: trimString(candidateFile?.name),
    candidate_file_size: Number(candidateFile?.size) || 0,
    job_spec_file_name: trimString(jobSpecFile?.name),
    job_spec_file_size: Number(jobSpecFile?.size) || 0,
    output_file_name: trimString(result?.fileName),
    output_size_bytes: Number(result?.buffer?.length) || 0,
    source: trimString(result?.source),
    model: trimString(result?.model),
    candidate_display_name: trimString(result?.profile?.candidateName || result?.analysis?.candidateName),
    target_role: trimString(result?.profile?.targetRole || result?.analysis?.targetRole),
    candidate_reference: trimString(result?.profile?.candidateReference || result?.analysis?.candidateReference),
    verification_passed: result?.analysis?.verification?.passed === true,
    verification_ai_status: trimString(result?.analysis?.verification?.ai?.status),
    history_requested: !!history?.requested,
    history_enabled: !!history?.enabled,
    history_saved: !!history?.saved,
    history_run_id: trimString(history?.runId),
    history_warning_count: Array.isArray(history?.warnings) ? history.warnings.length : 0,
    options: safeObject(options),
    ai_attempts: Array.isArray(result?.analysis?.aiAttempts) ? result.analysis.aiAttempts : [],
    ai_failure_code: trimString(result?.analysis?.ai?.failureCode),
    ai_failure_message: trimString(result?.analysis?.ai?.failureMessage, 240),
    error: trimString(error?.message, 240),
  };
}

const baseHandler = async (event, context) => {
  const { user, supabase, supabaseError } = await getContext(event, context, { requireAdmin: true });

  const body = safeJsonParse(event.body);
  if (!body) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'invalid_json' }),
    };
  }

  const options = safeObject(body.options);
  const historyRequested = options.saveRunHistory !== false;

  let candidateFile = null;
  let jobSpecFile = null;
  const runId = historyRequested ? randomUUID() : '';
  let historyRunCreated = false;
  let historyEnabled = false;
  let historySaved = false;
  let historyRun = null;
  const historyWarnings = [];

  try {
    candidateFile = normaliseUpload(body.candidateFile, 'Candidate CV');
    jobSpecFile = body.jobSpecFile ? normaliseUpload(body.jobSpecFile, 'Job spec') : null;

    if (!candidateFile) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'candidate_file_required' }),
      };
    }

    if (historyRequested) {
      if (supabase && typeof supabase.from === 'function') {
        try {
          const placeholder = await createRunPlaceholder({
            supabase,
            runId,
            user,
            candidateFile,
            jobSpecFile,
            options,
          });
          historyEnabled = !!placeholder.enabled;
          historyRunCreated = !!placeholder.enabled;
          historyWarnings.push(...(placeholder.warnings || []));

          if (historyEnabled) {
            const storedInput = await storeInputArtifacts({
              supabase,
              runId,
              user,
              candidateFile,
              jobSpecFile,
              timeoutMs: HISTORY_TIMEOUT_MS,
            });
            historyEnabled = storedInput.enabled !== false;
            historyWarnings.push(...(storedInput.warnings || []));
          }
        } catch (historyError) {
          historyEnabled = false;
          historyWarnings.push(`Run history could not be initialised: ${trimString(historyError?.message, 220) || 'unknown error'}.`);
        }
      } else {
        historyWarnings.push(
          supabaseError
            ? 'Run history is unavailable because the database connection is not configured in this environment.'
            : 'Run history is unavailable in this environment right now.'
        );
      }
    }

    await recordAudit({
      actor: user,
      action: 'cv_formatting_started',
      targetType: 'cv_formatting_run',
      targetId: runId || candidateFile.name,
      meta: buildAuditMeta({
        candidateFile,
        jobSpecFile,
        options,
        history: buildHistoryPayload({
          runId,
          requested: historyRequested,
          enabled: historyEnabled,
          saved: historySaved,
          warnings: historyWarnings,
          run: historyRun,
        }),
      }),
    });

    const result = await formatClientReadyCv({
      candidateFile,
      jobSpecFile,
      options,
    });

    if (historyRequested && historyRunCreated && supabase && typeof supabase.from === 'function') {
      try {
        const completed = await completeRun({
          supabase,
          runId,
          user,
          result,
          outputFile: {
            name: result.fileName,
            contentType: result.contentType,
            size: result.buffer.length,
            buffer: result.buffer,
          },
          timeoutMs: HISTORY_TIMEOUT_MS,
          extraWarnings: historyWarnings,
        });
        historyEnabled = completed.enabled !== false;
        historyWarnings.push(...(completed.warnings || []));
        historyRun = completed.run || null;
        historySaved = !!completed.run;
      } catch (historyError) {
        historyEnabled = false;
        historyWarnings.push(`Run history could not store the generated document: ${trimString(historyError?.message, 220) || 'unknown error'}.`);
      }
    }

    const responseHistory = buildHistoryPayload({
      runId,
      requested: historyRequested,
      enabled: historyRunCreated || historySaved,
      saved: historySaved,
      warnings: historyWarnings,
      run: historyRun,
    });

    result.analysis = {
      ...safeObject(result.analysis),
      historyWarnings: responseHistory.warnings,
    };

    await recordAudit({
      actor: user,
      action: 'cv_formatting_generated',
      targetType: 'cv_formatting_run',
      targetId: responseHistory.runId || candidateFile.name,
      meta: buildAuditMeta({
        candidateFile,
        jobSpecFile,
        options,
        result,
        history: responseHistory,
      }),
    });

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        source: result.source,
        model: result.model,
        analysis: result.analysis,
        profile: result.profile,
        history: responseHistory,
        file: {
          name: result.fileName,
          contentType: result.contentType,
          data: result.buffer.toString('base64'),
        },
      }),
    };
  } catch (error) {
    const failureHistory = buildHistoryPayload({
      runId,
      requested: historyRequested,
      enabled: historyRunCreated || historyEnabled,
      saved: historySaved,
      warnings: historyWarnings,
      run: historyRun,
    });

    if (historyRequested && historyRunCreated && supabase && typeof supabase.from === 'function' && runId) {
      try {
        await failRun({
          supabase,
          runId,
          error,
          analysis: {
            source: 'fallback',
            model: '',
            targetRole: trimString(options.targetRoleOverride),
            candidateReference: '',
            optionsUsed: options,
            warnings: [],
            aiAttempts: [],
            historyWarnings: failureHistory.warnings,
          },
          timeoutMs: HISTORY_TIMEOUT_MS,
        });
      } catch (historyError) {
        failureHistory.warnings = uniqueStrings(
          failureHistory.warnings.concat(`Run history could not record the failed run: ${trimString(historyError?.message, 220) || 'unknown error'}.`),
          280
        );
      }
    }

    await recordAudit({
      actor: user,
      action: 'cv_formatting_failed',
      targetType: 'cv_formatting_run',
      targetId: failureHistory.runId || candidateFile?.name || 'unknown',
      meta: buildAuditMeta({
        candidateFile,
        jobSpecFile,
        options,
        history: failureHistory,
        error,
      }),
    });

    const statusCode = Number(error?.statusCode) || Number(error?.code) || 500;
    return {
      statusCode: statusCode >= 400 && statusCode <= 599 ? statusCode : 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: trimString(error?.message || 'cv_formatting_failed', 240),
        details: error?.details || null,
        history: failureHistory,
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
