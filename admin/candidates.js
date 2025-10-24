/* eslint-disable no-console */
(function () {
  'use strict';

  const STORAGE_KEY = 'hmj:candidates:filters:v2';
  const SELECTION_KEY = 'hmj:candidates:selection';
  const ROW_HEIGHT = 64;
  const RENDER_PADDING = 6;
  const MAX_LOGS = 10;

  const STATUS_META = {
    active: { label: 'Active', tone: 'green' },
    'in progress': { label: 'In progress', tone: 'blue' },
    complete: { label: 'Complete', tone: 'green' },
    archived: { label: 'Archived', tone: 'gray' },
    blocked: { label: 'Blocked', tone: 'red' }
  };

  const DEFAULT_FILTERS = Object.freeze({
    query: '',
    status: [],
    role: '',
    region: '',
    skills: [],
    availability: '',
    createdFrom: '',
    createdTo: ''
  });

  const elements = {};
  const rowsInner = document.createElement('div');
  rowsInner.className = 'rows-inner';
  rowsInner.style.position = 'relative';
  rowsInner.style.width = '100%';

  const state = {
    helpers: null,
    identity: null,
    raw: [],
    filtered: [],
    selection: new Set(),
    filters: loadFilters(),
    quickSearch: '',
    sort: { key: 'updated_at', dir: 'desc' },
    drawerId: null,
    supabaseMode: 'unknown',
    cacheMode: false,
    lastQueryMs: 0,
    logs: [],
    debugOpen: false,
    metrics: { total: 0, progress: 0, archived: 0, blocked: 0 }
  };

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function loadFilters() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return { ...DEFAULT_FILTERS };
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_FILTERS,
        ...parsed,
        status: Array.isArray(parsed?.status) ? parsed.status.map((v) => String(v).toLowerCase()) : []
      };
    } catch (err) {
      console.warn('[candidates] filter restore failed', err);
      return { ...DEFAULT_FILTERS };
    }
  }

  function saveFilters(filters) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch (err) {
      console.warn('[candidates] filter persist failed', err);
    }
  }

  function loadSelection() {
    try {
      const stored = localStorage.getItem(SELECTION_KEY);
      if (!stored) return;
      const ids = JSON.parse(stored);
      if (Array.isArray(ids)) ids.forEach((id) => state.selection.add(String(id)));
    } catch (err) {
      console.warn('[candidates] selection restore failed', err);
    }
  }

  function persistSelection() {
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(Array.from(state.selection)));
    } catch (err) {
      console.warn('[candidates] selection persist failed', err);
    }
  }

  function pushLog(entry) {
    const record = { ...entry, at: new Date().toISOString() };
    state.logs.unshift(record);
    if (state.logs.length > MAX_LOGS) state.logs.length = MAX_LOGS;
    renderDebugPanel();
  }

  function statusLabel(status) {
    const key = String(status || '').toLowerCase();
    return STATUS_META[key]?.label || (status ? String(status) : 'In progress');
  }

  function statusTone(status) {
    const key = String(status || '').toLowerCase();
    return STATUS_META[key]?.tone || 'orange';
  }

  function parseSkills(value) {
    if (!value && value !== 0) return [];
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    return String(value)
      .split(/[\n,]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return value;
    }
  }

  function formatDateTime(value) {
    if (!value) return '—';
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return d.toLocaleString();
    } catch {
      return value;
    }
  }

  function ensureDebugPanel() {
    if (qs('#debug-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.innerHTML = `
      <button id="debug-toggle" class="btn ghost" type="button">Show debug</button>
      <div class="dbg-body">
        <div class="dbg-row"><strong>Identity</strong><span id="dbg-ident-value">-</span></div>
        <div class="dbg-row"><strong>Token</strong><span id="dbg-token-value">-</span></div>
        <div class="dbg-row"><strong>Supabase</strong><span id="dbg-sb-value">-</span></div>
        <div class="dbg-row"><strong>Last query</strong><span id="dbg-query">-</span></div>
        <div class="dbg-row"><strong>Logs</strong></div>
        <ul id="dbg-logs" class="dbg-logs"></ul>
        <button id="dbg-export" class="btn" type="button" style="margin-top:12px">Export logs</button>
      </div>`;
    document.body.appendChild(panel);
    qs('#debug-toggle', panel).addEventListener('click', () => toggleDebug());
    qs('#dbg-export', panel).addEventListener('click', exportLogs);
  }

  function toggleDebug(force) {
    state.debugOpen = force !== undefined ? !!force : !state.debugOpen;
    const panel = qs('#debug-panel');
    if (!panel) return;
    panel.classList.toggle('open', state.debugOpen);
    const btn = qs('#debug-toggle');
    if (btn) btn.textContent = state.debugOpen ? 'Hide debug' : 'Show debug';
  }

  function renderDebugPanel() {
    ensureDebugPanel();
    const list = qs('#dbg-logs');
    if (!list) return;
    list.innerHTML = '';
    state.logs.forEach((log) => {
      const li = document.createElement('li');
      li.textContent = `[${new Date(log.at).toLocaleTimeString()}] ${log.action || 'event'}: ${log.detail || ''}`;
      list.appendChild(li);
    });
    const info = qs('#dbg-query');
    if (info) {
      const last = state.logs[0];
      info.textContent = last ? last.detail || '' : '-';
    }
  }

  function exportLogs() {
    if (!state.logs.length) return;
    const rows = state.logs.map((log) => `${log.at}\t${log.action}\t${log.detail || ''}`);
    const blob = new Blob([rows.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'candidate-debug.log';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 0);
  }

  function tokenize(query) {
    const tokens = [];
    const text = String(query || '');
    let i = 0;
    while (i < text.length) {
      const char = text[i];
      if (/\s/.test(char)) { i += 1; continue; }
      if (char === '"' || char === '\'') {
        const quote = char;
        i += 1;
        let buf = '';
        while (i < text.length && text[i] !== quote) { buf += text[i]; i += 1; }
        i += 1;
        tokens.push({ type: 'term', value: buf.toLowerCase() });
        continue;
      }
      if (char === '(' || char === ')') {
        tokens.push({ type: char });
        i += 1;
        continue;
      }
      let buf = '';
      while (i < text.length && !/['"()\s]/.test(text[i])) { buf += text[i]; i += 1; }
      const upper = buf.toUpperCase();
      if (upper === 'AND' || upper === 'OR' || upper === 'NOT') tokens.push({ type: upper });
      else tokens.push({ type: 'term', value: buf.toLowerCase() });
    }
    return tokens;
  }

  function toRpn(tokens) {
    const output = [];
    const stack = [];
    const precedence = { OR: 1, AND: 2, NOT: 3 };
    tokens.forEach((token) => {
      if (token.type === 'term') { output.push(token); return; }
      if (token.type === 'NOT') { stack.push(token); return; }
      if (token.type === 'AND' || token.type === 'OR') {
        while (stack.length) {
          const top = stack[stack.length - 1];
          if ((top.type === 'AND' || top.type === 'OR' || top.type === 'NOT') && precedence[top.type] >= precedence[token.type]) output.push(stack.pop());
          else break;
        }
        stack.push(token);
        return;
      }
      if (token.type === '(') { stack.push(token); return; }
      if (token.type === ')') {
        while (stack.length && stack[stack.length - 1].type !== '(') output.push(stack.pop());
        stack.pop();
      }
    });
    while (stack.length) output.push(stack.pop());
    return output;
  }

  function evaluateRpn(tokens, haystack) {
    const stack = [];
    tokens.forEach((token) => {
      if (token.type === 'term') stack.push(haystack.includes(token.value));
      else if (token.type === 'NOT') stack.push(!stack.pop());
      else if (token.type === 'AND' || token.type === 'OR') {
        const b = stack.pop();
        const a = stack.pop();
        stack.push(token.type === 'AND' ? (a && b) : (a || b));
      }
    });
    return stack.pop() ?? true;
  }

  function booleanMatch(text, query) {
    if (!query) return true;
    const haystack = String(text || '').toLowerCase();
    try {
      const tokens = tokenize(query);
      const rpn = toRpn(tokens);
      return evaluateRpn(rpn, haystack);
    } catch (err) {
      console.warn('[candidates] boolean query fallback', err);
      return query
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .every((token) => haystack.includes(token));
    }
  }

  function normalizeCandidate(row) {
    if (!row) return null;
    const first = row.first_name || row.firstName || '';
    const last = row.last_name || row.lastName || '';
    const full = row.full_name || row.fullName || `${first} ${last}`.trim();
    const status = String(row.status || 'in progress').toLowerCase();
    const docs = Array.isArray(row.docs)
      ? row.docs.slice()
      : [
          row.rtw_url && { kind: 'Right to work', url: row.rtw_url },
          row.contract_url && { kind: 'Contract', url: row.contract_url }
        ]
          .filter(Boolean)
          .map((doc, idx) => ({ id: `${row.id}-doc-${idx}`, ...doc }));
    const notes = Array.isArray(row.notes)
      ? row.notes.map((note, idx) => ({
          id: note.id || `${row.id}-note-${idx}`,
          body: note.body || note.text || note.note || '',
          author_email: note.author_email || note.author || '',
          created_at: note.created_at || note.at || row.updated_at || new Date().toISOString()
        }))
      : row.notes
        ? [{ id: `${row.id}-note`, body: row.notes, author_email: row.author || '', created_at: row.updated_at || row.created_at }]
        : [];
    const skillList = parseSkills(row.skills || row.skill_tags || row.tags);
    const tags = skillList.map((skill) => ({ id: `${row.id}-tag-${skill}`, name: skill, color: '#3a66b3' }));
    return {
      ...row,
      id: row.id ?? row.ref ?? `tmp-${Math.random().toString(36).slice(2)}`,
      ref: row.ref || null,
      first_name: first,
      last_name: last,
      full_name: full || `${first} ${last}`.trim() || 'Candidate',
      name: full || `${first} ${last}`.trim() || 'Candidate',
      email: row.email || '',
      phone: row.phone || '',
      status,
      role: row.role || row.job_title || '',
      region: row.region || row.county || row.country || '',
      skills: skillList,
      tags,
      docs,
      notes,
      audit: Array.isArray(row.audit) ? row.audit : [],
      availability_on: row.availability_on || row.start_date || '',
      created_at: row.created_at || row.createdAt || '',
      updated_at: row.updated_at || row.updatedAt || row.created_at || '',
      source: row.source || (state.cacheMode ? 'cache' : 'supabase')
    };
  }

  function updateSupabaseBadge() {
    const pill = qs('#dbg-sb');
    if (!pill) return;
    const dbg = qs('#dbg-sb-value');
    if (state.supabaseMode === 'live') {
      pill.textContent = 'supabase: live';
      pill.className = 'pill ok';
      if (dbg) dbg.textContent = 'live';
    } else if (state.supabaseMode === 'cache') {
      pill.textContent = 'supabase: cache';
      pill.className = 'pill warn';
      if (dbg) dbg.textContent = 'cache';
    } else if (state.supabaseMode === 'error') {
      pill.textContent = 'supabase: error';
      pill.className = 'pill err';
      if (dbg) dbg.textContent = 'error';
    } else {
      pill.textContent = 'supabase: …';
      pill.className = 'pill';
      if (dbg) dbg.textContent = '…';
    }
  }

  function updateIdentityBadges(info) {
    const identityPill = qs('#dbg-identity');
    const tokenPill = qs('#dbg-token');
    const rolePill = qs('#dbg-role');
    if (identityPill) {
      identityPill.textContent = info?.ok ? 'identity: ok' : 'identity: none';
      identityPill.className = info?.ok ? 'pill ok' : 'pill warn';
    }
    if (tokenPill) {
      tokenPill.textContent = info?.token ? 'token: ok' : 'token: missing';
      tokenPill.className = info?.token ? 'pill ok' : 'pill warn';
    }
    if (rolePill) {
      rolePill.textContent = `role: ${info?.role || 'unknown'}`;
      rolePill.className = info?.ok ? 'pill ok' : 'pill warn';
    }
    const identDetail = qs('#dbg-ident-value');
    if (identDetail) identDetail.textContent = info?.email || '—';
    const tokenDetail = qs('#dbg-token-value');
    if (tokenDetail) tokenDetail.textContent = info?.token ? 'attached' : 'missing';
  }

  async function detectVersion() {
    const pill = qs('#dbg-version');
    if (!pill) return;
    try {
      const res = await fetch('/netlify/git.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('git meta missing');
      const json = await res.json();
      const sha = json.commit?.slice(0, 8) || json.sha?.slice(0, 8) || '-';
      pill.textContent = `build: ${sha}`;
    } catch {
      pill.textContent = 'build: dev';
    }
  }

  function applyFilterInputs() {
    elements.query.value = state.filters.query || '';
    Array.from(elements.status.options).forEach((opt) => {
      opt.selected = state.filters.status.includes(opt.value.toLowerCase());
    });
    elements.role.value = state.filters.role || '';
    elements.region.value = state.filters.region || '';
    elements.skills.value = state.filters.skills.join(', ');
    elements.availability.value = state.filters.availability || '';
    elements.createdFrom.value = state.filters.createdFrom || '';
    elements.createdTo.value = state.filters.createdTo || '';
  }

  function captureFilters() {
    state.filters = {
      query: elements.query.value.trim(),
      status: Array.from(elements.status.selectedOptions).map((opt) => opt.value.toLowerCase()),
      role: elements.role.value.trim(),
      region: elements.region.value.trim(),
      skills: parseSkills(elements.skills.value),
      availability: elements.availability.value || '',
      createdFrom: elements.createdFrom.value || '',
      createdTo: elements.createdTo.value || ''
    };
    saveFilters(state.filters);
  }

  function countActiveFilters() {
    const f = state.filters;
    let total = 0;
    if (f.query) total += 1;
    if (f.status.length) total += 1;
    if (f.role) total += 1;
    if (f.region) total += 1;
    if (f.skills.length) total += 1;
    if (f.availability) total += 1;
    if (f.createdFrom || f.createdTo) total += 1;
    return total;
  }

  function updateFilterCount() {
    const label = elements.filterCount;
    if (!label) return;
    const count = state.filtered.length;
    const active = countActiveFilters();
    label.textContent = `${count} results${active ? ` — ${active} filter${active === 1 ? '' : 's'}` : ''}`;
  }

  function matchesFilters(candidate) {
    const { filters } = state;
    if (!candidate) return false;
    const haystack = [
      candidate.ref,
      candidate.name,
      candidate.email,
      candidate.phone,
      candidate.role,
      candidate.region,
      (candidate.skills || []).join(' '),
      (candidate.notes || []).map((note) => note.body).join(' ')
    ].join(' ').toLowerCase();
    if (filters.query && !booleanMatch(haystack, filters.query)) return false;
    if (state.quickSearch && !haystack.includes(state.quickSearch)) return false;
    if (filters.status.length && !filters.status.includes(candidate.status)) return false;
    if (filters.role && !(candidate.role || '').toLowerCase().includes(filters.role.toLowerCase())) return false;
    if (filters.region && !(candidate.region || '').toLowerCase().includes(filters.region.toLowerCase())) return false;
    if (filters.skills.length) {
      const candSkills = (candidate.skills || []).map((skill) => skill.toLowerCase());
      if (!filters.skills.every((skill) => candSkills.includes(skill.toLowerCase()))) return false;
    }
    if (filters.availability) {
      const available = candidate.availability_on ? new Date(candidate.availability_on) : null;
      if (!available || available.getTime() < new Date(filters.availability).getTime()) return false;
    }
    if (filters.createdFrom) {
      const created = candidate.created_at ? new Date(candidate.created_at) : null;
      if (!created || created < new Date(filters.createdFrom)) return false;
    }
    if (filters.createdTo) {
      const created = candidate.created_at ? new Date(candidate.created_at) : null;
      if (!created || created > new Date(filters.createdTo)) return false;
    }
    return true;
  }

  function applyFilters() {
    state.filtered = state.raw.filter((candidate) => matchesFilters(candidate));
    state.filtered.sort((a, b) => {
      const dir = state.sort.dir === 'asc' ? 1 : -1;
      if (state.sort.key === 'name') {
        return String(a.name || '').localeCompare(String(b.name || '')) * dir;
      }
      const av = a[state.sort.key] || '';
      const bv = b[state.sort.key] || '';
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * dir;
    });
    updateFilterCount();
    recomputeMetrics();
    refreshRows(true);
    syncHeaderCheckbox();
  }

  function recomputeMetrics() {
    const total = state.filtered.length;
    const countStatus = (status) => state.filtered.filter((row) => row.status === status).length;
    state.metrics = {
      total,
      progress: countStatus('in progress'),
      archived: countStatus('archived'),
      blocked: countStatus('blocked')
    };
    updateTotals();
  }

  function updateTotals() {
    if (elements.total) elements.total.textContent = `Total: ${state.metrics.total}`;
    if (elements.progress) elements.progress.textContent = `In progress: ${state.metrics.progress}`;
    if (elements.archived) elements.archived.textContent = `Archived: ${state.metrics.archived}`;
    if (elements.blocked) elements.blocked.textContent = `Blocked: ${state.metrics.blocked}`;
  }

  function ensureRowsContainer() {
    if (!elements.rows.contains(rowsInner)) {
      elements.rows.innerHTML = '';
      elements.rows.appendChild(rowsInner);
    }
  }

  function renderSkeleton() {
    ensureRowsContainer();
    rowsInner.innerHTML = '';
    const count = 12;
    rowsInner.style.height = `${count * ROW_HEIGHT}px`;
    for (let i = 0; i < count; i += 1) {
      const row = document.createElement('div');
      row.className = 'trow skeleton';
      row.style.position = 'absolute';
      row.style.top = `${i * ROW_HEIGHT}px`;
      row.innerHTML = '<div class="skeleton-bar"></div>'.repeat(6);
      rowsInner.appendChild(row);
    }
  }

  function refreshRows(force = false) {
    ensureRowsContainer();
    const total = state.filtered.length;
    rowsInner.style.height = `${total * ROW_HEIGHT}px`;
    if (!total) {
      rowsInner.innerHTML = '<div class="empty-state">No candidates match the filters.</div>';
      return;
    }
    if (force) rowsInner.innerHTML = '';
    updateVisibleRows();
  }

  function updateVisibleRows() {
    const viewport = elements.rows;
    if (!viewport) return;
    const scrollTop = viewport.scrollTop;
    const height = viewport.clientHeight || 400;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - RENDER_PADDING);
    const end = Math.min(state.filtered.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + RENDER_PADDING);
    rowsInner.innerHTML = '';
    for (let i = start; i < end; i += 1) {
      const candidate = state.filtered[i];
      const row = buildRow(candidate, i);
      rowsInner.appendChild(row);
    }
  }

  function selectionHas(id) {
    return state.selection.has(String(id));
  }

  function buildRow(candidate, index) {
    const row = document.createElement('div');
    row.className = 'trow';
    row.dataset.id = candidate.id;
    row.style.position = 'absolute';
    row.style.top = `${index * ROW_HEIGHT}px`;
    const selected = selectionHas(candidate.id) ? 'checked' : '';
    const disabledActions = candidate.status === 'blocked';
    row.innerHTML = `
      <div><input type="checkbox" data-role="select" data-id="${candidate.id}" ${selected}></div>
      <div>${candidate.ref || '—'}</div>
      <div>
        <div class="row-name">${candidate.name || '—'}</div>
        <div class="muted" style="font-size:12px">${candidate.region || ''}</div>
      </div>
      <div>${candidate.email || '—'}</div>
      <div><span class="chip ${statusTone(candidate.status)}">${statusLabel(candidate.status)}</span></div>
      <div>${candidate.role || '—'}</div>
      <div class="row-actions">
        <button class="btn ghost" data-role="open" data-id="${candidate.id}">Open</button>
        <button class="btn ghost" data-role="pdf" data-id="${candidate.id}" ${disabledActions ? 'disabled' : ''}>PDF</button>
      </div>`;
    return row;
  }

  function updateSelection(id, checked) {
    const key = String(id);
    if (checked) state.selection.add(key);
    else state.selection.delete(key);
    persistSelection();
    updateBulkBar();
    syncHeaderCheckbox();
  }

  function setSelection(ids) {
    state.selection = new Set(ids.map((id) => String(id)));
    persistSelection();
    updateBulkBar();
    refreshRows(true);
  }

  function clearSelection() {
    state.selection.clear();
    persistSelection();
    updateBulkBar();
    syncHeaderCheckbox();
    refreshRows(true);
  }

  function syncHeaderCheckbox() {
    const head = elements.chkAll;
    if (!head) return;
    if (!state.filtered.length) {
      head.checked = false;
      head.indeterminate = false;
      return;
    }
    const total = state.filtered.length;
    const selected = state.filtered.filter((row) => selectionHas(row.id)).length;
    head.checked = selected && selected === total;
    head.indeterminate = selected > 0 && selected < total;
  }

  function updateBulkBar() {
    const bar = elements.bulkbar;
    if (!bar) return;
    const count = state.selection.size;
    bar.classList.toggle('show', count > 0);
    const label = elements.bulkCount;
    if (label) label.textContent = `${count} selected`;
  }

  function showToast(message, tone = 'info', ms = 3600) {
    if (state.helpers?.toast) {
      state.helpers.toast(message, tone, ms);
      return;
    }
    const host = qs('#toast');
    if (!host) return;
    host.textContent = message;
    host.classList.add('show');
    setTimeout(() => host.classList.remove('show'), ms);
  }

  function selectedCandidates() {
    return state.filtered.filter((row) => selectionHas(row.id));
  }

  function handleRowClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const role = target.dataset.role;
    const id = target.dataset.id || target.closest('.trow')?.dataset.id;
    if (!role) {
      if (id) openDrawer(id);
      return;
    }
    if (!id) return;
    if (role === 'select') {
      updateSelection(id, target.checked);
      return;
    }
    if (role === 'open') {
      openDrawer(id);
      return;
    }
    if (role === 'pdf') {
      const candidate = findCandidate(id);
      if (candidate) generatePdf(candidate);
    }
  }

  function findCandidate(id) {
    const key = String(id);
    return state.raw.find((row) => String(row.id) === key) || null;
  }

  async function openDrawer(id) {
    const drawer = elements.drawer;
    if (!drawer) return;
    state.drawerId = id;
    drawer.classList.add('open');
    const cached = findCandidate(id);
    if (cached) renderDrawer(cached);
    else renderDrawerSkeleton();
    try {
      const full = await fetchCandidate(id);
      if (full) renderDrawer(full);
    } catch (err) {
      console.warn('[candidates] drawer fetch failed', err);
      showToast(err.message || 'Unable to load candidate', 'error');
    }
  }

  function closeDrawer() {
    state.drawerId = null;
    if (elements.drawer) elements.drawer.classList.remove('open');
  }

  function renderDrawerSkeleton() {
    elements.dwName.textContent = 'Loading…';
    elements.dwProfile.innerHTML = '<div class="skeleton-card"></div>';
    elements.dwDocs.innerHTML = '';
    elements.dwNotes.innerHTML = '';
    elements.dwAudit.innerHTML = '';
  }

  function renderDrawer(candidate) {
    if (!candidate) return;
    elements.dwName.textContent = candidate.name || 'Candidate';
    const blocked = candidate.status === 'blocked';
    elements.dwEmail.disabled = blocked;
    elements.dwCall.disabled = blocked;
    elements.dwBlock.textContent = blocked ? 'Unblock' : 'Block';
    elements.dwEmail.onclick = () => {
      if (candidate.email && !blocked) window.location.href = `mailto:${candidate.email}`;
    };
    elements.dwCall.onclick = () => {
      if (candidate.phone && !blocked) window.location.href = `tel:${candidate.phone.replace(/\s+/g, '')}`;
    };
    elements.dwBlock.onclick = () => toggleBlock(candidate);
    elements.dwProfile.innerHTML = renderProfile(candidate);
    bindProfileEditors(candidate);
    elements.dwDocs.innerHTML = renderDocs(candidate);
    elements.dwNotes.innerHTML = renderNotes(candidate);
    bindNoteActions(candidate);
    elements.dwAudit.innerHTML = renderAudit(candidate);
  }

  function renderProfile(candidate) {
    return `
      <div class="drawer-section">
        <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap">
          <span class="chip ${statusTone(candidate.status)}">${statusLabel(candidate.status)}</span>
          <span class="muted">Updated ${formatDateTime(candidate.updated_at)}</span>
        </div>
        <div class="profile-grid">
          ${editableField('First name', 'first_name', candidate.first_name)}
          ${editableField('Last name', 'last_name', candidate.last_name)}
          ${editableField('Email', 'email', candidate.email)}
          ${editableField('Phone', 'phone', candidate.phone)}
          ${editableField('Role', 'role', candidate.role)}
          ${editableField('Region', 'region', candidate.region)}
          ${editableField('Availability', 'availability_on', candidate.availability_on, 'date')}
          ${editableSelect('Status', 'status', candidate.status, Object.keys(STATUS_META))}
          ${editableField('Reference', 'ref', candidate.ref)}
        </div>
        <div style="margin-top:12px">
          <label class="muted" style="display:block;margin-bottom:4px">Skills / tags</label>
          <textarea data-field="skills" rows="2" class="drawer-input">${candidate.skills.join(', ')}</textarea>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn ghost" target="_blank" rel="noopener" href="/admin/timesheets.html?candidate=${candidate.id}">Timesheet history</a>
          <button class="btn" type="button" data-action="download-pdf">Download summary PDF</button>
        </div>
        <div class="tag-row">${(candidate.tags || []).map((tag) => `<span class="chip blue">${tag.name}</span>`).join(' ')}</div>
      </div>`;
  }

  function editableField(label, field, value, type = 'text') {
    const val = value ? (type === 'date' ? value.slice(0, 10) : value) : '';
    return `
      <label class="drawer-field">
        <span>${label}</span>
        <input class="drawer-input" data-field="${field}" type="${type}" value="${val || ''}" />
      </label>`;
  }

  function editableSelect(label, field, value, options) {
    const opts = options
      .map((opt) => {
        const val = String(opt).toLowerCase();
        return `<option value="${val}" ${val === value ? 'selected' : ''}>${statusLabel(val)}</option>`;
      })
      .join('');
    return `
      <label class="drawer-field">
        <span>${label}</span>
        <select class="drawer-input" data-field="${field}">${opts}</select>
      </label>`;
  }

  function renderDocs(candidate) {
    if (!candidate.docs || !candidate.docs.length) return '<div class="muted">No documents uploaded.</div>';
    return `<div class="doc-list">${candidate.docs
      .map((doc) => `<div class="doc-row"><span>${doc.kind || doc.name || 'Document'}</span><a href="${doc.url}" target="_blank" rel="noopener">Open</a></div>`)
      .join('')}</div>`;
  }

  function renderNotes(candidate) {
    const list = candidate.notes && candidate.notes.length
      ? candidate.notes.map((note) => `
            <article class="note">
              <header>
                <strong>${note.author_email || 'System'}</strong>
                <span class="muted">${formatDateTime(note.created_at)}</span>
              </header>
              <p>${note.body || ''}</p>
              <button class="btn ghost" data-note-delete="${note.id}" type="button">Delete</button>
            </article>`).join('')
      : '<div class="muted">No notes yet.</div>';
    return `
      <div class="notes">
        <div class="note-form">
          <textarea rows="3" placeholder="Add note" class="drawer-input" id="note-text"></textarea>
          <button class="btn" id="note-add" type="button">Add note</button>
        </div>
        <div class="note-list">${list}</div>
      </div>`;
  }

  function renderAudit(candidate) {
    if (!candidate.audit || !candidate.audit.length) return '<div class="muted">Audit trail empty.</div>';
    return `<div class="audit-list">${candidate.audit
      .slice(0, 20)
      .map((entry) => `<div class="audit-row"><strong>${formatDateTime(entry.at || entry.created_at)}</strong><span>${entry.action || ''}</span></div>`)
      .join('')}</div>`;
  }

  function bindProfileEditors(candidate) {
    const section = elements.dwProfile;
    const inputs = section.querySelectorAll('[data-field]');
    inputs.forEach((input) => {
      input.addEventListener('blur', async (ev) => {
        const field = ev.target.dataset.field;
        const value = ev.target.type === 'date' ? ev.target.value : ev.target.value.trim();
        await saveField(candidate, field, value);
      });
    });
    const pdfBtn = section.querySelector('[data-action="download-pdf"]');
    if (pdfBtn) pdfBtn.addEventListener('click', () => generatePdf(candidate));
  }

  function bindNoteActions(candidate) {
    const host = elements.dwNotes;
    const addBtn = qs('#note-add', host);
    const field = qs('#note-text', host);
    if (addBtn && field) {
      addBtn.addEventListener('click', async () => {
        const text = field.value.trim();
        if (!text) {
          showToast('Note empty', 'warn');
          return;
        }
        field.value = '';
        await appendNote(candidate, text);
      });
    }
    host.querySelectorAll('[data-note-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const noteId = btn.dataset.noteDelete;
        await deleteNote(candidate, noteId);
      });
    });
  }

  function buildSavePayload(candidate, patch) {
    const first = patch.first_name !== undefined ? patch.first_name : candidate.first_name;
    const last = patch.last_name !== undefined ? patch.last_name : candidate.last_name;
    return {
      id: candidate.id,
      first_name: first,
      last_name: last,
      ref: patch.ref !== undefined ? patch.ref : candidate.ref,
      email: patch.email !== undefined ? patch.email : candidate.email,
      phone: patch.phone !== undefined ? patch.phone : candidate.phone,
      status: patch.status !== undefined ? patch.status : candidate.status,
      role: patch.role !== undefined ? patch.role : candidate.role,
      region: patch.region !== undefined ? patch.region : candidate.region,
      availability_on: patch.availability_on !== undefined ? patch.availability_on : candidate.availability_on,
      skills: patch.skills !== undefined ? parseSkills(patch.skills) : candidate.skills,
      notes: patch.notes !== undefined ? patch.notes : candidate.notes?.map((note) => note.body).join('\n') || ''
    };
  }

  async function callSave(payload) {
    try {
      pushLog({ action: 'save', detail: `Candidate ${payload.id}` });
      await state.helpers.api('admin-candidates-save', 'POST', payload);
    } catch (err) {
      if (/supabase/i.test(String(err.message))) state.supabaseMode = 'error';
      updateSupabaseBadge();
      throw err;
    }
  }

  async function saveField(candidate, field, value) {
    const patch = buildSavePayload(candidate, { [field]: value });
    try {
      await callSave(patch);
      Object.assign(candidate, patch, { [field]: value });
      const index = state.raw.findIndex((row) => String(row.id) === String(candidate.id));
      if (index >= 0) state.raw[index] = { ...candidate };
      applyFilters();
      showToast('Saved', 'info', 1600);
    } catch (err) {
      console.error('[candidates] save failed', err);
      showToast(err.message || 'Save failed', 'error');
    }
  }

  async function appendNote(candidate, text) {
    const author = state.identity?.email || 'admin';
    const updated = [...(candidate.notes || []), { id: `${candidate.id}-note-${Date.now()}`, body: text, author_email: author, created_at: new Date().toISOString() }];
    const payload = updated.map((note) => note.body).join('\n');
    await saveField(candidate, 'notes', payload);
    candidate.notes = updated;
    renderDrawer(candidate);
  }

  async function deleteNote(candidate, noteId) {
    const remaining = (candidate.notes || []).filter((note) => String(note.id) !== String(noteId));
    const payload = remaining.map((note) => note.body).join('\n');
    await saveField(candidate, 'notes', payload);
    candidate.notes = remaining;
    renderDrawer(candidate);
  }

  async function toggleBlock(candidate) {
    const next = candidate.status === 'blocked' ? 'in progress' : 'blocked';
    await saveField(candidate, 'status', next);
    candidate.status = next;
    renderDrawer(candidate);
  }

  async function fetchCandidate(id) {
    try {
      pushLog({ action: 'get', detail: `Candidate ${id}` });
      const res = await state.helpers.api('admin-candidates-get', 'POST', { id });
      const record = normalizeCandidate(res);
      if (record) {
        const index = state.raw.findIndex((row) => String(row.id) === String(record.id));
        if (index >= 0) state.raw[index] = record;
        else state.raw.push(record);
        applyFilters();
      }
      return record;
    } catch (err) {
      console.warn('[candidates] fetch candidate fallback', err);
      const fallback = findCandidate(id);
      if (!fallback) throw err;
      return fallback;
    }
  }

  async function getFallbackRows() {
    try {
      const res = await fetch('/data/candidates.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows = Array.isArray(json?.candidates) ? json.candidates : Array.isArray(json) ? json : [];
      return rows.map(normalizeCandidate).filter(Boolean);
    } catch (err) {
      console.warn('[candidates] fallback load failed', err);
      return [];
    }
  }

  function renderReauth() {
    rowsInner.innerHTML = '<div class="empty-state">Session expired. <button class="btn" id="reauth">Re-auth</button></div>';
    const btn = qs('#reauth', rowsInner);
    if (btn) btn.addEventListener('click', () => window.netlifyIdentity?.open('login'));
  }

  function renderRetry() {
    rowsInner.innerHTML = '<div class="empty-state">Network error. <button class="btn" id="retry-load">Retry</button></div>';
    const btn = qs('#retry-load', rowsInner);
    if (btn) btn.addEventListener('click', () => loadCandidates({ silent: true }));
  }

  async function loadCandidates({ silent = false } = {}) {
    if (!silent) renderSkeleton();
    const started = performance.now();
    try {
      const payload = {
        query: state.filters.query,
        status: state.filters.status,
        role: state.filters.role,
        region: state.filters.region,
        skills: state.filters.skills,
        availability: state.filters.availability,
        created_from: state.filters.createdFrom,
        created_to: state.filters.createdTo,
        quick: state.quickSearch
      };
      pushLog({ action: 'list', detail: 'Loading candidates' });
      const response = await state.helpers.api('admin-candidates-list', 'POST', payload);
      const rows = Array.isArray(response?.rows) ? response.rows : Array.isArray(response) ? response : [];
      state.supabaseMode = response?.supabase?.ok ? 'live' : 'cache';
      state.cacheMode = !response?.supabase?.ok;
      updateSupabaseBadge();
      state.raw = rows.map(normalizeCandidate).filter(Boolean);
      loadSelection();
      applyFilters();
      state.lastQueryMs = Math.round(performance.now() - started);
      pushLog({ action: 'list:ok', detail: `${state.raw.length} rows in ${state.lastQueryMs}ms` });
      if (!silent) showToast(`Loaded ${state.raw.length} candidates`, 'info', 2400);
    } catch (err) {
      console.error('[candidates] load failed', err);
      pushLog({ action: 'list:error', detail: err.message || 'error' });
      state.supabaseMode = /403/.test(String(err.message)) ? 'error' : 'cache';
      updateSupabaseBadge();
      if (/403/.test(String(err.message))) {
        showToast('Session expired — re-auth required.', 'warn', 5000);
        renderReauth();
      } else if (err.message === 'Failed to fetch') {
        showToast('Network error. Retry available.', 'error');
        renderRetry();
      }
      const fallback = await getFallbackRows();
      if (fallback.length) {
        state.cacheMode = true;
        state.raw = fallback;
        applyFilters();
        showToast('Offline mode — using cached dataset.', 'warn', 4200);
      }
    }
  }

  function updateQuickSearch(value) {
    state.quickSearch = value.trim().toLowerCase();
    applyFilters();
  }

  function clearFilters() {
    state.filters = { ...DEFAULT_FILTERS };
    applyFilterInputs();
    saveFilters(state.filters);
    applyFilters();
  }

  function handleScroll() {
    window.requestAnimationFrame(updateVisibleRows);
  }

  function handleSelectAll(event) {
    if (!event.target.checked) {
      clearSelection();
      return;
    }
    const ids = state.filtered.map((row) => row.id);
    setSelection(ids);
  }

  function bindBulkActions() {
    elements.bulkAssign.addEventListener('click', () => bulkAssign());
    elements.bulkStatus.addEventListener('click', () => bulkStatus());
    elements.bulkBlock.addEventListener('click', () => bulkStatus('blocked'));
    elements.bulkArchive.addEventListener('click', () => bulkStatus('archived'));
    elements.bulkExport.addEventListener('click', () => exportCsv({ mode: 'selected' }));
    elements.bulkClear.addEventListener('click', () => clearSelection());
  }

  function promptStatus(defaultStatus) {
    if (defaultStatus) return defaultStatus;
    const options = Object.keys(STATUS_META).join(', ');
    const answer = window.prompt(`Status (${options})`);
    return answer ? answer.toLowerCase() : null;
  }

  async function bulkStatus(forceStatus) {
    if (!state.selection.size) {
      showToast('Select candidates first', 'warn');
      return;
    }
    const status = promptStatus(forceStatus);
    if (!status) return;
    const rows = selectedCandidates();
    for (const row of rows) {
      // eslint-disable-next-line no-await-in-loop
      await saveField(row, 'status', status);
    }
    showToast(`Updated ${rows.length} candidates`, 'info');
    clearSelection();
  }

  async function bulkAssign() {
    if (!state.selection.size) {
      showToast('Select candidates first', 'warn');
      return;
    }
    const recruiter = window.prompt('Assign to recruiter (email)');
    if (!recruiter) return;
    const rows = selectedCandidates();
    rows.forEach((row) => {
      row.audit = row.audit || [];
      row.audit.unshift({ at: new Date().toISOString(), action: `Assigned to ${recruiter}` });
    });
    showToast(`Assigned ${rows.length} candidates to ${recruiter}`, 'info');
    renderDrawer(state.drawerId ? findCandidate(state.drawerId) : null);
    clearSelection();
  }

  function exportCsv({ mode } = { mode: 'filtered' }) {
    const rows = mode === 'selected' ? selectedCandidates() : state.filtered;
    if (!rows.length) {
      showToast('Nothing to export', 'warn');
      return;
    }
    const headers = ['id', 'ref', 'name', 'email', 'phone', 'status', 'role', 'region', 'skills'];
    const csv = [headers.join(',')].concat(
      rows.map((row) => headers
        .map((field) => {
          const value = field === 'name' ? row.name : field === 'skills' ? (row.skills || []).join('|') : row[field] ?? '';
          const text = String(value).replace(/"/g, '""');
          return `"${text}"`;
        })
        .join(','))
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `candidates-${mode}-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 0);
  }

  function generatePdf(candidate) {
    const lines = [
      'Candidate summary',
      '',
      `Name: ${candidate.name || ''}`,
      `Email: ${candidate.email || ''}`,
      `Phone: ${candidate.phone || ''}`,
      `Status: ${statusLabel(candidate.status)}`,
      `Role: ${candidate.role || ''}`,
      `Region: ${candidate.region || ''}`,
      `Skills: ${(candidate.skills || []).join(', ')}`,
      `Updated: ${formatDateTime(candidate.updated_at)}`
    ];
    let pdf = '%PDF-1.4\n';
    const objects = [];
    objects.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');
    objects.push('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj');
    objects.push('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj');
    objects.push('4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Name /F1 >> endobj');
    let stream = 'BT /F1 12 Tf 0 0 0 rg 50 780 Td 16 TL';
    lines.forEach((line, idx) => {
      const safe = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
      stream += ` (${safe}) Tj`;
      if (idx !== lines.length - 1) stream += ' T*';
    });
    stream += ' ET';
    const content = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects.push(`5 0 obj ${content} endobj`);
    const offsets = [0];
    objects.forEach((obj) => {
      offsets.push(pdf.length);
      pdf += `${obj}\n`;
    });
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < offsets.length; i += 1) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefStart}\n%%EOF`;
    const blob = new Blob([pdf], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${candidate.ref || candidate.id}-summary.pdf`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 0);
  }

  function bindKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (key === '/') {
        event.preventDefault();
        elements.search.focus();
        return;
      }
      if (key === 'escape' && state.drawerId) {
        closeDrawer();
        return;
      }
      if (key === 'e' && state.drawerId) {
        event.preventDefault();
        const first = elements.dwProfile.querySelector('[data-field]');
        if (first) first.focus();
        return;
      }
      if (key === 'b' && state.drawerId) {
        event.preventDefault();
        const candidate = findCandidate(state.drawerId);
        if (candidate) toggleBlock(candidate);
        return;
      }
      if (key === 'r') {
        event.preventDefault();
        loadCandidates({ silent: true });
      }
    });
  }

  function createNewCandidate() {
    const id = `new-${Date.now()}`;
    const candidate = normalizeCandidate({ id, first_name: 'New', last_name: 'Candidate', status: 'active' });
    state.raw.unshift(candidate);
    applyFilters();
    openDrawer(id);
  }

  function initElements() {
    elements.rows = qs('#rows');
    elements.chkAll = qs('#chk-all');
    elements.search = qs('#search');
    elements.refresh = qs('#btn-refresh');
    elements.bulkbar = qs('#bulkbar');
    elements.bulkCount = qs('#bulk-count');
    elements.bulkAssign = qs('#bulk-assign');
    elements.bulkStatus = qs('#bulk-status');
    elements.bulkBlock = qs('#bulk-block');
    elements.bulkArchive = qs('#bulk-archive');
    elements.bulkExport = qs('#bulk-export');
    elements.bulkClear = qs('#bulk-clear');
    elements.total = qs('#t-total');
    elements.progress = qs('#t-progress');
    elements.archived = qs('#t-archived');
    elements.blocked = qs('#t-blocked');
    elements.drawer = qs('#drawer');
    elements.dwName = qs('#dw-name');
    elements.dwProfile = qs('#dw-profile');
    elements.dwDocs = qs('#dw-docs');
    elements.dwNotes = qs('#dw-notes');
    elements.dwAudit = qs('#dw-audit');
    elements.dwEmail = qs('#dw-email');
    elements.dwCall = qs('#dw-call');
    elements.dwBlock = qs('#dw-block');
    elements.dwClose = qs('#dw-close');
    elements.fab = qs('#fab-new');
    elements.query = qs('#q');
    elements.status = qs('#flt-status');
    elements.role = qs('#flt-role');
    elements.region = qs('#flt-region');
    elements.skills = qs('#flt-skills');
    elements.availability = qs('#flt-avail');
    elements.createdFrom = qs('#flt-created-from');
    elements.createdTo = qs('#flt-created-to');
    elements.filterCount = qs('#flt-count');
    elements.applyFilters = qs('#btn-apply');
    elements.clearFilters = qs('#btn-clear');
  }

  function bindEvents() {
    elements.rows.addEventListener('scroll', handleScroll);
    elements.rows.addEventListener('click', handleRowClick);
    elements.chkAll.addEventListener('change', handleSelectAll);
    elements.search.addEventListener('input', (ev) => updateQuickSearch(ev.target.value));
    elements.refresh.addEventListener('click', () => loadCandidates({ silent: false }));
    elements.dwClose.addEventListener('click', () => closeDrawer());
    elements.fab.addEventListener('click', () => createNewCandidate());
    elements.applyFilters.addEventListener('click', () => { captureFilters(); applyFilters(); loadCandidates({ silent: true }); });
    elements.clearFilters.addEventListener('click', () => { clearFilters(); loadCandidates({ silent: true }); });
    bindBulkActions();
  }

  function init(helpers) {
    state.helpers = helpers;
    initElements();
    ensureDebugPanel();
    detectVersion();
    applyFilterInputs();
    bindEvents();
    bindKeyboardShortcuts();
    loadCandidates();
  }

  function ready() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      console.error('[candidates] Admin bootstrap missing');
      return;
    }
    window.Admin.bootAdmin(async (helpers) => {
      const who = await helpers.identity('admin');
      state.identity = who;
      updateIdentityBadges(who);
      init(helpers);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();

