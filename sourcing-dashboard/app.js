const state = {
  roles: [],
  selectedRoleId: '',
};

const roleList = document.getElementById('roleList');
const roleTitle = document.getElementById('roleTitle');
const roleMeta = document.getElementById('roleMeta');
const metricCards = document.getElementById('metricCards');
const overviewBlock = document.getElementById('overviewBlock');
const nextActions = document.getElementById('nextActions');
const artifactLinks = document.getElementById('artifactLinks');
const candidateRows = document.getElementById('candidateRows');
const statusBox = document.getElementById('statusBox');
const refreshRolesButton = document.getElementById('refreshRolesButton');
const initRoleButton = document.getElementById('initRoleButton');
const openWorkflowButton = document.getElementById('openWorkflowButton');

function setStatus(message) {
  statusBox.textContent = message;
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

function metricCard(label, value) {
  const card = document.createElement('div');
  card.className = 'metric-card';
  card.innerHTML = `<span class="metric-label">${label}</span><span class="metric-value">${value}</span>`;
  return card;
}

function renderRoles() {
  roleList.innerHTML = '';
  state.roles.forEach((role) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `role-item${role.roleId === state.selectedRoleId ? ' active' : ''}`;
    button.innerHTML = [
      `<strong>${role.roleTitle || role.roleId}</strong>`,
      `<div class="subtle">${role.metrics?.profiles_reviewed || 0} previews · ${role.metrics?.cvs_downloaded || 0} CVs · ${role.metrics?.outreach_drafts_prepared || 0} drafts</div>`,
    ].join('');
    button.addEventListener('click', () => {
      state.selectedRoleId = role.roleId;
      renderRoles();
      renderRole(role);
    });
    roleList.appendChild(button);
  });
}

function renderRole(role) {
  if (!role) {
    roleTitle.textContent = 'Select a role';
    roleMeta.textContent = 'Initialise a role or refresh after a CLI run.';
    metricCards.innerHTML = '';
    overviewBlock.innerHTML = '<div><strong>Status</strong><br>No roles loaded yet.</div>';
    nextActions.innerHTML = '<li>No roles loaded yet.</li>';
    artifactLinks.innerHTML = '';
    candidateRows.innerHTML = '';
    return;
  }
  roleTitle.textContent = role.roleTitle || role.roleId;
  roleMeta.textContent = `${role.roleId} · Updated ${role.updatedAt || 'not yet run'}`;

  metricCards.innerHTML = '';
  metricCards.appendChild(metricCard('Previews', role.metrics?.profiles_reviewed || 0));
  metricCards.appendChild(metricCard('CVs', role.metrics?.cvs_downloaded || 0));
  metricCards.appendChild(metricCard('Shortlist', (role.metrics?.shortlist_counts?.strong || 0) + (role.metrics?.shortlist_counts?.possible || 0)));
  metricCards.appendChild(metricCard('Drafts', role.metrics?.outreach_drafts_prepared || 0));
  metricCards.appendChild(metricCard('KPI', role.metrics?.conversion?.manual_profiles_reviewed_per_viable_outreach_candidate ?? 'n/a'));

  const overviewItems = [
    ['Client', role.overview?.clientName || 'Not set'],
    ['Consultant', role.overview?.consultant || 'Joe'],
    ['Location', role.overview?.location?.base || 'Not set'],
    ['Function', role.overview?.functionFamily || 'Not set'],
    ['Must-Haves', (role.overview?.mustHaveSkills || []).join(', ') || 'Not set'],
  ];
  overviewBlock.innerHTML = overviewItems.map(([label, value]) => `<div><strong>${label}</strong><br>${value}</div>`).join('');

  nextActions.innerHTML = '';
  (role.metrics?.next_actions || ['No immediate next actions.']).forEach((entry) => {
    const item = document.createElement('li');
    item.textContent = entry;
    nextActions.appendChild(item);
  });

  artifactLinks.innerHTML = '';
  Object.entries(role.artifacts || {}).forEach(([label, relativePath]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'artifact-button';
    button.textContent = label;
    button.addEventListener('click', () => openArtifact(role.roleId, relativePath));
    artifactLinks.appendChild(button);
  });

  candidateRows.innerHTML = '';
  (role.previewTriage?.candidates || []).forEach((candidate) => {
    const review = (role.candidateReviews || []).find((entry) => entry.candidate_id === candidate.candidate_id) || {};
    const row = document.createElement('tr');
    row.innerHTML = [
      `<td><strong>${candidate.candidate_name || candidate.candidate_id}</strong><br>${candidate.current_title || ''}</td>`,
      `<td>${candidate.lifecycle_stage || review.lifecycle_stage || ''}</td>`,
      `<td>${candidate.classification || ''}<br><span class="subtle">Score ${candidate.preview_score ?? ''}</span></td>`,
      `<td>${review.shortlist_status || review.shortlist_recommendation || ''}</td>`,
      `<td>${candidate.next_action || 'Review manually'}</td>`,
    ].join('');
    candidateRows.appendChild(row);
  });
}

async function loadRoles() {
  setStatus('Loading roles...');
  const result = await api('/api/roles');
  state.roles = result.roles || [];
  if (!state.selectedRoleId && state.roles.length) {
    state.selectedRoleId = state.roles[0].roleId;
  }
  const selected = state.roles.find((role) => role.roleId === state.selectedRoleId) || state.roles[0];
  renderRoles();
  renderRole(selected);
  setStatus(`Loaded ${state.roles.length} role(s).`);
}

async function runAction(action) {
  if (!state.selectedRoleId) return;
  setStatus(`Running ${action} for ${state.selectedRoleId}...`);
  const result = await api(`/api/roles/${encodeURIComponent(state.selectedRoleId)}/run`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
  const updatedRole = result.role;
  state.roles = state.roles.map((role) => role.roleId === updatedRole.roleId ? updatedRole : role);
  renderRoles();
  renderRole(updatedRole);
  setStatus(`Completed ${action} for ${updatedRole.roleTitle || updatedRole.roleId}.`);
}

async function openArtifact(roleId, relativePath) {
  setStatus(`Opening ${relativePath}...`);
  await api('/api/open-path', {
    method: 'POST',
    body: JSON.stringify({ roleId, relativePath }),
  });
  setStatus(`Opened ${relativePath}.`);
}

async function initRole() {
  const roleTitleInput = window.prompt('Role title');
  if (!roleTitleInput) return;
  const slugInput = window.prompt('Role id / slug', roleTitleInput.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  if (!slugInput) return;
  setStatus(`Initialising ${slugInput}...`);
  await api('/api/init-role', {
    method: 'POST',
    body: JSON.stringify({ roleId: slugInput, roleTitle: roleTitleInput }),
  });
  await loadRoles();
  setStatus(`Initialised ${roleTitleInput}.`);
}

refreshRolesButton.addEventListener('click', () => {
  loadRoles().catch((error) => setStatus(error.message || String(error)));
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    runAction(button.dataset.action).catch((error) => setStatus(error.message || String(error)));
  });
});

initRoleButton.addEventListener('click', () => {
  initRole().catch((error) => setStatus(error.message || String(error)));
});

openWorkflowButton.addEventListener('click', () => {
  if (!state.selectedRoleId) return;
  openArtifact(state.selectedRoleId, '.').catch((error) => setStatus(error.message || String(error)));
});

loadRoles().catch((error) => setStatus(error.message || String(error)));

window.addEventListener('focus', () => {
  loadRoles().catch((error) => setStatus(error.message || String(error)));
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadRoles().catch((error) => setStatus(error.message || String(error)));
  }
});

window.setInterval(() => {
  if (document.visibilityState === 'visible') {
    loadRoles().catch((error) => setStatus(error.message || String(error)));
  }
}, 15000);
