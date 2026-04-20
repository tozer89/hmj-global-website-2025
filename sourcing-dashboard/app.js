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
const actionButtons = Array.from(document.querySelectorAll('[data-action]'));

const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'strong_shortlist', label: 'Strong' },
  { key: 'possible_shortlist', label: 'Possible' },
  { key: 'reject', label: 'Reject' },
  { key: 'outreach_ready', label: 'Outreach Ready' },
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
  [...actionButtons, refreshRolesButton, initRoleButton, openWorkflowButton].forEach((button) => {
    button.disabled = busy;
  });
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
  if (filterKey === 'outreach_ready') return candidate.outreach?.ready === true;
  if (filterKey === 'reject') {
    return ['reject', 'do_not_progress'].includes(candidate.lifecycle?.current_stage) || candidate.status?.shortlist_stage === 'do_not_progress';
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
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `role-item${role.role_id === state.selectedRoleId ? ' active' : ''}`;
    button.innerHTML = [
      `<strong>${escapeHtml(role.role_title || role.role_id)}</strong>`,
      `<div class="subtle">${escapeHtml(`${role.previews_processed || 0} previews · ${role.cvs_reviewed || 0} CVs · target ${role.shortlist_target || 0}`)}</div>`,
      `<div class="subtle">${escapeHtml(role.shortlist_progress_status || 'awaiting_inputs')}</div>`,
    ].join('');
    button.addEventListener('click', () => {
      if (state.busy) return;
      state.selectedRoleId = role.role_id;
      loadRoleDetail(role.role_id).catch((error) => setStatus(error.message || String(error), 'error'));
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
    ['Status', progress.status || 'awaiting_inputs'],
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
    const previewClass = candidate.preview?.triage?.finalClassification || candidate.status?.preview_stage || '';
    const warnings = [];
    if (!candidate.fullCv?.downloaded) warnings.push('No CV');
    if (!candidate.outreach?.email || candidate.outreach.email.endsWith('@unknown.local')) warnings.push('Email missing');
    if (!candidate.sourceAudit?.source_url) warnings.push('Source URL missing');
    button.innerHTML = [
      `<strong>#${escapeHtml(candidate.ranking?.position || '')} ${escapeHtml(candidate.identity?.name || candidate.candidate_id)}</strong>`,
      `<div class="subtle">${escapeHtml(candidate.identity?.title || 'No title')} · ${escapeHtml(candidate.lifecycle?.current_stage || 'preview_only')}</div>`,
      `<div class="subtle">Score ${escapeHtml(candidate.ranking?.total_score || candidate.preview?.triage?.totalScore || 0)} · ${escapeHtml(previewClass)}</div>`,
      `<div class="reason-list">${(candidate.ranking?.reasons || []).map((reason) => `<span class="reason-pill">${escapeHtml(reason)}</span>`).join('')}</div>`,
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
      `<div class="artifact-status">${escapeHtml(artifact.status || 'missing')} · ${artifact.last_updated ? escapeHtml(artifact.last_updated) : 'Not generated yet'}</div>`,
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
  if (!candidate?.sourceAudit?.source_url) warnings.push('Source URL is missing, so source evidence relies on the stored audit string only.');
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
  const actions = [
    ['Open Record', () => openArtifact(role.roleId, candidate.artifacts?.candidateRecord?.path)],
    ['Open CV', () => openArtifact(role.roleId, candidate.artifacts?.cvFile?.path), !candidate.artifacts?.cvFile?.exists],
    ['Download CV', () => window.open(artifactUrl(role.roleId, candidate.artifacts?.cvFile?.path, true), '_blank', 'noopener'), !candidate.artifacts?.cvFile?.exists],
    ['Open Draft', () => openArtifact(role.roleId, candidate.artifacts?.outreachDraft?.path), !candidate.artifacts?.outreachDraft?.exists],
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
  renderDetailActions(role, candidate);
  const warnings = buildWarnings(candidate);
  warningBanner.classList.toggle('hidden', warnings.length === 0);
  warningBanner.textContent = warnings.join(' ');
  if (!candidate) {
    candidateDetail.innerHTML = '<div class="empty-state">No candidate is selected for this role yet.</div>';
    return;
  }

  const latestContact = candidate.operatorReview?.contact_log?.slice(-1)[0];
  const auditRows = (candidate.auditTrail || [])
    .map((entry) => `<div><strong>${escapeHtml(entry.stage || 'event')}</strong><br>${escapeHtml(entry.at || '')}<br>${escapeHtml(entry.note || entry.reason || '')}</div>`)
    .join('');

  candidateDetail.innerHTML = `
    <div class="detail-section">
      <div class="detail-grid">
        <div class="key-value"><strong>Candidate</strong><span>${escapeHtml(candidate.identity?.name || '')}</span></div>
        <div class="key-value"><strong>Title</strong><span>${escapeHtml(candidate.identity?.title || 'Not set')}</span></div>
        <div class="key-value"><strong>Rank</strong><span>#${escapeHtml(candidate.ranking?.position || 0)} · ${escapeHtml(candidate.ranking?.total_score || 0)}</span></div>
        <div class="key-value"><strong>Lifecycle</strong><span>${escapeHtml(candidate.lifecycle?.current_stage || 'preview_only')}</span></div>
        <div class="key-value"><strong>Shortlist</strong><span>${escapeHtml(candidate.status?.shortlist_stage || 'pending')}</span></div>
        <div class="key-value"><strong>Email</strong><span>${escapeHtml(candidate.outreach?.email || candidate.identity?.email || 'Missing')}</span></div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Profile / Preview Evidence</h3>
      <div class="detail-grid">
        <div class="key-value"><strong>Source</strong><span>${escapeHtml(candidate.sourceAudit?.source_name || '')}</span></div>
        <div class="key-value"><strong>Search Variant</strong><span>${escapeHtml(candidate.preview?.structured_fields?.search_variant || '')}</span></div>
        <div class="key-value"><strong>Boolean Used</strong><span>${escapeHtml(candidate.preview?.structured_fields?.boolean_used || role.searchPack?.primaryBoolean || 'Not stored')}</span></div>
        <div class="key-value"><strong>Found / Imported</strong><span>${escapeHtml(candidate.preview?.structured_fields?.found_at || 'Unknown')} · ${escapeHtml(candidate.preview?.structured_fields?.imported_at || 'Unknown')}</span></div>
        <div class="key-value"><strong>Source URL</strong><span>${escapeHtml(candidate.sourceAudit?.source_url || 'Not stored')}</span></div>
      </div>
      <div class="detail-section">
        <strong>Audit String</strong>
        <div>${escapeHtml(candidate.sourceAudit?.display || '')}</div>
      </div>
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
      <div class="stacked-list">
        ${(candidate.preview?.triage?.reasons || []).map((reason) => `<span class="reason-pill">${escapeHtml(reason)}</span>`).join('') || '<span class="subtle">No triage reasons stored.</span>'}
      </div>
    </div>

    <div class="detail-section">
      <h3>CV Review</h3>
      <div class="detail-grid">
        <div class="key-value"><strong>Downloaded</strong><span>${candidate.fullCv?.downloaded ? 'Yes' : 'No'}</span></div>
        <div class="key-value"><strong>Review Status</strong><span>${escapeHtml(candidate.fullCv?.review_status || 'not_reviewed')}</span></div>
        <div class="key-value"><strong>Shortlist Recommendation</strong><span>${escapeHtml(candidate.fullCv?.shortlist_recommendation || 'Pending')}</span></div>
        <div class="key-value"><strong>Reviewed At</strong><span>${escapeHtml(candidate.fullCv?.reviewed_at || 'Not reviewed')}</span></div>
      </div>
      <div class="detail-section"><strong>Extraction Summary</strong><div>${escapeHtml(candidate.fullCv?.extraction_summary || 'No CV extraction summary yet.')}</div></div>
      <div class="detail-grid">
        <div><strong>Highlights</strong>${(candidate.fullCv?.highlights || []).map((item) => `<div>${escapeHtml(item)}</div>`).join('') || '<div class="subtle">No highlights yet.</div>'}</div>
        <div><strong>Strengths</strong>${(candidate.fullCv?.strengths || []).map((item) => `<div>${escapeHtml(item)}</div>`).join('') || '<div class="subtle">No strengths yet.</div>'}</div>
        <div><strong>Concerns</strong>${(candidate.fullCv?.concerns || []).map((item) => `<div>${escapeHtml(item)}</div>`).join('') || '<div class="subtle">No concerns yet.</div>'}</div>
        <div><strong>Follow-Up Questions</strong>${(candidate.fullCv?.follow_up_questions || []).map((item) => `<div>${escapeHtml(item)}</div>`).join('') || '<div class="subtle">No follow-up questions yet.</div>'}</div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Outreach Draft</h3>
      <div class="detail-grid">
        <div class="key-value"><strong>Email</strong><span>${escapeHtml(candidate.outreach?.email || 'Missing')}</span></div>
        <div class="key-value"><strong>Subject</strong><span>${escapeHtml(candidate.outreach?.subject || 'Not prepared')}</span></div>
        <div class="key-value"><strong>Why Contacted</strong><span>${escapeHtml(candidate.outreach?.why_contacted_summary || 'Not prepared')}</span></div>
        <div class="key-value"><strong>Draft File</strong><span>${escapeHtml(candidate.outreach?.draft_path || 'Not generated')}</span></div>
      </div>
      <div class="detail-section"><strong>Draft Body</strong><div>${escapeHtml(candidate.outreach?.body || 'No draft prepared yet.')}</div></div>
    </div>

    <div class="detail-section">
      <h3>Operator Review</h3>
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
        <div class="field full-span">
          <label for="manualNotes">Manual Notes</label>
          <textarea id="manualNotes" name="manualNotes">${escapeHtml(candidate.operatorReview?.manual_notes || '')}</textarea>
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
        <div><strong>Latest Contact</strong><div>${escapeHtml(latestContact?.stage || 'No contact logged')}</div><div class="subtle">${escapeHtml(latestContact?.at || '')}</div></div>
        <div><strong>Availability Notes</strong><div>${escapeHtml(candidate.operatorReview?.availability_notes || 'None')}</div></div>
        <div><strong>Appetite Notes</strong><div>${escapeHtml(candidate.operatorReview?.appetite_notes || 'None')}</div></div>
        <div><strong>Compensation Notes</strong><div>${escapeHtml(candidate.operatorReview?.compensation_notes || 'None')}</div></div>
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
    saveCandidateReview(role.roleId, candidate.candidate_id).catch((error) => setStatus(error.message || String(error), 'error'));
  });
  document.getElementById('markContactedButton')?.addEventListener('click', () => logContact(role.roleId, candidate.candidate_id, 'contacted'));
  document.getElementById('markAwaitingReplyButton')?.addEventListener('click', () => logContact(role.roleId, candidate.candidate_id, 'awaiting_reply'));
  document.getElementById('markClosedButton')?.addEventListener('click', () => logContact(role.roleId, candidate.candidate_id, 'closed'));
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
    state.selectedRoleId = state.roleIndex[0].role_id;
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
    candidateFilters.innerHTML = '';
    candidateList.innerHTML = '<div class="empty-state">No candidates yet.</div>';
    candidateDetail.innerHTML = '<div class="empty-state">Select a role to review shortlisted candidates.</div>';
    artifactLinks.innerHTML = '';
    roleConfigForm.innerHTML = '';
    detailActions.innerHTML = '';
    warningBanner.classList.add('hidden');
    return;
  }

  roleTitle.textContent = role.roleTitle || role.roleId;
  roleMeta.textContent = `${role.roleId} · Updated ${role.updatedAt || 'not yet run'} · ${role.shortlistProgress?.message || ''}`;
  renderMetricCards(role);
  renderOverview(role);
  renderProgress(role);
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
    lifecycle_stage: document.getElementById('lifecycleStage')?.value || '',
    outreach_ready_override: document.getElementById('outreachReady')?.value || '',
    manual_notes: document.getElementById('manualNotes')?.value || '',
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
