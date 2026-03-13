'use strict';

const { randomUUID } = require('node:crypto');
const core = require('./candidate-matcher-core.js');
const REQUEST_TIMEOUT_MS = 28000;
const STAGE_TIMEOUTS = {
  extraction: 15000,
  jobs_fetch: 10000,
  storage_upload: 10000,
  openai: 18000,
  history_save: 10000,
};

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
  return JSON.stringify(payload);
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
  const warnings = extraction.failed
    .map((document) => ({
      file: document.name,
      message: document.error,
      status: document.status,
    }))
    .concat((storageResult?.warnings || []).map((warning) => ({
      file: '',
      message: warning,
      status: 'storage',
    })));

  return {
    ok: true,
    run_id: runId,
    recruiter_notes: recruiterNotes,
    live_jobs_count: liveJobs.length,
    saved_to_history: !!historyResult?.saved,
    history_enabled: historyResult?.enabled !== false,
    history_record: historyResult?.record || null,
    upload_storage: {
      enabled: !!saveResult,
      stored: !!storageResult?.stored,
      bucket: storageResult?.bucket || '',
    },
    extraction: {
      success_count: extraction.successCount,
      failure_count: extraction.failureCount,
      documents: extraction.documents.map(core.summariseDocument),
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

function logRequest(runId, message, data) {
  if (data === undefined) {
    console.info(`[candidate-matcher][${runId}] ${message}`);
    return;
  }
  console.info(`[candidate-matcher][${runId}] ${message}`, data);
}

function createRequestMeta(runId, body) {
  const startedAt = Date.now();
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
  });

  return {
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
        () => core.extractCandidateDocuments(preparedFiles),
        { timeoutMs: Math.min(STAGE_TIMEOUTS.extraction, requestMeta.remainingMs()) }
      );

      if (!extraction.successCount) {
        const details = {
          stage: 'extraction',
          source: 'request-buffer',
          storage_readback: 'not_used',
          documents: extraction.documents.map(core.summariseDocument),
        };
        const error = core.coded(
          422,
          'None of the uploaded documents produced readable candidate text. Review the per-file extraction details and try again.',
          'all_files_failed',
          { details }
        );
        throw requestMeta.annotateError(error, 'extraction', 'Extract evidence');
      }

      const liveJobs = await requestMeta.runStage(
        'jobs_fetch',
        'Read live roles',
        () => core.fetchPublishedLiveJobs(supabase, {
          timeoutMs: Math.min(STAGE_TIMEOUTS.jobs_fetch, requestMeta.remainingMs()),
        }),
        { timeoutMs: Math.min(STAGE_TIMEOUTS.jobs_fetch, requestMeta.remainingMs()) }
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
          timeoutMs: Math.min(STAGE_TIMEOUTS.storage_upload, requestMeta.remainingMs()),
        }),
        { timeoutMs: Math.min(STAGE_TIMEOUTS.storage_upload, requestMeta.remainingMs()) }
      );

      const analysis = await requestMeta.runStage(
        'openai',
        'Run recruiter matching',
        () => core.callOpenAIForMatch({
          candidate: core.buildCandidatePayload(extraction, recruiterNotes),
          live_jobs: liveJobs,
        }, {
          timeoutMs: Math.min(STAGE_TIMEOUTS.openai, requestMeta.remainingMs()),
        }),
        { timeoutMs: Math.min(STAGE_TIMEOUTS.openai, requestMeta.remainingMs()) }
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
          timeoutMs: Math.min(STAGE_TIMEOUTS.history_save, requestMeta.remainingMs()),
        }),
        { timeoutMs: Math.min(STAGE_TIMEOUTS.history_save, requestMeta.remainingMs()) }
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

module.exports = {
  createCandidateHistoryListBaseHandler,
  createCandidateMatchBaseHandler,
};
