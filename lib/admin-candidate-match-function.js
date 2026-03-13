'use strict';

const { randomUUID } = require('node:crypto');
const core = require('./candidate-matcher-core.js');

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
    },
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

      const preparedFiles = core.prepareCandidateFiles(body.files);
      const extraction = await core.extractCandidateDocuments(preparedFiles);

      if (!extraction.successCount) {
        const details = {
          stage: 'extraction',
          source: 'request-buffer',
          storage_readback: 'not_used',
          documents: extraction.documents.map(core.summariseDocument),
        };
        throw core.coded(
          422,
          'None of the uploaded documents produced readable candidate text. Review the per-file extraction details and try again.',
          'all_files_failed',
          { details }
        );
      }

      const liveJobs = await core.fetchPublishedLiveJobs(supabase);
      if (!liveJobs.length) {
        throw core.coded(
          409,
          'No currently published live jobs are available to match against.',
          'no_live_jobs'
        );
      }

      const storageResult = await core.maybeStoreUploads({
        supabase,
        documents: extraction.documents,
        runId,
        userEmail: user?.email || '',
        shouldStore: saveResult,
      });

      const analysis = await core.callOpenAIForMatch({
        candidate: core.buildCandidatePayload(extraction, recruiterNotes),
        live_jobs: liveJobs,
      });

      const historyResult = await core.saveMatchRun({
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
