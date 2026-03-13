(function () {
  'use strict';

  const TEXT_EXTRACTABLE_EXTENSIONS = new Set(['pdf', 'docx']);
  const LIMITED_EXTENSIONS = new Set(['doc']);
  const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);
  const ACCEPTED_EXTENSIONS = new Set([
    ...TEXT_EXTRACTABLE_EXTENSIONS,
    ...LIMITED_EXTENSIONS,
    ...IMAGE_EXTENSIONS,
  ]);
  const PROGRESS_STAGES = [
    {
      key: 'prepare_intake',
      label: 'Validate intake',
      helper: 'Check selected files and recruiter notes before submission.',
      message: 'Validating the current intake queue…',
      targetPercent: 8,
    },
    {
      key: 'transmit_files',
      label: 'Transmit files',
      helper: 'Package the selected files and hand them to the secure matcher function.',
      message: 'Packaging candidate files for secure transmission…',
      targetPercent: 24,
    },
    {
      key: 'extraction',
      label: 'Extract evidence',
      helper: 'Read CV and supporting documents server-side.',
      message: 'Extracting readable candidate evidence on the server…',
      targetPercent: 48,
    },
    {
      key: 'prepared_evidence_save',
      label: 'Store prepared evidence',
      helper: 'Save extracted evidence privately so matching can be retried without re-uploading.',
      message: 'Saving prepared evidence for later matching…',
      targetPercent: 74,
    },
    {
      key: 'jobs_fetch',
      label: 'Read live roles',
      helper: 'Load HMJ published live jobs from the live source.',
      message: 'Reading HMJ published live roles from Supabase…',
      targetPercent: 92,
    },
    {
      key: 'openai',
      label: 'Run recruiter match',
      helper: 'Send extracted evidence and live roles into the structured OpenAI analysis stage.',
      message: 'Running structured recruiter matching…',
      targetPercent: 96,
    },
    {
      key: 'render',
      label: 'Render results',
      helper: 'Display the ranked outcome and save the latest recruiter review.',
      message: 'Rendering the ranked recruiter view…',
      targetPercent: 100,
    }
  ];
  const STAGE_INDEX_BY_KEY = {
    prepare_intake: 0,
    transmit_files: 1,
    extraction: 2,
    storage_upload: 3,
    prepared_evidence_save: 3,
    prepared_evidence_load: 4,
    loading_prepared_evidence: 4,
    prepared_evidence_ready: 4,
    loading_live_jobs: 4,
    live_jobs_loaded: 4,
    jobs_fetch: 4,
    openai_request_started: 5,
    openai_thinking: 5,
    openai_response_received: 5,
    parsing_result: 5,
    structured_result_validated: 5,
    openai: 5,
    saving_result: 6,
    history_save: 6,
    completed: 6,
    render: 6,
  };
  const CLIENT_REQUEST_TIMEOUT_MS = 65000;
  const MATCH_STATUS_POLL_MS = 2500;
  const SESSION_STATE_KEY = 'hmj-candidate-matcher-session';
  const SESSION_ID_KEY = 'hmj-candidate-matcher-session-id';
  const QUEUE_DB_NAME = 'hmj-candidate-matcher';
  const QUEUE_DB_VERSION = 1;
  const QUEUE_STORE = 'queued-files';
  const QUEUE_RETENTION_MS = 12 * 60 * 60 * 1000;
  const PDF_MIME_TYPES = new Set(['application/pdf', 'application/x-pdf', 'application/acrobat', 'applications/vnd.pdf', 'text/pdf', 'text/x-pdf']);
  const DOCX_MIME_TYPES = new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
  const DOC_MIME_TYPES = new Set(['application/msword', 'application/doc', 'application/x-doc', 'application/vnd.msword', 'application/vnd.ms-word']);
  const JPEG_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg']);
  const PNG_MIME_TYPES = new Set(['image/png', 'image/x-png']);

  const state = {
    files: [],
    fileDiagnostics: new Map(),
    historyRuns: [],
    preparedRun: null,
    latestResultPayload: null,
    latestResultMeta: null,
    matchPollTimer: 0,
    busy: false,
    progressIndex: -1,
    progressFailureIndex: -1,
    progressPercent: 0,
    progressStageDetails: PROGRESS_STAGES.map((stage) => stage.helper),
    progressStageStatus: PROGRESS_STAGES.map(() => ''),
    activeRequestId: '',
    runDiagnostics: null,
    problemFileKeys: new Set(),
    helpers: null,
    sessionId: '',
  };

  const elements = {};

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function extOf(name) {
    const value = String(name || '').toLowerCase();
    const index = value.lastIndexOf('.');
    return index === -1 ? '' : value.slice(index + 1);
  }

  function normaliseContentType(value) {
    return String(value || '').toLowerCase().split(';')[0].trim();
  }

  function inferExtensionFromMime(contentType) {
    const mime = normaliseContentType(contentType);
    if (PDF_MIME_TYPES.has(mime)) return 'pdf';
    if (DOCX_MIME_TYPES.has(mime)) return 'docx';
    if (DOC_MIME_TYPES.has(mime)) return 'doc';
    if (JPEG_MIME_TYPES.has(mime)) return 'jpg';
    if (PNG_MIME_TYPES.has(mime)) return 'png';
    return '';
  }

  function fileKey(file) {
    return [String(file?.name || ''), Number(file?.size) || 0].join('::');
  }

  function classifyClientFile(file) {
    const nameExtension = extOf(file?.name);
    const mimeExtension = inferExtensionFromMime(file?.type);
    const extension = ACCEPTED_EXTENSIONS.has(mimeExtension)
      ? mimeExtension
      : (ACCEPTED_EXTENSIONS.has(nameExtension) ? nameExtension : (nameExtension || mimeExtension || 'file'));

    if (TEXT_EXTRACTABLE_EXTENSIONS.has(extension)) {
      return {
        extension,
        fileKind: extension,
        eligibility: 'Text extraction supported',
        warning: '',
      };
    }

    if (LIMITED_EXTENSIONS.has(extension)) {
      return {
        extension,
        fileKind: 'doc',
        eligibility: 'Accepted with limited extraction',
        warning: 'Legacy DOC uploads may need PDF re-upload if text extraction is unavailable.',
      };
    }

    if (IMAGE_EXTENSIONS.has(extension)) {
      return {
        extension,
        fileKind: 'image',
        eligibility: 'Accepted as image evidence',
        warning: 'Image evidence is included but not text-extracted in V1.',
      };
    }

    return {
      extension,
      fileKind: 'unsupported',
      eligibility: 'Unsupported',
      warning: 'Accepted types: PDF, DOCX, DOC, JPG, JPEG, PNG.',
    };
  }

  function extractionStatusLabel(status) {
    const key = String(status || '').toLowerCase();
    if (key === 'ok') return 'Parsed';
    if (key === 'image_only') return 'Image evidence';
    if (key === 'limited') return 'Limited';
    if (key === 'unsupported') return 'Unsupported';
    if (key === 'failed') return 'Failed';
    if (key === 'storage') return 'Storage note';
    if (key === 'openai') return 'AI stage';
    if (key === 'jobs_fetch') return 'Jobs stage';
    if (key === 'error') return 'Error';
    return 'Ready';
  }

  function formatDuration(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return '—';
    if (value < 1000) return `${Math.round(value)} ms`;
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} s`;
  }

  function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
  }

  function formatDateTime(value) {
    if (!value) return 'Unknown date';
    try {
      return new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(value);
    }
  }

  function elapsedSince(isoString) {
    if (!isoString) return '—';
    const timestamp = new Date(isoString).getTime();
    if (!Number.isFinite(timestamp)) return '—';
    return formatDuration(Date.now() - timestamp);
  }

  function recommendationLabel(value) {
    const key = String(value || '').toLowerCase();
    if (key === 'shortlist') return 'Shortlist';
    if (key === 'maybe') return 'Maybe';
    return 'Reject';
  }

  function pluralise(count, singular, plural) {
    return `${count} ${count === 1 ? singular : (plural || `${singular}s`)}`;
  }

  function safeArray(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function currentMatchJob(run) {
    return run && typeof run === 'object' ? (run.match_job || null) : null;
  }

  function matchJobStatusLabel(status) {
    const key = String(status || '').toLowerCase();
    if (key === 'queued') return 'Queued';
    if (key === 'running') return 'Running';
    if (key === 'completed') return 'Completed';
    if (key === 'failed') return 'Failed';
    return 'Idle';
  }

  function matchJobStageLabel(stage, fallbackLabel) {
    const key = String(stage || '').toLowerCase();
    if (key === 'queued') return 'Prepared evidence ready';
    if (key === 'loading_prepared_evidence') return 'Loading prepared evidence';
    if (key === 'prepared_evidence_ready') return 'Prepared evidence ready';
    if (key === 'loading_live_jobs') return 'Loading live roles';
    if (key === 'live_jobs_loaded') return 'Live roles loaded';
    if (key === 'openai_request_started') return 'Data successfully transferred to OpenAI';
    if (key === 'openai_thinking') return 'OpenAI thinking';
    if (key === 'openai_response_received') return 'OpenAI response received';
    if (key === 'parsing_result') return 'Validating structured result';
    if (key === 'structured_result_validated') return 'Structured result validated';
    if (key === 'saving_result') return 'Saving recruiter match result';
    if (key === 'completed') return 'Match complete';
    if (key === 'failed') return 'Match failed';
    return fallbackLabel || 'Waiting for progress update';
  }

  function buildProgressStateFromJob(run) {
    const job = currentMatchJob(run);
    const status = String(job?.status || '').toLowerCase();
    const stage = String(job?.stage || '').toLowerCase();
    const stageLabel = matchJobStageLabel(stage, job?.stage_label);

    if (status === 'failed') {
      return {
        activeIndex: stageIndexForKey(stage || 'openai'),
        failedIndex: stageIndexForKey(stage || 'openai'),
        percent: progressPercentForStage(stageIndexForKey(stage || 'openai'), true),
        statusText: 'Background match failed',
        detailText: run?.error_message || job?.last_error || 'The queued recruiter match did not complete.',
        stageDetail: stageLabel || 'Background recruiter analysis failed.',
      };
    }

    if (status === 'completed') {
      return {
        activeIndex: 6,
        failedIndex: -1,
        percent: 100,
        statusText: 'Match complete',
        detailText: 'Background recruiter analysis completed. Review the saved ranked result below.',
        stageDetail: 'Match complete',
      };
    }

    if (stage === 'queued' || status === 'queued') {
      return {
        activeIndex: 4,
        failedIndex: -1,
        percent: 66,
        statusText: 'Match queued',
        detailText: 'Prepared evidence is ready. Waiting for the background recruiter analysis to start.',
        stageDetail: 'Prepared evidence ready',
      };
    }

    if (stage === 'loading_prepared_evidence') {
      return {
        activeIndex: 4,
        failedIndex: -1,
        percent: 70,
        statusText: 'Loading prepared evidence',
        detailText: 'Prepared evidence is being loaded for the background recruiter match.',
        stageDetail: 'Loading prepared evidence',
      };
    }

    if (stage === 'prepared_evidence_ready') {
      return {
        activeIndex: 4,
        failedIndex: -1,
        percent: 74,
        statusText: 'Prepared evidence ready',
        detailText: 'Prepared evidence is ready for the AI match stage.',
        stageDetail: 'Prepared evidence ready',
      };
    }

    if (stage === 'loading_live_jobs' || stage === 'live_jobs_loaded') {
      return {
        activeIndex: 4,
        failedIndex: -1,
        percent: 78,
        statusText: stage === 'live_jobs_loaded' ? 'Live roles loaded' : 'Loading live roles',
        detailText: stage === 'live_jobs_loaded'
          ? 'Current HMJ live roles have been loaded for the matcher.'
          : 'Loading current HMJ live roles for the matcher.',
        stageDetail: stageLabel,
      };
    }

    if (stage === 'openai_request_started' || stage === 'openai_thinking') {
      return {
        activeIndex: 5,
        failedIndex: -1,
        percent: 86,
        statusText: 'OpenAI analysing candidate',
        detailText: 'Data successfully transferred to OpenAI. OpenAI is analysing the candidate against the live roles.',
        stageDetail: stageLabel,
      };
    }

    if (stage === 'openai_response_received') {
      return {
        activeIndex: 5,
        failedIndex: -1,
        percent: 90,
        statusText: 'OpenAI response received',
        detailText: 'OpenAI has returned a response and the matcher is moving to validation.',
        stageDetail: stageLabel,
      };
    }

    if (stage === 'parsing_result' || stage === 'structured_result_validated') {
      return {
        activeIndex: 5,
        failedIndex: -1,
        percent: 94,
        statusText: stage === 'structured_result_validated' ? 'Structured result validated' : 'Validating structured result',
        detailText: stage === 'structured_result_validated'
          ? 'The structured recruiter result passed validation and is preparing to save.'
          : 'Validating the structured recruiter result returned by OpenAI.',
        stageDetail: stageLabel,
      };
    }

    if (stage === 'saving_result') {
      return {
        activeIndex: 6,
        failedIndex: -1,
        percent: 97,
        statusText: 'Saving recruiter match result',
        detailText: 'Saving the validated recruiter match result to the private history record.',
        stageDetail: stageLabel,
      };
    }

    if (status === 'running') {
      return {
        activeIndex: 5,
        failedIndex: -1,
        percent: 84,
        statusText: 'Running recruiter match',
        detailText: 'Prepared evidence is saved. The AI recruiter analysis is running in the background.',
        stageDetail: stageLabel || 'Background recruiter analysis is currently running.',
      };
    }

    return null;
  }

  function isMatchJobActive(run) {
    const status = String(currentMatchJob(run)?.status || '').toLowerCase();
    return status === 'queued' || status === 'running';
  }

  function createSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function ensureSessionId() {
    if (state.sessionId) return state.sessionId;
    try {
      const existing = window.sessionStorage.getItem(SESSION_ID_KEY);
      state.sessionId = existing || createSessionId();
      window.sessionStorage.setItem(SESSION_ID_KEY, state.sessionId);
    } catch {
      state.sessionId = createSessionId();
    }
    return state.sessionId;
  }

  function readSessionSnapshot() {
    try {
      return JSON.parse(window.sessionStorage.getItem(SESSION_STATE_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function persistSessionSnapshot() {
    try {
      window.sessionStorage.setItem(SESSION_STATE_KEY, JSON.stringify({
        recruiterNotes: elements.recruiterNotes ? elements.recruiterNotes.value : '',
        preparedRun: state.preparedRun,
        latestResultPayload: state.latestResultPayload,
        latestResultMeta: state.latestResultMeta,
        runDiagnostics: state.runDiagnostics,
      }));
    } catch {
      // Ignore session storage failures in restricted browser modes.
    }
  }

  function clearPersistedResultState() {
    state.latestResultPayload = null;
    state.latestResultMeta = null;
    persistSessionSnapshot();
  }

  function setLatestResult(resultPayload, meta) {
    state.latestResultPayload = resultPayload || null;
    state.latestResultMeta = meta || null;
    persistSessionSnapshot();
  }

  function supportsIndexedDb() {
    return typeof window.indexedDB !== 'undefined';
  }

  function openQueueDb() {
    if (!supportsIndexedDb()) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(QUEUE_DB_NAME, QUEUE_DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function withQueueStore(mode, work) {
    const db = await openQueueDb();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, mode);
      const store = tx.objectStore(QUEUE_STORE);
      Promise.resolve(work(store))
        .then((result) => {
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        })
        .catch((error) => {
          db.close();
          reject(error);
        });
    });
  }

  function queueRecordId(file) {
    return `${ensureSessionId()}::${fileKey(file)}`;
  }

  async function persistQueuedFiles(files) {
    if (!supportsIndexedDb()) return;
    const items = safeArray(files);
    if (!items.length) return;
    await withQueueStore('readwrite', async (store) => {
      items.forEach((file) => {
        store.put({
          id: queueRecordId(file),
          sessionId: ensureSessionId(),
          updatedAt: Date.now(),
          file,
        });
      });
    }).catch(() => {});
  }

  async function removeQueuedFileFromStore(file) {
    if (!supportsIndexedDb()) return;
    await withQueueStore('readwrite', async (store) => {
      store.delete(queueRecordId(file));
    }).catch(() => {});
  }

  async function clearQueuedFilesFromStore() {
    if (!supportsIndexedDb()) return;
    const sessionId = ensureSessionId();
    await withQueueStore('readwrite', async (store) => {
      const request = store.getAll ? store.getAll() : store.openCursor();
      const rows = store.getAll
        ? await requestToPromise(request)
        : await new Promise((resolve, reject) => {
          const items = [];
          request.onerror = () => reject(request.error);
          request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
              resolve(items);
              return;
            }
            items.push(cursor.value);
            cursor.continue();
          };
        });
      rows.filter((row) => row?.sessionId === sessionId).forEach((row) => store.delete(row.id));
    }).catch(() => {});
  }

  async function restoreQueuedFilesFromStore() {
    if (!supportsIndexedDb()) return [];
    const sessionId = ensureSessionId();
    return withQueueStore('readonly', async (store) => {
      const request = store.getAll ? store.getAll() : store.openCursor();
      const rows = store.getAll
        ? await requestToPromise(request)
        : await new Promise((resolve, reject) => {
          const items = [];
          request.onerror = () => reject(request.error);
          request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
              resolve(items);
              return;
            }
            items.push(cursor.value);
            cursor.continue();
          };
        });
      const now = Date.now();
      return rows
        .filter((row) => row?.sessionId === sessionId && row?.file)
        .filter((row) => now - Number(row.updatedAt || 0) < QUEUE_RETENTION_MS)
        .map((row) => row.file);
    }).catch(() => []);
  }

  function progressPercentForStage(index, failed) {
    if (failed && Number.isFinite(index) && index >= 0) {
      return Math.max(8, (PROGRESS_STAGES[index]?.targetPercent || 0) - 6);
    }
    if (!Number.isFinite(index) || index < 0) return 0;
    return PROGRESS_STAGES[index]?.targetPercent || 0;
  }

  function resetProgressState() {
    state.progressStageDetails = PROGRESS_STAGES.map((stage) => stage.helper);
    state.progressStageStatus = PROGRESS_STAGES.map(() => '');
  }

  function setStageDetail(index, detail, status) {
    if (!Number.isFinite(index) || index < 0 || index >= PROGRESS_STAGES.length) return;
    if (detail) state.progressStageDetails[index] = detail;
    if (status) state.progressStageStatus[index] = status;
  }

  function buildTimingLookup(timings) {
    return safeArray(timings).reduce((map, timing) => {
      if (timing?.stage) {
        map[timing.stage] = timing;
      }
      return map;
    }, {});
  }

  function deriveStageDetailsFromRun(response, error) {
    resetProgressState();
    const timings = safeArray(response?.analysis_meta?.timings || error?.details?.timings);
    const timingByStage = buildTimingLookup(timings);
    const diagnostics = response?.run_diagnostics || error?.run_diagnostics || {};
    const extraction = response?.extraction || {};
    const liveJobsCount = Number(response?.live_jobs_count) || 0;

    setStageDetail(0, 'Queue validated in browser before submission.', 'done');
    setStageDetail(1, `${pluralise(state.files.length, 'file')} packaged and submitted to the secure matcher function.`, 'done');

    const extractionTiming = timingByStage.extraction;
    const extractionLine = [
      response
        ? `${Number(extraction.success_count) || 0} file${Number(extraction.success_count) === 1 ? '' : 's'} text-read`
        : '',
      Number(extraction.image_evidence_count) ? `${Number(extraction.image_evidence_count)} image evidence file${Number(extraction.image_evidence_count) === 1 ? '' : 's'}` : '',
      extractionTiming ? formatDuration(extractionTiming.duration_ms) : '',
    ].filter(Boolean).join(' • ');
    if (extractionLine) setStageDetail(2, extractionLine, extractionTiming?.status === 'failed' ? 'failed' : 'done');

    const storageTiming = timingByStage.storage_upload;
    const preparedSaveTiming = timingByStage.prepared_evidence_save;
    if (response || storageTiming || preparedSaveTiming) {
      const storageMessage = response?.upload_storage?.enabled
        ? (response?.upload_storage?.stored ? 'Prepared evidence stored privately' : 'Prepared evidence saved without private upload copies')
        : 'Prepared evidence save still completed';
      setStageDetail(
        3,
        [storageMessage, storageTiming ? formatDuration(storageTiming.duration_ms) : '', preparedSaveTiming ? formatDuration(preparedSaveTiming.duration_ms) : '']
          .filter(Boolean)
          .join(' • '),
        storageTiming?.status === 'failed' || preparedSaveTiming?.status === 'failed' ? 'failed' : (response ? 'done' : '')
      );
    }

    const jobsTiming = timingByStage.jobs_fetch || timingByStage.prepared_evidence_load;
    if (response || jobsTiming) {
      setStageDetail(4, [
        liveJobsCount ? `${liveJobsCount} live job${liveJobsCount === 1 ? '' : 's'} loaded` : 'Prepared evidence reloaded for matching',
        jobsTiming ? formatDuration(jobsTiming.duration_ms) : '',
      ].filter(Boolean).join(' • ') || PROGRESS_STAGES[4].helper, jobsTiming?.status === 'failed' ? 'failed' : (response ? 'done' : ''));
    }

    const openAiTiming = timingByStage.openai;
    if (response || openAiTiming) {
      const model = response?.analysis_meta?.model || '';
      setStageDetail(5, [
        model ? `Model ${model}` : 'Structured recruiter analysis',
        openAiTiming ? formatDuration(openAiTiming.duration_ms) : '',
      ].filter(Boolean).join(' • '), openAiTiming?.status === 'failed' ? 'failed' : (response ? 'done' : ''));
    }

    const historyTiming = timingByStage.history_save;
    if (response || error) {
      const renderBits = [];
      if (response?.saved_to_history === true) {
        renderBits.push('Results rendered and private history saved');
      } else if (response) {
        renderBits.push('Results rendered');
      }
      if (historyTiming) renderBits.push(formatDuration(historyTiming.duration_ms));
      if (diagnostics?.failed_stage && !response) {
        renderBits.push(`Failed at ${diagnostics.failed_stage}`);
      }
      setStageDetail(6, renderBits.filter(Boolean).join(' • ') || PROGRESS_STAGES[6].helper, historyTiming?.status === 'failed' ? 'failed' : (response ? 'done' : ''));
    }
  }

  function buildTokenList(items, fallback) {
    const values = safeArray(items);
    if (!values.length) {
      return fallback ? `<p class="muted">${escapeHtml(fallback)}</p>` : '';
    }
    return `<div class="token-list">${values.map((item) => `<span class="token">${escapeHtml(item)}</span>`).join('')}</div>`;
  }

  function buildBulletList(items, fallback) {
    const values = safeArray(items);
    if (!values.length) return `<p class="muted">${escapeHtml(fallback)}</p>`;
    return `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }

  function buildMetricCard(label, value, note) {
    return `
      <article class="metric-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value || '—')}</strong>
        <p>${escapeHtml(note || '')}</p>
      </article>
    `;
  }

  function buildSummaryCard(label, value, tokens) {
    return `
      <article class="summary-card">
        <strong>${escapeHtml(label)}</strong>
        <p>${escapeHtml(value || 'No clear signal returned.')}</p>
        ${buildTokenList(tokens, '')}
      </article>
    `;
  }

  function setWorkflowStep(element, textElement, stateClass, text) {
    if (!element || !textElement) return;
    element.className = `workflow-step ${stateClass || ''}`.trim();
    textElement.textContent = text;
  }

  function updateWorkflowState() {
    const prepared = state.preparedRun;
    const ready = !!prepared?.ready_for_match;
    const hasResult = !!prepared?.has_result;
    const hasFailure = !!prepared?.error_message && !hasResult;
    const inProgress = isMatchJobActive(prepared);

    if (!prepared) {
      setWorkflowStep(
        elements.workflowStepPrepare,
        elements.workflowStepPrepareText,
        'active',
        'Upload and extract candidate evidence, then save a reusable private preparation record.'
      );
      setWorkflowStep(
        elements.workflowStepMatch,
        elements.workflowStepMatchText,
        '',
        'Reuse prepared evidence to compare the candidate against the current live HMJ roles.'
      );
      return;
    }

    setWorkflowStep(
      elements.workflowStepPrepare,
      elements.workflowStepPrepareText,
      ready ? 'ready' : 'warn',
      ready
        ? 'Prepared evidence is stored privately and ready to be reused without uploading again.'
        : 'Prepared evidence was saved, but recruiter review is still needed before matching.'
    );
    setWorkflowStep(
      elements.workflowStepMatch,
      elements.workflowStepMatchText,
      hasResult ? 'ready' : (inProgress ? 'active' : (ready ? (hasFailure ? 'warn' : 'active') : '')),
      hasResult
        ? 'A match result has been saved for this prepared evidence and can be reopened at any time.'
        : inProgress
          ? 'The background recruiter analysis is active. Results will load automatically when ready.'
        : hasFailure
          ? 'Matching can be retried from the saved evidence without re-parsing the files.'
          : ready
            ? 'Run the recruiter match now using the prepared evidence snapshot.'
            : 'Matching stays unavailable until at least one readable text document is prepared.'
    );
  }

  function syncCopyActionState() {
    const hasResult = !!state.latestResultPayload;
    if (elements.copyCandidateSummaryButton) elements.copyCandidateSummaryButton.disabled = !hasResult;
    if (elements.copyTopMatchButton) elements.copyTopMatchButton.disabled = !hasResult;
    if (elements.copyFollowUpsButton) elements.copyFollowUpsButton.disabled = !hasResult;
  }

  function setBusy(isBusy) {
    state.busy = !!isBusy;
    if (elements.app) {
      elements.app.setAttribute('aria-busy', state.busy ? 'true' : 'false');
    }
    if (elements.analyseButton) elements.analyseButton.disabled = state.busy;
    elements.pickFilesButton.disabled = state.busy;
    elements.clearFilesButton.disabled = state.busy;
    elements.fileInput.disabled = state.busy;
    if (elements.saveHistory) elements.saveHistory.disabled = state.busy;
    elements.recruiterNotes.disabled = state.busy;
    if (elements.retryAnalysisButton) elements.retryAnalysisButton.disabled = state.busy;
    if (elements.removeProblemFilesButton) elements.removeProblemFilesButton.disabled = state.busy;
    if (elements.clearProblemFilesButton) elements.clearProblemFilesButton.disabled = state.busy;
    if (elements.prepareEvidenceButton) elements.prepareEvidenceButton.disabled = state.busy;
    if (elements.runMatchButton) elements.runMatchButton.disabled = state.busy;
    if (elements.retryMatchButton) elements.retryMatchButton.disabled = state.busy;
    syncCopyActionState();
  }

  function renderStageList(activeIndex, complete, failedIndex) {
    elements.stageList.innerHTML = PROGRESS_STAGES.map((stage, index) => {
      const isFailed = failedIndex === index;
      const stageStatus = state.progressStageStatus[index];
      const stateClass = isFailed
        ? 'failed'
        : complete
          ? 'complete'
          : activeIndex === index
            ? 'current'
            : activeIndex > index
              ? 'complete'
              : '';
      const stateLabel = isFailed
        ? '<span class="stage-state bad">Failed</span>'
        : complete || activeIndex > index
        ? '<span class="stage-state ok">Done</span>'
        : activeIndex === index
          ? '<span class="stage-state">Working</span>'
          : '<span class="stage-state">Pending</span>';
      return `
        <li class="stage ${stateClass}">
          ${stateLabel}
          <strong>${escapeHtml(stage.label)}</strong>
          <small>${escapeHtml(stage.helper)}</small>
          <span class="stage-detail ${escapeHtml(stageStatus)}">${escapeHtml(state.progressStageDetails[index] || stage.helper)}</span>
        </li>
      `;
    }).join('');
  }

  function setProgress(statusText, detailText, activeIndex, complete, failedIndex, percent) {
    elements.analysisStatus.textContent = statusText;
    elements.progressText.textContent = detailText;
    state.progressIndex = Number.isFinite(activeIndex) ? activeIndex : -1;
    state.progressFailureIndex = Number.isFinite(failedIndex) ? failedIndex : -1;
    state.progressPercent = Number.isFinite(percent)
      ? Math.max(0, Math.min(100, Math.round(percent)))
      : progressPercentForStage(state.progressIndex, state.progressFailureIndex >= 0);
    if (elements.progressFill) {
      elements.progressFill.style.width = `${state.progressPercent}%`;
    }
    if (elements.progressPercent) {
      elements.progressPercent.textContent = `${state.progressPercent}%`;
    }
    if (elements.progressStageDetail) {
      const detail = Number.isFinite(state.progressIndex) && state.progressIndex >= 0
        ? state.progressStageDetails[state.progressIndex] || PROGRESS_STAGES[state.progressIndex].helper
        : 'Waiting to begin';
      elements.progressStageDetail.textContent = detail;
    }
    renderStageList(state.progressIndex, !!complete, state.progressFailureIndex);
  }

  function startProgress() {
    resetProgressState();
    setStageDetail(0, 'Checking the current queue and recruiter notes.', 'working');
    setProgress('Preparing candidate analysis', PROGRESS_STAGES[0].message, 0, false, -1, 4);
  }

  function stopProgress() {
    return undefined;
  }

  function stageIndexForKey(key) {
    return Object.prototype.hasOwnProperty.call(STAGE_INDEX_BY_KEY, key)
      ? STAGE_INDEX_BY_KEY[key]
      : -1;
  }

  function buildFailureProgress(error) {
    const stageKey = String(error?.details?.stage || '').toLowerCase();
    const failureIndex = stageIndexForKey(stageKey);
    const stageLabel = error?.details?.stage_label || '';
    const timeoutMs = Number(error?.details?.timeout_ms) || 0;
    const durationMs = Number(error?.details?.stage_duration_ms) || 0;
    const bits = [];
    if (stageLabel) bits.push(`${stageLabel} failed.`);
    if (timeoutMs) bits.push(`Timeout limit ${Math.round(timeoutMs / 1000)}s.`);
    if (durationMs) bits.push(`Stage ran for ${(durationMs / 1000).toFixed(1)}s.`);
    if (!bits.length) bits.push(error?.message || 'The matcher could not complete this run.');
    return {
      failureIndex: failureIndex >= 0 ? failureIndex : Math.max(state.progressIndex, 1),
      detail: bits.join(' '),
      percent: progressPercentForStage(failureIndex >= 0 ? failureIndex : Math.max(state.progressIndex, 1), true),
    };
  }

  function callMatcherApi(path, body) {
    let timer = null;
    return Promise.race([
      state.helpers.api(path, 'POST', body),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => {
          const error = new Error(`The matcher did not return within ${Math.round(CLIENT_REQUEST_TIMEOUT_MS / 1000)} seconds.`);
          error.details = {
            stage: 'server_wait',
            stage_label: 'Await server response',
            timeout_ms: CLIENT_REQUEST_TIMEOUT_MS,
          };
          reject(error);
        }, CLIENT_REQUEST_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timer) window.clearTimeout(timer);
    });
  }

  function renderQueueSummary() {
    if (!state.files.length) {
      elements.queueSummary.innerHTML = `
        <span class="metric-badge">Queue empty</span>
        <span class="muted">Add candidate files to review them before analysis.</span>
      `;
      return;
    }

    const totalBytes = state.files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    const limitedCount = state.files.filter((file) => LIMITED_EXTENSIONS.has(classifyClientFile(file).extension)).length;
    const imageCount = state.files.filter((file) => IMAGE_EXTENSIONS.has(classifyClientFile(file).extension)).length;
    elements.queueSummary.innerHTML = `
      <span class="metric-badge">${escapeHtml(pluralise(state.files.length, 'file'))}</span>
      <span class="metric-badge">${escapeHtml(formatSize(totalBytes))} total</span>
      ${limitedCount ? `<span class="metric-badge">${escapeHtml(pluralise(limitedCount, 'limited DOC file'))}</span>` : ''}
      ${imageCount ? `<span class="metric-badge">${escapeHtml(pluralise(imageCount, 'image evidence file'))}</span>` : ''}
      <span class="muted">Review the queue, remove anything unnecessary, then run the matcher.</span>
    `;
  }

  function renderFileQueue() {
    renderQueueSummary();

    if (!state.files.length) {
      elements.fileList.innerHTML = `
        <div class="empty-state">
          <strong>No candidate documents queued yet</strong>
          <p>Add a CV or resume plus any relevant supporting documents to start a structured comparison against HMJ live roles.</p>
        </div>
      `;
      return;
    }

    elements.fileList.innerHTML = state.files.map((file, index) => {
      const classification = classifyClientFile(file);
      const extension = classification.extension || 'file';
      const isLegacyDoc = classification.fileKind === 'doc';
      const isImageEvidence = classification.fileKind === 'image';
      const diagnostic = state.fileDiagnostics.get(fileKey(file));
      const updatedLabel = file.lastModified ? `Updated ${formatDateTime(file.lastModified)}` : 'Ready for analysis';
      const extractionStatus = diagnostic?.status || (isImageEvidence ? 'image_only' : (isLegacyDoc ? 'limited' : 'ready'));
      const extractionLabel = extractionStatusLabel(extractionStatus);
      const extractionMessage = diagnostic?.error || classification.warning || (extractionStatus === 'ready' ? 'Ready for extraction in Step 1.' : '');
      const statusPills = [
        `<span class="file-pill">${escapeHtml(updatedLabel)}</span>`,
        `<span class="file-pill">${escapeHtml(classification.eligibility)}</span>`,
      ];
      statusPills.push(`<span class="file-pill ${escapeHtml(extractionStatus === 'ready' ? 'ok' : extractionStatus)}">${escapeHtml(extractionLabel)}</span>`);
      return `
        <article class="file-card">
          <div class="file-icon" aria-hidden="true">${escapeHtml(extension.toUpperCase())}</div>
          <div class="file-meta">
            <div>
              <strong>${escapeHtml(file.name)}</strong>
              <div class="file-meta-line">${escapeHtml(formatSize(file.size))} • ${escapeHtml(file.type || extension.toUpperCase())}</div>
            </div>
            <div class="file-pill-row">
              ${statusPills.join('')}
            </div>
            ${extractionMessage ? `<div class="file-meta-line">${escapeHtml(extractionMessage)}</div>` : ''}
          </div>
          <button class="file-remove" type="button" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">Remove</button>
        </article>
      `;
    }).join('');

    elements.fileList.querySelectorAll('[data-remove-file]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.getAttribute('data-remove-file'));
        const removed = state.files[index];
        state.files.splice(index, 1);
        if (removed) void removeQueuedFileFromStore(removed);
        resetPreparedState();
        renderFileQueue();
      });
    });
  }

  function renderWarnings(warnings) {
    const items = safeArray(warnings).filter((warning) => warning && warning.message);
    if (!items.length) {
      elements.warningShell.hidden = true;
      elements.warningList.innerHTML = '';
      if (elements.warningActions) elements.warningActions.hidden = true;
      if (elements.warningNote) {
        elements.warningNote.textContent = 'Warnings here do not always invalidate the run; they highlight files or steps that need recruiter attention.';
      }
      return;
    }

    elements.warningShell.hidden = false;
    elements.warningList.innerHTML = items.map((warning) => `
      <article class="warning-card ${escapeHtml(String(warning.status || '').toLowerCase())}">
        <strong>${escapeHtml(warning.file || warning.status || 'Notice')}</strong>
        <div class="file-pill-row">
          ${warning.status ? `<span class="file-pill ${escapeHtml(String(warning.status).toLowerCase())}">${escapeHtml(extractionStatusLabel(warning.status))}</span>` : ''}
        </div>
        <div class="muted">${escapeHtml(warning.message)}</div>
      </article>
    `).join('');
    if (elements.warningActions) {
      elements.warningActions.hidden = false;
    }
  }

  function renderWarningActions(hasFailure) {
    if (!elements.warningActions) return;
    elements.warningActions.hidden = elements.warningShell.hidden;
    if (elements.warningNote) {
      elements.warningNote.textContent = hasFailure
        ? 'Retry after removing the problematic file, or re-upload legacy formats as PDF where possible.'
        : 'Warnings here do not always invalidate the run; they highlight files or steps that need recruiter attention.';
    }
    if (elements.removeProblemFilesButton) {
      const removable = state.problemFileKeys.size > 0;
      elements.removeProblemFilesButton.hidden = !removable;
      elements.removeProblemFilesButton.textContent = removable
        ? `Remove problematic file${state.problemFileKeys.size === 1 ? '' : 's'}`
        : 'Remove problematic files';
    }
  }

  function renderRunDiagnostics(diagnostics) {
    state.runDiagnostics = diagnostics || null;
    const data = state.runDiagnostics;
    if (!data) {
      elements.runDiagnosticsList.innerHTML = `
        <div class="ops-item">
          <strong>No run diagnostics yet</strong>
          <p>The next analysis will populate elapsed time, file counts, stage timings, and any failure stage.</p>
        </div>
      `;
      return;
    }

    const failedStage = data.failed_stage || 'Completed successfully';
    const warningCount = Number(data.warning_count) || 0;
    elements.runDiagnosticsList.innerHTML = [
      { label: 'Run started', value: formatDateTime(data.started_at), note: 'Browser session timestamp for this matcher run.' },
      { label: 'Elapsed time', value: formatDuration(data.total_elapsed_ms), note: 'Total client-visible elapsed time.' },
      { label: 'Files attempted', value: pluralise(Number(data.files_attempted) || 0, 'file'), note: 'Files included in the request.' },
      { label: 'Text-read files', value: pluralise(Number(data.files_text_read) || 0, 'file'), note: 'Documents that produced readable candidate text.' },
      { label: 'Skipped / limited', value: pluralise(Number(data.files_skipped) || 0, 'file'), note: 'Image-only, limited, unsupported, or failed files.' },
      { label: 'Failed stage', value: failedStage, note: warningCount ? `${warningCount} warning${warningCount === 1 ? '' : 's'} returned.` : 'No warnings returned.' },
    ].map((item) => `
      <div class="ops-item">
        <strong>${escapeHtml(item.label)}</strong>
        <p>${escapeHtml(item.value)}</p>
        <p class="muted">${escapeHtml(item.note)}</p>
      </div>
    `).join('');
    persistSessionSnapshot();
  }

  function buildRunDiagnosticsFromPreparedRun(run, extra) {
    const prepared = run?.prepared_evidence || {};
    const skipped = (prepared.limited_count || 0)
      + (prepared.unsupported_count || 0)
      + (prepared.failed_count || 0);
    const overrides = extra && typeof extra === 'object' ? extra : {};
    const warningCount = Number.isFinite(Number(overrides.warning_count))
      ? Number(overrides.warning_count)
      : skipped;

    return {
      started_at: overrides.started_at || run?.match_job?.started_at || run?.match_job?.queued_at || run?.updated_at || run?.created_at || '',
      total_elapsed_ms: Number.isFinite(Number(overrides.total_elapsed_ms)) ? Number(overrides.total_elapsed_ms) : 0,
      files_attempted: Number(prepared.files_attempted) || 0,
      files_text_read: Number(prepared.files_text_read) || 0,
      files_skipped: skipped,
      warning_count: warningCount,
      failed_stage: overrides.failed_stage || run?.match_job?.stage_label || '',
    };
  }

  function renderJobStatus(run) {
    if (!elements.jobStatusList) return;
    const job = currentMatchJob(run);
    if (!job || !job.id) {
      elements.jobStatusList.innerHTML = `
        <div class="ops-item">
          <strong>No active match job</strong>
          <p>Prepared evidence can be queued for background recruiter analysis when you are ready.</p>
        </div>
      `;
      return;
    }

    const status = String(job.status || '').toLowerCase();
    const startedAt = job.started_at || job.queued_at || '';
    const lastUpdate = job.completed_at || job.failed_at || job.started_at || job.queued_at || run?.updated_at || '';
    const stageLabel = matchJobStageLabel(job.stage, job.stage_label);
    elements.jobStatusList.innerHTML = [
      {
        label: 'Current job state',
        value: matchJobStatusLabel(status),
        note: status === 'queued'
          ? 'Waiting for the background matcher worker to start.'
          : status === 'running'
            ? 'OpenAI recruiter analysis is running in the background.'
            : status === 'completed'
              ? 'The latest background matcher job completed successfully.'
              : 'The latest background matcher job failed and can be retried.',
      },
      {
        label: 'Current sub-stage',
        value: stageLabel,
        note: job.stage_updated_at ? `Updated ${elapsedSince(job.stage_updated_at)} ago.` : 'Live progress from the background matcher worker.',
      },
      { label: 'Current job id', value: job.id, note: 'Use this when checking logs for a specific async run.' },
      { label: 'Started / queued', value: formatDateTime(startedAt), note: `Elapsed: ${elapsedSince(startedAt)}` },
      { label: 'Last update', value: formatDateTime(lastUpdate), note: run?.best_match_job_title ? `Best role: ${run.best_match_job_title}` : (run?.error_message || job.last_error || 'No result saved yet.') },
    ].map((item) => `
      <div class="ops-item">
        <strong>${escapeHtml(item.label)}</strong>
        <p>${escapeHtml(item.value || '—')}</p>
        <p class="muted">${escapeHtml(item.note || '')}</p>
      </div>
    `).join('');
  }

  function stopMatchPolling() {
    if (state.matchPollTimer) {
      window.clearTimeout(state.matchPollTimer);
      state.matchPollTimer = 0;
    }
  }

  function renderEvidenceDocumentList(items, fallback) {
    const documents = safeArray(items);
    if (!documents.length) {
      return `
        <div class="empty-state compact">
          <strong>${escapeHtml(fallback)}</strong>
        </div>
      `;
    }

    return documents.map((document) => `
      <article class="evidence-card">
        <div class="evidence-card-head">
          <strong>${escapeHtml(document.name || document.original_filename || 'Candidate file')}</strong>
          <span class="file-pill ${escapeHtml(String(document.status || document.extraction_status || '').toLowerCase())}">${escapeHtml(extractionStatusLabel(document.status || document.extraction_status || 'queued'))}</span>
        </div>
        <div class="file-meta-line">${escapeHtml(document.sizeLabel || formatSize(document.size || document.file_size_bytes || 0))} • ${escapeHtml(document.contentType || document.mime_type || document.extension || 'File')}</div>
        ${document.error || document.extraction_error ? `<div class="file-meta-line">${escapeHtml(document.error || document.extraction_error)}</div>` : ''}
      </article>
    `).join('');
  }

  function updateMatchActionState() {
    const prepared = state.preparedRun;
    const ready = !!prepared?.ready_for_match;
    const hasResult = !!prepared?.has_result;
    const hasFailure = !!prepared?.error_message && !hasResult;
    const inProgress = isMatchJobActive(prepared);
    if (elements.preparedStateChip) {
      if (!prepared) {
        elements.preparedStateChip.textContent = 'No prepared evidence';
        elements.preparedStateChip.className = 'chip warn';
      } else if (ready) {
        elements.preparedStateChip.textContent = hasResult ? 'Prepared and matched' : 'Prepared and match-ready';
        elements.preparedStateChip.className = 'chip ok';
      } else {
        elements.preparedStateChip.textContent = 'Prepared but not match-ready';
        elements.preparedStateChip.className = 'chip warn';
      }
    }
    if (elements.runMatchButton) {
      elements.runMatchButton.hidden = !ready || hasFailure || inProgress;
      elements.runMatchButton.disabled = state.busy || !ready || inProgress;
    }
    if (elements.retryMatchButton) {
      elements.retryMatchButton.hidden = !ready || !hasFailure || inProgress;
      elements.retryMatchButton.disabled = state.busy || !ready || inProgress;
    }
    updateWorkflowState();
  }

  function renderPreparedEvidence(run) {
    state.preparedRun = run || null;
    if (!elements.preparedEvidenceShell) return;

    if (!run) {
      elements.preparedEvidenceShell.hidden = false;
      elements.preparedEvidenceMeta.textContent = 'Prepare evidence to review extracted text, image evidence, and file readiness before running the recruiter match.';
      elements.preparedEvidenceSummary.innerHTML = `
        <div class="empty-state">
          <strong>No prepared evidence yet</strong>
          <p>Step 1 will parse readable documents, classify supporting images, and save a private evidence record that can be reused if matching fails.</p>
        </div>
      `;
      elements.preparedTextList.innerHTML = '';
      elements.preparedImageList.innerHTML = '';
      elements.preparedLimitedList.innerHTML = '';
      elements.preparedFailedList.innerHTML = '';
      renderJobStatus(null);
      updateMatchActionState();
      return;
    }

    const prepared = run.prepared_evidence || {};
    const candidateName = run.candidate_name || prepared.inferred_candidate_name || 'Candidate not confidently identified';
    const warningCount = (prepared.failed_count || 0) + (prepared.limited_count || 0) + (prepared.unsupported_count || 0);
    const matchReadyLabel = run.ready_for_match ? 'Ready for matching' : 'Review required before matching';
    const matchedLabel = run.has_result ? 'Latest result saved on this prepared evidence.' : 'No match run has been completed yet.';
    elements.preparedEvidenceShell.hidden = false;
    elements.preparedEvidenceMeta.textContent = `${matchReadyLabel}. ${matchedLabel}`;
    elements.preparedEvidenceSummary.innerHTML = `
      <div class="prepared-highlight">
        <div class="section-head" style="margin-bottom:0">
          <div>
            <p class="eyebrow">Prepared candidate</p>
            <h3>${escapeHtml(candidateName)}</h3>
          </div>
          <div class="chip-list">
            <span class="chip ${run.ready_for_match ? 'ok' : 'warn'}">${escapeHtml(matchReadyLabel)}</span>
            <span class="chip">${escapeHtml(formatDateTime(run.updated_at || run.created_at))}</span>
          </div>
        </div>
        <p>${escapeHtml(prepared.preview_text || 'No readable candidate text preview is available for this prepared run yet.')}</p>
      </div>
      <div class="results-summary-strip">
        ${buildMetricCard('Text-read files', String(prepared.files_text_read || 0), 'Readable CV / text evidence')}
        ${buildMetricCard('Image evidence', String(prepared.image_evidence_count || 0), 'Supporting image-only files')}
        ${buildMetricCard('Warnings', String(warningCount), 'Limited, unsupported, or failed files')}
        ${buildMetricCard('Evidence text', `${Number(prepared.combined_text_length || 0).toLocaleString()} chars`, run.error_message || 'Prepared privately for reruns')}
      </div>
    `;
    elements.preparedTextList.innerHTML = renderEvidenceDocumentList(prepared.text_files, 'No text-readable files were extracted.');
    elements.preparedImageList.innerHTML = renderEvidenceDocumentList(prepared.image_evidence_files, 'No supporting image evidence files were included.');
    elements.preparedLimitedList.innerHTML = renderEvidenceDocumentList(
      safeArray(prepared.limited_files).concat(safeArray(prepared.unsupported_files)),
      'No limited or unsupported files in this prepared evidence set.'
    );
    elements.preparedFailedList.innerHTML = renderEvidenceDocumentList(prepared.failed_files, 'No extraction failures in this prepared evidence set.');
    renderJobStatus(run);
    if (!state.runDiagnostics || (!Number(state.runDiagnostics.files_attempted) && Number(prepared.files_attempted) > 0)) {
      renderRunDiagnostics(buildRunDiagnosticsFromPreparedRun(run));
    }
    persistSessionSnapshot();
    updateMatchActionState();
  }

  function resetPreparedState() {
    stopMatchPolling();
    state.preparedRun = null;
    clearPersistedResultState();
    renderPreparedEvidence(null);
    renderEmptyResults();
    updateMatchActionState();
  }

  function updateDiagnosticsFromDocuments(documents, hasFailure) {
    const map = new Map();
    const problemKeys = new Set();
    safeArray(documents).forEach((document) => {
      const key = fileKey({ name: document.name || document.file, size: document.size || document.declared_size_bytes });
      if (key !== '::0') {
        map.set(key, document);
        if (String(document.status || '').toLowerCase() !== 'ok') {
          problemKeys.add(key);
        }
      }
    });
    state.fileDiagnostics = map;
    state.problemFileKeys = hasFailure ? problemKeys : new Set();
    renderFileQueue();
  }

  function renderMatch(match, index, options) {
    const featured = !!options?.featured;
    const headerLabel = options?.label || `Rank ${index + 1}`;
    return `
      <article class="match-card ${featured ? 'featured' : ''}">
        <div class="match-head">
          <div class="match-rank" aria-hidden="true">${escapeHtml(featured ? 'TOP' : String(index + 1))}</div>
          <div class="match-title-block">
            <div class="token-list">
              <span class="token">${escapeHtml(headerLabel)}</span>
              <span class="recommendation ${escapeHtml(match.recommendation)}">${escapeHtml(recommendationLabel(match.recommendation))}</span>
            </div>
            <h3>${escapeHtml(match.job_title || 'Untitled role')}</h3>
            <p>${escapeHtml(match.why_match || 'No rationale returned for this role.')}</p>
          </div>
          <div class="match-metrics">
            <div class="score-badge">
              <strong>${escapeHtml(String(Math.round(Number(match.score) || 0)))}</strong>
              <span>Match score</span>
            </div>
          </div>
        </div>

        <div class="match-grid">
          <section class="subsection">
            <h4>Matched strengths</h4>
            ${buildTokenList(safeArray(match.matched_skills).concat(safeArray(match.matched_qualifications)), 'No direct strengths were called out.')}
          </section>
          <section class="subsection">
            <h4>Transferable experience</h4>
            ${buildBulletList(match.transferable_experience, 'No transferable experience was highlighted.')}
          </section>
          <section class="subsection">
            <h4>Key gaps</h4>
            ${buildBulletList(match.gaps, 'No critical gaps were highlighted.')}
          </section>
          <section class="subsection">
            <h4>Follow-up questions</h4>
            ${buildBulletList(match.follow_up_questions, 'No follow-up questions were suggested.')}
          </section>
        </div>

        <section class="subsection">
          <h4>Uncertainty</h4>
          <p class="muted">${escapeHtml(match.uncertainty_notes || 'No additional uncertainty note was returned for this role.')}</p>
        </section>
      </article>
    `;
  }

  function renderEmptyResults() {
    state.latestResultPayload = null;
    state.latestResultMeta = null;
    elements.resultsEmptyState.hidden = false;
    elements.resultsContent.hidden = true;
    elements.resultsMeta.textContent = 'No analysis has been run yet. Results will appear here once a candidate is processed.';
    elements.resultsSummaryStrip.innerHTML = '';
    elements.overallRecommendation.innerHTML = '';
    elements.candidateNarrative.innerHTML = '';
    elements.candidateSummaryGrid.innerHTML = '';
    elements.topMatchShell.hidden = true;
    elements.topMatchFeature.innerHTML = '';
    elements.topMatchesList.innerHTML = '';
    elements.otherMatchesList.innerHTML = '';
    elements.noStrongMatchNotice.hidden = true;
    elements.noStrongMatchNotice.innerHTML = '';
    renderRunDiagnostics(null);
    syncCopyActionState();
    persistSessionSnapshot();
  }

  function renderResult(resultPayload, meta) {
    const result = resultPayload || {};
    const summary = result.candidate_summary || {};
    const topMatches = safeArray(result.top_matches);
    const otherMatches = safeArray(result.other_matches);
    const followUps = safeArray(result.general_follow_up_questions);
    const featured = topMatches[0] || null;
    const additionalTopMatches = featured ? topMatches.slice(1) : topMatches;
    const liveJobsValue = meta?.liveJobsCount == null ? '—' : String(meta.liveJobsCount);
    const topScore = featured ? `${Math.round(Number(featured.score) || 0)}%` : '—';
    const topRecommendation = featured ? recommendationLabel(featured.recommendation) : (result.no_strong_match_reason ? 'No strong match' : 'Pending');
    const warningCount = Number(meta?.warningCount) || 0;
    const modelLabel = meta?.model || 'OpenAI';
    setLatestResult(result, meta || null);

    elements.resultsEmptyState.hidden = true;
    elements.resultsContent.hidden = false;
    elements.resultsMeta.textContent = `Analysed against ${liveJobsValue} published live job${liveJobsValue === '1' ? '' : 's'} using ${modelLabel}.`;
    elements.resultsSummaryStrip.innerHTML = [
      buildMetricCard('Best match role', featured?.job_title || 'No strong match', featured ? 'Highest-ranked live role' : 'No lead match returned'),
      buildMetricCard('Top score', topScore, featured ? topRecommendation : 'No scored top match'),
      buildMetricCard('Roles assessed', liveJobsValue, 'Published + live jobs only'),
      buildMetricCard('Warnings', String(warningCount), meta?.historyNote || 'Extraction or match warnings returned'),
    ].join('');

    elements.overallRecommendation.innerHTML = `
      <strong>Overall recruiter recommendation</strong>
      <p>${escapeHtml(result.overall_recommendation || 'No overall recommendation returned.')}</p>
      ${followUps.length ? `
        <div class="subsection" style="margin-top:12px">
          <h4>General follow-up questions</h4>
          ${buildBulletList(followUps, '')}
        </div>
      ` : ''}
    `;

    elements.candidateNarrative.innerHTML = `
      <div class="narrative-head">
        <div>
          <p class="eyebrow">Candidate summary</p>
          <h3>${escapeHtml(summary.name || 'Candidate name not confidently identified')}</h3>
          <p>${escapeHtml(summary.summary || 'No concise recruiter summary was returned for the candidate.')}</p>
        </div>
        <div class="token-list">
          ${summary.current_or_recent_title ? `<span class="token">${escapeHtml(summary.current_or_recent_title)}</span>` : ''}
          ${summary.seniority_level ? `<span class="token">${escapeHtml(summary.seniority_level)}</span>` : ''}
          ${summary.primary_discipline ? `<span class="token">${escapeHtml(summary.primary_discipline)}</span>` : ''}
        </div>
      </div>
      ${buildTokenList(safeArray(summary.sectors).concat(safeArray(summary.locations)), '')}
    `;

    elements.candidateSummaryGrid.innerHTML = [
      buildSummaryCard('Key skills', safeArray(summary.key_skills).join(', ') || 'No key skills were extracted into the structured summary.', summary.key_skills),
      buildSummaryCard('Key qualifications', safeArray(summary.key_qualifications).join(', ') || 'No key qualifications were extracted into the structured summary.', summary.key_qualifications),
      buildSummaryCard('Sectors', safeArray(summary.sectors).join(', ') || 'No sector evidence was highlighted.', summary.sectors),
      buildSummaryCard('Locations', safeArray(summary.locations).join(', ') || 'No clear location evidence was highlighted.', summary.locations),
    ].join('');

    if (featured) {
      elements.topMatchShell.hidden = false;
      elements.topMatchFeature.innerHTML = renderMatch(featured, 0, { featured: true, label: 'Best current fit' });
    } else {
      elements.topMatchShell.hidden = true;
      elements.topMatchFeature.innerHTML = '';
    }

    elements.topMatchesList.innerHTML = additionalTopMatches.length
      ? additionalTopMatches.map((match, index) => renderMatch(match, index + 1, { label: `Rank ${index + 2}` })).join('')
      : `
        <div class="empty-state">
          <strong>No additional shortlist or maybe roles</strong>
          <p>The matcher did not surface further high-confidence live roles beyond the lead result.</p>
        </div>
      `;

    elements.otherMatchesList.innerHTML = otherMatches.length
      ? otherMatches.map((match, index) => renderMatch(match, index + topMatches.length, { label: `Other ${index + 1}` })).join('')
      : `
        <div class="empty-state">
          <strong>No lower-ranked roles returned</strong>
          <p>No additional live roles were considered relevant enough to include as secondary options.</p>
        </div>
      `;

    if (result.no_strong_match_reason) {
      elements.noStrongMatchNotice.hidden = false;
      elements.noStrongMatchNotice.innerHTML = `
        <strong>No strong current match</strong>
        <p>${escapeHtml(result.no_strong_match_reason)}</p>
      `;
    } else {
      elements.noStrongMatchNotice.hidden = true;
      elements.noStrongMatchNotice.innerHTML = '';
    }
    syncCopyActionState();
    persistSessionSnapshot();
  }

  function summariseHistoryFiles(fileNames) {
    const items = safeArray(fileNames);
    if (!items.length) return 'No saved file metadata';
    if (items.length <= 2) return items.join(', ');
    return `${items.slice(0, 2).join(', ')} +${items.length - 2} more`;
  }

  function renderHistory(runs, enabled) {
    const items = safeArray(runs);

    if (!enabled) {
      elements.historyChip.textContent = 'History not configured';
      elements.historyChip.className = 'chip warn';
      elements.historyList.innerHTML = `
        <div class="empty-state">
          <strong>Private history is not configured yet</strong>
          <p>The analysis UI works, but saved matcher history is unavailable until the Supabase history tables are enabled for this environment.</p>
        </div>
      `;
      return;
    }

    if (!items.length) {
      elements.historyChip.textContent = 'No saved runs yet';
      elements.historyChip.className = 'chip warn';
      elements.historyList.innerHTML = `
        <div class="empty-state">
          <strong>No saved matcher runs yet</strong>
          <p>Saved candidate analyses will appear here for quick re-open and recruiter review.</p>
        </div>
      `;
      return;
    }

    elements.historyChip.textContent = `${items.length} saved run${items.length === 1 ? '' : 's'}`;
    elements.historyChip.className = 'chip ok';
    elements.historyList.innerHTML = items.map((run) => `
      <article class="history-card">
        <div class="history-top">
          <div>
            <strong>${escapeHtml(run.candidate_name || 'Unnamed candidate')}</strong>
            <p>${escapeHtml(run.best_match_job_title || 'No top match saved')} ${run.best_match_score != null ? `• ${Math.round(run.best_match_score)}%` : ''}</p>
          </div>
          <div class="history-meta">
            <span class="history-tag">${escapeHtml(formatDateTime(run.created_at))}</span>
            <span class="history-tag">${escapeHtml(run.status || 'completed')}</span>
            ${run.current_or_recent_title ? `<span class="history-tag">${escapeHtml(run.current_or_recent_title)}</span>` : ''}
          </div>
        </div>
        <div class="history-files">
          <span class="history-tag">${escapeHtml(summariseHistoryFiles(run.file_names))}</span>
          ${run.primary_discipline ? `<span class="history-tag">${escapeHtml(run.primary_discipline)}</span>` : ''}
          ${run.ready_for_match && !run.has_result ? '<span class="history-tag">Prepared only</span>' : ''}
        </div>
        <button class="btn history-action" type="button" data-history-id="${escapeHtml(run.id)}">${escapeHtml(run.has_result ? 'Open saved result' : 'Use prepared evidence')}</button>
      </article>
    `).join('');

    elements.historyList.querySelectorAll('[data-history-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.getAttribute('data-history-id');
        const run = state.historyRuns.find((item) => item.id === id);
        const payload = run && run.raw_result_json && run.raw_result_json.result ? run.raw_result_json.result : null;
        renderPreparedEvidence(run);
        if (isMatchJobActive(run)) {
          scheduleMatchPolling(run.id, { silentComplete: true });
        } else {
          stopMatchPolling();
        }
        const diagnostics = {
          started_at: run.updated_at || run.created_at,
          total_elapsed_ms: 0,
          files_attempted: run.prepared_evidence?.files_attempted || 0,
          files_text_read: run.prepared_evidence?.files_text_read || 0,
          files_skipped: (run.prepared_evidence?.limited_count || 0) + (run.prepared_evidence?.unsupported_count || 0) + (run.prepared_evidence?.failed_count || 0),
          warning_count: (run.prepared_evidence?.failed_count || 0) + (run.prepared_evidence?.limited_count || 0),
          failed_stage: run.error_message ? 'Previous match failed' : '',
        };
        if (payload) {
          renderRunDiagnostics(diagnostics);
          renderWarnings([]);
          renderResult(payload, {
            liveJobsCount: 'saved',
            model: 'saved result',
            savedToHistory: true,
            warningCount: diagnostics.warning_count,
            historyNote: summariseHistoryFiles(run.file_names),
          });
          window.scrollTo({ top: elements.resultsShell.offsetTop - 80, behavior: 'smooth' });
          return;
        }
        renderEmptyResults();
        renderRunDiagnostics(diagnostics);
        state.helpers.toast.ok('Prepared evidence loaded. You can run or retry the recruiter match without uploading again.', 3600);
        window.scrollTo({ top: elements.preparedEvidenceShell.offsetTop - 80, behavior: 'smooth' });
      });
    });
  }

  function queueFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const additions = [];
    for (const file of incoming) {
      const extension = classifyClientFile(file).extension;
      if (!ACCEPTED_EXTENSIONS.has(extension)) {
        state.helpers.toast.warn(`Skipped ${file.name}. Accepted file types: PDF, DOCX, DOC, JPG, JPEG, PNG.`, 3600);
        continue;
      }
      const duplicate = state.files.some((existing) => (
        existing.name === file.name &&
        existing.size === file.size &&
        existing.lastModified === file.lastModified
      ));
      if (duplicate) continue;
      additions.push(file);
    }

    state.files = state.files.concat(additions);
    void persistQueuedFiles(additions);
    resetPreparedState();
    renderFileQueue();
    if (additions.length) {
      state.helpers.toast.ok(`${pluralise(additions.length, 'file')} queued for analysis.`, 2600);
    }
  }

  function clearFiles() {
    state.files = [];
    state.fileDiagnostics = new Map();
    state.problemFileKeys = new Set();
    elements.fileInput.value = '';
    void clearQueuedFilesFromStore();
    resetPreparedState();
    renderFileQueue();
    renderWarnings([]);
    renderWarningActions(false);
  }

  function arrayBufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || new ArrayBuffer(0));
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      let piece = '';
      for (let cursor = 0; cursor < chunk.length; cursor += 1) {
        piece += String.fromCharCode(chunk[cursor]);
      }
      binary += piece;
    }
    return window.btoa(binary);
  }

  function readFileAsBase64(file) {
    if (file && typeof file.arrayBuffer === 'function') {
      return file.arrayBuffer()
        .then((buffer) => arrayBufferToBase64(new Uint8Array(buffer)))
        .catch(() => {
          throw new Error(`Unable to read ${file.name}.`);
        });
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
      reader.onload = () => {
        const result = reader.result;
        if (result instanceof ArrayBuffer) {
          resolve(arrayBufferToBase64(new Uint8Array(result)));
          return;
        }
        reject(new Error(`Unable to read ${file.name}.`));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  async function buildFilesPayload(requestId) {
    const payload = [];
    for (let index = 0; index < state.files.length; index += 1) {
      const file = state.files[index];
      const data = await readFileAsBase64(file);
      if (state.activeRequestId !== requestId) {
        throw new Error('Matcher request superseded by a newer analysis run.');
      }
      const packagedPercent = 10 + Math.round(((index + 1) / state.files.length) * 14);
      setStageDetail(1, `Packaged ${index + 1} of ${state.files.length} file${state.files.length === 1 ? '' : 's'} for secure transmission.`, 'working');
      setProgress(
        'Packaging candidate files',
        PROGRESS_STAGES[1].message,
        1,
        false,
        -1,
        packagedPercent
      );
      payload.push({
        name: file.name,
        contentType: file.type || '',
        size: file.size,
        data,
      });
    }
    return payload;
  }

  async function loadHistory() {
    try {
      const response = await state.helpers.api('admin-candidate-history-list', 'POST', { limit: 8 });
      state.historyRuns = safeArray(response.runs);
      renderHistory(state.historyRuns, response.history_enabled !== false);
      if (state.preparedRun?.id) {
        const refreshed = state.historyRuns.find((run) => run.id === state.preparedRun.id);
        if (refreshed) {
          renderPreparedEvidence(refreshed);
        }
      }
    } catch (error) {
      elements.historyChip.textContent = 'History unavailable';
      elements.historyChip.className = 'chip warn';
      elements.historyList.innerHTML = `
        <div class="empty-state">
          <strong>Recent matcher history is unavailable</strong>
          <p>History could not be loaded for this environment right now. Matching can still run if the analysis endpoint is available.</p>
        </div>
      `;
    }
  }

  async function restoreSessionState() {
    ensureSessionId();
    const restoredFiles = await restoreQueuedFilesFromStore();
    if (restoredFiles.length) {
      state.files = restoredFiles;
    }

    const snapshot = readSessionSnapshot();
    if (!snapshot || typeof snapshot !== 'object') return;

    if (elements.recruiterNotes && typeof snapshot.recruiterNotes === 'string') {
      elements.recruiterNotes.value = snapshot.recruiterNotes;
    }
    if (snapshot.preparedRun && typeof snapshot.preparedRun === 'object') {
      state.preparedRun = snapshot.preparedRun;
    }
    if (snapshot.latestResultPayload && typeof snapshot.latestResultPayload === 'object') {
      state.latestResultPayload = snapshot.latestResultPayload;
      state.latestResultMeta = snapshot.latestResultMeta || null;
    } else if (snapshot.preparedRun?.raw_result_json?.result) {
      state.latestResultPayload = snapshot.preparedRun.raw_result_json.result;
      state.latestResultMeta = {
        liveJobsCount: 'saved',
        model: 'saved result',
        savedToHistory: true,
      };
    }
    if (snapshot.runDiagnostics && typeof snapshot.runDiagnostics === 'object') {
      state.runDiagnostics = snapshot.runDiagnostics;
    }
  }

  function buildDiagnosticsWarnings(error) {
    const documents = safeArray(error?.details?.documents);
    const diagnostics = documents.map((document) => ({
      file: document.name || document.file || 'Candidate file',
      message: [
        document.error || 'Extraction failed.',
        document.contentType || document.content_type ? `MIME: ${document.contentType || document.content_type}` : '',
        Number.isFinite(Number(document.size || document.declared_size_bytes)) ? `Bytes seen: ${document.size || document.declared_size_bytes}` : '',
        document.parserPath || document.parser_path ? `Parser: ${document.parserPath || document.parser_path}` : '',
      ].filter(Boolean).join(' | '),
      status: document.status || 'error',
    }));
    const stageSummary = error?.details?.stage_label
      ? [{
        file: error.details.stage_label,
        message: [
          error.message || 'Matcher stage failed.',
          Number.isFinite(Number(error?.details?.stage_duration_ms))
            ? `Stage duration: ${(Number(error.details.stage_duration_ms) / 1000).toFixed(1)}s`
            : '',
          Number.isFinite(Number(error?.details?.total_duration_ms))
            ? `Total request: ${(Number(error.details.total_duration_ms) / 1000).toFixed(1)}s`
            : '',
        ].filter(Boolean).join(' | '),
        status: error?.details?.stage || 'error',
      }]
      : [];
    return { documents, diagnostics, stageSummary };
  }

  function handleMatcherFailure(error, requestId, options) {
    if (state.activeRequestId !== requestId) return;
    stopProgress();
    deriveStageDetailsFromRun(null, error);
    const failure = buildFailureProgress(error);
    setProgress(
      options?.statusText || 'Step failed',
      failure.detail,
      failure.failureIndex,
      false,
      failure.failureIndex,
      failure.percent
    );
    const { documents, diagnostics, stageSummary } = buildDiagnosticsWarnings(error);
    updateDiagnosticsFromDocuments(documents, true);
    renderRunDiagnostics(error?.run_diagnostics || {
      started_at: error?.details?.started_at || '',
      total_elapsed_ms: Number(error?.details?.total_duration_ms) || 0,
      files_attempted: documents.length,
      files_text_read: documents.filter((document) => document.status === 'ok').length,
      files_skipped: documents.filter((document) => document.status !== 'ok').length,
      warning_count: diagnostics.length || stageSummary.length,
      failed_stage: error?.details?.stage_label || error?.details?.stage || '',
    });
    renderWarnings(diagnostics.length
      ? diagnostics
      : stageSummary.length
        ? stageSummary
        : [{ file: options?.warningLabel || 'Analysis', message: error.message || 'Unexpected matcher failure.', status: 'error' }]);
    renderWarningActions(true);
    if (options?.preparedFailure && state.preparedRun) {
      state.preparedRun = {
        ...state.preparedRun,
        error_message: error.message || 'Match failed.',
      };
      renderPreparedEvidence(state.preparedRun);
    }
    persistSessionSnapshot();
  }

  async function refreshQueuedMatch(preparedRunId, options) {
    const response = await state.helpers.api('admin-candidate-match-status', 'POST', {
      preparedRunId,
    });

    if (response.prepared_run) {
      renderPreparedEvidence(response.prepared_run);
      renderJobStatus(response.prepared_run);
    }

    const job = response.prepared_run?.match_job || null;
    const status = String(job?.status || '').toLowerCase();
    const baseDiagnostics = buildRunDiagnosticsFromPreparedRun(response.prepared_run, {
      started_at: job?.started_at || job?.queued_at || response.prepared_run?.updated_at || '',
      total_elapsed_ms: 0,
      warning_count: safeArray(response.warnings).length,
      failed_stage: status === 'failed' ? (job?.stage_label || 'Background recruiter analysis') : '',
    });
    if (status === 'completed' && response.result) {
      stopMatchPolling();
      renderWarnings(response.warnings || []);
      renderWarningActions(false);
      renderResult(response.result, {
        liveJobsCount: response.live_jobs_count || 'saved',
        model: response.analysis_meta?.model || 'saved result',
        savedToHistory: true,
        warningCount: safeArray(response.warnings).length,
        historyNote: 'Background recruiter analysis complete',
      });
      renderRunDiagnostics(response.run_diagnostics || buildRunDiagnosticsFromPreparedRun(response.prepared_run, {
        started_at: job.completed_at || response.prepared_run?.updated_at || '',
        total_elapsed_ms: 0,
        warning_count: safeArray(response.warnings).length,
        failed_stage: '',
      }));
      setProgress('Results ready', 'Background recruiter analysis completed. Review the saved ranked result below.', 6, true, -1, 100);
      elements.jobsChip.textContent = 'Background match complete';
      elements.jobsChip.className = 'chip ok';
      if (!options?.silentComplete) {
        state.helpers.toast.ok('Background recruiter match completed.', 2600);
      }
      await loadHistory();
      return response;
    }

    if (status === 'failed') {
      stopMatchPolling();
      renderWarnings([{
        file: 'Background match',
        message: response.prepared_run?.error_message || job?.last_error || 'The async recruiter match failed.',
        status: 'failed',
      }]);
      renderWarningActions(true);
      renderRunDiagnostics(buildRunDiagnosticsFromPreparedRun(response.prepared_run, {
        started_at: job.failed_at || response.prepared_run?.updated_at || '',
        total_elapsed_ms: 0,
        warning_count: 1,
        failed_stage: job?.stage_label || 'Background recruiter analysis',
      }));
      const failedProgress = buildProgressStateFromJob(response.prepared_run);
      if (failedProgress?.stageDetail) {
        setStageDetail(Number.isFinite(failedProgress.activeIndex) ? failedProgress.activeIndex : 5, failedProgress.stageDetail, 'failed');
      }
      setProgress(
        failedProgress?.statusText || 'Background match failed',
        failedProgress?.detailText || response.prepared_run?.error_message || job?.last_error || 'The queued recruiter match did not complete.',
        Number.isFinite(failedProgress?.activeIndex) ? failedProgress.activeIndex : 5,
        false,
        Number.isFinite(failedProgress?.failedIndex) ? failedProgress.failedIndex : 5,
        Number.isFinite(failedProgress?.percent) ? failedProgress.percent : 88
      );
      elements.jobsChip.textContent = 'Background match failed';
      elements.jobsChip.className = 'chip bad';
      await loadHistory();
      return response;
    }

    renderRunDiagnostics(baseDiagnostics);
    const progressState = buildProgressStateFromJob(response.prepared_run);
    if (progressState) {
      const activeIndex = Number.isFinite(progressState.activeIndex) ? progressState.activeIndex : (status === 'queued' ? 4 : 5);
      if (progressState.stageDetail) {
        setStageDetail(activeIndex, progressState.stageDetail, 'working');
      }
      setProgress(
        progressState.statusText,
        progressState.detailText,
        activeIndex,
        false,
        Number.isFinite(progressState.failedIndex) ? progressState.failedIndex : -1,
        Number.isFinite(progressState.percent) ? progressState.percent : (status === 'queued' ? 66 : 84)
      );
      elements.jobsChip.textContent = status === 'queued' ? 'Match queued' : 'Background match running';
      elements.jobsChip.className = 'chip warn';
    }

    return response;
  }

  function scheduleMatchPolling(preparedRunId, options) {
    stopMatchPolling();
    if (!preparedRunId) return;
    const poll = async () => {
      try {
        const response = await refreshQueuedMatch(preparedRunId, options);
        if (isMatchJobActive(response?.prepared_run)) {
          state.matchPollTimer = window.setTimeout(poll, MATCH_STATUS_POLL_MS);
        }
      } catch (error) {
        stopMatchPolling();
        renderWarnings([{
          file: 'Match status',
          message: error.message || 'Could not refresh background match status.',
          status: 'failed',
        }]);
        renderWarningActions(true);
      }
    };
    state.matchPollTimer = window.setTimeout(poll, MATCH_STATUS_POLL_MS);
  }

  async function copyTextToClipboard(text, successMessage) {
    const safeText = String(text || '').trim();
    if (!safeText) {
      state.helpers.toast.warn('There is no content ready to copy yet.', 2600);
      return;
    }
    try {
      await navigator.clipboard.writeText(safeText);
      state.helpers.toast.ok(successMessage, 2200);
    } catch {
      state.helpers.toast.warn('Clipboard access failed in this browser session.', 3200);
    }
  }

  function buildCandidateSummaryCopy() {
    const result = state.latestResultPayload || {};
    const summary = result.candidate_summary || {};
    return [
      summary.name || 'Candidate',
      summary.current_or_recent_title || '',
      summary.summary || '',
      safeArray(summary.key_skills).length ? `Key skills: ${safeArray(summary.key_skills).join(', ')}` : '',
      safeArray(summary.key_qualifications).length ? `Key qualifications: ${safeArray(summary.key_qualifications).join(', ')}` : '',
      safeArray(summary.sectors).length ? `Sectors: ${safeArray(summary.sectors).join(', ')}` : '',
      safeArray(summary.locations).length ? `Locations: ${safeArray(summary.locations).join(', ')}` : '',
    ].filter(Boolean).join('\n');
  }

  function buildTopMatchCopy() {
    const topMatch = safeArray(state.latestResultPayload?.top_matches)[0];
    if (!topMatch) return '';
    return [
      topMatch.job_title || 'Top match',
      `Score: ${Math.round(Number(topMatch.score) || 0)}%`,
      `Recommendation: ${recommendationLabel(topMatch.recommendation)}`,
      topMatch.why_match || '',
      safeArray(topMatch.gaps).length ? `Gaps: ${safeArray(topMatch.gaps).join('; ')}` : '',
    ].filter(Boolean).join('\n');
  }

  function buildFollowUpsCopy() {
    const topMatch = safeArray(state.latestResultPayload?.top_matches)[0];
    const followUps = safeArray(state.latestResultPayload?.general_follow_up_questions)
      .concat(safeArray(topMatch?.follow_up_questions));
    return followUps.length
      ? followUps.map((item, index) => `${index + 1}. ${item}`).join('\n')
      : '';
  }

  async function prepareEvidence() {
    if (state.busy) return;
    if (!state.files.length) {
      state.helpers.toast.warn('Add at least one candidate document before preparing evidence.', 3600);
      return;
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state.activeRequestId = requestId;
    setBusy(true);
    startProgress();
    state.fileDiagnostics = new Map();
    state.problemFileKeys = new Set();
    renderFileQueue();
    renderWarnings([]);
    renderWarningActions(false);
    renderRunDiagnostics(null);
    renderPreparedEvidence(null);
    renderEmptyResults();
    elements.jobsChip.textContent = 'Preparing evidence';
    elements.jobsChip.className = 'chip warn';

    try {
      setStageDetail(0, `${pluralise(state.files.length, 'file')} passed client-side intake validation.`, 'done');
      setStageDetail(1, 'Packaging the current queue for secure transmission.', 'working');
      setProgress('Preparing candidate evidence', PROGRESS_STAGES[1].message, 1, false, -1, 10);

      const files = await buildFilesPayload(requestId);
      if (state.activeRequestId !== requestId) return;
      setStageDetail(1, `${pluralise(files.length, 'file')} transmitted to the secure matcher function.`, 'done');
      setStageDetail(2, 'Server extraction is running for the prepared evidence set.', 'working');
      setProgress('Extracting candidate evidence', PROGRESS_STAGES[2].message, 2, false, -1, 34);

      const response = await callMatcherApi('admin-candidate-prepare', {
        files,
        recruiterNotes: elements.recruiterNotes.value,
      });
      if (state.activeRequestId !== requestId) return;

      deriveStageDetailsFromRun({
        analysis_meta: { timings: [] },
        extraction: response.extraction,
        upload_storage: response.upload_storage,
        run_diagnostics: response.run_diagnostics,
      }, null);
      setStageDetail(3, response.prepared_run?.ready_for_match
        ? 'Prepared evidence stored and ready to be matched without re-uploading.'
        : 'Prepared evidence stored, but recruiter review is still needed before matching.', 'done');
      setProgress(
        response.prepared_run?.ready_for_match ? 'Prepared evidence ready' : 'Prepared evidence saved with review required',
        response.prepared_run?.ready_for_match
          ? 'Step 1 completed. Review the extracted evidence summary, then run the recruiter match.'
          : 'Step 1 completed, but no readable candidate text is ready for matching yet.',
        3,
        false,
        -1,
        100
      );
      updateDiagnosticsFromDocuments(response?.extraction?.documents, false);
      renderWarnings(response.warnings || []);
      renderWarningActions(false);
      renderRunDiagnostics(response.run_diagnostics || null);
      renderPreparedEvidence(response.prepared_run || null);
      elements.jobsChip.textContent = response.prepared_run?.ready_for_match ? 'Prepared evidence ready' : 'Prepared evidence needs review';
      elements.jobsChip.className = response.prepared_run?.ready_for_match ? 'chip ok' : 'chip warn';
      state.helpers.toast.ok('Candidate evidence prepared and saved privately.', 3200);
      await loadHistory();
    } catch (error) {
      handleMatcherFailure(error, requestId, {
        statusText: 'Evidence preparation failed',
        warningLabel: 'Prepare evidence',
      });
      elements.jobsChip.textContent = 'Evidence preparation failed';
      elements.jobsChip.className = 'chip bad';
    } finally {
      if (state.activeRequestId === requestId) {
        state.activeRequestId = '';
      }
      setBusy(false);
      updateMatchActionState();
    }
  }

  async function runMatch(isRetry) {
    if (state.busy) return;
    if (!state.preparedRun?.id) {
      state.helpers.toast.warn('Prepare evidence first before running the recruiter match.', 3600);
      return;
    }
    if (!state.preparedRun.ready_for_match) {
      state.helpers.toast.warn('This prepared evidence is not ready for matching yet. Review the extracted evidence summary first.', 3600);
      return;
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state.activeRequestId = requestId;
    setBusy(true);
    resetProgressState();
    setStageDetail(3, 'Prepared evidence already saved. Reusing it for this match run.', 'done');
    setStageDetail(4, 'Loading prepared evidence and current live roles.', 'working');
    setProgress(
      isRetry ? 'Queueing recruiter match retry' : 'Queueing recruiter match',
      'Step 2 reuses the saved prepared evidence. No files will be uploaded or re-parsed.',
      4,
      false,
      -1,
      58
    );
    renderWarnings([]);
    renderWarningActions(false);
    elements.jobsChip.textContent = isRetry ? 'Retrying match' : 'Matching in progress';
    elements.jobsChip.className = 'chip warn';

    try {
      const response = await callMatcherApi('admin-candidate-run-match', {
        preparedRunId: state.preparedRun.id,
        recruiterNotes: elements.recruiterNotes.value,
      });
      if (state.activeRequestId !== requestId) return;

      renderPreparedEvidence(response.prepared_run || state.preparedRun);
      renderWarnings([]);
      renderWarningActions(false);
      renderRunDiagnostics(response.run_diagnostics || buildRunDiagnosticsFromPreparedRun(response.prepared_run, {
        started_at: response.prepared_run?.match_job?.queued_at || new Date().toISOString(),
        total_elapsed_ms: 0,
        warning_count: 0,
        failed_stage: '',
      }));
      setStageDetail(4, 'Prepared evidence loaded and the background match has been queued.', 'done');
      setStageDetail(5, 'Background recruiter analysis will update automatically when complete.', 'working');
      setProgress(
        isRetry ? 'Retry queued' : 'Match queued',
        'The recruiter match is running asynchronously in the background. You can stay on this page and it will refresh automatically.',
        5,
        false,
        -1,
        68
      );
      elements.jobsChip.textContent = 'Match queued';
      elements.jobsChip.className = 'chip warn';
      state.helpers.toast.ok(isRetry ? 'Retry queued from the saved evidence.' : 'Recruiter match queued in the background.', 3200);
      scheduleMatchPolling(state.preparedRun.id, { silentComplete: false });
      await loadHistory();
    } catch (error) {
      handleMatcherFailure(error, requestId, {
        statusText: isRetry ? 'Retry match failed' : 'Recruiter match failed',
        warningLabel: 'Run match',
        preparedFailure: true,
      });
      elements.jobsChip.textContent = 'Match failed';
      elements.jobsChip.className = 'chip bad';
    } finally {
      if (state.activeRequestId === requestId) {
        state.activeRequestId = '';
      }
      setBusy(false);
      updateMatchActionState();
    }
  }

  function bindDropZone() {
    const dropZone = elements.dropZone;
    const activatePicker = () => elements.fileInput.click();

    dropZone.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      activatePicker();
    });
    dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activatePicker();
      }
    });

    ['dragenter', 'dragover'].forEach((type) => {
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        dropZone.classList.add('dragover');
      });
    });
    ['dragleave', 'dragend', 'drop'].forEach((type) => {
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        if (type !== 'drop') dropZone.classList.remove('dragover');
      });
    });
    dropZone.addEventListener('drop', (event) => {
      dropZone.classList.remove('dragover');
      queueFiles(event.dataTransfer?.files);
    });
  }

  function collectElements(sel) {
    elements.app = document.getElementById('app');
    elements.userStatus = sel('#userStatus');
    elements.sessionChip = sel('#sessionChip');
    elements.historyChip = sel('#historyChip');
    elements.jobsChip = sel('#jobsChip');
    elements.dropZone = sel('#dropZone');
    elements.fileInput = sel('#fileInput');
    elements.pickFilesButton = sel('#pickFilesButton');
    elements.clearFilesButton = sel('#clearFilesButton');
    elements.queueSummary = sel('#queueSummary');
    elements.fileList = sel('#fileList');
    elements.recruiterNotes = sel('#recruiterNotes');
    elements.saveHistory = sel('#saveHistory');
    elements.workflowStepPrepare = sel('#workflowStepPrepare');
    elements.workflowStepPrepareText = sel('#workflowStepPrepareText');
    elements.workflowStepMatch = sel('#workflowStepMatch');
    elements.workflowStepMatchText = sel('#workflowStepMatchText');
    elements.preparedStateChip = sel('#preparedStateChip');
    elements.preparedEvidenceShell = sel('#preparedEvidenceShell');
    elements.preparedEvidenceMeta = sel('#preparedEvidenceMeta');
    elements.preparedEvidenceSummary = sel('#preparedEvidenceSummary');
    elements.preparedTextList = sel('#preparedTextList');
    elements.preparedImageList = sel('#preparedImageList');
    elements.preparedLimitedList = sel('#preparedLimitedList');
    elements.preparedFailedList = sel('#preparedFailedList');
    elements.analysisStatus = sel('#analysisStatus');
    elements.progressText = sel('#progressText');
    elements.progressFill = sel('#progressFill');
    elements.progressPercent = sel('#progressPercent');
    elements.progressStageDetail = sel('#progressStageDetail');
    elements.stageList = sel('#stageList');
    elements.analyseButton = sel('#analyseButton');
    elements.prepareEvidenceButton = sel('#prepareEvidenceButton');
    elements.runMatchButton = sel('#runMatchButton');
    elements.retryMatchButton = sel('#retryMatchButton');
    elements.warningShell = sel('#warningShell');
    elements.warningNote = sel('#warningNote');
    elements.warningActions = sel('#warningActions');
    elements.warningList = sel('#warningList');
    elements.retryAnalysisButton = sel('#retryAnalysisButton');
    elements.removeProblemFilesButton = sel('#removeProblemFilesButton');
    elements.clearProblemFilesButton = sel('#clearProblemFilesButton');
    elements.resultsShell = sel('#resultsShell');
    elements.resultsMeta = sel('#resultsMeta');
    elements.resultsEmptyState = sel('#resultsEmptyState');
    elements.resultsContent = sel('#resultsContent');
    elements.resultsSummaryStrip = sel('#resultsSummaryStrip');
    elements.copyCandidateSummaryButton = sel('#copyCandidateSummaryButton');
    elements.copyTopMatchButton = sel('#copyTopMatchButton');
    elements.copyFollowUpsButton = sel('#copyFollowUpsButton');
    elements.overallRecommendation = sel('#overallRecommendation');
    elements.candidateNarrative = sel('#candidateNarrative');
    elements.candidateSummaryGrid = sel('#candidateSummaryGrid');
    elements.topMatchShell = sel('#topMatchShell');
    elements.topMatchFeature = sel('#topMatchFeature');
    elements.topMatchesList = sel('#topMatchesList');
    elements.otherMatchesList = sel('#otherMatchesList');
    elements.noStrongMatchNotice = sel('#noStrongMatchNotice');
    elements.historyList = sel('#historyList');
    elements.runDiagnosticsList = sel('#runDiagnosticsList');
    elements.jobStatusList = sel('#jobStatusList');
  }

  function bindEvents() {
    elements.pickFilesButton.addEventListener('click', () => elements.fileInput.click());
    elements.clearFilesButton.addEventListener('click', clearFiles);
    elements.fileInput.addEventListener('change', (event) => queueFiles(event.target.files));
    elements.recruiterNotes.addEventListener('input', () => persistSessionSnapshot());
    if (elements.prepareEvidenceButton) {
      elements.prepareEvidenceButton.addEventListener('click', prepareEvidence);
    }
    if (elements.runMatchButton) {
      elements.runMatchButton.addEventListener('click', () => runMatch(false));
    }
    if (elements.retryMatchButton) {
      elements.retryMatchButton.addEventListener('click', () => runMatch(true));
    }
    if (elements.retryAnalysisButton) {
      elements.retryAnalysisButton.addEventListener('click', () => {
        if (state.preparedRun?.ready_for_match) {
          runMatch(!!state.preparedRun?.error_message);
        } else {
          prepareEvidence();
        }
      });
    }
    if (elements.removeProblemFilesButton) {
      elements.removeProblemFilesButton.addEventListener('click', () => {
        if (!state.problemFileKeys.size) return;
        const removed = state.files.filter((file) => state.problemFileKeys.has(fileKey(file)));
        state.files = state.files.filter((file) => !state.problemFileKeys.has(fileKey(file)));
        removed.forEach((file) => { void removeQueuedFileFromStore(file); });
        state.problemFileKeys = new Set();
        state.fileDiagnostics = new Map();
        resetPreparedState();
        renderFileQueue();
        renderWarningActions(false);
        state.helpers.toast.ok('Problematic files removed from the queue.', 2800);
      });
    }
    if (elements.clearProblemFilesButton) {
      elements.clearProblemFilesButton.addEventListener('click', clearFiles);
    }
    if (elements.copyCandidateSummaryButton) {
      elements.copyCandidateSummaryButton.addEventListener('click', () => {
        copyTextToClipboard(buildCandidateSummaryCopy(), 'Candidate summary copied.');
      });
    }
    if (elements.copyTopMatchButton) {
      elements.copyTopMatchButton.addEventListener('click', () => {
        copyTextToClipboard(buildTopMatchCopy(), 'Top match summary copied.');
      });
    }
    if (elements.copyFollowUpsButton) {
      elements.copyFollowUpsButton.addEventListener('click', () => {
        copyTextToClipboard(buildFollowUpsCopy(), 'Follow-up questions copied.');
      });
    }
    bindDropZone();
  }

  function start() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      window.setTimeout(start, 40);
      return;
    }

    window.Admin.bootAdmin(async (helpers) => {
      state.helpers = helpers;
      collectElements(helpers.sel);
      bindEvents();
      await restoreSessionState();
      renderFileQueue();
      if (state.preparedRun) {
        renderPreparedEvidence(state.preparedRun);
      } else {
        renderPreparedEvidence(null);
      }
      if (state.latestResultPayload) {
        renderResult(state.latestResultPayload, state.latestResultMeta || {});
      } else {
        renderEmptyResults();
      }
      if (state.runDiagnostics) {
        renderRunDiagnostics(state.runDiagnostics);
      }
      renderStageList(-1, false, -1);
      setProgress(
        isMatchJobActive(state.preparedRun)
          ? 'Background match in progress'
          : state.preparedRun?.ready_for_match
            ? 'Prepared evidence ready'
          : 'Ready to prepare evidence',
        isMatchJobActive(state.preparedRun)
          ? 'A background recruiter match is already queued or running for the selected prepared evidence.'
          : state.preparedRun?.ready_for_match
            ? 'A saved prepared evidence set is available. You can run or retry the recruiter match without uploading again.'
          : 'Upload one or more files, add optional recruiter context, then prepare a reusable evidence record.',
        -1,
        false,
        -1,
        0
      );
      renderWarningActions(false);
      updateMatchActionState();
      syncCopyActionState();

      try {
        const who = await helpers.identity('admin');
        elements.userStatus.textContent = who?.email
          ? `Signed in as ${who.email}`
          : 'Signed in with admin access';
        elements.sessionChip.textContent = 'Admin session ready';
        elements.sessionChip.className = 'chip ok';
      } catch (error) {
        elements.userStatus.textContent = 'Unable to confirm the current admin user.';
        elements.sessionChip.textContent = 'Session check failed';
        elements.sessionChip.className = 'chip bad';
      }

      await loadHistory();
      elements.jobsChip.textContent = 'Live jobs source ready';
      elements.jobsChip.className = 'chip ok';
      if (state.files.length) {
        state.helpers.toast.ok(`${pluralise(state.files.length, 'queued file')} restored for this session.`, 2600);
      }
      if (isMatchJobActive(state.preparedRun)) {
        elements.jobsChip.textContent = 'Background match active';
        elements.jobsChip.className = 'chip warn';
        scheduleMatchPolling(state.preparedRun.id, { silentComplete: true });
      }
    });
  }

  start();
})();
