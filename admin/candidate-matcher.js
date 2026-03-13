(function () {
  'use strict';

  const ACCEPTED_EXTENSIONS = new Set(['pdf', 'docx', 'doc']);
  const PROGRESS_STAGES = [
    {
      label: 'Prepare intake',
      helper: 'Validate selected files and recruiter notes.',
      message: 'Preparing candidate files for secure submission…',
    },
    {
      label: 'Extract evidence',
      helper: 'Read CV and supporting documents server-side.',
      message: 'Extracting readable candidate evidence on the server…',
    },
    {
      label: 'Read live roles',
      helper: 'Load HMJ published live jobs from the live source.',
      message: 'Reading HMJ published live roles from Supabase…',
    },
    {
      label: 'Return ranked view',
      helper: 'Build structured recruiter-focused match results.',
      message: 'Running structured OpenAI matching and preparing results…',
    }
  ];
  const STAGE_INDEX_BY_KEY = {
    prepare_intake: 0,
    extraction: 1,
    storage_upload: 1,
    jobs_fetch: 2,
    openai: 3,
    history_save: 3,
  };
  const CLIENT_REQUEST_TIMEOUT_MS = 35000;

  const state = {
    files: [],
    historyRuns: [],
    busy: false,
    progressIndex: -1,
    progressFailureIndex: -1,
    activeRequestId: '',
    helpers: null,
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

  function setBusy(isBusy) {
    state.busy = !!isBusy;
    if (elements.app) {
      elements.app.setAttribute('aria-busy', state.busy ? 'true' : 'false');
    }
    elements.analyseButton.disabled = state.busy;
    elements.pickFilesButton.disabled = state.busy;
    elements.clearFilesButton.disabled = state.busy;
    elements.fileInput.disabled = state.busy;
    elements.saveHistory.disabled = state.busy;
    elements.recruiterNotes.disabled = state.busy;
  }

  function renderStageList(activeIndex, complete, failedIndex) {
    elements.stageList.innerHTML = PROGRESS_STAGES.map((stage, index) => {
      const isFailed = failedIndex === index;
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
        </li>
      `;
    }).join('');
  }

  function setProgress(statusText, detailText, activeIndex, complete, failedIndex) {
    elements.analysisStatus.textContent = statusText;
    elements.progressText.textContent = detailText;
    state.progressIndex = Number.isFinite(activeIndex) ? activeIndex : -1;
    state.progressFailureIndex = Number.isFinite(failedIndex) ? failedIndex : -1;
    renderStageList(state.progressIndex, !!complete, state.progressFailureIndex);
  }

  function startProgress() {
    setProgress('Preparing candidate analysis', PROGRESS_STAGES[0].message, 0, false, -1);
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
            stage: 'openai',
            stage_label: 'Run recruiter matching',
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
    const docCount = state.files.filter((file) => extOf(file.name) === 'doc').length;
    elements.queueSummary.innerHTML = `
      <span class="metric-badge">${escapeHtml(pluralise(state.files.length, 'file'))}</span>
      <span class="metric-badge">${escapeHtml(formatSize(totalBytes))} total</span>
      ${docCount ? `<span class="metric-badge">${escapeHtml(pluralise(docCount, 'DOC file'))}</span>` : ''}
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
      const extension = extOf(file.name) || 'file';
      const isLegacyDoc = extension === 'doc';
      const updatedLabel = file.lastModified ? `Updated ${formatDateTime(file.lastModified)}` : 'Ready for analysis';
      return `
        <article class="file-card">
          <div class="file-icon" aria-hidden="true">${escapeHtml(extension.toUpperCase())}</div>
          <div class="file-meta">
            <div>
              <strong>${escapeHtml(file.name)}</strong>
              <div class="file-meta-line">${escapeHtml(formatSize(file.size))} • ${escapeHtml(file.type || extension.toUpperCase())}</div>
            </div>
            <div class="file-pill-row">
              <span class="file-pill">${escapeHtml(updatedLabel)}</span>
              ${isLegacyDoc ? '<span class="file-pill">Legacy DOC may produce extraction warnings</span>' : '<span class="file-pill">Included in analysis queue</span>'}
            </div>
          </div>
          <button class="file-remove" type="button" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">Remove</button>
        </article>
      `;
    }).join('');

    elements.fileList.querySelectorAll('[data-remove-file]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.getAttribute('data-remove-file'));
        state.files.splice(index, 1);
        renderFileQueue();
      });
    });
  }

  function renderWarnings(warnings) {
    const items = safeArray(warnings).filter((warning) => warning && warning.message);
    if (!items.length) {
      elements.warningShell.hidden = true;
      elements.warningList.innerHTML = '';
      return;
    }

    elements.warningShell.hidden = false;
    elements.warningList.innerHTML = items.map((warning) => `
      <article class="warning-card">
        <strong>${escapeHtml(warning.file || warning.status || 'Notice')}</strong>
        <div class="muted">${escapeHtml(warning.message)}</div>
      </article>
    `).join('');
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
    const historyLabel = meta?.savedToHistory ? 'Saved' : 'Not saved';
    const modelLabel = meta?.model || 'OpenAI';

    elements.resultsEmptyState.hidden = true;
    elements.resultsContent.hidden = false;
    elements.resultsMeta.textContent = `Analysed against ${liveJobsValue} published live job${liveJobsValue === '1' ? '' : 's'} using ${modelLabel}.`;
    elements.resultsSummaryStrip.innerHTML = [
      buildMetricCard('Live roles analysed', liveJobsValue, 'Published + live jobs only'),
      buildMetricCard('Top score', topScore, featured ? featured.job_title || 'Highest-ranked role' : 'No scored top match'),
      buildMetricCard('Recommendation', topRecommendation, result.overall_recommendation || 'Recruiter summary from the model'),
      buildMetricCard('History status', historyLabel, meta?.historyNote || 'Private admin history only'),
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
        </div>
        <button class="btn history-action" type="button" data-history-id="${escapeHtml(run.id)}">Open saved result</button>
      </article>
    `).join('');

    elements.historyList.querySelectorAll('[data-history-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.getAttribute('data-history-id');
        const run = state.historyRuns.find((item) => item.id === id);
        const payload = run && run.raw_result_json && run.raw_result_json.result ? run.raw_result_json.result : null;
        if (!payload) {
          state.helpers.toast.warn('This saved run does not include a renderable result payload.', 3600);
          return;
        }
        renderWarnings([]);
        renderResult(payload, {
          liveJobsCount: 'saved',
          model: 'saved result',
          savedToHistory: true,
          historyNote: summariseHistoryFiles(run.file_names),
        });
        window.scrollTo({ top: elements.resultsShell.offsetTop - 80, behavior: 'smooth' });
      });
    });
  }

  function queueFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const additions = [];
    for (const file of incoming) {
      const extension = extOf(file.name);
      if (!ACCEPTED_EXTENSIONS.has(extension)) {
        state.helpers.toast.warn(`Skipped ${file.name}. Accepted file types: PDF, DOCX, DOC.`, 3600);
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
    renderFileQueue();
    if (additions.length) {
      state.helpers.toast.ok(`${pluralise(additions.length, 'file')} queued for analysis.`, 2600);
    }
  }

  function clearFiles() {
    state.files = [];
    elements.fileInput.value = '';
    renderFileQueue();
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma === -1 ? result : result.slice(comma + 1));
      };
      reader.readAsDataURL(file);
    });
  }

  async function buildFilesPayload() {
    const payload = [];
    for (const file of state.files) {
      const data = await readFileAsBase64(file);
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

  async function analyse() {
    if (state.busy) return;
    if (!state.files.length) {
      state.helpers.toast.warn('Add at least one candidate document before analysing.', 3600);
      return;
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    state.activeRequestId = requestId;
    setBusy(true);
    startProgress();
    renderWarnings([]);
    elements.jobsChip.textContent = 'Analysis in progress';
    elements.jobsChip.className = 'chip warn';

    try {
      const files = await buildFilesPayload();
      if (state.activeRequestId !== requestId) return;
      setProgress(
        'Server-side extraction in progress',
        'Candidate files were packaged successfully. The server is now extracting evidence and preparing the matcher run.',
        1,
        false,
        -1
      );
      const response = await callMatcherApi('admin-candidate-match', {
        files,
        recruiterNotes: elements.recruiterNotes.value,
        saveHistory: elements.saveHistory.checked,
      });
      if (state.activeRequestId !== requestId) return;

      renderWarnings(response.warnings || []);
      renderResult(response.result, {
        liveJobsCount: response.live_jobs_count || 0,
        model: response.analysis_meta?.model || '',
        savedToHistory: !!response.saved_to_history,
        historyNote: response.saved_to_history ? 'Stored in private admin history' : 'This run was not added to history',
      });

      stopProgress();
      setProgress('Analysis complete', 'The candidate summary and ranked role matches are ready to review.', PROGRESS_STAGES.length - 1, true, -1);
      elements.jobsChip.textContent = `${response.live_jobs_count || 0} live jobs analysed`;
      elements.jobsChip.className = 'chip ok';
      state.helpers.toast.ok('Candidate analysis complete.', 3200);
      if (response.history_enabled !== false) {
        await loadHistory();
      }
    } catch (error) {
      if (state.activeRequestId !== requestId) return;
      stopProgress();
      const failure = buildFailureProgress(error);
      setProgress(
        'Analysis failed',
        failure.detail,
        failure.failureIndex,
        false,
        failure.failureIndex
      );
      elements.jobsChip.textContent = 'Analysis failed';
      elements.jobsChip.className = 'chip bad';
      const diagnostics = safeArray(error?.details?.details?.documents).map((document) => ({
        file: document.name || document.file || 'Candidate file',
        message: [
          document.error || 'Extraction failed.',
          document.contentType ? `MIME: ${document.contentType}` : '',
          Number.isFinite(Number(document.size)) ? `Bytes seen: ${document.size}` : '',
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
      renderWarnings(diagnostics.length
        ? diagnostics
        : stageSummary.length
          ? stageSummary
        : [{ file: 'Analysis', message: error.message || 'Unexpected matcher failure.', status: 'error' }]);
    } finally {
      if (state.activeRequestId === requestId) {
        state.activeRequestId = '';
      }
      setBusy(false);
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
    elements.analysisStatus = sel('#analysisStatus');
    elements.progressText = sel('#progressText');
    elements.stageList = sel('#stageList');
    elements.analyseButton = sel('#analyseButton');
    elements.warningShell = sel('#warningShell');
    elements.warningList = sel('#warningList');
    elements.resultsShell = sel('#resultsShell');
    elements.resultsMeta = sel('#resultsMeta');
    elements.resultsEmptyState = sel('#resultsEmptyState');
    elements.resultsContent = sel('#resultsContent');
    elements.resultsSummaryStrip = sel('#resultsSummaryStrip');
    elements.overallRecommendation = sel('#overallRecommendation');
    elements.candidateNarrative = sel('#candidateNarrative');
    elements.candidateSummaryGrid = sel('#candidateSummaryGrid');
    elements.topMatchShell = sel('#topMatchShell');
    elements.topMatchFeature = sel('#topMatchFeature');
    elements.topMatchesList = sel('#topMatchesList');
    elements.otherMatchesList = sel('#otherMatchesList');
    elements.noStrongMatchNotice = sel('#noStrongMatchNotice');
    elements.historyList = sel('#historyList');
  }

  function bindEvents() {
    elements.pickFilesButton.addEventListener('click', () => elements.fileInput.click());
    elements.clearFilesButton.addEventListener('click', clearFiles);
    elements.fileInput.addEventListener('change', (event) => queueFiles(event.target.files));
    elements.analyseButton.addEventListener('click', analyse);
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
      renderFileQueue();
      renderEmptyResults();
      renderStageList(-1, false, -1);
      setProgress('Ready to analyse', 'Upload one or more files, add optional recruiter context, then run the matcher.', -1, false, -1);

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
    });
  }

  start();
})();
