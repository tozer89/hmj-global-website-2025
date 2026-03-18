(function () {
  'use strict';

  const STATUS_OPTIONS = [
    { value: 'submitted', label: 'Submitted', tone: 'blue' },
    { value: 'in_progress', label: 'In Progress', tone: 'amber' },
    { value: 'interview', label: 'Interview', tone: 'purple' },
    { value: 'reject', label: 'Reject', tone: 'red' },
  ];

  const state = {
    helpers: null,
    rows: [],
    summary: null,
    overallSummary: null,
    page: 1,
    pages: 1,
    pageSize: 50,
    total: 0,
    overallTotal: 0,
    sources: [],
    loading: false,
    activeId: null,
    filters: {
      q: '',
      status: 'all',
      source: 'all',
    },
    sort: {
      key: 'applied_at',
      dir: 'desc',
    },
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function setupElements() {
    [
      'gate',
      'app',
      'welcomeMeta',
      'btnRefresh',
      'filterSearch',
      'filterStatus',
      'filterSource',
      'sortSelect',
      'btnApplyFilters',
      'btnClearFilters',
      'pageAlert',
      'filterChips',
      'applicationRows',
      'emptyState',
      'resultChip',
      'pageInfo',
      'btnPrevPage',
      'btnNextPage',
      'statTotal',
      'statTotalMeta',
      'statSubmitted',
      'statInProgress',
      'statInterview',
      'cardSubmitted',
      'cardInProgress',
      'cardInterview',
      'cardReject',
      'cardVisible',
      'cardVisibleMeta',
      'applicationDrawer',
      'drawerOverlay',
      'btnCloseDrawer',
      'drawerTitle',
      'drawerMeta',
      'drawerBody',
      'drawerStatusActions',
      'drawerCandidateLink',
      'drawerJobLink',
    ].forEach((id) => {
      els[id] = $(id);
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateTime(value) {
    if (!value) return 'Not recorded';
    try {
      return new Date(value).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return value;
    }
  }

  function statusMeta(status) {
    return STATUS_OPTIONS.find((item) => item.value === status) || STATUS_OPTIONS[0];
  }

  function readQueryState() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      state.filters.q = String(params.get('q') || '').trim();
      state.filters.status = params.get('status') || 'all';
      state.filters.source = params.get('source') || 'all';
      state.page = Math.max(1, Number(params.get('page')) || 1);
      const sortValue = params.get('sort') || 'applied_at:desc';
      const [key, dir] = sortValue.split(':');
      state.sort.key = key || 'applied_at';
      state.sort.dir = dir || 'desc';
    } catch {}
  }

  function writeQueryState() {
    try {
      const params = new URLSearchParams();
      if (state.filters.q) params.set('q', state.filters.q);
      if (state.filters.status && state.filters.status !== 'all') params.set('status', state.filters.status);
      if (state.filters.source && state.filters.source !== 'all') params.set('source', state.filters.source);
      if (state.page > 1) params.set('page', String(state.page));
      params.set('sort', `${state.sort.key}:${state.sort.dir}`);
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', next);
    } catch {}
  }

  function syncFilterInputs() {
    if (els.filterSearch) els.filterSearch.value = state.filters.q;
    if (els.filterStatus) els.filterStatus.value = state.filters.status;
    if (els.filterSource) els.filterSource.value = state.filters.source;
    if (els.sortSelect) els.sortSelect.value = `${state.sort.key}:${state.sort.dir}`;
  }

  function renderSourceOptions() {
    if (!els.filterSource) return;
    const current = state.filters.source || 'all';
    const options = ['<option value="all">All sources</option>'];
    state.sources.forEach((source) => {
      options.push(`<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`);
    });
    els.filterSource.innerHTML = options.join('');
    state.filters.source = state.sources.includes(current) ? current : 'all';
    els.filterSource.value = state.filters.source;
  }

  function setAlert(message) {
    if (!els.pageAlert) return;
    if (!message) {
      els.pageAlert.innerHTML = '';
      return;
    }
    els.pageAlert.innerHTML = `<div class="ja-alert">${escapeHtml(message)}</div>`;
  }

  function renderFilterChips() {
    if (!els.filterChips) return;
    const chips = [];
    if (state.filters.q) chips.push(`Search: ${state.filters.q}`);
    if (state.filters.status !== 'all') chips.push(`Status: ${statusMeta(state.filters.status).label}`);
    if (state.filters.source !== 'all') chips.push(`Source: ${state.filters.source}`);
    chips.push(`Sort: ${statusSortLabel()}`);
    els.filterChips.innerHTML = chips.map((chip) => `<span class="ja-chip">${escapeHtml(chip)}</span>`).join('');
  }

  function statusSortLabel() {
    const value = `${state.sort.key}:${state.sort.dir}`;
    if (value === 'applied_at:desc') return 'Newest applications';
    if (value === 'applied_at:asc') return 'Oldest applications';
    if (value === 'candidate_name:asc') return 'Candidate A-Z';
    if (value === 'job_title:asc') return 'Role A-Z';
    if (value === 'status:asc') return 'Status';
    if (value === 'updated_at:desc') return 'Recently updated';
    return value;
  }

  function renderSummary() {
    const summary = state.summary || { total: 0, submitted: 0, in_progress: 0, interview: 0, reject: 0 };
    const overall = state.overallSummary || summary;
    if (els.statTotal) els.statTotal.textContent = String(state.overallTotal || 0);
    if (els.statTotalMeta) {
      els.statTotalMeta.textContent = state.total === state.overallTotal
        ? 'Showing the full website application set.'
        : `${state.total} application${state.total === 1 ? '' : 's'} match the current filters.`;
    }
    if (els.statSubmitted) els.statSubmitted.textContent = String(overall.submitted || 0);
    if (els.statInProgress) els.statInProgress.textContent = String(overall.in_progress || 0);
    if (els.statInterview) els.statInterview.textContent = String(overall.interview || 0);

    if (els.cardSubmitted) els.cardSubmitted.textContent = String(summary.submitted || 0);
    if (els.cardInProgress) els.cardInProgress.textContent = String(summary.in_progress || 0);
    if (els.cardInterview) els.cardInterview.textContent = String(summary.interview || 0);
    if (els.cardReject) els.cardReject.textContent = String(summary.reject || 0);
    if (els.cardVisible) els.cardVisible.textContent = String(state.total || 0);
    if (els.cardVisibleMeta) {
      els.cardVisibleMeta.textContent = state.total === state.overallTotal
        ? 'All application rows are visible.'
        : `${state.total} of ${state.overallTotal} rows match the current filters.`;
    }
  }

  function renderPagination() {
    if (els.resultChip) {
      els.resultChip.textContent = state.loading
        ? 'Loading applications…'
        : `${state.total} application${state.total === 1 ? '' : 's'} in view`;
    }
    if (els.pageInfo) {
      els.pageInfo.textContent = `Page ${state.page} of ${state.pages}`;
    }
    if (els.btnPrevPage) els.btnPrevPage.disabled = state.loading || state.page <= 1;
    if (els.btnNextPage) els.btnNextPage.disabled = state.loading || state.page >= state.pages;
  }

  function candidateHref(row) {
    return row.candidateId
      ? `/admin/candidates.html?candidate_id=${encodeURIComponent(row.candidateId)}`
      : '/admin/candidates.html';
  }

  function jobHref(row) {
    const params = new URLSearchParams();
    if (row.jobTitle) params.set('q', row.jobTitle);
    if (row.jobId) params.set('job_id', row.jobId);
    return `/admin/jobs.html${params.toString() ? `?${params.toString()}` : ''}`;
  }

  function renderRows() {
    if (!els.applicationRows || !els.emptyState) return;
    if (!state.rows.length) {
      els.applicationRows.innerHTML = '';
      els.emptyState.hidden = false;
      return;
    }

    els.emptyState.hidden = true;
    els.applicationRows.innerHTML = state.rows.map((row) => {
      const meta = statusMeta(row.status);
      const selected = state.activeId && String(state.activeId) === String(row.id);
      return `
        <tr data-id="${escapeHtml(row.id)}" data-selected="${selected ? 'true' : 'false'}">
          <td>
            <div class="ja-cell-stack">
              <div class="ja-cell-title">${escapeHtml(formatDateTime(row.appliedAt))}</div>
              <div class="ja-cell-sub">Updated ${escapeHtml(formatDateTime(row.updatedAt || row.appliedAt))}</div>
              <div class="ja-cell-sub">Ref ${escapeHtml(row.id || '—')}</div>
            </div>
          </td>
          <td>
            <div class="ja-cell-stack">
              <div class="ja-cell-title">${escapeHtml(row.candidateName)}</div>
              <div class="ja-cell-sub">${escapeHtml(row.candidateEmail || 'No email stored')}</div>
              <div class="ja-cell-sub">${escapeHtml(row.candidateLocation || 'Location not stored')}</div>
            </div>
          </td>
          <td>
            <div class="ja-cell-stack">
              <div class="ja-cell-title">${escapeHtml(row.jobTitle)}</div>
              <div class="ja-cell-sub">${escapeHtml(row.jobLocation || 'Location snapshot not stored')}</div>
              <div class="ja-cell-sub">${escapeHtml(row.jobType || 'Type not stored')}${row.jobPay ? ` · ${escapeHtml(row.jobPay)}` : ''}</div>
            </div>
          </td>
          <td>
            <div class="ja-cell-stack">
              <span class="ja-status" data-tone="${escapeHtml(meta.tone)}">${escapeHtml(meta.label)}</span>
              <select class="ja-select" data-status-select="${escapeHtml(row.id)}" aria-label="Change application status for ${escapeHtml(row.candidateName)}">
                ${STATUS_OPTIONS.map((option) => `<option value="${option.value}" ${option.value === row.status ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
              </select>
            </div>
          </td>
          <td>
            <div class="ja-cell-stack">
              <span class="ja-chip">${escapeHtml(row.sourceLabel || row.source || 'Website')}</span>
              <div class="ja-cell-sub">${escapeHtml(row.shareCode || row.sourceSubmissionId || 'No external tracking code')}</div>
            </div>
          </td>
          <td>
            <div class="ja-cell-actions">
              <button class="ja-btn" type="button" data-open-application="${escapeHtml(row.id)}">Review</button>
              <a class="ja-link" href="${candidateHref(row)}">Candidate</a>
              <a class="ja-link" href="${jobHref(row)}">Role</a>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderDrawer() {
    const row = state.rows.find((item) => String(item.id) === String(state.activeId)) || null;
    if (!row) {
      els.applicationDrawer?.classList.remove('open');
      els.drawerOverlay?.classList.remove('open');
      if (els.applicationDrawer) els.applicationDrawer.setAttribute('aria-hidden', 'true');
      return;
    }

    const meta = statusMeta(row.status);
    if (els.applicationDrawer) els.applicationDrawer.setAttribute('aria-hidden', 'false');
    els.applicationDrawer?.classList.add('open');
    els.drawerOverlay?.classList.add('open');
    if (els.drawerTitle) els.drawerTitle.textContent = row.candidateName;
    if (els.drawerMeta) {
      els.drawerMeta.textContent = `${row.jobTitle} · ${row.jobLocation || 'No location snapshot'} · ${formatDateTime(row.appliedAt)}`;
    }
    if (els.drawerCandidateLink) {
      els.drawerCandidateLink.href = candidateHref(row);
      els.drawerCandidateLink.textContent = row.candidateId ? 'View candidate profile' : 'Candidates workspace';
    }
    if (els.drawerJobLink) {
      els.drawerJobLink.href = jobHref(row);
      els.drawerJobLink.textContent = 'View role';
    }
    if (els.drawerStatusActions) {
      els.drawerStatusActions.innerHTML = STATUS_OPTIONS.map((option) => `
        <button class="ja-btn ${option.value === row.status ? 'ja-btn--primary' : ''}" type="button" data-drawer-status="${option.value}">
          ${escapeHtml(option.label)}
        </button>
      `).join('');
    }
    if (els.drawerBody) {
      els.drawerBody.innerHTML = `
        <div class="ja-drawer__section">
          <div class="ja-cell-actions">
            <span class="ja-status" data-tone="${escapeHtml(meta.tone)}">${escapeHtml(meta.label)}</span>
            <span class="ja-chip">${escapeHtml(row.sourceLabel || row.source || 'Website')}</span>
          </div>
          <div class="ja-drawer__grid">
            <div class="ja-meta"><span>Application id</span><strong>${escapeHtml(row.id || '—')}</strong></div>
            <div class="ja-meta"><span>Applied</span><strong>${escapeHtml(formatDateTime(row.appliedAt))}</strong></div>
            <div class="ja-meta"><span>Candidate email</span><strong>${escapeHtml(row.candidateEmail || 'Not stored')}</strong></div>
            <div class="ja-meta"><span>Candidate location</span><strong>${escapeHtml(row.candidateLocation || 'Not stored')}</strong></div>
            <div class="ja-meta"><span>Job id</span><strong>${escapeHtml(row.jobId || 'Not linked')}</strong></div>
            <div class="ja-meta"><span>Role status</span><strong>${escapeHtml(row.jobStatus || 'Not available')}</strong></div>
            <div class="ja-meta"><span>Job type</span><strong>${escapeHtml(row.jobType || 'Not stored')}</strong></div>
            <div class="ja-meta"><span>Job pay</span><strong>${escapeHtml(row.jobPay || 'Not stored')}</strong></div>
          </div>
        </div>
        <div class="ja-drawer__section">
          <p class="ja-eyebrow" style="margin:0">Application note</p>
          <p class="ja-note">${escapeHtml(row.notes || 'No application note captured on this record.')}</p>
        </div>
      `;
    }
  }

  async function loadApplications({ silent = false } = {}) {
    if (!state.helpers) return;
    state.loading = true;
    renderPagination();
    if (!silent) setAlert('');

    try {
      const payload = await state.helpers.api('admin-job-applications-list', 'POST', {
        q: state.filters.q,
        status: state.filters.status,
        source: state.filters.source,
        page: state.page,
        pageSize: state.pageSize,
        sort: state.sort,
      });

      state.rows = Array.isArray(payload.rows) ? payload.rows : [];
      state.page = Number(payload.page) || 1;
      state.pages = Number(payload.pages) || 1;
      state.total = Number(payload.total) || 0;
      state.overallTotal = Number(payload.overallTotal) || 0;
      state.summary = payload.summary || null;
      state.overallSummary = payload.overallSummary || null;
      state.sources = Array.isArray(payload.sources) ? payload.sources : [];
      renderSourceOptions();
      renderSummary();
      renderFilterChips();
      renderRows();
      renderPagination();
      renderDrawer();
      writeQueryState();
      if (!silent) {
        setAlert(state.total
          ? `Loaded ${state.total} application${state.total === 1 ? '' : 's'} for the current view.`
          : 'No job applications match the current filters.');
      }
    } catch (error) {
      state.rows = [];
      state.total = 0;
      state.pages = 1;
      renderRows();
      renderPagination();
      setAlert(error.message || 'Unable to load job applications.');
      state.helpers.toast(error.message || 'Unable to load job applications.', 'error', 4200);
    } finally {
      state.loading = false;
      renderPagination();
    }
  }

  async function updateStatus(id, nextStatus) {
    if (!id || !nextStatus || !state.helpers) return;
    const current = state.rows.find((row) => String(row.id) === String(id));
    const currentStatus = current?.status || '';
    if (currentStatus === nextStatus) return;

    try {
      await state.helpers.api('admin-job-applications-update', 'POST', { id, status: nextStatus });
      state.helpers.toast(`Application moved to ${statusMeta(nextStatus).label}.`, 'ok', 2600);
      await loadApplications({ silent: true });
      if (state.activeId && String(state.activeId) === String(id)) {
        state.activeId = id;
        renderDrawer();
      }
    } catch (error) {
      state.helpers.toast(error.message || 'Unable to update the application status.', 'error', 4200);
      renderRows();
      renderDrawer();
    }
  }

  function openDrawer(id) {
    state.activeId = id;
    renderRows();
    renderDrawer();
  }

  function closeDrawer() {
    state.activeId = null;
    renderRows();
    renderDrawer();
  }

  function bindEvents() {
    els.btnRefresh?.addEventListener('click', () => loadApplications());
    els.btnApplyFilters?.addEventListener('click', () => {
      state.filters.q = (els.filterSearch?.value || '').trim();
      state.filters.status = els.filterStatus?.value || 'all';
      state.filters.source = els.filterSource?.value || 'all';
      const [key, dir] = String(els.sortSelect?.value || 'applied_at:desc').split(':');
      state.sort = { key, dir };
      state.page = 1;
      loadApplications();
    });
    els.btnClearFilters?.addEventListener('click', () => {
      state.filters = { q: '', status: 'all', source: 'all' };
      state.sort = { key: 'applied_at', dir: 'desc' };
      state.page = 1;
      syncFilterInputs();
      renderSourceOptions();
      loadApplications();
    });
    els.filterSearch?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        els.btnApplyFilters?.click();
      }
    });
    els.btnPrevPage?.addEventListener('click', () => {
      if (state.page <= 1) return;
      state.page -= 1;
      loadApplications({ silent: true });
    });
    els.btnNextPage?.addEventListener('click', () => {
      if (state.page >= state.pages) return;
      state.page += 1;
      loadApplications({ silent: true });
    });
    els.applicationRows?.addEventListener('click', (event) => {
      const reviewButton = event.target.closest('[data-open-application]');
      if (reviewButton) {
        openDrawer(reviewButton.getAttribute('data-open-application'));
      }
    });
    els.applicationRows?.addEventListener('change', (event) => {
      const select = event.target.closest('[data-status-select]');
      if (!select) return;
      updateStatus(select.getAttribute('data-status-select'), select.value);
    });
    els.btnCloseDrawer?.addEventListener('click', closeDrawer);
    els.drawerOverlay?.addEventListener('click', closeDrawer);
    els.drawerStatusActions?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-drawer-status]');
      if (!button || !state.activeId) return;
      updateStatus(state.activeId, button.getAttribute('data-drawer-status'));
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.activeId) closeDrawer();
    });
  }

  function boot() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      window.setTimeout(boot, 40);
      return;
    }

    setupElements();
    readQueryState();
    syncFilterInputs();

    window.Admin.bootAdmin(async (helpers) => {
      state.helpers = helpers;
      const who = await helpers.identity('admin');
      if (!who?.ok) {
        if (els.gate) els.gate.style.display = 'grid';
        if (els.app) els.app.style.display = 'none';
        return;
      }
      if (els.gate) els.gate.style.display = 'none';
      if (els.app) els.app.style.display = 'grid';
      if (els.welcomeMeta) {
        els.welcomeMeta.textContent = `Signed in as ${who.user?.email || who.email || 'admin'}`;
      }
      bindEvents();
      await loadApplications();
    }).catch((error) => {
      console.error('[job-applications] bootstrap failed', error);
      setAlert('The job applications workspace hit a startup error. Refresh and try again.');
    });
  }

  boot();
})();
