'use strict';

const { randomUUID } = require('node:crypto');
const core = require('./candidate-matcher-core.js');
const REQUEST_TIMEOUT_MS = 120000;
const BACKGROUND_REQUEST_TIMEOUT_MS = 180000;
const fetchImpl = typeof fetch === 'function'
  ? fetch.bind(globalThis)
  : (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeJsonParse(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function getRequestTimeoutMs(mode) {
  const fallback = mode === 'background' ? BACKGROUND_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const envName = mode === 'background'
    ? 'CANDIDATE_MATCH_BACKGROUND_REQUEST_TIMEOUT_MS'
    : 'CANDIDATE_MATCH_REQUEST_TIMEOUT_MS';
  const parsed = Number(trimString(process.env[envName]));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pickStatusCode(error) {
  const status = Number(error?.statusCode || error?.status || error?.code);
  if (Number.isInteger(status) && status >= 400 && status < 600) {
    return status;
  }
  return 500;
}

function buildErrorBody(error) {
  const payload = {
    ok: false,
    error: error?.message || 'Unexpected error',
  };

  if (typeof error?.code === 'string') payload.code = error.code;
  if (error?.details) payload.details = error.details;
  if (error?.details && typeof error.details === 'object') {
    const documents = Array.isArray(error.details.documents) ? error.details.documents : [];
    payload.run_diagnostics = {
      started_at: trimString(error.details.started_at),
      total_elapsed_ms: Number(error.details.total_duration_ms) || 0,
      files_attempted: documents.length,
      files_text_read: documents.filter((document) => document.status === 'ok').length,
      files_skipped: documents.filter((document) => document.status !== 'ok').length,
      warning_count: documents.filter((document) => document.status !== 'ok').length,
      failed_stage: trimString(error.details.match_stage_label || error.details.stage_label || error.details.stage),
    };
  }
  return JSON.stringify(payload);
}

function buildWarnings(extraction, storageResult) {
  return (Array.isArray(extraction?.failed) ? extraction.failed : [])
    .map((document) => ({
      file: document.name,
      message: document.error,
      status: document.status,
    }))
    .concat((extraction.imageEvidence || []).map((document) => ({
      file: document.name,
      message: document.error || 'Supporting image evidence was included but not text-extracted in V1.',
      status: document.status,
    })))
    .concat((storageResult?.warnings || []).map((warning) => ({
      file: '',
      message: warning,
      status: 'storage',
    })));
}

function buildPreparedRunView(run) {
  if (!run || typeof run !== 'object') return null;
  return {
    id: run.id || '',
    created_at: run.created_at || '',
    updated_at: run.updated_at || '',
    candidate_name: run.candidate_name || '',
    recruiter_notes: run.recruiter_notes || '',
    status: run.status || '',
    ready_for_match: run.ready_for_match === true,
    has_result: run.has_result === true,
    file_names: Array.isArray(run.file_names) ? run.file_names : [],
    prepared_evidence: run.prepared_evidence || null,
    best_match_job_title: run.best_match_job_title || '',
    best_match_score: run.best_match_score,
    overall_recommendation: run.overall_recommendation || '',
    no_strong_match_reason: run.no_strong_match_reason || '',
    error_message: run.error_message || '',
    prepare_job: run.prepare_job || null,
    match_job: run.match_job || null,
  };
}

function buildSuccessPayload({
  runId,
  recruiterNotes,
  extraction,
  liveJobs,
  analysis,
  saveResult,
  storageResult,
  historyResult,
  requestMeta,
}) {
  const warnings = buildWarnings(extraction, storageResult);

  return {
    ok: true,
    run_id: runId,
    recruiter_notes: recruiterNotes,
    live_jobs_count: Number(analysis?.diagnostics?.live_jobs_sent_count) || liveJobs.length,
    live_jobs_total_count: Number(analysis?.diagnostics?.live_jobs_total_count) || liveJobs.length,
    saved_to_history: !!historyResult?.saved,
    history_enabled: historyResult?.enabled !== false,
    history_record: historyResult?.record || null,
    prepared_run: buildPreparedRunView(requestMeta?.prepared_run || historyResult?.prepared_run || null),
    upload_storage: {
      enabled: !!saveResult,
      stored: !!storageResult?.stored,
      bucket: storageResult?.bucket || '',
    },
    extraction: {
      success_count: extraction.successCount,
      failure_count: extraction.failureCount,
      image_evidence_count: Array.isArray(extraction.imageEvidence) ? extraction.imageEvidence.length : 0,
      documents: extraction.documents.map(core.summariseDocument),
    },
    run_diagnostics: {
      started_at: requestMeta?.started_at || '',
      total_elapsed_ms: requestMeta?.total_duration_ms || 0,
      files_attempted: extraction.documents.length,
      files_text_read: extraction.successCount,
      files_skipped: extraction.documents.filter((document) => document.status !== 'ok').length,
      warning_count: warnings.length,
      failed_stage: '',
    },
    warnings,
    result: analysis.result,
    analysis_meta: {
      model: analysis.model,
      request_metrics: analysis?.diagnostics && typeof analysis.diagnostics === 'object'
        ? {
          candidate_text_chars: Number(analysis.diagnostics.candidate_text_chars) || 0,
          candidate_text_source_chars: Number(analysis.diagnostics.candidate_text_source_chars) || 0,
          live_jobs_total_count: Number(analysis.diagnostics.live_jobs_total_count) || 0,
          live_jobs_sent_count: Number(analysis.diagnostics.live_jobs_sent_count) || 0,
          live_jobs_json_chars: Number(analysis.diagnostics.live_jobs_json_chars) || 0,
          request_payload_json_chars: Number(analysis.diagnostics.request_payload_json_chars) || 0,
          max_output_tokens: Number(analysis.diagnostics.max_output_tokens) || 0,
        }
        : null,
      timings: requestMeta?.timings || [],
      total_duration_ms: requestMeta?.total_duration_ms || 0,
    },
  };
}

function buildPrepareSuccessPayload({
  runId,
  recruiterNotes,
  extraction,
  storageResult,
  preparedRun,
  requestMeta,
}) {
  const warnings = buildWarnings(extraction, storageResult);
  return {
    ok: true,
    run_id: runId,
    recruiter_notes: recruiterNotes,
    prepared_run: buildPreparedRunView(preparedRun),
    upload_storage: {
      enabled: true,
      stored: !!storageResult?.stored,
      bucket: storageResult?.bucket || '',
    },
    extraction: {
      success_count: extraction.successCount,
      failure_count: extraction.failureCount,
      image_evidence_count: Array.isArray(extraction.imageEvidence) ? extraction.imageEvidence.length : 0,
      documents: extraction.documents.map(core.summariseDocument),
    },
    run_diagnostics: {
      started_at: requestMeta?.started_at || '',
      total_elapsed_ms: requestMeta?.total_duration_ms || 0,
      files_attempted: extraction.documents.length,
      files_text_read: extraction.successCount,
      files_skipped: extraction.documents.filter((document) => document.status !== 'ok').length,
      warning_count: warnings.length,
      failed_stage: '',
    },
    warnings,
  };
}

function logRequest(runId, message, data) {
  if (data === undefined) {
    console.info(`[candidate-matcher][${runId}] ${message}`);
    return;
  }
  console.info(`[candidate-matcher][${runId}] ${message}`, data);
}

function createRequestMeta(runId, body, options = {}) {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const timings = [];
  const requestTimeoutMs = getRequestTimeoutMs(options.mode);

  function totalDuration() {
    return Date.now() - startedAt;
  }

  function remainingMs() {
    return Math.max(1000, requestTimeoutMs - totalDuration());
  }

  function enrichStageError(error, stage, stageLabel, durationMs, extra = {}) {
    const details = error?.details && typeof error.details === 'object'
      ? { ...error.details }
      : {};
    if (!details.stage) details.stage = stage;
    details.stage_label = details.stage_label || stageLabel;
    details.stage_duration_ms = durationMs;
    details.total_duration_ms = totalDuration();
    details.started_at = startedAtIso;
    details.timings = timings.slice();
    Object.assign(details, extra);
    error.details = details;
    return error;
  }

  function annotateError(error, stage, stageLabel, extra = {}) {
    return enrichStageError(error, stage, stageLabel, 0, extra);
  }

  async function runStage(stage, stageLabel, work, options = {}) {
    const stageStartedAt = Date.now();
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 0;
    logRequest(runId, `${stage} start`, {
      stage_label: stageLabel,
      timeout_ms: timeoutMs || null,
      total_elapsed_ms: totalDuration(),
    });

    try {
      const result = timeoutMs > 0
        ? await core.withTimeout(
          work,
          timeoutMs,
          () => core.coded(
            504,
            `${stageLabel} timed out after ${timeoutMs}ms.`,
            `${stage}_timeout`,
            {
              details: {
                stage,
                stage_label: stageLabel,
                timeout_ms: timeoutMs,
              }
            }
          )
        )
        : await work();
      const durationMs = Date.now() - stageStartedAt;
      const record = { stage, stage_label: stageLabel, status: 'ok', duration_ms: durationMs };
      timings.push(record);
      logRequest(runId, `${stage} complete`, record);
      return result;
    } catch (error) {
      const durationMs = Date.now() - stageStartedAt;
      const record = {
        stage,
        stage_label: stageLabel,
        status: 'failed',
        duration_ms: durationMs,
        error: error?.message || 'Unexpected error',
      };
      timings.push(record);
      logRequest(runId, `${stage} failed`, record);
      throw enrichStageError(error, stage, stageLabel, durationMs, options.errorDetails || {});
    }
  }

  logRequest(runId, 'request start', {
    file_count: Array.isArray(body?.files) ? body.files.length : 0,
    save_history: body?.saveHistory !== false,
    timeout_ms: requestTimeoutMs,
    node: process.version,
    files: Array.isArray(body?.files)
      ? body.files.map((file) => ({
        name: trimString(file?.name),
        content_type: trimString(file?.contentType),
        declared_size_bytes: Number(file?.size) || 0,
        has_data: !!trimString(file?.data),
      }))
      : [],
  });

  return {
    startedAtIso,
    timings,
    totalDuration,
    requestTimeoutMs,
    remainingMs,
    runStage,
    annotateError,
  };
}

function getBearerToken(event) {
  const raw = trimString(event?.headers?.authorization || event?.headers?.Authorization);
  return raw ? raw : '';
}

function buildInternalFunctionUrl(event, functionName) {
  const host = trimString(event?.headers?.['x-forwarded-host'] || event?.headers?.host);
  const proto = trimString(event?.headers?.['x-forwarded-proto']) || 'https';
  if (!host) {
    throw core.coded(500, 'Unable to determine the current host for background matcher dispatch.', 'background_dispatch_host_missing');
  }
  return `${proto}://${host}/.netlify/functions/${functionName}`;
}

function buildExtractionFromPreparedRun(updatedRun) {
  return {
    successCount: updatedRun.prepared_evidence?.files_text_read || 0,
    failureCount: (updatedRun.prepared_evidence?.failed_count || 0)
      + (updatedRun.prepared_evidence?.limited_count || 0)
      + (updatedRun.prepared_evidence?.unsupported_count || 0),
    imageEvidence: updatedRun.prepared_evidence?.image_evidence_files || [],
    failed: []
      .concat(updatedRun.prepared_evidence?.failed_files || [])
      .concat(updatedRun.prepared_evidence?.limited_files || [])
      .concat(updatedRun.prepared_evidence?.unsupported_files || []),
    documents: updatedRun.prepared_evidence?.documents || [],
  };
}

function buildMatchStatusPayload(run, extra = {}) {
  const preparedRun = buildPreparedRunView(run);
  const payload = {
    ok: true,
    prepared_run: preparedRun,
    job: preparedRun?.match_job || null,
    result: run?.raw_result_json?.result || null,
    run_diagnostics: extra.run_diagnostics || null,
  };
  if (extra.live_jobs_count != null) payload.live_jobs_count = extra.live_jobs_count;
  if (extra.live_jobs_total_count != null) payload.live_jobs_total_count = extra.live_jobs_total_count;
  if (extra.analysis_meta) payload.analysis_meta = extra.analysis_meta;
  if (extra.warnings) payload.warnings = extra.warnings;
  return payload;
}

async function persistMatchStage({ supabase, preparedRunId, recruiterNotes, jobId, requestMeta, stage, stageLabel, details = {}, status = 'running' }) {
  await core.updatePreparedRunJobState({
    supabase,
    runId: preparedRunId,
    recruiterNotes,
    jobId,
    status,
    stage,
    stageLabel,
    details,
    timeoutMs: requestMeta.remainingMs(),
  });
}

async function performPreparedMatchWorkflow({ supabase, user, preparedRunId, recruiterNotes, jobId, requestMeta }) {
  await persistMatchStage({
    supabase,
    preparedRunId,
    recruiterNotes,
    jobId,
    requestMeta,
    stage: 'loading_prepared_evidence',
    stageLabel: 'Loading prepared evidence',
  });
  const preparedRun = await requestMeta.runStage(
    'prepared_evidence_load',
    'Load prepared evidence',
    () => core.getMatchRun(supabase, preparedRunId),
    { timeoutMs: requestMeta.remainingMs() }
  );

  if (!preparedRun.ready_for_match) {
    throw requestMeta.annotateError(
      core.coded(409, 'Prepared evidence is not ready for matching yet. Review the extracted evidence summary first.', 'prepared_evidence_not_ready'),
      'prepared_evidence_load',
      'Load prepared evidence'
    );
  }

  const candidatePayload = core.buildCandidatePayloadFromPreparedRun(preparedRun, recruiterNotes || preparedRun.recruiter_notes);
  if (!candidatePayload.candidate_text) {
    throw requestMeta.annotateError(
      core.coded(409, 'Prepared evidence does not contain readable candidate text for matching.', 'prepared_candidate_text_missing'),
      'prepared_evidence_load',
      'Load prepared evidence'
    );
  }

  await persistMatchStage({
    supabase,
    preparedRunId,
    recruiterNotes: recruiterNotes || preparedRun.recruiter_notes,
    jobId,
    requestMeta,
    stage: 'prepared_evidence_ready',
    stageLabel: 'Prepared evidence ready',
    details: {
      request_metrics: {
        candidate_text_chars: String(candidatePayload?.candidate_text || '').length,
        candidate_text_source_chars: String(candidatePayload?.candidate_text || '').length,
      },
    },
  });

  await persistMatchStage({
    supabase,
    preparedRunId,
    recruiterNotes: recruiterNotes || preparedRun.recruiter_notes,
    jobId,
    requestMeta,
    stage: 'loading_live_jobs',
    stageLabel: 'Loading live roles',
  });

  const liveJobs = await requestMeta.runStage(
    'jobs_fetch',
    'Read live roles',
    () => core.fetchPublishedLiveJobs(supabase, {
      timeoutMs: requestMeta.remainingMs(),
    }),
    { timeoutMs: requestMeta.remainingMs() }
  );
  if (!liveJobs.length) {
    throw requestMeta.annotateError(core.coded(
      409,
      'No currently published live jobs are available to match against.',
      'no_live_jobs'
    ), 'jobs_fetch', 'Read live roles');
  }

  await persistMatchStage({
    supabase,
    preparedRunId,
    recruiterNotes: recruiterNotes || preparedRun.recruiter_notes,
    jobId,
    requestMeta,
    stage: 'live_jobs_loaded',
    stageLabel: 'Live roles loaded',
    details: {
      request_metrics: {
        live_jobs_total_count: liveJobs.length,
      },
    },
  });

  const analysis = await requestMeta.runStage(
    'openai',
    'Run recruiter matching',
    () => core.callOpenAIForMatch({
      candidate: candidatePayload,
      live_jobs: liveJobs,
    }, {
      timeoutMs: requestMeta.remainingMs(),
      onStage: async (event) => {
        await persistMatchStage({
          supabase,
          preparedRunId,
          recruiterNotes: recruiterNotes || preparedRun.recruiter_notes,
          jobId,
          requestMeta,
          stage: event?.stage,
          stageLabel: event?.stage_label,
          details: {
            model: trimString(event?.details?.model),
            request_metrics: event?.details && typeof event.details === 'object'
              ? {
                candidate_text_chars: Number(event.details.candidate_text_chars) || 0,
                candidate_text_source_chars: Number(event.details.candidate_text_source_chars) || 0,
                live_jobs_total_count: Number(event.details.live_jobs_total_count) || 0,
                live_jobs_sent_count: Number(event.details.live_jobs_sent_count) || 0,
                live_jobs_json_chars: Number(event.details.live_jobs_json_chars) || 0,
                request_payload_json_chars: Number(event.details.request_payload_json_chars) || 0,
                max_output_tokens: Number(event.details.max_output_tokens) || null,
              }
              : null,
            response_metrics: event?.details && typeof event.details === 'object'
              ? {
                openai_status: Number(event.details.openai_status) || null,
                duration_ms: Number(event.details.duration_ms) || 0,
              }
              : null,
            response_received: event?.details?.response_received === true,
          },
        });
      },
    }),
    { timeoutMs: requestMeta.remainingMs() }
  );

  await persistMatchStage({
    supabase,
    preparedRunId,
    recruiterNotes: recruiterNotes || preparedRun.recruiter_notes,
    jobId,
    requestMeta,
    stage: 'saving_result',
    stageLabel: 'Saving recruiter match result',
    details: {
      model: analysis?.model,
      request_metrics: analysis?.diagnostics && typeof analysis.diagnostics === 'object'
        ? {
          candidate_text_chars: Number(analysis.diagnostics.candidate_text_chars) || 0,
          candidate_text_source_chars: Number(analysis.diagnostics.candidate_text_source_chars) || 0,
          live_jobs_total_count: Number(analysis.diagnostics.live_jobs_total_count) || 0,
          live_jobs_sent_count: Number(analysis.diagnostics.live_jobs_sent_count) || 0,
          live_jobs_json_chars: Number(analysis.diagnostics.live_jobs_json_chars) || 0,
          request_payload_json_chars: Number(analysis.diagnostics.request_payload_json_chars) || 0,
          max_output_tokens: Number(analysis.diagnostics.max_output_tokens) || null,
        }
        : null,
      response_metrics: analysis?.diagnostics && typeof analysis.diagnostics === 'object'
        ? {
          response_id: analysis.diagnostics.response_id || '',
          response_status: analysis.diagnostics.response_status || '',
          output_text_length: Number(analysis.diagnostics.output_text_length) || 0,
        }
        : null,
      response_received: true,
    },
  });

  await requestMeta.runStage(
    'history_save',
    'Save match result',
    () => core.updatePreparedRunWithMatch({
      supabase,
      run: preparedRun,
      actorEmail: user?.email || '',
      recruiterNotes: recruiterNotes || preparedRun.recruiter_notes,
      analysis,
      liveJobs,
      candidatePayload,
      timeoutMs: requestMeta.remainingMs(),
    }),
    { timeoutMs: requestMeta.remainingMs() }
  );

  const updatedRun = await core.getMatchRun(supabase, preparedRun.id);
  return {
    preparedRun,
    updatedRun,
    candidatePayload,
    liveJobs,
    analysis,
  };
}

async function dispatchBackgroundMatch(event, payload) {
  const url = buildInternalFunctionUrl(event, 'admin-candidate-run-match-background');
  const headers = {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  };
  const authHeader = getBearerToken(event);
  const cookieHeader = trimString(event?.headers?.cookie || event?.headers?.Cookie);
  if (authHeader) headers.authorization = authHeader;
  if (cookieHeader) headers.cookie = cookieHeader;
  if (!authHeader && !cookieHeader) {
    throw core.coded(
      500,
      'Background match dispatch could not forward the current admin session.',
      'background_dispatch_auth_missing'
    );
  }

  console.info('[candidate-matcher] dispatching background match', {
    preparedRunId: trimString(payload?.preparedRunId),
    jobId: trimString(payload?.jobId),
    hasAuthorization: !!authHeader,
    hasCookie: !!cookieHeader,
  });

  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  console.info('[candidate-matcher] background match dispatch response', {
    preparedRunId: trimString(payload?.preparedRunId),
    jobId: trimString(payload?.jobId),
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok && response.status !== 202) {
    const text = await response.text().catch(() => '');
    throw core.coded(
      502,
      `Background match dispatch failed (${response.status}).`,
      'background_dispatch_failed',
      { details: { status: response.status, body: text } }
    );
  }
}

function createCandidateMatchBaseHandler({ getContextImpl }) {
  if (typeof getContextImpl !== 'function') {
    throw new Error('getContextImpl is required');
  }

  return async function candidateMatchBaseHandler(event, context) {
    try {
      const { supabase, user } = await getContextImpl(event, context, { requireAdmin: true });
      const body = safeJsonParse(event?.body);
      const recruiterNotes = core.sanitiseNotes(body.recruiterNotes);
      const saveResult = body.saveHistory !== false;
      const runId = randomUUID();
      const requestMeta = createRequestMeta(runId, body);

      const preparedFiles = await requestMeta.runStage(
        'prepare_intake',
        'Prepare intake',
        async () => core.prepareCandidateFiles(body.files)
      );

      logRequest(runId, 'storage read-back skipped', {
        reason: 'Extraction runs against request buffers before any storage fetch.',
      });

      const extraction = await requestMeta.runStage(
        'extraction',
        'Extract evidence',
        () => core.extractCandidateDocuments(preparedFiles, {
          pdfTimeoutMs: requestMeta.remainingMs(),
          docxTimeoutMs: requestMeta.remainingMs(),
        }),
        { timeoutMs: requestMeta.remainingMs() }
      );

      if (!extraction.successCount) {
        const imageOnlyCount = Array.isArray(extraction.imageEvidence) ? extraction.imageEvidence.length : 0;
        const details = {
          stage: 'extraction',
          source: 'request-buffer',
          storage_readback: 'not_used',
          documents: extraction.documents.map(core.summariseDocument),
        };
        const error = core.coded(
          422,
          imageOnlyCount
            ? `No readable candidate text was extracted. ${imageOnlyCount} image file${imageOnlyCount === 1 ? ' was' : 's were'} included as supporting evidence but not text-extracted in V1.`
            : core.summariseNoReadableTextFailure(extraction.documents),
          'all_files_failed',
          { details }
        );
        throw requestMeta.annotateError(error, 'extraction', 'Extract evidence');
      }

      const liveJobs = await requestMeta.runStage(
        'jobs_fetch',
        'Read live roles',
        () => core.fetchPublishedLiveJobs(supabase, {
          timeoutMs: requestMeta.remainingMs(),
        }),
        { timeoutMs: requestMeta.remainingMs() }
      );
      if (!liveJobs.length) {
        throw requestMeta.annotateError(core.coded(
          409,
          'No currently published live jobs are available to match against.',
          'no_live_jobs'
        ), 'jobs_fetch', 'Read live roles');
      }

      const storageResult = await requestMeta.runStage(
        'storage_upload',
        'Store private uploads',
        () => core.maybeStoreUploads({
          supabase,
          documents: extraction.documents,
          runId,
          userEmail: user?.email || '',
          shouldStore: saveResult,
          timeoutMs: requestMeta.remainingMs(),
        }),
        { timeoutMs: requestMeta.remainingMs() }
      );

      const analysis = await requestMeta.runStage(
        'openai',
        'Run recruiter matching',
        () => core.callOpenAIForMatch({
          candidate: core.buildCandidatePayload(extraction, recruiterNotes),
          live_jobs: liveJobs,
        }, {
          timeoutMs: requestMeta.remainingMs(),
        }),
        { timeoutMs: requestMeta.remainingMs() }
      );

      const historyResult = await requestMeta.runStage(
        'history_save',
        'Save matcher history',
        () => core.saveMatchRun({
          supabase,
          runId,
          actorEmail: user?.email || '',
          recruiterNotes,
          extraction,
          analysisResult: analysis.result,
          documents: extraction.documents,
          bucket: storageResult?.bucket || '',
          liveJobs,
          enabled: saveResult,
          timeoutMs: requestMeta.remainingMs(),
        }),
        { timeoutMs: requestMeta.remainingMs() }
      );

      logRequest(runId, 'request complete', {
        total_duration_ms: requestMeta.totalDuration(),
        stages: requestMeta.timings,
      });

      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: JSON.stringify(buildSuccessPayload({
          runId,
          recruiterNotes,
          extraction,
          liveJobs,
          analysis,
          saveResult,
          storageResult,
          historyResult,
          requestMeta: {
            started_at: requestMeta.startedAtIso,
            timings: requestMeta.timings,
            total_duration_ms: requestMeta.totalDuration(),
          },
        })),
      };
    } catch (error) {
      if (error?.details?.timings) {
        console.info('[candidate-matcher] request failed', {
          stage: error.details.stage,
          total_duration_ms: error.details.total_duration_ms,
          timings: error.details.timings,
        });
      }
      return {
        statusCode: pickStatusCode(error),
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: buildErrorBody(error),
      };
    }
  };
}

function createCandidateHistoryListBaseHandler({ getContextImpl }) {
  if (typeof getContextImpl !== 'function') {
    throw new Error('getContextImpl is required');
  }

  return async function candidateHistoryListBaseHandler(event, context) {
    try {
      const { supabase } = await getContextImpl(event, context, { requireAdmin: true });
      const body = safeJsonParse(event?.body);
      const history = await core.listMatchRuns(supabase, body.limit);
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: JSON.stringify({
          ok: true,
          history_enabled: history.enabled,
          runs: history.runs,
        }),
      };
    } catch (error) {
      return {
        statusCode: pickStatusCode(error),
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: buildErrorBody(error),
      };
    }
  };
}

function createCandidatePrepareBaseHandler({ getContextImpl }) {
  if (typeof getContextImpl !== 'function') {
    throw new Error('getContextImpl is required');
  }

  return async function candidatePrepareBaseHandler(event, context) {
    let supabase = null;
    let user = null;
    let runId = '';
    let recruiterNotes = '';
    try {
      const auth = await getContextImpl(event, context, { requireAdmin: true });
      supabase = auth.supabase;
      user = auth.user;
      const body = safeJsonParse(event?.body);
      recruiterNotes = core.sanitiseNotes(body.recruiterNotes);
      runId = trimString(body.runId) || randomUUID();
      const requestMeta = createRequestMeta(runId, body);

      await core.createPreparedRunPlaceholder({
        supabase,
        runId,
        actorEmail: user?.email || '',
        recruiterNotes,
        timeoutMs: requestMeta.remainingMs(),
      });
      await core.updatePreparedRunPreparationState({
        supabase,
        runId,
        recruiterNotes,
        status: 'running',
        stage: 'validating_upload',
        stageLabel: 'Validating file',
        details: {
          file_count: Array.isArray(body?.files) ? body.files.length : 0,
        },
        timeoutMs: requestMeta.remainingMs(),
      });

      const preparedFiles = await requestMeta.runStage(
        'prepare_intake',
        'Prepare intake',
        async () => core.prepareCandidateFiles(body.files)
      );
      await core.updatePreparedRunPreparationState({
        supabase,
        runId,
        recruiterNotes,
        status: 'running',
        stage: 'detecting_file_type',
        stageLabel: 'Detecting file type',
        details: {
          files: preparedFiles.map((file) => ({
            name: file.name,
            extension: file.extension,
            content_type: file.contentType,
            parser_path: file.parserPath,
          })),
        },
        timeoutMs: requestMeta.remainingMs(),
      });

      const extraction = await requestMeta.runStage(
        'extraction',
        'Extract evidence',
        () => core.extractCandidateDocuments(preparedFiles, {
          pdfTimeoutMs: requestMeta.remainingMs(),
          docxTimeoutMs: requestMeta.remainingMs(),
          onStage: async (stageEvent) => {
            await core.updatePreparedRunPreparationState({
              supabase,
              runId,
              recruiterNotes,
              status: 'running',
              stage: stageEvent?.stage,
              stageLabel: stageEvent?.stage_label,
              details: stageEvent?.details,
              timeoutMs: requestMeta.remainingMs(),
            });
          },
        }),
        { timeoutMs: requestMeta.remainingMs() }
      );
      await core.updatePreparedRunPreparationState({
        supabase,
        runId,
        recruiterNotes,
        status: 'running',
        stage: 'building_prepared_evidence',
        stageLabel: 'Building candidate evidence',
        details: {
          success_count: extraction.successCount,
          failure_count: extraction.failureCount,
        },
        timeoutMs: requestMeta.remainingMs(),
      });

      const storageResult = await requestMeta.runStage(
        'storage_upload',
        'Store prepared evidence',
        () => core.maybeStoreUploads({
          supabase,
          documents: extraction.documents,
          runId,
          userEmail: user?.email || '',
          shouldStore: true,
          timeoutMs: requestMeta.remainingMs(),
        }),
        { timeoutMs: requestMeta.remainingMs() }
      );

      const savedRun = await requestMeta.runStage(
        'prepared_evidence_save',
        'Save prepared evidence',
        () => core.savePreparedRun({
          supabase,
          runId,
          actorEmail: user?.email || '',
          recruiterNotes,
          extraction,
          documents: extraction.documents,
          bucket: storageResult?.bucket || '',
          timeoutMs: requestMeta.remainingMs(),
        }),
        { timeoutMs: requestMeta.remainingMs() }
      );

      if (savedRun?.enabled === false) {
        throw core.coded(503, 'Prepared evidence storage is not configured for this environment.', 'prepared_evidence_storage_missing');
      }

      const preparedRun = await core.getMatchRun(supabase, runId);

      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: JSON.stringify(buildPrepareSuccessPayload({
          runId,
          recruiterNotes,
          extraction,
          storageResult,
          preparedRun,
          requestMeta: {
            started_at: requestMeta.startedAtIso,
            total_duration_ms: requestMeta.totalDuration(),
          },
        })),
      };
    } catch (error) {
      if (supabase && runId) {
        await core.updatePreparedRunPreparationState({
          supabase,
          runId,
          recruiterNotes,
          status: 'failed',
          stage: trimString(error?.details?.stage) || 'failed',
          stageLabel: trimString(error?.details?.stage_label) || 'Evidence preparation failed',
          message: trimString(error?.message) || 'Candidate preparation failed.',
          technicalMessage: trimString(error?.code)
            ? `${trimString(error.code)}: ${trimString(error?.message)}`
            : trimString(error?.message),
          details: error?.details && typeof error.details === 'object' ? error.details : null,
          timeoutMs: 2000,
        }).catch(() => {});
      }
      return {
        statusCode: pickStatusCode(error),
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: buildErrorBody(error),
      };
    }
  };
}

function createCandidateRunMatchBaseHandler({ getContextImpl, dispatchBackgroundImpl = dispatchBackgroundMatch }) {
  if (typeof getContextImpl !== 'function') {
    throw new Error('getContextImpl is required');
  }

  return async function candidateRunMatchBaseHandler(event, context) {
    let supabase = null;
    let preparedRunId = '';
    let queuedJobId = '';
    try {
      const auth = await getContextImpl(event, context, { requireAdmin: true });
      supabase = auth.supabase;
      const user = auth.user;
      const body = safeJsonParse(event?.body);
      preparedRunId = trimString(body.preparedRunId);
      const recruiterNotes = core.sanitiseNotes(body.recruiterNotes);
      const requestMeta = createRequestMeta(preparedRunId || randomUUID(), body);

      const preparedRun = await requestMeta.runStage(
        'prepared_evidence_load',
        'Load prepared evidence',
        () => core.getMatchRun(supabase, preparedRunId),
        { timeoutMs: requestMeta.remainingMs() }
      );

      if (!preparedRun.ready_for_match) {
        throw requestMeta.annotateError(
          core.coded(409, 'Prepared evidence is not ready for matching yet. Review the extracted evidence summary first.', 'prepared_evidence_not_ready'),
          'prepared_evidence_load',
          'Load prepared evidence'
        );
      }

      const currentJobStatus = trimString(preparedRun.match_job?.status).toLowerCase();
      if (currentJobStatus === 'queued' || currentJobStatus === 'running') {
        return {
          statusCode: 202,
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          },
          body: JSON.stringify({
            ...buildMatchStatusPayload(preparedRun),
            queued: false,
            already_in_progress: true,
          }),
        };
      }

      queuedJobId = randomUUID();
      await requestMeta.runStage(
        'queue_match',
        'Queue recruiter match',
        () => core.updatePreparedRunJobState({
          supabase,
          runId: preparedRun.id,
          recruiterNotes: recruiterNotes || preparedRun.recruiter_notes,
          jobId: queuedJobId,
          status: 'queued',
          stage: 'queued',
          stageLabel: 'Prepared evidence ready',
          timeoutMs: requestMeta.remainingMs(),
        }),
        { timeoutMs: requestMeta.remainingMs() }
      );

      await requestMeta.runStage(
        'background_dispatch',
        'Dispatch background match',
        () => dispatchBackgroundImpl(event, {
          preparedRunId: preparedRun.id,
          recruiterNotes: recruiterNotes || preparedRun.recruiter_notes || '',
          jobId: queuedJobId,
          requestedBy: user?.email || '',
        }),
        { timeoutMs: Math.min(8000, requestMeta.remainingMs()) }
      );

      const updatedRun = await core.getMatchRun(supabase, preparedRun.id);
      return {
        statusCode: 202,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: JSON.stringify({
          ...buildMatchStatusPayload(updatedRun, {
            run_diagnostics: {
              started_at: requestMeta.startedAtIso,
              total_elapsed_ms: requestMeta.totalDuration(),
              files_attempted: updatedRun.prepared_evidence?.files_attempted || 0,
              files_text_read: updatedRun.prepared_evidence?.files_text_read || 0,
              files_skipped: (updatedRun.prepared_evidence?.limited_count || 0)
                + (updatedRun.prepared_evidence?.unsupported_count || 0)
                + (updatedRun.prepared_evidence?.failed_count || 0),
              warning_count: (updatedRun.prepared_evidence?.limited_count || 0)
                + (updatedRun.prepared_evidence?.unsupported_count || 0)
                + (updatedRun.prepared_evidence?.failed_count || 0),
              failed_stage: '',
            },
          }),
          queued: true,
        }),
      };
    } catch (error) {
      if (supabase && preparedRunId && queuedJobId) {
        await core.markPreparedRunFailure({
          supabase,
          runId: preparedRunId,
          jobId: queuedJobId,
          error,
          timeoutMs: 2000,
        });
      }
      return {
        statusCode: pickStatusCode(error),
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: buildErrorBody(error),
      };
    }
  };
}

function createCandidateMatchStatusBaseHandler({ getContextImpl }) {
  if (typeof getContextImpl !== 'function') {
    throw new Error('getContextImpl is required');
  }

  return async function candidateMatchStatusBaseHandler(event, context) {
    try {
      const { supabase } = await getContextImpl(event, context, { requireAdmin: true });
      const body = safeJsonParse(event?.body);
      const preparedRunId = trimString(body.preparedRunId);
      const preparedRun = await core.getMatchRun(supabase, preparedRunId);
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: JSON.stringify(buildMatchStatusPayload(preparedRun)),
      };
    } catch (error) {
      return {
        statusCode: pickStatusCode(error),
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: buildErrorBody(error),
      };
    }
  };
}

function createCandidateRunMatchBackgroundBaseHandler({ getContextImpl }) {
  if (typeof getContextImpl !== 'function') {
    throw new Error('getContextImpl is required');
  }

  return async function candidateRunMatchBackgroundBaseHandler(event, context) {
    let supabase = null;
    let preparedRunId = '';
    let jobId = '';
    try {
      const auth = await getContextImpl(event, context, { requireAdmin: true });
      supabase = auth.supabase;
      const user = auth.user;
      const body = safeJsonParse(event?.body);
      preparedRunId = trimString(body.preparedRunId);
      jobId = trimString(body.jobId) || randomUUID();
      const recruiterNotes = core.sanitiseNotes(body.recruiterNotes);
      const requestMeta = createRequestMeta(preparedRunId || jobId, body, { mode: 'background' });

      await requestMeta.runStage(
        'job_start',
        'Start background recruiter match',
        () => core.updatePreparedRunJobState({
          supabase,
          runId: preparedRunId,
          recruiterNotes,
          jobId,
          status: 'running',
          stage: 'loading_prepared_evidence',
          stageLabel: 'Loading prepared evidence',
          timeoutMs: requestMeta.remainingMs(),
        }),
        { timeoutMs: requestMeta.remainingMs() }
      );

      const { updatedRun, analysis, liveJobs } = await performPreparedMatchWorkflow({
        supabase,
        user,
        preparedRunId,
        recruiterNotes,
        jobId,
        requestMeta,
      });

      logRequest(preparedRunId, 'background request complete', {
        total_duration_ms: requestMeta.totalDuration(),
        stages: requestMeta.timings,
      });

      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: JSON.stringify(buildMatchStatusPayload(updatedRun, {
          live_jobs_count: Number(analysis?.diagnostics?.live_jobs_sent_count) || liveJobs.length,
          live_jobs_total_count: Number(analysis?.diagnostics?.live_jobs_total_count) || liveJobs.length,
          analysis_meta: {
            model: analysis.model,
            request_metrics: analysis?.diagnostics && typeof analysis.diagnostics === 'object'
              ? {
                candidate_text_chars: Number(analysis.diagnostics.candidate_text_chars) || 0,
                candidate_text_source_chars: Number(analysis.diagnostics.candidate_text_source_chars) || 0,
                live_jobs_total_count: Number(analysis.diagnostics.live_jobs_total_count) || 0,
                live_jobs_sent_count: Number(analysis.diagnostics.live_jobs_sent_count) || 0,
                live_jobs_json_chars: Number(analysis.diagnostics.live_jobs_json_chars) || 0,
                request_payload_json_chars: Number(analysis.diagnostics.request_payload_json_chars) || 0,
                max_output_tokens: Number(analysis.diagnostics.max_output_tokens) || 0,
              }
              : null,
            timings: requestMeta.timings,
            total_duration_ms: requestMeta.totalDuration(),
          },
        })),
      };
    } catch (error) {
      if (supabase && preparedRunId) {
        await core.markPreparedRunFailure({
          supabase,
          runId: preparedRunId,
          jobId,
          error,
          timeoutMs: 2000,
        });
      }
      return {
        statusCode: pickStatusCode(error),
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: buildErrorBody(error),
      };
    }
  };
}

module.exports = {
  createCandidateMatchStatusBaseHandler,
  createCandidatePrepareBaseHandler,
  createCandidateHistoryListBaseHandler,
  createCandidateMatchBaseHandler,
  createCandidateRunMatchBaseHandler,
  createCandidateRunMatchBackgroundBaseHandler,
};
