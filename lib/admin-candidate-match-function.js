'use strict';

const { randomUUID } = require('node:crypto');
const core = require('./candidate-matcher-core.js');
const REQUEST_TIMEOUT_MS = 60000;

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
      failed_stage: trimString(error.details.stage_label || error.details.stage),
    };
  }
  return JSON.stringify(payload);
}

function buildWarnings(extraction, storageResult) {
  return extraction.failed
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
    live_jobs_count: liveJobs.length,
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

function createRequestMeta(runId, body) {
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const timings = [];

  function totalDuration() {
    return Date.now() - startedAt;
  }

  function remainingMs() {
    return Math.max(1000, REQUEST_TIMEOUT_MS - totalDuration());
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
    remainingMs,
    runStage,
    annotateError,
  };
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
            : 'None of the uploaded documents produced readable candidate text. Review the per-file extraction details and try again.',
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
    try {
      const { supabase, user } = await getContextImpl(event, context, { requireAdmin: true });
      const body = safeJsonParse(event?.body);
      const recruiterNotes = core.sanitiseNotes(body.recruiterNotes);
      const runId = randomUUID();
      const requestMeta = createRequestMeta(runId, body);

      const preparedFiles = await requestMeta.runStage(
        'prepare_intake',
        'Prepare intake',
        async () => core.prepareCandidateFiles(body.files)
      );

      const extraction = await requestMeta.runStage(
        'extraction',
        'Extract evidence',
        () => core.extractCandidateDocuments(preparedFiles, {
          pdfTimeoutMs: requestMeta.remainingMs(),
          docxTimeoutMs: requestMeta.remainingMs(),
        }),
        { timeoutMs: requestMeta.remainingMs() }
      );

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

function createCandidateRunMatchBaseHandler({ getContextImpl }) {
  if (typeof getContextImpl !== 'function') {
    throw new Error('getContextImpl is required');
  }

  return async function candidateRunMatchBaseHandler(event, context) {
    let supabase = null;
    let preparedRunId = '';
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

      const candidatePayload = core.buildCandidatePayloadFromPreparedRun(preparedRun, recruiterNotes || preparedRun.recruiter_notes);
      if (!candidatePayload.candidate_text) {
        throw requestMeta.annotateError(
          core.coded(409, 'Prepared evidence does not contain readable candidate text for matching.', 'prepared_candidate_text_missing'),
          'prepared_evidence_load',
          'Load prepared evidence'
        );
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

      const analysis = await requestMeta.runStage(
        'openai',
        'Run recruiter matching',
        () => core.callOpenAIForMatch({
          candidate: candidatePayload,
          live_jobs: liveJobs,
        }, {
          timeoutMs: requestMeta.remainingMs(),
        }),
        { timeoutMs: requestMeta.remainingMs() }
      );

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
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: JSON.stringify(buildSuccessPayload({
          runId: preparedRun.id,
          recruiterNotes: recruiterNotes || preparedRun.recruiter_notes || '',
          extraction: {
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
          },
          liveJobs,
          analysis,
          saveResult: true,
          storageResult: {
            stored: true,
            bucket: updatedRun.files?.[0]?.storage_bucket || '',
            warnings: [],
          },
          historyResult: {
            saved: true,
            enabled: true,
            record: { id: updatedRun.id, created_at: updatedRun.created_at },
            prepared_run: updatedRun,
          },
          requestMeta: {
            started_at: requestMeta.startedAtIso,
            timings: requestMeta.timings,
            total_duration_ms: requestMeta.totalDuration(),
            prepared_run: updatedRun,
          },
        })),
      };
    } catch (error) {
      if (supabase && preparedRunId) {
        await core.markPreparedRunFailure({
          supabase,
          runId: preparedRunId,
          message: error?.message || 'Match failed.',
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
  createCandidatePrepareBaseHandler,
  createCandidateHistoryListBaseHandler,
  createCandidateMatchBaseHandler,
  createCandidateRunMatchBaseHandler,
};
