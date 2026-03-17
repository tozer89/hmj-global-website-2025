(function bootTimesheets() {
  if (!window.Admin || typeof window.Admin.bootAdmin !== 'function' || !window.netlifyIdentity) {
    return setTimeout(bootTimesheets, 40);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function trimString(value) {
    return String(value == null ? '' : value).trim();
  }

  function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function formatDate(value) {
    const text = trimString(value);
    if (!text) return '—';
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return text;
    return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatHours(value) {
    return toNumber(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function statusClass(value) {
    const raw = trimString(value).toLowerCase();
    if (raw === 'draft') return 'status-draft';
    if (raw === 'submitted') return 'status-submitted';
    if (raw === 'approved') return 'status-approved';
    if (raw === 'rejected') return 'status-rejected';
    return 'status-other';
  }

  function normaliseStatus(value) {
    const raw = trimString(value).toLowerCase();
    if (!raw) return '';
    if (raw.includes('approved')) return 'approved';
    if (raw.includes('reject')) return 'rejected';
    if (raw.includes('draft')) return 'draft';
    if (raw.includes('submit') || raw.includes('pending')) return 'submitted';
    return raw;
  }

  function normaliseText(value) {
    return trimString(value).toLowerCase();
  }

  Admin.bootAdmin(async ({ api, sel, identity, getTrace }) => {
    const storageKey = 'hmj.admin.timesheets.filters.v1';
    const chips = sel('#diagChips');
    const chip = (label, tone = 'ok') => {
      if (!chips) return;
      const span = document.createElement('span');
      span.className = 'pill';
      if (tone === 'warn') span.style.background = 'rgba(245,158,11,.18)';
      if (tone === 'bad') span.style.background = 'rgba(180,35,24,.25)';
      span.textContent = label;
      chips.appendChild(span);
    };

    const gate = sel('#gate');
    const app = sel('#app');

    const who = await identity('admin');
    if (!who || !who.ok) {
      if (app) app.style.display = 'none';
      if (gate) {
        gate.style.display = '';
        const why = gate.querySelector('.why');
        if (why) why.textContent = 'Restricted. Sign in with an admin account.';
      }
      chip('role: blocked', 'bad');
      return;
    }

    chip('role: admin');
    chip(`trace ${getTrace().slice(0, 8)}`);
    if (gate) gate.style.display = 'none';
    if (app) app.style.display = '';

    const els = {
      summaryBar: sel('#summaryBar'),
      syncNotice: sel('#syncNotice'),
      resultMeta: sel('#resultMeta'),
      filterSearch: sel('#filterSearch'),
      filterStatus: sel('#filterStatus'),
      filterCandidate: sel('#filterCandidate'),
      filterClient: sel('#filterClient'),
      filterAssignment: sel('#filterAssignment'),
      filterWeekFrom: sel('#filterWeekFrom'),
      filterWeekTo: sel('#filterWeekTo'),
      btnRefresh: sel('#btnRefresh'),
      btnClear: sel('#btnClear'),
      btnExportCsv: sel('#btnExportCsv'),
      tableWrap: sel('#tableWrap'),
      drawer: sel('#detailDrawer'),
      drawerOverlay: sel('#drawerOverlay'),
      drawerClose: sel('#drawerClose'),
      drawerTitle: sel('#drawerTitle'),
      drawerMeta: sel('#drawerMeta'),
      drawerFacts: sel('#drawerFacts'),
      drawerMatches: sel('#drawerMatches'),
      drawerNotes: sel('#drawerNotes'),
      drawerRaw: sel('#drawerRaw'),
    };

    const state = {
      rows: [],
      filtered: [],
      selectedId: '',
      loading: false,
      source: '',
      sync: null,
      syncError: null,
      emptyMessage: '',
      filters: {
        search: '',
        status: '',
        candidate: '',
        client: '',
        assignment: '',
        weekFrom: '',
        weekTo: '',
      },
    };

    function loadStoredFilters() {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (stored && typeof stored === 'object') Object.assign(state.filters, stored);
      } catch {}
    }

    function persistFilters() {
      try {
        localStorage.setItem(storageKey, JSON.stringify(state.filters));
      } catch {}
    }

    function syncFiltersToInputs() {
      if (els.filterSearch) els.filterSearch.value = state.filters.search;
      if (els.filterStatus) els.filterStatus.value = state.filters.status;
      if (els.filterCandidate) els.filterCandidate.value = state.filters.candidate;
      if (els.filterClient) els.filterClient.value = state.filters.client;
      if (els.filterAssignment) els.filterAssignment.value = state.filters.assignment;
      if (els.filterWeekFrom) els.filterWeekFrom.value = state.filters.weekFrom;
      if (els.filterWeekTo) els.filterWeekTo.value = state.filters.weekTo;
    }

    function filterRows(rows) {
      const search = normaliseText(state.filters.search);
      const status = normaliseStatus(state.filters.status);
      const candidate = normaliseText(state.filters.candidate);
      const client = normaliseText(state.filters.client);
      const assignment = normaliseText(state.filters.assignment);
      const weekFrom = trimString(state.filters.weekFrom);
      const weekTo = trimString(state.filters.weekTo);

      return (Array.isArray(rows) ? rows : []).filter((row) => {
        if (status && normaliseStatus(row.status) !== status) return false;
        if (candidate && !normaliseText(row.candidateName).includes(candidate)) return false;
        if (client && !normaliseText(row.clientName).includes(client)) return false;
        if (assignment) {
          const hay = normaliseText(`${row.assignmentRef || ''} ${row.assignmentTitle || ''}`);
          if (!hay.includes(assignment)) return false;
        }
        if (weekFrom && trimString(row.weekEnding) && trimString(row.weekEnding) < weekFrom) return false;
        if (weekTo && trimString(row.weekEnding) && trimString(row.weekEnding) > weekTo) return false;
        if (search) {
          const haystack = normaliseText([
            row.candidateName,
            row.candidateEmail,
            row.clientName,
            row.assignmentRef,
            row.assignmentTitle,
            row.payrollRef,
            row.approverName,
          ].filter(Boolean).join(' '));
          if (!haystack.includes(search)) return false;
        }
        return true;
      }).sort((a, b) => {
        const left = trimString(b.weekEnding);
        const right = trimString(a.weekEnding);
        if (left !== right) return left.localeCompare(right);
        return trimString(a.assignmentRef).localeCompare(trimString(b.assignmentRef));
      });
    }

    function renderSummary() {
      if (!els.summaryBar) return;
      const rows = state.filtered;
      const byStatus = rows.reduce((acc, row) => {
        const key = normaliseStatus(row.status) || 'submitted';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const totalHours = rows.reduce((sum, row) => sum + toNumber(row.hours), 0);
      const matchedCandidates = rows.filter((row) => row.match && row.match.candidate).length;
      const matchedAssignments = rows.filter((row) => row.match && row.match.assignment).length;

      els.summaryBar.innerHTML = `
        <div class="summary-card"><h4>Total rows</h4><strong>${rows.length}</strong><small>Visible in current filter view</small></div>
        <div class="summary-card"><h4>Total hours</h4><strong>${formatHours(totalHours)}</strong><small>Standard + overtime hours</small></div>
        <div class="summary-card"><h4>Matched candidates</h4><strong>${matchedCandidates}</strong><small>Rows linked to website candidates</small></div>
        <div class="summary-card"><h4>Matched assignments</h4><strong>${matchedAssignments}</strong><small>Rows linked to website assignments</small></div>
        <div class="summary-card"><h4>Submitted</h4><strong>${byStatus.submitted || 0}</strong><small>Awaiting approval or final processing</small></div>
        <div class="summary-card"><h4>Approved</h4><strong>${byStatus.approved || 0}</strong><small>Approved in Timesheet Portal</small></div>
      `;
    }

    function renderSyncNotice() {
      if (!els.syncNotice) return;
      const discoveryPath = state.sync?.discovery?.timesheetPath || '';
      const attemptCopy = Array.isArray(state.sync?.attempts) && state.sync.attempts.length
        ? state.sync.attempts.map((attempt) => `${attempt.path} → ${attempt.status}`).join(' · ')
        : '';
      const rowsCopy = state.rows.length
        ? `${state.rows.length} mirrored row${state.rows.length === 1 ? '' : 's'} loaded from Timesheet Portal.`
        : (state.emptyMessage || 'No timesheet rows are currently available.');

      if (state.syncError) {
        els.syncNotice.className = 'alert bad';
        els.syncNotice.innerHTML = `
          <strong>Timesheet Portal sync failed.</strong><br/>
          ${escapeHtml(state.syncError.message || 'Unknown error')}
          ${attemptCopy ? `<div class="muted" style="margin-top:8px">Latest checks: ${escapeHtml(attemptCopy)}</div>` : ''}
        `;
        return;
      }

      if (state.source === 'timesheet_portal') {
        els.syncNotice.className = state.rows.length ? 'alert' : 'alert warn';
        els.syncNotice.innerHTML = `
          <strong>Live TSP mirror ${discoveryPath ? `via ${escapeHtml(discoveryPath)}` : ''}.</strong><br/>
          ${escapeHtml(rowsCopy)}
          ${attemptCopy ? `<div class="muted" style="margin-top:8px">Latest checks: ${escapeHtml(attemptCopy)}</div>` : ''}
        `;
        return;
      }

      els.syncNotice.className = 'alert warn';
      els.syncNotice.innerHTML = `
        <strong>Fallback source in use.</strong><br/>
        ${escapeHtml(rowsCopy)}
      `;
    }

    function renderTable() {
      if (!els.tableWrap) return;
      if (state.loading) {
        els.tableWrap.innerHTML = '<div class="empty">Loading live timesheet data…</div>';
        return;
      }
      if (!state.filtered.length) {
        els.tableWrap.innerHTML = `<div class="empty">${escapeHtml(state.emptyMessage || 'No timesheets match the current filters.')}</div>`;
        return;
      }

      const rowsHtml = state.filtered.map((row) => {
        const selected = String(row.id) === String(state.selectedId);
        const candidateMatch = row.match?.candidate ? '<span class="match-chip">Candidate linked</span>' : '<span class="match-chip missing">Candidate missing</span>';
        const assignmentMatch = row.match?.assignment ? '<span class="match-chip">Assignment linked</span>' : '<span class="match-chip missing">Assignment missing</span>';
        return `
          <tr data-row-id="${escapeHtml(row.id)}" class="${selected ? 'active' : ''}">
            <td>
              <strong>${escapeHtml(row.assignmentRef || '—')}</strong><br/>
              <span class="muted">${escapeHtml(row.assignmentTitle || 'Role pending')}</span>
            </td>
            <td><span class="status-chip ${statusClass(row.status)}">${escapeHtml(normaliseStatus(row.status) || 'submitted')}</span></td>
            <td>
              ${escapeHtml(row.candidateName || 'Unknown worker')}<br/>
              <span class="muted">${escapeHtml(row.candidateEmail || row.payrollRef || 'No email / payroll ref')}</span>
            </td>
            <td>
              ${escapeHtml(row.clientName || 'Client pending')}<br/>
              <span class="muted">${escapeHtml(row.siteName || 'No site')}</span>
            </td>
            <td>${formatHours(row.standardHours)}</td>
            <td>${formatHours(row.overtimeHours)}</td>
            <td>${formatHours(row.hours)}</td>
            <td>${escapeHtml(formatDate(row.weekEnding))}</td>
            <td>
              ${candidateMatch}<br/>
              ${assignmentMatch}
            </td>
          </tr>
        `;
      }).join('');

      els.tableWrap.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Assignment</th>
              <th>Status</th>
              <th>Worker</th>
              <th>Client / site</th>
              <th>Std (h)</th>
              <th>OT (h)</th>
              <th>Total (h)</th>
              <th>Week ending</th>
              <th>Website match</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      `;

      els.tableWrap.querySelectorAll('tbody tr[data-row-id]').forEach((rowEl) => {
        rowEl.addEventListener('click', () => {
          const row = state.filtered.find((item) => String(item.id) === String(rowEl.dataset.rowId));
          if (row) openDrawer(row);
        });
      });
    }

    function renderDrawer(row) {
      if (!row) return;
      state.selectedId = row.id;
      if (els.drawerTitle) els.drawerTitle.textContent = row.candidateName || 'Timesheet detail';
      if (els.drawerMeta) {
        els.drawerMeta.textContent = `${row.assignmentRef || 'No assignment ref'} • ${formatDate(row.weekEnding)} • Source ${row.source === 'timesheet_portal' ? 'TSP' : row.source}`;
      }
      if (els.drawerFacts) {
        els.drawerFacts.innerHTML = [
          ['Status', normaliseStatus(row.status) || 'submitted'],
          ['Week ending', formatDate(row.weekEnding)],
          ['Worker email', row.candidateEmail || '—'],
          ['Payroll ref', row.payrollRef || '—'],
          ['Client', row.clientName || '—'],
          ['Assignment', row.assignmentTitle || row.assignmentRef || '—'],
          ['Approver', row.approverName || '—'],
          ['Std hours', formatHours(row.standardHours)],
          ['OT hours', formatHours(row.overtimeHours)],
          ['Total hours', formatHours(row.hours)],
          ['Currency', row.currency || 'GBP'],
        ].map(([label, value]) => `<div class="muted">${escapeHtml(label)}</div><div>${escapeHtml(value)}</div>`).join('');
      }
      if (els.drawerMatches) {
        els.drawerMatches.innerHTML = [
          ['Website candidate', row.match?.candidate ? `${row.match.candidate.name || 'Candidate'}${row.match.candidate.email ? ` (${row.match.candidate.email})` : ''}` : 'No linked website candidate'],
          ['Website assignment', row.match?.assignment ? `${row.match.assignment.ref || 'Assignment'}${row.match.assignment.title ? ` — ${row.match.assignment.title}` : ''}` : 'No linked website assignment'],
          ['Read only', row.readOnlyReason || 'This row is view-only in the admin workspace.'],
        ].map(([label, value]) => `<div class="muted">${escapeHtml(label)}</div><div>${escapeHtml(value)}</div>`).join('');
      }
      if (els.drawerNotes) {
        els.drawerNotes.textContent = row.notes || 'No note text was supplied by Timesheet Portal for this row.';
      }
      if (els.drawerRaw) {
        els.drawerRaw.textContent = JSON.stringify(row.raw || row, null, 2);
      }
      if (els.drawer) {
        els.drawer.classList.add('active');
        els.drawer.setAttribute('aria-hidden', 'false');
      }
      renderTable();
    }

    function closeDrawer() {
      state.selectedId = '';
      if (els.drawer) {
        els.drawer.classList.remove('active');
        els.drawer.setAttribute('aria-hidden', 'true');
      }
      renderTable();
    }

    function applyFilters() {
      state.filtered = filterRows(state.rows);
      if (els.resultMeta) {
        const all = state.rows.length;
        const visible = state.filtered.length;
        els.resultMeta.textContent = `${visible} timesheet${visible === 1 ? '' : 's'} visible${all !== visible ? ` (of ${all})` : ''}`;
      }
      renderSummary();
      renderSyncNotice();
      renderTable();
      persistFilters();
      if (state.selectedId) {
        const row = state.filtered.find((item) => String(item.id) === String(state.selectedId))
          || state.rows.find((item) => String(item.id) === String(state.selectedId));
        if (row && els.drawer?.classList.contains('active')) renderDrawer(row);
      }
    }

    async function loadRows() {
      state.loading = true;
      renderSyncNotice();
      renderTable();
      try {
        const payload = await api('/admin-timesheets-list', 'POST', {});
        state.rows = Array.isArray(payload.rows) ? payload.rows : [];
        state.source = payload.source || '';
        state.sync = payload.sync || null;
        state.syncError = payload.syncError || null;
        state.emptyMessage = payload.emptyMessage || '';
        applyFilters();
      } catch (error) {
        state.rows = [];
        state.filtered = [];
        state.source = '';
        state.sync = null;
        state.syncError = {
          code: error?.details?.code || error.code || 'timesheets_load_failed',
          message: error?.message || 'Failed to load timesheets.',
          attempts: Array.isArray(error?.details?.attempts) ? error.details.attempts : [],
        };
        state.emptyMessage = 'Timesheet Portal sync failed.';
        renderSummary();
        renderSyncNotice();
        renderTable();
      } finally {
        state.loading = false;
        renderSyncNotice();
        renderTable();
      }
    }

    function exportCsv() {
      const rows = state.filtered;
      const head = ['Week ending', 'Status', 'Worker', 'Worker email', 'Payroll ref', 'Client', 'Assignment ref', 'Assignment title', 'Std hours', 'OT hours', 'Total hours', 'Approver', 'Source'];
      const lines = [head];
      rows.forEach((row) => {
        lines.push([
          row.weekEnding || '',
          normaliseStatus(row.status) || '',
          row.candidateName || '',
          row.candidateEmail || '',
          row.payrollRef || '',
          row.clientName || '',
          row.assignmentRef || '',
          row.assignmentTitle || '',
          formatHours(row.standardHours),
          formatHours(row.overtimeHours),
          formatHours(row.hours),
          row.approverName || '',
          row.source || '',
        ]);
      });
      const csv = lines.map((cols) => cols.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `timesheets-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    function bindInputs() {
      const inputMap = [
        [els.filterSearch, 'search'],
        [els.filterStatus, 'status'],
        [els.filterCandidate, 'candidate'],
        [els.filterClient, 'client'],
        [els.filterAssignment, 'assignment'],
        [els.filterWeekFrom, 'weekFrom'],
        [els.filterWeekTo, 'weekTo'],
      ];
      inputMap.forEach(([element, key]) => {
        if (!element) return;
        const eventName = element.tagName === 'SELECT' ? 'change' : 'input';
        element.addEventListener(eventName, (event) => {
          state.filters[key] = event.target.value || '';
          applyFilters();
        });
      });
      if (els.btnClear) {
        els.btnClear.addEventListener('click', () => {
          Object.keys(state.filters).forEach((key) => { state.filters[key] = ''; });
          syncFiltersToInputs();
          applyFilters();
        });
      }
      if (els.btnRefresh) {
        els.btnRefresh.addEventListener('click', () => loadRows());
      }
      if (els.btnExportCsv) {
        els.btnExportCsv.addEventListener('click', () => exportCsv());
      }
      if (els.drawerClose) els.drawerClose.addEventListener('click', closeDrawer);
      if (els.drawerOverlay) els.drawerOverlay.addEventListener('click', closeDrawer);
    }

    loadStoredFilters();
    syncFiltersToInputs();
    bindInputs();
    loadRows();
  });
}());
