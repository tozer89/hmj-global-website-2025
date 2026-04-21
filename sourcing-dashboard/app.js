const state = {
  roleIndex: [],
  selectedRoleId: '',
  selectedRole: null,
  selectedCandidateId: '',
  candidateFilter: 'all',
  busy: false,
};

const roleList = document.getElementById('roleList');
const roleTitle = document.getElementById('roleTitle');
const roleMeta = document.getElementById('roleMeta');
const metricCards = document.getElementById('metricCards');
const overviewBlock = document.getElementById('overviewBlock');
const progressBlock = document.getElementById('progressBlock');
const nextActions = document.getElementById('nextActions');
const reviewQueues = document.getElementById('reviewQueues');
const roleHistory = document.getElementById('roleHistory');
const candidateFilters = document.getElementById('candidateFilters');
const candidateList = document.getElementById('candidateList');
const candidateDetail = document.getElementById('candidateDetail');
const detailActions = document.getElementById('detailActions');
const artifactLinks = document.getElementById('artifactLinks');
const roleConfigForm = document.getElementById('roleConfigForm');
const warningBanner = document.getElementById('warningBanner');
const statusBox = document.getElementById('statusBox');
const refreshRolesButton = document.getElementById('refreshRolesButton');
const initRoleButton = document.getElementById('initRoleButton');
const openWorkflowButton = document.getElementById('openWorkflowButton');
const importFileInput = document.getElementById('importFileInput');
const importPostAction = document.getElementById('importPostAction');
const importBatchButton = document.getElementById('importBatchButton');
const importSummary = document.getElementById('importSummary');
const bulkCvFileInput = document.getElementById('bulkCvFileInput');
const bulkCvPostAction = document.getElementById('bulkCvPostAction');
const bulkCvUploadButton = document.getElementById('bulkCvUploadButton');
const bulkCvSummary = document.getElementById('bulkCvSummary');
const actionButtons = Array.from(document.querySelectorAll('[data-action]'));

const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'awaiting_manual_screening', label: 'Awaiting Review' },
  { key: 'new_since_last_review', label: 'New Since Review' },
  { key: 'changed_since_last_import', label: 'Changed Since Import' },
  { key: 'newly_shortlist_ready', label: 'Newly Shortlist-Ready' },
  { key: 'strong_shortlist', label: 'Strong' },
  { key: 'possible_shortlist', label: 'Possible' },
  { key: 'primary', label: 'Primary' },
  { key: 'backup', label: 'Backup' },
  { key: 'hold', label: 'Hold' },
  { key: 'reject', label: 'Reject' },
  { key: 'outreach_ready', label: 'Outreach Ready' },
  { key: 'draft_ready_not_contacted', label: 'Draft Ready' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'awaiting_reply', label: 'Awaiting Reply' },
  { key: 'closed', label: 'Closed' },
];

const ROLE_CONFIG_FIELDS = [
  { key: 'shortlist_target_size', label: 'Target Shortlist Size', type: 'number', min: 1 },
  { key: 'max_previews_per_run', label: 'Max Previews Per Run', type: 'number', min: 0 },
  { key: 'max_cv_reviews_per_run', label: 'Max CV Reviews Per Run', type: 'number', min: 0 },
  { key: 'shortlist_mode', label: 'Shortlist Mode', type: 'select', options: ['strict', 'balanced', 'broad'] },
  { key: 'minimum_shortlist_score', label: 'Minimum Shortlist Score', type: 'number', min: 0 },
  { key: 'minimum_draft_score', label: 'Minimum Draft Score', type: 'number', min: 0 },
  { key: 'must_have_weighting', label: 'Must-Have Weighting', type: 'number', min: 0, step: '0.1' },
  { key: 'preferred_weighting', label: 'Preferred Weighting', type: 'number', min: 0, step: '0.1' },
  { key: 'reject_on_missing_must_have', label: 'Reject on Missing Must-Have', type: 'checkbox' },
  { key: 'location_strictness', label: 'Location Strictness', type: 'select', options: ['strict', 'balanced', 'flexible'] },
  { key: 'adjacent_title_looseness', label: 'Adjacent Title Looseness', type: 'select', options: ['strict', 'balanced', 'wide'] },
  { key: 'sector_strictness', label: 'Sector Strictness', type: 'select', options: ['strict', 'balanced', 'flexible'] },
  { key: 'continue_until_target_reached', label: 'Continue Until Target Reached', type: 'checkbox' },
];

function setStatus(message, tone = 'info') {
  statusBox.textContent = message;
  statusBox.className = `status-box${tone === 'info' ? '' : ` ${tone}`}`;
}

function setBusy(busy, message = '') {
  state.busy = busy;
  [...actionButtons, refreshRolesButton, initRoleButton, openWorkflowButton, importBatchButton, bulkCvUploadButton].forEach((button) => {
    button.disabled = busy;
  });
  if (importFileInput) importFileInput.disabled = busy;
  if (importPostAction) importPostAction.disabled = busy;
  if (bulkCvFileInput) bulkCvFileInput.disabled = busy;
  if (bulkCvPostAction) bulkCvPostAction.disabled = busy;
  document.querySelectorAll('.role-item, .candidate-card, .filter-pill, .artifact-button, .tiny-button').forEach((node) => {
    node.disabled = busy;
  });
  if (message) {
    setStatus(message, busy ? 'busy' : 'success');
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
    },
    ...options,
  });
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof payload === 'string'
      ? payload
      : payload?.error || 'Request failed.';
    throw new Error(message);
  }
  return payload;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function arrayText(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

function listMarkup(values, emptyText = 'None recorded yet.') {
  const items = Array.isArray(values) ? values.filter(Boolean) : [];
  return items.length
    ? items.map((item) => `<div>${escapeHtml(item)}</div>`).join('')
    : `<div class="subtle">${escapeHtml(emptyText)}</div>`;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function summariseImportResult(result) {
  if (!result) return 'No import result yet.';
  const entry = result.importHistoryEntry || {};
  return [
    `${result.importedCount || 0} row(s) imported`,
    `${entry.added?.count || 0} added`,
    `${entry.updated?.count || 0} updated`,
    `${entry.preview_text_changed?.count || 0} preview text change(s)`,
    `${result.totalCandidates || 0} total candidate(s) in role`,
  ].join(' · ');
}

function summariseBulkCvResult(result) {
  if (!result) return 'No bulk CV upload result yet.';
  const entry = result.batchHistoryEntry || {};
  return [
    `${result.filesReceived || entry.files_received || 0} file(s) received`,
    `${result.successfulCount || entry.parsed_successfully || 0} parsed`,
    `${result.failedCount || entry.failed || 0} failed`,
    `${entry.ocr_used_count || 0} OCR fallback`,
    entry.ocr_enabled ? 'OCR enabled' : 'OCR disabled',
  ].join(' · ');
}

function metricCard(label, value) {
  const card = document.createElement('div');
  card.className = 'metric-card';
  card.innerHTML = `<span class="metric-label">${escapeHtml(label)}</span><span class="metric-value">${escapeHtml(value)}</span>`;
  return card;
}

function artifactUrl(roleId, relativePath, download = false) {
  const params = new URLSearchParams({
    path: relativePath,
  });
  if (download) params.set('download', '1');
  return `/api/roles/${encodeURIComponent(roleId)}/artifact?${params.toString()}`;
}

function roleKeyForRole(role) {
  return role?.roleSlug || role?.role_slug || state.selectedRoleId || role?.roleId || '';
}

function candidateListForRole(role) {
  return Array.isArray(role?.candidateDetails) ? role.candidateDetails : [];
}

function getSelectedCandidate(role) {
  const candidates = candidateListForRole(role);
  const selected = candidates.find((candidate) => candidate.candidate_id === state.selectedCandidateId);
  return selected || candidates[0] || null;
}

function matchesFilter(candidate, filterKey) {
  if (!candidate) return false;
  if (filterKey === 'all') return true;
  if (['awaiting_manual_screening', 'new_since_last_review', 'changed_since_last_import', 'newly_shortlist_ready', 'draft_ready_not_contacted'].includes(filterKey)) {
    return candidate.sessionFlags?.[filterKey] === true;
  }
  if (['primary', 'backup', 'hold'].includes(filterKey)) {
    return candidate.operatorReview?.shortlist_bucket === filterKey;
  }
  if (filterKey === 'outreach_ready') return candidate.outreach?.ready === true;
  if (filterKey === 'reject') {
    return ['reject', 'do_not_progress'].includes(candidate.lifecycle?.current_stage)
      || candidate.status?.shortlist_stage === 'do_not_progress'
      || candidate.operatorReview?.shortlist_bucket === 'do_not_progress';
  }
  if (filterKey === 'strong_shortlist' || filterKey === 'possible_shortlist') {
    return candidate.status?.shortlist_stage === filterKey || candidate.lifecycle?.current_stage === filterKey;
  }
  return candidate.lifecycle?.current_stage === filterKey;
}

function filteredCandidates(role) {
  return candidateListForRole(role)
    .filter((candidate) => matchesFilter(candidate, state.candidateFilter))
    .sort((left, right) => (left.ranking?.position || 0) - (right.ranking?.position || 0));
}

function renderRoleList() {
  roleList.innerHTML = '';
  state.roleIndex.forEach((role) => {
    const roleKey = role.role_slug || role.role_id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `role-item${roleKey === state.selectedRoleId ? ' active' : ''}`;
    button.dataset.roleId = roleKey;
    button.innerHTML = [
      `<strong>${escapeHtml(role.role_title || role.role_id)}</strong>`,
      `<div class="subtle">${escapeHtml(`${role.previews_processed || 0} previews · ${role.cvs_reviewed || 0} CVs · target ${role.shortlist_target || 0}`)}</div>`,
      `<div class="subtle">${escapeHtml(role.role_id || roleKey)}</div>`,
      `<div class="subtle">${escapeHtml((role.role_state || role.shortlist_progress_status || 'awaiting_inputs').replace(/_/g, ' '))}</div>`,
    ].join('');
    button.addEventListener('click', () => {
      if (state.busy) return;
      state.selectedRoleId = roleKey;
      loadRoleDetail(roleKey).catch((error) => setStatus(error.message || String(error), 'error'));
    });
    roleList.appendChild(button);
  });
}

function renderOverview(role) {
  const summary = role.shortlistProgress || {};
  const overviewItems = [
    ['Client', role.overview?.clientName || 'Not set'],
    ['Consultant', role.overview?.consultant || 'Joe'],
    ['Location', role.overview?.location?.base || 'Not set'],
    ['Function', role.overview?.functionFamily || 'Not set'],
    ['Must-Haves', (role.overview?.mustHaveSkills || []).join(', ') || 'Not set'],
    ['Shortlist Target', summary.target || role.roleConfig?.shortlist_target_size || 'Not set'],
    ['Role State', (role.roleState || role.metrics?.role_workflow_state || 'gathering_candidates').replace(/_/g, ' ')],
  ];
  overviewBlock.innerHTML = overviewItems
    .map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><br>${escapeHtml(value)}</div>`)
    .join('');
}

function renderProgress(role) {
  const progress = role.shortlistProgress || {};
  const blocks = [
    ['Target', progress.target ?? role.roleConfig?.shortlist_target_size ?? 'n/a'],
    ['Strong / Possible', `${progress.strong_count || 0} / ${progress.possible_count || 0}`],
    ['Remaining Strong', progress.remaining_strong_needed ?? 'n/a'],
    ['Remaining Viable', progress.remaining_viable_needed ?? 'n/a'],
    ['Status', (progress.status || 'awaiting_inputs').replace(/_/g, ' ')],
  ];
  progressBlock.innerHTML = blocks
    .map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><br>${escapeHtml(value)}</div>`)
    .join('');

  nextActions.innerHTML = '';
  (role.metrics?.next_actions || ['No immediate next actions.']).forEach((entry) => {
    const item = document.createElement('li');
    item.textContent = entry;
    nextActions.appendChild(item);
  });
}

function renderReviewQueues(role) {
  const queues = role.reviewQueues || {};
  const items = [
    ['New Since Review', queues.new_since_last_review || 0],
    ['Awaiting Manual Screening', queues.awaiting_manual_screening || 0],
    ['Newly Shortlist-Ready', queues.newly_shortlist_ready || 0],
    ['Draft Ready, Not Contacted', queues.draft_ready_not_contacted || 0],
    ['Contacted / Awaiting Reply', queues.contacted_awaiting_reply || 0],
    ['Changed Since Last Import', queues.changed_since_last_import || 0],
  ];
  reviewQueues.innerHTML = items
    .map(([label, value]) => `<div class="queue-card"><strong>${escapeHtml(label)}</strong><br>${escapeHtml(value)}</div>`)
    .join('');
}

function renderRoleHistory(role) {
  const latestEntries = []
    .concat((role.roleHistory?.importHistory || []).slice(0, 3).map((entry) => ({
      kind: 'Import',
      title: `${entry.method || 'import'} · ${entry.imported_count || 0} row(s)`,
      time: entry.at,
      summary: `Added ${entry.added?.count || 0}, updated ${entry.updated?.count || 0}, preview text changed ${entry.preview_text_changed?.count || 0}, total ${entry.total_candidates_after_import || 0}.`,
    })))
    .concat((role.roleHistory?.bulkCvHistory || []).slice(0, 3).map((entry) => ({
      kind: 'Bulk CV',
      title: `${entry.files_received || 0} file(s) · ${entry.parsed_successfully || 0} parsed`,
      time: entry.at,
      summary: `Failed ${entry.failed || 0}, OCR ${entry.ocr_enabled ? 'enabled' : 'disabled'}, OCR used ${entry.ocr_used_count || 0}.`,
    })))
    .concat((role.roleHistory?.runHistory || []).slice(0, 3).map((entry) => ({
      kind: 'Run',
      title: `${entry.action || 'run'} · ${entry.status || 'completed'}`,
      time: entry.completed_at || entry.at,
      summary: `Processed ${entry.processed_candidate_count || 0}, drafts ${entry.changes?.drafts_added?.count || 0}, shortlist-ready ${entry.changes?.shortlist_ready?.count || 0}, gap ${entry.shortlist_gap_before ?? 'n/a'} -> ${entry.shortlist_gap_after ?? 'n/a'}.`,
    })))
    .sort((left, right) => String(right.time || '').localeCompare(String(left.time || '')));

  roleHistory.innerHTML = latestEntries.length
    ? latestEntries.map((entry) => `
      <div class="history-card">
        <strong>${escapeHtml(entry.kind)} · ${escapeHtml(entry.title)}</strong>
        <div class="subtle">${escapeHtml(formatDateTime(entry.time) || 'Unknown time')}</div>
        <div>${escapeHtml(entry.summary)}</div>
      </div>
    `).join('')
    : '<div class="empty-state">No import or run history has been recorded for this role yet.</div>';
}

function renderImportPanel(role) {
  if (!importSummary) return;
  const latestImport = role?.roleHistory?.latestImport || null;
  importSummary.textContent = latestImport
    ? `Latest import: ${latestImport.imported_count || 0} row(s) · ${latestImport.added?.count || 0} added · ${latestImport.updated?.count || 0} updated · ${latestImport.preview_text_changed?.count || 0} preview text change(s)`
    : 'Choose a CSV or JSON batch for the selected role.';
  if (bulkCvSummary) {
    const latestBulk = role?.roleHistory?.latestBulkCvImport || null;
    bulkCvSummary.textContent = latestBulk
      ? `Latest bulk CV batch: ${latestBulk.files_received || 0} file(s) · ${latestBulk.parsed_successfully || 0} parsed · ${latestBulk.failed || 0} failed · OCR ${latestBulk.ocr_enabled ? 'enabled' : 'disabled'}`
      : 'Choose up to 20 PDF or DOCX CVs for the selected role. Legacy DOC remains manual for now.';
  }
}

function renderMetricCards(role) {
  metricCards.innerHTML = '';
  metricCards.appendChild(metricCard('Previews', role.metrics?.profiles_reviewed || 0));
  metricCards.appendChild(metricCard('CVs', role.metrics?.cvs_downloaded || 0));
  metricCards.appendChild(metricCard('Strong', role.shortlistProgress?.strong_count || 0));
  metricCards.appendChild(metricCard('Possible', role.shortlistProgress?.possible_count || 0));
  metricCards.appendChild(metricCard('Drafts', role.metrics?.outreach_drafts_prepared || 0));
  metricCards.appendChild(metricCard('KPI', role.metrics?.conversion?.manual_profiles_reviewed_per_viable_outreach_candidate ?? 'n/a'));
}

function renderCandidateFilters(role) {
  candidateFilters.innerHTML = '';
  FILTER_OPTIONS.forEach((filter) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `filter-pill${state.candidateFilter === filter.key ? ' active' : ''}`;
    button.dataset.filterKey = filter.key;
    button.textContent = filter.label;
    button.addEventListener('click', () => {
      state.candidateFilter = filter.key;
      const candidates = filteredCandidates(role);
      if (!candidates.some((candidate) => candidate.candidate_id === state.selectedCandidateId)) {
        state.selectedCandidateId = candidates[0]?.candidate_id || '';
      }
      renderCandidateList(role);
      renderCandidateDetail(role);
    });
    candidateFilters.appendChild(button);
  });
}

function renderCandidateList(role) {
  const candidates = filteredCandidates(role);
  candidateList.innerHTML = '';
  if (!candidates.length) {
    candidateList.innerHTML = '<div class="empty-state">No candidates match the current filter yet.</div>';
    return;
  }
  candidates.forEach((candidate) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `candidate-card${candidate.candidate_id === state.selectedCandidateId ? ' active' : ''}`;
    button.dataset.candidateId = candidate.candidate_id;
    const previewClass = candidate.preview?.triage?.finalClassification || candidate.status?.preview_stage || '';
    const shortlistBucket = candidate.operatorReview?.shortlist_bucket || '';
    const warnings = [];
    if (!candidate.fullCv?.downloaded) warnings.push('No CV');
    if (!candidate.outreach?.email || candidate.outreach.email.endsWith('@unknown.local')) warnings.push('Email missing');
    if (!candidate.sourceAudit?.source_url && candidate.sourceAudit?.import_method !== 'bulk_cv_upload') warnings.push('Source URL missing');
    if (candidate.sessionFlags?.new_since_last_review) warnings.push('New');
    if (candidate.sessionFlags?.changed_since_last_import) warnings.push('Changed');
    button.innerHTML = [
      `<strong>#${escapeHtml(candidate.ranking?.position || '')} ${escapeHtml(candidate.identity?.name || candidate.candidate_id)}</strong>`,
      `<div class="subtle">${escapeHtml(candidate.identity?.title || 'No title')} · ${escapeHtml(candidate.lifecycle?.current_stage || 'preview_only')}</div>`,
      `<div class="subtle">Score ${escapeHtml(candidate.ranking?.total_score || candidate.preview?.triage?.totalScore || 0)} · ${escapeHtml(previewClass)}</div>`,
      `<div class="reason-list">${(candidate.ranking?.reasons || []).map((reason) => `<span class="reason-pill">${escapeHtml(reason)}</span>`).join('')}</div>`,
      shortlistBucket
        ? `<div class="reason-list"><span class="bucket-pill ${escapeAttribute(shortlistBucket)}">${escapeHtml(shortlistBucket)}</span></div>`
        : '',
      warnings.length ? `<div class="reason-list">${warnings.map((warning) => `<span class="warning-pill">${escapeHtml(warning)}</span>`).join('')}</div>` : '',
    ].join('');
    button.addEventListener('click', () => {
      state.selectedCandidateId = candidate.candidate_id;
      renderCandidateList(role);
      renderCandidateDetail(role);
    });
    candidateList.appendChild(button);
  });
}

function renderArtifacts(role) {
  artifactLinks.innerHTML = '';
  Object.values(role.artifacts || {}).forEach((artifact) => {
    const card = document.createElement('div');
    card.className = 'artifact-card';
    card.innerHTML = [
      `<strong>${escapeHtml(artifact.label || artifact.path || 'Artifact')}</strong>`,
      `<div class="subtle">${escapeHtml(artifact.path || '')}</div>`,
      `<div class="artifact-status">${escapeHtml(artifact.status || 'missing')} · ${artifact.last_updated ? escapeHtml(formatDateTime(artifact.last_updated)) : escapeHtml(artifact.empty_state || 'Not generated yet')}</div>`,
      `<div class="subtle">Group: ${escapeHtml((artifact.group || 'role').replace(/_/g, ' '))} · Source of truth: ${escapeHtml(artifact.source_of_truth || 'filesystem')}</div>`,
      '<div class="artifact-actions"></div>',
    ].join('');
    const actionRow = card.querySelector('.artifact-actions');
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'artifact-button';
    openButton.textContent = 'Open';
    openButton.disabled = !artifact.exists;
    openButton.addEventListener('click', () => openArtifact(state.selectedRoleId, artifact.path));
    actionRow.appendChild(openButton);
    const downloadButton = document.createElement('a');
    downloadButton.className = 'artifact-button';
    downloadButton.textContent = 'Download';
    if (artifact.exists) {
      downloadButton.href = artifactUrl(state.selectedRoleId, artifact.path, true);
      downloadButton.target = '_blank';
      downloadButton.rel = 'noopener';
    } else {
      downloadButton.removeAttribute('href');
      downloadButton.setAttribute('aria-disabled', 'true');
    }
    actionRow.appendChild(downloadButton);
    artifactLinks.appendChild(card);
  });
}

function buildWarnings(candidate) {
  const warnings = [];
  if (!candidate?.fullCv?.downloaded) warnings.push('CV file has not been downloaded for this candidate yet.');
  if (!candidate?.outreach?.email || candidate.outreach.email.endsWith('@unknown.local')) warnings.push('Candidate email is missing, so the draft is not yet send-ready.');
  if (!candidate?.sourceAudit?.source_url && candidate?.sourceAudit?.import_method !== 'bulk_cv_upload') warnings.push('Source URL is missing, so source evidence relies on the stored audit string only.');
  if (!candidate?.preview?.summary_text) warnings.push('Preview text is missing, so preview-level evidence is limited.');
  return warnings;
}

function candidateLifecycleOptions() {
  return [
    '',
    'strong_open',
    'maybe_open',
    'low_priority',
    'reject',
    'cv_reviewed',
    'strong_shortlist',
    'possible_shortlist',
    'do_not_progress',
    'outreach_ready',
    'outreach_drafted',
    'contacted',
    'awaiting_reply',
    'closed',
  ];
}

function renderDetailActions(role, candidate) {
  detailActions.innerHTML = '';
  if (!candidate) return;
  const roleKey = roleKeyForRole(role);
  const actions = [
    ['Open Record', () => openArtifact(roleKey, candidate.artifacts?.candidateRecord?.path)],
    ['Open CV', () => openArtifact(roleKey, candidate.artifacts?.cvFile?.path), !candidate.artifacts?.cvFile?.exists],
    ['Download CV', () => window.open(artifactUrl(roleKey, candidate.artifacts?.cvFile?.path, true), '_blank', 'noopener'), !candidate.artifacts?.cvFile?.exists],
    ['Open Draft', () => openArtifact(roleKey, candidate.artifacts?.outreachDraft?.path), !candidate.artifacts?.outreachDraft?.exists],
    ['Copy Email', () => copyToClipboard(candidate.outreach?.email || candidate.identity?.email || '', 'Email copied.'), !(candidate.outreach?.email || candidate.identity?.email)],
    ['Copy Subject', () => copyToClipboard(candidate.outreach?.subject || '', 'Subject copied.'), !candidate.outreach?.subject],
    ['Copy Body', () => copyToClipboard(candidate.outreach?.body || '', 'Draft body copied.'), !candidate.outreach?.body],
  ];
  actions.forEach(([label, handler, disabled]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tiny-button';
    button.textContent = label;
    button.disabled = !!disabled;
    button.addEventListener('click', handler);
    detailActions.appendChild(button);
  });
}

function renderCandidateDetail(role) {
  const candidate = getSelectedCandidate(role);
  const roleKey = roleKeyForRole(role);
  candidateDetail.dataset.candidateId = candidate?.candidate_id || '';
  renderDetailActions(role, candidate);
  const warnings = buildWarnings(candidate);
  warningBanner.classList.toggle('hidden', warnings.length === 0);
  warningBanner.textContent = warnings.join(' ');
  if (!candidate) {
    candidateDetail.innerHTML = '<div class="empty-state">No candidate is selected for this role yet.</div>';
    return;
  }

  const latestContact = candidate.operatorReview?.contact_log?.slice(-1)[0];
  const changeReview = candidate.changeReview || {};
  const auditRows = (candidate.auditTrail || [])
    .map((entry) => `<div><strong>${escapeHtml(entry.stage || 'event')}</strong><br>${escapeHtml(formatDateTime(entry.at) || '')}<br>${escapeHtml(entry.note || entry.reason || '')}</div>`)
    .join('');
  const bucketLabel = candidate.operatorReview?.shortlist_bucket
    ? `<span class="bucket-pill ${escapeAttribute(candidate.operatorReview.shortlist_bucket)}">${escapeHtml(candidate.operatorReview.shortlist_bucket)}</span>`
    : '<span class="subtle">No shortlist bucket set.</span>';
  const candidateArtifacts = Object.values(candidate.artifacts || {});

  candidateDetail.innerHTML = `
    <div class="detail-section">
      <div class="detail-grid">
        <div class="key-value"><strong>Candidate</strong><span>${escapeHtml(candidate.identity?.name || '')}</span></div>
        <div class="key-value"><strong>Title</strong><span>${escapeHtml(candidate.identity?.title || 'Not set')}</span></div>
        <div class="key-value"><strong>Rank</strong><span>#${escapeHtml(candidate.ranking?.position || 0)} · ${escapeHtml(candidate.ranking?.total_score || 0)}</span></div>
        <div class="key-value"><strong>Lifecycle</strong><span>${escapeHtml(candidate.lifecycle?.current_stage || 'preview_only')}</span></div>
        <div class="key-value"><strong>Shortlist</strong><span>${escapeHtml(candidate.status?.shortlist_stage || 'pending')}</span></div>
        <div class="key-value"><strong>Email</strong><span>${escapeHtml(candidate.outreach?.email || candidate.identity?.email || 'Missing')}</span></div>
        <div class="key-value"><strong>Bucket</strong><span>${bucketLabel}</span></div>
        <div class="key-value"><strong>Recruiter Confidence</strong><span>${escapeHtml(candidate.operatorReview?.recruiter_confidence || 'Not set')}</span></div>
        <div class="key-value"><strong>Pinned</strong><span>${candidate.operatorReview?.ranking_pin ? 'Yes' : 'No'}</span></div>
        <div class="key-value"><strong>Last Reviewed</strong><span>${escapeHtml(formatDateTime(candidate.operatorReview?.updated_at) || 'Not reviewed yet')}</span></div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Source Audit</h3>
      <div class="detail-grid">
        <div class="key-value"><strong>Source</strong><span>${escapeHtml(candidate.sourceAudit?.source_name || '')}</span></div>
        <div class="key-value"><strong>Search Variant</strong><span>${escapeHtml(candidate.preview?.structured_fields?.search_variant || '')}</span></div>
        <div class="key-value"><strong>Boolean Used</strong><span>${escapeHtml(candidate.preview?.structured_fields?.boolean_used || role.searchPack?.primaryBoolean || 'Not stored')}</span></div>
        <div class="key-value"><strong>Found / Imported</strong><span>${escapeHtml(formatDateTime(candidate.preview?.structured_fields?.found_at) || 'Unknown')} · ${escapeHtml(formatDateTime(candidate.preview?.structured_fields?.imported_at) || 'Unknown')}</span></div>
        <div class="key-value"><strong>Source URL</strong><span>${candidate.sourceAudit?.source_url ? `<a href="${escapeAttribute(candidate.sourceAudit.source_url)}" target="_blank" rel="noopener">${escapeHtml(candidate.sourceAudit.source_url)}</a>` : 'Not stored'}</span></div>
        <div class="key-value"><strong>Import Method</strong><span>${escapeHtml(candidate.sourceAudit?.import_method || 'manual_entry')}</span></div>
        <div class="key-value"><strong>Reference ID</strong><span>${escapeHtml(candidate.sourceAudit?.source_reference_id || 'Not stored')}</span></div>
      </div>
      <div class="detail-section">
        <strong>Audit String</strong>
        <div>${escapeHtml(candidate.sourceAudit?.display || '')}</div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Change Since Last Import</h3>
      ${changeReview.changed ? `
        <div class="detail-grid">
          <div class="key-value"><strong>Changed</strong><span>${changeReview.import_change?.change_type || 'run_update'}</span></div>
          <div class="key-value"><strong>Rank Movement</strong><span>${changeReview.rank_change ? `${changeReview.rank_change.from || 'unranked'} -> ${changeReview.rank_change.to || 'unranked'}` : 'No change'}</span></div>
          <div class="key-value"><strong>Status Movement</strong><span>${changeReview.status_change ? `${changeReview.status_change.from_stage || 'none'} -> ${changeReview.status_change.to_stage || 'none'}` : 'No change'}</span></div>
          <div class="key-value"><strong>Draft / Shortlist Change</strong><span>${changeReview.draft_added ? 'New draft created' : 'No new draft'}${changeReview.shortlist_ready_changed ? ' · shortlist-ready changed' : ''}</span></div>
        </div>
        <div class="stacked-list">
          ${(changeReview.summaries || []).map((summary) => `<span class="reason-pill">${escapeHtml(summary)}</span>`).join('')}
        </div>
        <div class="detail-grid">
          <div>
            <strong>Changed Fields</strong>
            ${listMarkup(changeReview.import_change?.field_changes?.map((entry) => `${entry.label}: ${entry.previous || 'blank'} -> ${entry.current || 'blank'}`), 'No field-level changes recorded.')}
          </div>
          <div>
            <strong>Source Evidence Changes</strong>
            ${listMarkup(changeReview.import_change?.source_changes?.map((entry) => `${entry.label}: ${entry.previous || 'blank'} -> ${entry.current || 'blank'}`), 'No source evidence changes recorded.')}
          </div>
        </div>
        <div class="detail-grid">
          <div>
            <strong>Previous Preview</strong>
            <div>${escapeHtml(changeReview.import_change?.previous_preview_excerpt || 'No previous preview excerpt stored.')}</div>
          </div>
          <div>
            <strong>Latest Preview</strong>
            <div>${escapeHtml(changeReview.import_change?.current_preview_excerpt || 'No latest preview excerpt stored.')}</div>
          </div>
        </div>
      ` : '<div class="subtle">No candidate-level change was recorded in the latest import or run.</div>'}
    </div>

    <div class="detail-section">
      <h3>Imported Preview / Profile Evidence</h3>
      <div class="detail-section">
        <strong>Imported Preview Text</strong>
        <div>${escapeHtml(candidate.preview?.summary_text || 'No preview text stored.')}</div>
      </div>
      <div class="detail-grid">
        <div class="key-value"><strong>Headline</strong><span>${escapeHtml(candidate.preview?.headline || 'Not set')}</span></div>
        <div class="key-value"><strong>Location / Mobility</strong><span>${escapeHtml(candidate.identity?.location || 'Not set')} · ${escapeHtml(candidate.preview?.structured_fields?.mobility || 'Not set')}</span></div>
        <div class="key-value"><strong>Sector Tags</strong><span>${escapeHtml((candidate.preview?.structured_fields?.sector_tags || []).join(', ') || 'None')}</span></div>
        <div class="key-value"><strong>Preview Score</strong><span>${escapeHtml(candidate.preview?.triage?.totalScore || 0)}</span></div>
      </div>
      <div class="detail-grid">
        <div><strong>Preview Reasons</strong>${listMarkup(candidate.preview?.triage?.reasons, 'No preview reasons stored yet.')}</div>
        <div><strong>Missing Critical Info</strong>${listMarkup(candidate.machineAssessment?.preview_missing_info, 'No missing critical info flagged.')}</div>
        <div><strong>Hard Reject Reasons</strong>${listMarkup(candidate.machineAssessment?.preview_hard_reject_reasons, 'No hard reject reasons flagged.')}</div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Extracted CV Evidence</h3>
      <div class="detail-grid">
        <div class="key-value"><strong>Downloaded</strong><span>${candidate.fullCv?.downloaded ? 'Yes' : 'No'}</span></div>
        <div class="key-value"><strong>Review Status</strong><span>${escapeHtml(candidate.fullCv?.review_status || 'not_reviewed')}</span></div>
        <div class="key-value"><strong>Shortlist Recommendation</strong><span>${escapeHtml(candidate.fullCv?.shortlist_recommendation || 'Pending')}</span></div>
        <div class="key-value"><strong>Reviewed At</strong><span>${escapeHtml(formatDateTime(candidate.fullCv?.reviewed_at) || 'Not reviewed')}</span></div>
      </div>
      <div class="detail-section"><strong>Extraction Summary</strong><div>${escapeHtml(candidate.fullCv?.extraction_summary || 'No CV extraction summary yet.')}</div></div>
      <div class="detail-grid">
        <div><strong>Highlights</strong>${listMarkup(candidate.fullCv?.highlights, 'No highlights yet.')}</div>
        <div><strong>Strengths</strong>${listMarkup(candidate.fullCv?.strengths, 'No strengths yet.')}</div>
        <div><strong>Concerns</strong>${listMarkup(candidate.fullCv?.concerns, 'No concerns yet.')}</div>
        <div><strong>Follow-Up Questions</strong>${listMarkup(candidate.fullCv?.follow_up_questions, 'No follow-up questions yet.')}</div>
      </div>
      <div class="detail-section"><strong>Uncertainty Notes</strong><div>${listMarkup(candidate.fullCv?.uncertainty_notes, 'No uncertainty notes recorded.')}</div></div>
    </div>

    <div class="detail-section">
      <h3>Machine Assessment</h3>
      <div class="detail-grid">
        <div class="key-value"><strong>Preview Classification</strong><span>${escapeHtml(candidate.machineAssessment?.preview_classification || 'Not assessed')}</span></div>
        <div class="key-value"><strong>CV Score</strong><span>${escapeHtml(candidate.machineAssessment?.cv_score || 0)}</span></div>
        <div class="key-value"><strong>Shortlist Recommendation</strong><span>${escapeHtml(candidate.machineAssessment?.shortlist_recommendation || 'Pending')}</span></div>
        <div class="key-value"><strong>Outreach Ready</strong><span>${candidate.outreach?.ready ? 'Yes' : 'No'}</span></div>
      </div>
      <div class="detail-section"><strong>Suitability Summary</strong><div>${escapeHtml(candidate.machineAssessment?.suitability_summary || 'No machine suitability summary yet.')}</div></div>
      <div class="detail-grid">
        <div class="key-value"><strong>Rank Breakdown</strong><span>Base ${escapeHtml(candidate.ranking?.breakdown?.base_score || 0)} · Stage ${escapeHtml(candidate.ranking?.breakdown?.stage_boost || 0)} · Bucket ${escapeHtml(candidate.ranking?.breakdown?.bucket_boost || 0)} · Pin ${escapeHtml(candidate.ranking?.breakdown?.pin_boost || 0)}</span></div>
        <div class="key-value"><strong>Why Ranked Here</strong><span>${escapeHtml((candidate.ranking?.reasons || []).join(', ') || 'No ranking reasons stored yet.')}</span></div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Candidate Artifacts</h3>
      <div class="detail-grid">
        ${candidateArtifacts.map((artifact) => `
          <div class="stacked-block">
            <strong>${escapeHtml(artifact.label || artifact.path || 'Artifact')}</strong>
            <div>${escapeHtml(artifact.exists ? 'Available' : artifact.empty_state || 'Missing')}</div>
            <div class="subtle">${escapeHtml(artifact.path || '')}</div>
            <div class="subtle">Updated ${escapeHtml(formatDateTime(artifact.last_updated) || 'Not yet')}</div>
            <div class="subtle">Source of truth: ${escapeHtml(artifact.source_of_truth || 'filesystem')}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="detail-section">
      <h3>Outreach Data</h3>
      <div class="detail-grid">
        <div class="key-value"><strong>Email</strong><span>${escapeHtml(candidate.outreach?.email || 'Missing')}</span></div>
        <div class="key-value"><strong>Subject</strong><span>${escapeHtml(candidate.outreach?.subject || 'Not prepared')}</span></div>
        <div class="key-value"><strong>Why Contacted</strong><span>${escapeHtml(candidate.outreach?.why_contacted_summary || 'Not prepared')}</span></div>
        <div class="key-value"><strong>Draft File</strong><span>${escapeHtml(candidate.outreach?.draft_path || 'Not generated')}</span></div>
      </div>
      <div class="detail-section"><strong>Draft Body</strong><div>${escapeHtml(candidate.outreach?.body || 'No draft prepared yet.')}</div></div>
    </div>

    <div class="detail-section">
      <h3>Operator Assessment</h3>
      <div class="detail-grid">
        <div><strong>Operator Strengths</strong>${listMarkup(candidate.operatorReview?.strengths, 'No operator strengths recorded yet.')}</div>
        <div><strong>Operator Concerns</strong>${listMarkup(candidate.operatorReview?.concerns, 'No operator concerns recorded yet.')}</div>
        <div><strong>Follow-Up Questions</strong>${listMarkup(candidate.operatorReview?.follow_up_questions, 'No follow-up questions recorded yet.')}</div>
        <div><strong>Final Manual Rationale</strong><div>${escapeHtml(candidate.operatorReview?.final_manual_rationale || 'No final manual rationale yet.')}</div></div>
      </div>
      <form id="candidateReviewForm" class="form-grid">
        <div class="field">
          <label for="operatorDecision">Operator Decision</label>
          <select id="operatorDecision" name="operatorDecision">
            <option value="">No override</option>
            ${['manual_screened', 'hold', 'do_not_progress', 'contacted', 'awaiting_reply', 'closed']
              .map((option) => `<option value="${escapeHtml(option)}" ${candidate.operatorReview?.decision === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="shortlistStatus">Shortlist Status</label>
          <select id="shortlistStatus" name="shortlistStatus">
            <option value="">No override</option>
            ${['strong_shortlist', 'possible_shortlist', 'do_not_progress']
              .map((option) => `<option value="${escapeHtml(option)}" ${candidate.operatorReview?.shortlist_status === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="shortlistBucket">Shortlist Bucket</label>
          <select id="shortlistBucket" name="shortlistBucket">
            <option value="">No bucket</option>
            ${['primary', 'backup', 'hold', 'do_not_progress']
              .map((option) => `<option value="${escapeHtml(option)}" ${candidate.operatorReview?.shortlist_bucket === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="lifecycleStage">Lifecycle Stage</label>
          <select id="lifecycleStage" name="lifecycleStage">
            ${candidateLifecycleOptions()
              .map((option) => `<option value="${escapeHtml(option)}" ${candidate.operatorReview?.lifecycle_stage === option ? 'selected' : ''}>${escapeHtml(option || 'No override')}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="outreachReady">Outreach Ready Override</label>
          <select id="outreachReady" name="outreachReady">
            <option value="">No override</option>
            <option value="true" ${candidate.operatorReview?.outreach_ready_override === true ? 'selected' : ''}>true</option>
            <option value="false" ${candidate.operatorReview?.outreach_ready_override === false ? 'selected' : ''}>false</option>
          </select>
        </div>
        <div class="field">
          <label for="rankingPin">Manual Pin</label>
          <select id="rankingPin" name="rankingPin">
            <option value="false" ${candidate.operatorReview?.ranking_pin === true ? '' : 'selected'}>false</option>
            <option value="true" ${candidate.operatorReview?.ranking_pin === true ? 'selected' : ''}>true</option>
          </select>
        </div>
        <div class="field">
          <label for="recruiterConfidence">Recruiter Confidence</label>
          <select id="recruiterConfidence" name="recruiterConfidence">
            <option value="">Not set</option>
            ${['low', 'medium', 'high']
              .map((option) => `<option value="${escapeHtml(option)}" ${candidate.operatorReview?.recruiter_confidence === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="recommendedNextStep">Recommended Next Step</label>
          <input id="recommendedNextStep" name="recommendedNextStep" value="${escapeAttribute(candidate.operatorReview?.recommended_next_step || '')}">
        </div>
        <div class="field full-span">
          <label for="manualNotes">Manual Notes</label>
          <textarea id="manualNotes" name="manualNotes">${escapeHtml(candidate.operatorReview?.manual_notes || '')}</textarea>
        </div>
        <div class="field full-span">
          <label for="manualScreeningSummary">Manual Screening Summary</label>
          <textarea id="manualScreeningSummary" name="manualScreeningSummary">${escapeHtml(candidate.operatorReview?.manual_screening_summary || '')}</textarea>
        </div>
        <div class="field full-span">
          <label for="strengths">Operator Strengths</label>
          <textarea id="strengths" name="strengths">${escapeHtml(arrayText(candidate.operatorReview?.strengths))}</textarea>
        </div>
        <div class="field full-span">
          <label for="concerns">Operator Concerns</label>
          <textarea id="concerns" name="concerns">${escapeHtml(arrayText(candidate.operatorReview?.concerns))}</textarea>
        </div>
        <div class="field full-span">
          <label for="followUpQuestions">Follow-Up Questions</label>
          <textarea id="followUpQuestions" name="followUpQuestions">${escapeHtml(arrayText(candidate.operatorReview?.follow_up_questions))}</textarea>
        </div>
        <div class="field">
          <label for="appetiteNotes">Appetite / Interest Notes</label>
          <textarea id="appetiteNotes" name="appetiteNotes">${escapeHtml(candidate.operatorReview?.appetite_notes || '')}</textarea>
        </div>
        <div class="field">
          <label for="availabilityNotes">Availability Notes</label>
          <textarea id="availabilityNotes" name="availabilityNotes">${escapeHtml(candidate.operatorReview?.availability_notes || '')}</textarea>
        </div>
        <div class="field">
          <label for="compensationNotes">Compensation / Rate Notes</label>
          <textarea id="compensationNotes" name="compensationNotes">${escapeHtml(candidate.operatorReview?.compensation_notes || '')}</textarea>
        </div>
        <div class="field">
          <label for="locationMobilityNotes">Location / Mobility Notes</label>
          <textarea id="locationMobilityNotes" name="locationMobilityNotes">${escapeHtml(candidate.operatorReview?.location_mobility_notes || '')}</textarea>
        </div>
        <div class="field full-span">
          <label for="finalManualRationale">Final Manual Rationale</label>
          <textarea id="finalManualRationale" name="finalManualRationale">${escapeHtml(candidate.operatorReview?.final_manual_rationale || '')}</textarea>
        </div>
        <div class="field full-span">
          <label for="overrideReason">Override Reason</label>
          <textarea id="overrideReason" name="overrideReason">${escapeHtml(candidate.operatorReview?.override_reason || '')}</textarea>
        </div>
        <div class="full-span inline-actions">
          <button id="saveCandidateReviewButton" class="primary-button" type="submit">Save Review Update</button>
          <button id="markContactedButton" class="secondary-button" type="button">Mark Contacted</button>
          <button id="markAwaitingReplyButton" class="ghost-button" type="button">Awaiting Reply</button>
          <button id="markClosedButton" class="ghost-button" type="button">Close Candidate</button>
        </div>
      </form>
      <div class="detail-grid">
        <div><strong>Latest Contact</strong><div>${escapeHtml(latestContact?.stage || 'No contact logged')}</div><div class="subtle">${escapeHtml(formatDateTime(latestContact?.at) || '')}</div></div>
        <div><strong>Availability Notes</strong><div>${escapeHtml(candidate.operatorReview?.availability_notes || 'None')}</div></div>
        <div><strong>Appetite Notes</strong><div>${escapeHtml(candidate.operatorReview?.appetite_notes || 'None')}</div></div>
        <div><strong>Compensation Notes</strong><div>${escapeHtml(candidate.operatorReview?.compensation_notes || 'None')}</div></div>
        <div><strong>Location / Mobility Notes</strong><div>${escapeHtml(candidate.operatorReview?.location_mobility_notes || 'None')}</div></div>
        <div><strong>Recommended Next Step</strong><div>${escapeHtml(candidate.operatorReview?.recommended_next_step || 'Not set')}</div></div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Audit Trail</h3>
      <div class="info-list">${auditRows || '<div class="subtle">No audit trail events yet.</div>'}</div>
    </div>
  `;

  const reviewForm = document.getElementById('candidateReviewForm');
  reviewForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    saveCandidateReview(roleKey, candidate.candidate_id).catch((error) => setStatus(error.message || String(error), 'error'));
  });
  document.getElementById('markContactedButton')?.addEventListener('click', () => logContact(roleKey, candidate.candidate_id, 'contacted'));
  document.getElementById('markAwaitingReplyButton')?.addEventListener('click', () => logContact(roleKey, candidate.candidate_id, 'awaiting_reply'));
  document.getElementById('markClosedButton')?.addEventListener('click', () => logContact(roleKey, candidate.candidate_id, 'closed'));
}

function renderRoleConfigForm(role) {
  roleConfigForm.innerHTML = '';
  ROLE_CONFIG_FIELDS.forEach((field) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    if (field.type === 'checkbox') {
      wrapper.innerHTML = `
        <label for="${field.key}">${escapeHtml(field.label)}</label>
        <select id="${field.key}" name="${field.key}">
          <option value="false" ${(role.roleConfig?.[field.key] === false || role.roleConfig?.[field.key] == null) ? 'selected' : ''}>false</option>
          <option value="true" ${role.roleConfig?.[field.key] === true ? 'selected' : ''}>true</option>
        </select>
      `;
    } else if (field.type === 'select') {
      wrapper.innerHTML = `
        <label for="${field.key}">${escapeHtml(field.label)}</label>
        <select id="${field.key}" name="${field.key}">
          ${field.options.map((option) => `<option value="${escapeHtml(option)}" ${role.roleConfig?.[field.key] === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
        </select>
      `;
    } else {
      wrapper.innerHTML = `
        <label for="${field.key}">${escapeHtml(field.label)}</label>
        <input id="${field.key}" name="${field.key}" type="${field.type}" min="${field.min ?? ''}" step="${field.step ?? ''}" value="${escapeHtml(role.roleConfig?.[field.key] ?? '')}">
      `;
    }
    roleConfigForm.appendChild(wrapper);
  });
  const actionRow = document.createElement('div');
  actionRow.className = 'full-span inline-actions';
  actionRow.innerHTML = '<button id="saveRoleConfigButton" class="primary-button" type="submit">Save Role Settings</button>';
  roleConfigForm.appendChild(actionRow);
}

async function copyToClipboard(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(successMessage, 'success');
  } catch {
    setStatus('Copy failed. Please copy manually from the visible text.', 'error');
  }
}

async function openArtifact(roleId, relativePath) {
  if (!relativePath) return;
  setBusy(true, `Opening ${relativePath}...`);
  try {
    await api('/api/open-path', {
      method: 'POST',
      body: JSON.stringify({ roleId, relativePath }),
    });
    setStatus(`Opened ${relativePath}.`, 'success');
  } finally {
    setBusy(false);
    renderRoleList();
  }
}

async function loadRoleIndex() {
  const result = await api('/api/role-index');
  state.roleIndex = result.roles || [];
  if (!state.selectedRoleId && state.roleIndex.length) {
    state.selectedRoleId = state.roleIndex[0].role_slug || state.roleIndex[0].role_id;
  }
  renderRoleList();
}

async function loadRoleDetail(roleId) {
  setStatus(`Loading ${roleId}...`, 'busy');
  const result = await api(`/api/roles/${encodeURIComponent(roleId)}`);
  state.selectedRole = result.role;
  state.selectedRoleId = roleId;
  const selectedCandidate = getSelectedCandidate(state.selectedRole);
  if (!state.selectedCandidateId || !candidateListForRole(state.selectedRole).some((candidate) => candidate.candidate_id === state.selectedCandidateId)) {
    state.selectedCandidateId = selectedCandidate?.candidate_id || '';
  }
  render();
  setStatus(`Loaded ${state.selectedRole.roleTitle || state.selectedRole.roleId}.`, 'success');
}

async function refreshAll() {
  await loadRoleIndex();
  if (state.selectedRoleId) {
    await loadRoleDetail(state.selectedRoleId);
  } else {
    render();
  }
}

function render() {
  const role = state.selectedRole;
  if (!role) {
    roleTitle.textContent = 'Select a role';
    roleMeta.textContent = 'Create or refresh a role to start reviewing candidates.';
    metricCards.innerHTML = '';
    overviewBlock.innerHTML = '<div><strong>Status</strong><br>No role selected.</div>';
    progressBlock.innerHTML = '<div><strong>Status</strong><br>No role selected.</div>';
    nextActions.innerHTML = '<li>Initialise a role folder or refresh the workflow.</li>';
    reviewQueues.innerHTML = '<div class="empty-state">No review queues yet.</div>';
    roleHistory.innerHTML = '<div class="empty-state">No role history yet.</div>';
    candidateFilters.innerHTML = '';
    candidateList.innerHTML = '<div class="empty-state">No candidates yet.</div>';
    candidateDetail.innerHTML = '<div class="empty-state">Select a role to review shortlisted candidates.</div>';
    artifactLinks.innerHTML = '';
    roleConfigForm.innerHTML = '';
    detailActions.innerHTML = '';
    warningBanner.classList.add('hidden');
    renderImportPanel(null);
    if (bulkCvSummary) {
      bulkCvSummary.textContent = 'Choose up to 20 PDF or DOCX CVs for the selected role. Legacy DOC remains manual for now.';
    }
    return;
  }

  roleTitle.textContent = role.roleTitle || role.roleId;
  roleMeta.textContent = `${role.roleId} · ${(role.roleState || role.metrics?.role_workflow_state || 'gathering_candidates').replace(/_/g, ' ')} · Updated ${formatDateTime(role.updatedAt) || 'not yet run'} · ${role.shortlistProgress?.message || ''}`;
  renderMetricCards(role);
  renderOverview(role);
  renderProgress(role);
  renderReviewQueues(role);
  renderRoleHistory(role);
  renderImportPanel(role);
  renderCandidateFilters(role);
  renderCandidateList(role);
  renderCandidateDetail(role);
  renderArtifacts(role);
  renderRoleConfigForm(role);
}

async function runAction(action) {
  if (!state.selectedRoleId) return;
  setBusy(true, `Running ${action} for ${state.selectedRoleId}...`);
  try {
    await api(`/api/roles/${encodeURIComponent(state.selectedRoleId)}/run`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    await refreshAll();
    setStatus(`Completed ${action} for ${state.selectedRoleId}.`, 'success');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function initRole() {
  const roleTitleInput = window.prompt('Role title');
  if (!roleTitleInput) return;
  const slugInput = window.prompt('Role id / slug', roleTitleInput.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  if (!slugInput) return;
  setBusy(true, `Initialising ${slugInput}...`);
  try {
    await api('/api/init-role', {
      method: 'POST',
      body: JSON.stringify({ roleId: slugInput, roleTitle: roleTitleInput }),
    });
    state.selectedRoleId = slugInput;
    await refreshAll();
    setStatus(`Initialised ${roleTitleInput}.`, 'success');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file?.name || 'the selected file'}.`));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file?.name || 'the selected file'}.`));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

async function importBatch() {
  if (!state.selectedRoleId) {
    setStatus('Select a role before importing a preview batch.', 'error');
    return;
  }
  const file = importFileInput?.files?.[0];
  if (!file) {
    setStatus('Choose a CSV or JSON batch before importing.', 'error');
    return;
  }
  if (!/\.(csv|json)$/i.test(file.name)) {
    setStatus('Upload must be a CSV or JSON preview batch.', 'error');
    return;
  }
  if (file.size === 0) {
    setStatus(`The selected file ${file.name} is empty.`, 'error');
    return;
  }

  const text = await readFileAsText(file);
  const postImportActionValue = importPostAction?.value || 'run_preview_triage';
  setBusy(true, `Importing ${file.name} into ${state.selectedRoleId}...`);
  try {
    const result = await api(`/api/roles/${encodeURIComponent(state.selectedRoleId)}/import`, {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        text,
        postImportAction: postImportActionValue,
      }),
    });
    state.selectedRole = result.role;
    importSummary.textContent = summariseImportResult(result.importResult);
    const entry = result.importResult?.importHistoryEntry || {};
    state.candidateFilter = (entry.updated?.count || 0) > 0
      ? 'changed_since_last_import'
      : (entry.added?.count || 0) > 0
        ? 'new_since_last_review'
        : 'all';
    const visibleCandidates = filteredCandidates(result.role);
    state.selectedCandidateId = visibleCandidates[0]?.candidate_id || getSelectedCandidate(result.role)?.candidate_id || '';
    render();
    await loadRoleIndex();
    setStatus(`Imported ${file.name}. ${summariseImportResult(result.importResult)}.`, 'success');
    if (importFileInput) importFileInput.value = '';
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function uploadBulkCvBatch() {
  if (!state.selectedRoleId) {
    setStatus('Select a role before uploading CVs.', 'error');
    return;
  }
  const files = Array.from(bulkCvFileInput?.files || []);
  if (!files.length) {
    setStatus('Choose one or more PDF or DOCX CVs before uploading.', 'error');
    return;
  }
  if (files.length > 20) {
    setStatus('Upload up to 20 CV files at a time.', 'error');
    return;
  }
  const allowed = files.every((file) => /\.(pdf|docx|doc|txt)$/i.test(file.name || ''));
  if (!allowed) {
    setStatus('Bulk CV upload currently supports PDF and DOCX reliably. TXT is allowed for manual recovery; legacy DOC remains limited.', 'error');
    return;
  }

  setBusy(true, `Uploading ${files.length} CV file(s) into ${state.selectedRoleId}...`);
  try {
    const encodedFiles = await Promise.all(files.map(async (file) => ({
      name: file.name,
      size: file.size,
      contentType: file.type || '',
      data: await readFileAsDataUrl(file),
    })));
    const postImportActionValue = bulkCvPostAction?.value || 'review_downloaded_cvs';
    const result = await api(`/api/roles/${encodeURIComponent(state.selectedRoleId)}/bulk-cv-upload`, {
      method: 'POST',
      body: JSON.stringify({
        files: encodedFiles,
        postImportAction: postImportActionValue,
      }),
    });
    state.selectedRole = result.role;
    if (bulkCvSummary) {
      bulkCvSummary.textContent = summariseBulkCvResult(result.bulkImportResult);
    }
    const importEntry = result.bulkImportResult?.importResult?.importHistoryEntry || {};
    state.candidateFilter = (importEntry.updated?.count || 0) > 0
      ? 'changed_since_last_import'
      : (importEntry.added?.count || 0) > 0
        ? 'new_since_last_review'
        : 'all';
    const visibleCandidates = filteredCandidates(result.role);
    state.selectedCandidateId = visibleCandidates[0]?.candidate_id || getSelectedCandidate(result.role)?.candidate_id || '';
    render();
    await loadRoleIndex();
    setStatus(`Bulk CV upload completed. ${summariseBulkCvResult(result.bulkImportResult)}.`, 'success');
    if (bulkCvFileInput) bulkCvFileInput.value = '';
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function saveRoleConfig() {
  if (!state.selectedRoleId) return;
  const patch = {};
  const formData = new FormData(roleConfigForm);
  ROLE_CONFIG_FIELDS.forEach((field) => {
    const raw = formData.get(field.key);
    if (raw == null) return;
    patch[field.key] = field.type === 'number'
      ? Number(raw)
      : field.type === 'checkbox'
        ? raw === 'true'
        : raw;
  });
  setBusy(true, `Saving role settings for ${state.selectedRoleId}...`);
  try {
    await api(`/api/roles/${encodeURIComponent(state.selectedRoleId)}/config`, {
      method: 'POST',
      body: JSON.stringify({ patch }),
    });
    await refreshAll();
    setStatus(`Saved role settings for ${state.selectedRoleId}.`, 'success');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function saveCandidateReview(roleId, candidateId) {
  const patch = {
    decision: document.getElementById('operatorDecision')?.value || '',
    shortlist_status: document.getElementById('shortlistStatus')?.value || '',
    shortlist_bucket: document.getElementById('shortlistBucket')?.value || '',
    ranking_pin: document.getElementById('rankingPin')?.value || 'false',
    lifecycle_stage: document.getElementById('lifecycleStage')?.value || '',
    outreach_ready_override: document.getElementById('outreachReady')?.value || '',
    manual_notes: document.getElementById('manualNotes')?.value || '',
    strengths: document.getElementById('strengths')?.value || '',
    concerns: document.getElementById('concerns')?.value || '',
    follow_up_questions: document.getElementById('followUpQuestions')?.value || '',
    appetite_notes: document.getElementById('appetiteNotes')?.value || '',
    availability_notes: document.getElementById('availabilityNotes')?.value || '',
    compensation_notes: document.getElementById('compensationNotes')?.value || '',
    location_mobility_notes: document.getElementById('locationMobilityNotes')?.value || '',
    manual_screening_summary: document.getElementById('manualScreeningSummary')?.value || '',
    recommended_next_step: document.getElementById('recommendedNextStep')?.value || '',
    recruiter_confidence: document.getElementById('recruiterConfidence')?.value || '',
    final_manual_rationale: document.getElementById('finalManualRationale')?.value || '',
    override_reason: document.getElementById('overrideReason')?.value || '',
  };
  if (patch.outreach_ready_override === '') delete patch.outreach_ready_override;
  setBusy(true, `Saving review update for ${candidateId}...`);
  try {
    await api(`/api/roles/${encodeURIComponent(roleId)}/candidates/${encodeURIComponent(candidateId)}/update`, {
      method: 'POST',
      body: JSON.stringify({ patch }),
    });
    await refreshAll();
    state.selectedCandidateId = candidateId;
    setStatus(`Saved review update for ${candidateId}.`, 'success');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
}

async function logContact(roleId, candidateId, stage) {
  const note = window.prompt(`Note for ${stage.replace('_', ' ')}:`) || '';
  const messageSummary = window.prompt('Optional message summary:', '') || '';
  setBusy(true, `Updating ${stage} for ${candidateId}...`);
  try {
    await api(`/api/roles/${encodeURIComponent(roleId)}/candidates/${encodeURIComponent(candidateId)}/contact`, {
      method: 'POST',
      body: JSON.stringify({
        stage,
        date: new Date().toISOString(),
        note,
        messageSummary,
      }),
    });
    await refreshAll();
    state.selectedCandidateId = candidateId;
    setStatus(`Updated ${candidateId} to ${stage}.`, 'success');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  } finally {
    setBusy(false);
  }
}

refreshRolesButton.addEventListener('click', () => {
  if (state.busy) return;
  refreshAll().catch((error) => setStatus(error.message || String(error), 'error'));
});

actionButtons.forEach((button) => {
  button.addEventListener('click', () => runAction(button.dataset.action));
});

initRoleButton.addEventListener('click', () => {
  if (state.busy) return;
  initRole().catch((error) => setStatus(error.message || String(error), 'error'));
});

openWorkflowButton.addEventListener('click', () => {
  if (state.busy) return;
  openArtifact(state.selectedRoleId || '', '.').catch((error) => setStatus(error.message || String(error), 'error'));
});

importBatchButton.addEventListener('click', () => {
  if (state.busy) return;
  importBatch().catch((error) => setStatus(error.message || String(error), 'error'));
});

bulkCvUploadButton?.addEventListener('click', () => {
  if (state.busy) return;
  uploadBulkCvBatch().catch((error) => setStatus(error.message || String(error), 'error'));
});

roleConfigForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveRoleConfig().catch((error) => setStatus(error.message || String(error), 'error'));
});

window.addEventListener('focus', () => {
  if (state.busy) return;
  refreshAll().catch((error) => setStatus(error.message || String(error), 'error'));
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !state.busy) {
    refreshAll().catch((error) => setStatus(error.message || String(error), 'error'));
  }
});

window.setInterval(() => {
  if (document.visibilityState === 'visible' && !state.busy) {
    loadRoleIndex()
      .catch((error) => setStatus(error.message || String(error), 'error'));
  }
}, 20000);

refreshAll().catch((error) => setStatus(error.message || String(error), 'error'));
