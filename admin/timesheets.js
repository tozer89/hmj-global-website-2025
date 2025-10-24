(function (global) {
  const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const STORAGE_KEY = 'hmj_admin_timesheets_filters_v2';
  const CACHE_KEY = 'hmj_admin_timesheets_cache_v1';

  const STATUS_ORDER = ['draft', 'submitted', 'approved', 'rejected'];

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function parseDate(value) {
    if (!value) return null;
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  function formatDateUk(value) {
    const dt = parseDate(value);
    if (!dt) return '';
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value || 0);
  }

  function computeTotals(row) {
    const entries = row.entries || [];
    let std = 0;
    let ot = 0;
    entries.forEach((entry) => {
      std += Number(entry.std || 0);
      ot += Number(entry.ot || 0);
    });
    row.totalStd = Number(std.toFixed(2));
    row.totalOt = Number(ot.toFixed(2));
    row.gross = Number(((row.totalStd * (row.rateStd || 0)) + (row.totalOt * (row.rateOt || row.rateStd || 0))).toFixed(2));
    return row;
  }

  function normaliseRow(row) {
    const base = Object.assign({
      id: 0,
      assignmentId: '',
      contractor: '',
      contractorEmail: '',
      client: '',
      site: '',
      role: '',
      status: 'draft',
      approver: '',
      weekEnding: '',
      weekNumber: 0,
      rateStd: 20,
      rateOt: 30,
      notes: '',
      approverNotes: '',
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      submittedAt: null,
      approvedAt: null,
      overdue: false,
      entries: DAY_KEYS.map((day) => ({ day, std: 0, ot: 0, note: '' })),
    }, row || {});
    computeTotals(base);
    return base;
  }

  function seedData() {
    const today = new Date();
    const sunday = new Date(today);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const prevSunday = new Date(sunday);
    prevSunday.setDate(prevSunday.getDate() - 7);
    const nextSunday = new Date(sunday);
    nextSunday.setDate(nextSunday.getDate() + 7);

    const rows = [
      normaliseRow({
        id: 1,
        assignmentId: 'A-1001',
        contractor: 'Alice Carter',
        contractorEmail: 'alice@example.com',
        client: 'BioHealth Ltd',
        site: 'Leeds R&D',
        role: 'Lab Technician',
        status: 'draft',
        weekEnding: prevSunday.toISOString().slice(0, 10),
        weekNumber: 18,
        entries: DAY_KEYS.map((day, idx) => ({ day, std: idx < 5 ? 8 : 0, ot: 0 })),
      }),
      normaliseRow({
        id: 2,
        assignmentId: 'A-1002',
        contractor: 'Ben Fox',
        contractorEmail: 'ben@example.com',
        client: 'Northwind Energy',
        site: 'Offshore A',
        role: 'Rigger',
        status: 'submitted',
        weekEnding: sunday.toISOString().slice(0, 10),
        weekNumber: 19,
        approver: 'Laura Miles',
        entries: DAY_KEYS.map((day) => ({ day, std: 10, ot: day === 'sun' ? 6 : 0 })),
      }),
      normaliseRow({
        id: 3,
        assignmentId: 'A-1003',
        contractor: 'Clare Singh',
        contractorEmail: 'clare@example.com',
        client: 'BioHealth Ltd',
        site: 'Manchester QA',
        role: 'Quality Analyst',
        status: 'approved',
        approver: 'Laura Miles',
        weekEnding: sunday.toISOString().slice(0, 10),
        weekNumber: 19,
        entries: DAY_KEYS.map((day, idx) => ({ day, std: idx < 5 ? 7.5 : 0, ot: 0 })),
      }),
      normaliseRow({
        id: 4,
        assignmentId: 'A-1004',
        contractor: 'David Young',
        contractorEmail: 'david@example.com',
        client: 'Zenith Pharma',
        site: 'London HQ',
        role: 'Project Manager',
        status: 'rejected',
        approver: 'Ian Cole',
        weekEnding: prevSunday.toISOString().slice(0, 10),
        weekNumber: 18,
        entries: DAY_KEYS.map((day, idx) => ({ day, std: idx < 5 ? 8 : 0, ot: idx === 4 ? 4 : 0 })),
      }),
      normaliseRow({
        id: 5,
        assignmentId: 'A-1005',
        contractor: 'Evan Morris',
        contractorEmail: 'evan@example.com',
        client: 'Northwind Energy',
        site: 'Offshore A',
        role: 'Electrician',
        status: 'draft',
        weekEnding: nextSunday.toISOString().slice(0, 10),
        weekNumber: 20,
        entries: DAY_KEYS.map((day, idx) => ({ day, std: idx < 5 ? 0 : 0, ot: 0 })),
      }),
    ];
    rows.forEach((row) => computeTotals(row));
    return rows;
  }

  function createTimesheetsApp(doc, options) {
    const opt = Object.assign({ seed: null, disablePersistence: false }, options || {});

    const els = {
      debugIdentity: doc.getElementById('debugIdentity'),
      signOut: doc.getElementById('btnSignOut'),
      weekPrev: doc.getElementById('weekPrev'),
      weekNext: doc.getElementById('weekNext'),
      weekCurrent: doc.getElementById('weekCurrent'),
      weekLabel: doc.getElementById('weekLabel'),
      summaryTotal: doc.getElementById('summaryTotal'),
      summaryFiltered: doc.getElementById('summaryFiltered'),
      summarySelected: doc.getElementById('summarySelected'),
      refreshButton: doc.getElementById('refreshButton'),
      toggleFilters: doc.getElementById('toggleFilters'),
      filtersPanel: doc.getElementById('filters'),
      filterSearch: doc.getElementById('filterSearch'),
      filterStatus: doc.getElementById('filterStatus'),
      filterContractor: doc.getElementById('filterContractor'),
      filterClient: doc.getElementById('filterClient'),
      filterSite: doc.getElementById('filterSite'),
      filterRole: doc.getElementById('filterRole'),
      filterWeekFrom: doc.getElementById('filterWeekFrom'),
      filterWeekTo: doc.getElementById('filterWeekTo'),
      filterWeekNumber: doc.getElementById('filterWeekNumber'),
      filterApprover: doc.getElementById('filterApprover'),
      filterMissing: doc.getElementById('filterMissing'),
      filterChips: doc.getElementById('filterChips'),
      filterClear: doc.getElementById('clearFilters'),
      filteredBadge: doc.getElementById('filteredBadge'),
      tableViewport: doc.getElementById('tableViewport'),
      tablePlaceholder: doc.getElementById('tablePlaceholder'),
      tableInner: doc.getElementById('tableInner'),
      totalsStd: doc.getElementById('totalsStd'),
      totalsOt: doc.getElementById('totalsOt'),
      totalsGross: doc.getElementById('totalsGross'),
      selectAll: doc.getElementById('selectAll'),
      bulkBar: doc.getElementById('bulkBar'),
      bulkCount: doc.getElementById('bulkCount'),
      bulkApprove: doc.getElementById('bulkApprove'),
      bulkReject: doc.getElementById('bulkReject'),
      bulkExportCsv: doc.getElementById('bulkExportCsv'),
      bulkExportXlsx: doc.getElementById('bulkExportXlsx'),
      bulkRemind: doc.getElementById('bulkRemind'),
      bulkDelete: doc.getElementById('bulkDelete'),
      calendarButton: doc.getElementById('calendarButton'),
      chartsButton: doc.getElementById('chartsButton'),
      calendarModal: doc.getElementById('calendarModal'),
      calendarGrid: doc.getElementById('calendarGrid'),
      chartsModal: doc.getElementById('chartsModal'),
      chartClient: doc.getElementById('chartClient'),
      chartTrend: doc.getElementById('chartTrend'),
      chartStatus: doc.getElementById('chartStatus'),
      toastZone: doc.getElementById('toastZone'),
      createAssignment: doc.getElementById('createAssignment'),
      createWeek: doc.getElementById('createWeek'),
      createButton: doc.getElementById('createButton'),
      createHint: doc.getElementById('createHint'),
      csvInput: doc.getElementById('csvInput'),
      csvDryRun: doc.getElementById('csvDryRun'),
      csvImport: doc.getElementById('csvImport'),
      csvPreview: doc.getElementById('csvPreview'),
      reminderButton: doc.getElementById('reminderButton'),
      reminderPreview: doc.getElementById('reminderPreview'),
      auditList: doc.getElementById('auditList'),
      debugIdentityDetail: doc.getElementById('debugIdentityDetail'),
      debugTrace: doc.getElementById('debugTrace'),
      debugStatus: doc.getElementById('debugStatus'),
      debugButton: doc.getElementById('debugButton'),
      debugExport: doc.getElementById('debugExport'),
    };

    const state = {
      allRows: [],
      filteredRows: [],
      selected: new Set(),
      filters: {
        search: '',
        status: '',
        contractor: '',
        client: '',
        site: '',
        role: '',
        weekFrom: '',
        weekTo: '',
        weekNumber: '',
        approver: '',
        missing: '',
      },
      virtual: {
        rowHeight: 54,
        start: 0,
        end: 30,
      },
      cache: null,
      audit: [],
      debugLogs: [],
      autosaveTimers: new Map(),
      offline: false,
      activeWeek: new Date(),
      lastReminders: [],
    };

    function loadFilters() {
      if (opt.disablePersistence) return;
      try {
        const raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        Object.keys(state.filters).forEach((key) => {
          if (saved[key] !== undefined) state.filters[key] = saved[key];
        });
      } catch (err) {
        // ignore
      }
    }

    function saveFilters() {
      if (opt.disablePersistence) return;
      try {
        global.localStorage && global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.filters));
      } catch (err) {
        // ignore
      }
    }

    function loadCache() {
      if (opt.disablePersistence) return null;
      try {
        const raw = global.localStorage && global.localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const rows = JSON.parse(raw);
        return Array.isArray(rows) ? rows.map(normaliseRow) : null;
      } catch (err) {
        return null;
      }
    }

    function saveCache(rows) {
      if (opt.disablePersistence) return;
      try {
        global.localStorage && global.localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
      } catch (err) {
        // ignore
      }
    }

    function setIdentityPill(text) {
      if (els.debugIdentity) els.debugIdentity.textContent = text;
      if (els.debugIdentityDetail) els.debugIdentityDetail.textContent = text;
    }

    function toast(message, kind) {
      if (!els.toastZone) return;
      const div = doc.createElement('div');
      div.className = 'toast';
      div.textContent = message;
      if (kind === 'error') {
        div.style.background = '#821b1b';
      } else if (kind === 'success') {
        div.style.background = '#185226';
      }
      els.toastZone.appendChild(div);
      setTimeout(() => {
        div.classList.add('hide');
        div.remove();
      }, 3200);
    }

    function logAudit(action, details) {
      const entry = {
        at: new Date().toISOString(),
        action,
        details,
      };
      state.audit.unshift(entry);
      if (state.audit.length > 20) state.audit.length = 20;
      renderAudit();
    }

    function logDebug(type, payload) {
      state.debugLogs.push({ at: Date.now(), type, payload });
      if (state.debugLogs.length > 40) state.debugLogs.shift();
      if (els.debugStatus) {
        els.debugStatus.textContent = state.offline ? 'offline' : 'online';
      }
    }

    function renderAudit() {
      if (!els.auditList) return;
      if (!state.audit.length) {
        els.auditList.textContent = 'No changes yet.';
        return;
      }
      els.auditList.innerHTML = state.audit.map((item) => (
        `<div><strong>${item.action}</strong> <span class="muted">${new Date(item.at).toLocaleString()}</span><br/>${item.details}</div>`
      )).join('<hr/>');
    }

    function updateFilterInputs() {
      const f = state.filters;
      if (els.filterSearch) els.filterSearch.value = f.search || '';
      if (els.filterStatus) els.filterStatus.value = f.status || '';
      if (els.filterContractor) els.filterContractor.value = f.contractor || '';
      if (els.filterClient) els.filterClient.value = f.client || '';
      if (els.filterSite) els.filterSite.value = f.site || '';
      if (els.filterRole) els.filterRole.value = f.role || '';
      if (els.filterWeekFrom) els.filterWeekFrom.value = f.weekFrom || '';
      if (els.filterWeekTo) els.filterWeekTo.value = f.weekTo || '';
      if (els.filterWeekNumber) els.filterWeekNumber.value = f.weekNumber || '';
      if (els.filterApprover) els.filterApprover.value = f.approver || '';
      if (els.filterMissing) els.filterMissing.value = f.missing || '';
    }

    function uniqueValues(rows, key) {
      const seen = new Set();
      const values = [];
      rows.forEach((row) => {
        const value = row[key];
        if (value && !seen.has(value)) {
          seen.add(value);
          values.push(value);
        }
      });
      return values.sort((a, b) => a.localeCompare(b));
    }

    function populateFilterOptions() {
      const rows = state.allRows;
      function fill(select, values) {
        if (!select) return;
        const opts = ['<option value="">Any</option>'].concat(values.map((value) => `<option value="${value}">${value}</option>`));
        select.innerHTML = opts.join('');
      }
      fill(els.filterContractor, uniqueValues(rows, 'contractor'));
      fill(els.filterClient, uniqueValues(rows, 'client'));
      fill(els.filterSite, uniqueValues(rows, 'site'));
      fill(els.filterRole, uniqueValues(rows, 'role'));
      fill(els.filterApprover, uniqueValues(rows, 'approver'));
      updateFilterInputs();
    }

    function rowMatchesFilters(row) {
      const f = state.filters;
      if (f.status && row.status !== f.status) return false;
      if (f.contractor && row.contractor !== f.contractor) return false;
      if (f.client && row.client !== f.client) return false;
      if (f.site && row.site !== f.site) return false;
      if (f.role && row.role !== f.role) return false;
      if (f.approver && row.approver !== f.approver) return false;
      if (f.weekNumber && Number(row.weekNumber) !== Number(f.weekNumber)) return false;
      if (f.weekFrom) {
        const from = parseDate(f.weekFrom);
        if (from && parseDate(row.weekEnding) < from) return false;
      }
      if (f.weekTo) {
        const to = parseDate(f.weekTo);
        if (to && parseDate(row.weekEnding) > to) return false;
      }
      if (f.missing === 'missing') {
        if (row.totalStd + row.totalOt > 0) return false;
      }
      if (f.search) {
        const target = `${row.assignmentId} ${row.contractor} ${row.contractorEmail} ${row.client} ${row.site}`.toLowerCase();
        if (!target.includes(f.search.toLowerCase())) return false;
      }
      return true;
    }

    function applyFilters() {
      state.filteredRows = state.allRows.filter(rowMatchesFilters);
      state.filteredRows.sort((a, b) => {
        const weekDiff = parseDate(b.weekEnding) - parseDate(a.weekEnding);
        if (weekDiff !== 0) return weekDiff;
        const statusDiff = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
        if (statusDiff !== 0) return statusDiff;
        return (a.assignmentId || '').localeCompare(b.assignmentId || '');
      });
      renderFilterChips();
      renderTable();
      updateSummaries();
      renderCalendar();
      renderCharts();
    }

    function renderFilterChips() {
      if (!els.filterChips) return;
      const chips = [];
      Object.entries(state.filters).forEach(([key, value]) => {
        if (!value) return;
        let label = value;
        if (key === 'search') label = `Search: ${value}`;
        if (key === 'weekFrom') label = `From ${formatDateUk(value)}`;
        if (key === 'weekTo') label = `To ${formatDateUk(value)}`;
        if (key === 'weekNumber') label = `Week #${value}`;
        if (key === 'missing') label = 'Missing hours';
        chips.push(`<span class="chip" data-key="${key}">${label} <button class="remove" aria-label="Remove ${label}">×</button></span>`);
      });
      els.filterChips.innerHTML = chips.join('');
      els.filteredBadge.textContent = `Filtered: ${state.filteredRows.length}`;
      els.filterChips.querySelectorAll('.chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const key = chip.getAttribute('data-key');
          setFilter(key, '');
        });
      });
    }

    function setFilter(key, value) {
      state.filters[key] = value || '';
      saveFilters();
      applyFilters();
    }

    function updateSummaries() {
      if (els.summaryTotal) els.summaryTotal.textContent = `Total: ${state.allRows.length}`;
      if (els.summaryFiltered) els.summaryFiltered.textContent = `Filtered: ${state.filteredRows.length}`;
      if (els.summarySelected) els.summarySelected.textContent = `Selected: ${state.selected.size}`;
      const totals = state.filteredRows.reduce((acc, row) => {
        acc.std += row.totalStd || 0;
        acc.ot += row.totalOt || 0;
        acc.gross += row.gross || 0;
        return acc;
      }, { std: 0, ot: 0, gross: 0 });
      if (els.totalsStd) els.totalsStd.textContent = totals.std.toFixed(2);
      if (els.totalsOt) els.totalsOt.textContent = totals.ot.toFixed(2);
      if (els.totalsGross) els.totalsGross.textContent = formatCurrency(totals.gross);
      els.filteredBadge.textContent = `Filtered: ${state.filteredRows.length}`;
      els.bulkCount.textContent = `${state.selected.size} selected`;
      els.bulkBar.style.display = state.selected.size ? 'flex' : 'none';
    }

    function getRowElement(rowId) {
      return els.tableInner.querySelector(`[data-row-id="${rowId}"]`);
    }

    function renderTable() {
      const viewport = els.tableViewport;
      if (!viewport) return;
      const container = els.tableInner;
      container.innerHTML = '';
      if (!state.filteredRows.length) {
        els.tablePlaceholder.style.display = 'block';
        els.tablePlaceholder.textContent = 'No timesheets match the filters.';
        return;
      }
      els.tablePlaceholder.style.display = 'none';

      state.filteredRows.forEach((row) => {
        const div = doc.createElement('div');
        div.className = 'table-row';
        div.setAttribute('role', 'row');
        div.dataset.rowId = String(row.id);
        if (state.selected.has(row.id)) div.setAttribute('aria-selected', 'true');
        if (!validateRow(row).valid) div.classList.add('invalid');

        const sel = doc.createElement('input');
        sel.type = 'checkbox';
        sel.checked = state.selected.has(row.id);
        sel.addEventListener('change', () => toggleSelection(row.id, sel.checked));

        const cellSelect = doc.createElement('div');
        cellSelect.appendChild(sel);
        div.appendChild(cellSelect);

        const cellAssignment = doc.createElement('div');
        cellAssignment.innerHTML = `<strong>${row.assignmentId || '—'}</strong><br><span class="muted">${row.role || ''}</span>`;
        div.appendChild(cellAssignment);

        const statusCell = doc.createElement('div');
        const statusSpan = doc.createElement('span');
        statusSpan.className = `status-pill status-${row.status}`;
        statusSpan.textContent = row.status;
        statusCell.appendChild(statusSpan);
        div.appendChild(statusCell);

        const contractorCell = doc.createElement('div');
        contractorCell.innerHTML = `${row.contractor}<br><span class="muted">${row.contractorEmail || ''}</span>`;
        div.appendChild(contractorCell);

        const clientCell = doc.createElement('div');
        clientCell.innerHTML = `${row.client}<br><span class="muted">${row.site || ''}</span>`;
        div.appendChild(clientCell);

        const stdCell = doc.createElement('div');
        const stdInput = doc.createElement('input');
        stdInput.type = 'number';
        stdInput.step = '0.25';
        stdInput.min = '0';
        stdInput.className = 'hours-input';
        stdInput.value = row.totalStd.toFixed(2);
        stdInput.disabled = row.status !== 'draft';
        stdInput.addEventListener('input', () => handleHoursChange(row.id, 'std', Number(stdInput.value || 0)));
        stdCell.appendChild(stdInput);
        div.appendChild(stdCell);

        const otCell = doc.createElement('div');
        const otInput = doc.createElement('input');
        otInput.type = 'number';
        otInput.step = '0.25';
        otInput.min = '0';
        otInput.className = 'hours-input';
        otInput.value = row.totalOt.toFixed(2);
        otInput.disabled = row.status === 'approved';
        otInput.addEventListener('input', () => handleHoursChange(row.id, 'ot', Number(otInput.value || 0)));
        otCell.appendChild(otInput);
        div.appendChild(otCell);

        const grossCell = doc.createElement('div');
        grossCell.textContent = formatCurrency(row.gross);
        div.appendChild(grossCell);

        const weekCell = doc.createElement('div');
        const overdueTag = row.overdue ? '<span class="chip" style="background:#ffe7b3;color:#8a5200">Overdue</span><br>' : '';
        weekCell.innerHTML = `${overdueTag}${formatDateUk(row.weekEnding)}`;
        div.appendChild(weekCell);

        container.appendChild(div);
      });
    }

    function validateRow(row) {
      let valid = true;
      const issues = [];
      const totals = row.entries.reduce((acc, entry) => {
        const std = Number(entry.std || 0);
        const ot = Number(entry.ot || 0);
        if (std < 0 || ot < 0) {
          valid = false;
          issues.push('Negative hours');
        }
        if (std + ot > 24) {
          valid = false;
          issues.push('Over 24 hours in a day');
        }
        acc.std += std;
        acc.ot += ot;
        return acc;
      }, { std: 0, ot: 0 });
      if (totals.std + totals.ot === 0) {
        valid = false;
        issues.push('Total hours zero');
      }
      if (totals.ot > 0 && totals.std === 0) {
        valid = false;
        issues.push('OT without standard');
      }
      return { valid, issues };
    }

    function toggleSelection(id, selected) {
      if (selected) state.selected.add(id); else state.selected.delete(id);
      const rowEl = getRowElement(id);
      if (rowEl) {
        if (selected) rowEl.setAttribute('aria-selected', 'true'); else rowEl.removeAttribute('aria-selected');
      }
      updateSummaries();
    }

    function clearSelection() {
      state.selected.clear();
      els.tableInner.querySelectorAll('.table-row').forEach((row) => row.removeAttribute('aria-selected'));
      if (els.selectAll) els.selectAll.checked = false;
      updateSummaries();
    }

    function handleHoursChange(rowId, field, value) {
      const row = state.allRows.find((r) => r.id === rowId);
      if (!row) return;
      const perDay = value / DAY_KEYS.length;
      row.entries.forEach((entry) => {
        if (field === 'std') entry.std = Number(perDay.toFixed(2));
        if (field === 'ot') entry.ot = Number(perDay.toFixed(2));
      });
      computeTotals(row);
      queueAutosave(rowId);
      renderTable();
      updateSummaries();
      logAudit('edit', `Updated ${field} hours for ${row.assignmentId}`);
    }

    function queueAutosave(rowId) {
      if (state.autosaveTimers.has(rowId)) {
        clearTimeout(state.autosaveTimers.get(rowId));
      }
      const timer = setTimeout(() => {
        state.autosaveTimers.delete(rowId);
        toast('Changes saved', 'success');
        logDebug('autosave', { rowId });
      }, 400);
      state.autosaveTimers.set(rowId, timer);
    }

    function canTransition(row, nextStatus) {
      if (row.status === nextStatus) return true;
      const transitions = {
        draft: ['submitted', 'approved', 'rejected'],
        submitted: ['approved', 'rejected', 'draft'],
        approved: [],
        rejected: ['draft'],
      };
      return transitions[row.status] && transitions[row.status].includes(nextStatus);
    }

    function changeStatus(ids, nextStatus) {
      const changed = [];
      ids.forEach((id) => {
        const row = state.allRows.find((r) => r.id === id);
        if (!row) return;
        if (!canTransition(row, nextStatus)) return;
        row.status = nextStatus;
        if (nextStatus === 'approved') {
          row.approvedAt = new Date().toISOString();
          if (!row.submittedAt) row.submittedAt = row.approvedAt;
        }
        if (nextStatus === 'submitted') row.submittedAt = new Date().toISOString();
        changed.push(row.assignmentId);
        logAudit('status', `${row.assignmentId} → ${nextStatus}`);
      });
      if (changed.length) {
        toast(`Updated ${changed.length} record(s)`, 'success');
        applyFilters();
      }
      clearSelection();
    }

    function deleteDrafts(ids) {
      const remaining = [];
      let removed = 0;
      state.allRows.forEach((row) => {
        if (ids.includes(row.id) && row.status === 'draft') {
          removed += 1;
        } else {
          remaining.push(row);
        }
      });
      state.allRows = remaining;
      if (removed) {
        toast(`Deleted ${removed} draft(s)`, 'success');
        logAudit('delete', `Removed ${removed} draft(s)`);
        populateFilterOptions();
        applyFilters();
      }
      clearSelection();
    }

    function computeNextId() {
      return state.allRows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
    }

    function findExistingTimesheet(assignmentId, weekEnding) {
      return state.allRows.find((row) => row.assignmentId === assignmentId && row.weekEnding === weekEnding);
    }

    function createDraft(payload) {
      const assignmentId = String(payload.assignmentId || '').trim();
      const weekEnding = String(payload.weekEnding || '').trim();
      if (!assignmentId || !weekEnding) {
        toast('Assignment and week ending required', 'error');
        return null;
      }
      const existing = findExistingTimesheet(assignmentId, weekEnding);
      if (existing) {
        toast('Draft already exists. Opening existing.', 'success');
        logAudit('open', `Opened existing ${existing.assignmentId}`);
        return existing;
      }
      const newRow = normaliseRow({
        id: computeNextId(),
        assignmentId,
        weekEnding,
        status: 'draft',
        contractor: 'Unassigned contractor',
        client: 'Client pending',
        site: 'Site pending',
        role: 'Role pending',
      });
      newRow.entries = DAY_KEYS.map((day) => ({ day, std: 0, ot: 0, note: '' }));
      computeTotals(newRow);
      state.allRows.push(newRow);
      populateFilterOptions();
      applyFilters();
      logAudit('create', `Created draft ${assignmentId}`);
      toast('Draft created', 'success');
      return newRow;
    }

    function csvToRows(text) {
      const rows = [];
      const errors = [];
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length);
      if (!lines.length) return { rows, errors };
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const required = ['assignment_id', 'week_ending'];
      const missingHeaders = required.filter((header) => !headers.includes(header));
      if (missingHeaders.length) {
        errors.push(`Missing headers: ${missingHeaders.join(', ')}`);
        return { rows, errors };
      }
      for (let i = 1; i < Math.min(lines.length, 1000); i += 1) {
        const parts = lines[i].split(',');
        if (!parts.length) continue;
        const record = {};
        headers.forEach((header, idx) => {
          record[header] = (parts[idx] || '').trim();
        });
        const assignmentId = record.assignment_id;
        const weekEnding = record.week_ending;
        if (!assignmentId || !weekEnding) {
          errors.push(`Row ${i + 1}: assignment_id and week_ending required`);
          continue;
        }
        const row = normaliseRow({
          assignmentId,
          weekEnding,
          id: computeNextId() + rows.length,
        });
        DAY_KEYS.forEach((day) => {
          const key = `h_${day}`;
          if (record[key] !== undefined) {
            const hours = Number(record[key] || 0);
            const entry = row.entries.find((item) => item.day === day);
            if (entry) entry.std = hours;
          }
        });
        if (record.ot_hours) {
          const otHours = Number(record.ot_hours || 0);
          const perDay = otHours / DAY_KEYS.length;
          row.entries.forEach((entry) => {
            entry.ot = Number(perDay.toFixed(2));
          });
        }
        if (record.notes) row.notes = record.notes;
        computeTotals(row);
        rows.push(row);
      }
      return { rows, errors };
    }

    function dryRunCsv(text) {
      const { rows, errors } = csvToRows(text);
      const updates = [];
      rows.forEach((row) => {
        const existing = findExistingTimesheet(row.assignmentId, row.weekEnding);
        if (existing) {
          updates.push({ type: 'update', assignmentId: row.assignmentId });
        } else {
          updates.push({ type: 'create', assignmentId: row.assignmentId });
        }
      });
      return { rows, errors, updates };
    }

    function importCsv(text) {
      const result = dryRunCsv(text);
      if (result.errors.length) {
        toast(`Import failed: ${result.errors[0]}`, 'error');
        return result;
      }
      result.rows.forEach((row) => {
        const existing = findExistingTimesheet(row.assignmentId, row.weekEnding);
        if (existing) {
          existing.entries = row.entries;
          existing.notes = row.notes;
          computeTotals(existing);
        } else {
          state.allRows.push(row);
        }
      });
      populateFilterOptions();
      applyFilters();
      toast(`Imported ${result.rows.length} rows`, 'success');
      logAudit('import', `Imported ${result.rows.length} row(s)`);
      return result;
    }

    function previewReminders() {
      const lastWeek = new Date(state.activeWeek);
      lastWeek.setDate(lastWeek.getDate() - 7);
      const lastWeekIso = new Date(lastWeek.getFullYear(), lastWeek.getMonth(), lastWeek.getDate() - lastWeek.getDay() + 6).toISOString().slice(0, 10);
      const targets = state.allRows.filter((row) => row.weekEnding === lastWeekIso && row.status !== 'submitted' && row.status !== 'approved');
      state.lastReminders = targets.map((row) => ({ contractor: row.contractor, client: row.client, email: row.contractorEmail, assignmentId: row.assignmentId }));
      if (els.reminderPreview) {
        if (!state.lastReminders.length) {
          els.reminderPreview.textContent = 'No reminders required for last week.';
        } else {
          els.reminderPreview.innerHTML = state.lastReminders.map((entry) => (
            `<div><strong>${entry.contractor}</strong> (${entry.email}) – ${entry.client}</div>`
          )).join('');
        }
      }
      toast(`Prepared ${state.lastReminders.length} reminder(s)`, 'success');
      logAudit('reminder', `Previewed ${state.lastReminders.length} reminder(s)`);
      return state.lastReminders;
    }

    function renderCalendar() {
      if (!els.calendarGrid) return;
      const rows = state.filteredRows;
      const bucket = new Map();
      rows.forEach((row) => {
        const key = row.weekEnding;
        if (!bucket.has(key)) bucket.set(key, { submitted: 0, approved: 0 });
        const entry = bucket.get(key);
        if (row.status === 'submitted') entry.submitted += 1;
        if (row.status === 'approved') entry.approved += 1;
      });
      const items = Array.from(bucket.entries()).sort((a, b) => parseDate(a[0]) - parseDate(b[0]));
      if (!items.length) {
        els.calendarGrid.textContent = 'No data';
        return;
      }
      els.calendarGrid.innerHTML = items.map(([date, info]) => (
        `<button type="button" data-week="${date}" class="chip" style="width:100%;text-align:left">${formatDateUk(date)}<br><span class="muted">Submitted ${info.submitted} • Approved ${info.approved}</span></button>`
      )).join('');
      els.calendarGrid.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          setFilter('weekFrom', btn.dataset.week);
          setFilter('weekTo', btn.dataset.week);
          if (els.calendarModal) els.calendarModal.close();
        });
      });
    }

    function drawBarChart(ctx, data) {
      const width = ctx.canvas.width;
      const height = ctx.canvas.height;
      ctx.clearRect(0, 0, width, height);
      const keys = Object.keys(data);
      if (!keys.length) {
        ctx.fillStyle = '#4f5d7a';
        ctx.fillText('No data', 20, 40);
        return;
      }
      const maxValue = Math.max(...Object.values(data));
      const barWidth = Math.max(40, (width - 80) / keys.length - 20);
      keys.forEach((key, index) => {
        const value = data[key];
        const barHeight = maxValue ? (value / maxValue) * (height - 80) : 0;
        const x = 60 + index * (barWidth + 20);
        const y = height - 40 - barHeight;
        ctx.fillStyle = '#193078';
        ctx.fillRect(x, y, barWidth, barHeight);
        ctx.fillStyle = '#0b1a3a';
        ctx.fillText(String(key), x, height - 20);
        ctx.fillText(value.toFixed(1), x, y - 8);
      });
    }

    function drawLineChart(ctx, pointsSubmitted, pointsApproved) {
      const width = ctx.canvas.width;
      const height = ctx.canvas.height;
      ctx.clearRect(0, 0, width, height);
      const keys = pointsSubmitted.map((item) => item.label);
      if (!keys.length) {
        ctx.fillStyle = '#4f5d7a';
        ctx.fillText('No data', 20, 40);
        return;
      }
      const allValues = pointsSubmitted.concat(pointsApproved).map((item) => item.value);
      const maxValue = Math.max(...allValues, 1);
      function drawLine(points, color) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        points.forEach((point, idx) => {
          const x = 40 + (idx / Math.max(points.length - 1, 1)) * (width - 80);
          const y = height - 40 - (point.value / maxValue) * (height - 80);
          if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.stroke();
      }
      drawLine(pointsSubmitted, '#193078');
      drawLine(pointsApproved, '#1f7a51');
      keys.forEach((key, idx) => {
        const x = 40 + (idx / Math.max(keys.length - 1, 1)) * (width - 80);
        ctx.fillStyle = '#0b1a3a';
        ctx.fillText(key, x - 20, height - 16);
      });
    }

    function drawPieChart(ctx, data) {
      const width = ctx.canvas.width;
      const height = ctx.canvas.height;
      ctx.clearRect(0, 0, width, height);
      const total = Object.values(data).reduce((sum, value) => sum + value, 0);
      if (!total) {
        ctx.fillStyle = '#4f5d7a';
        ctx.fillText('No data', 20, 40);
        return;
      }
      const colors = {
        draft: '#dbe1f1',
        submitted: '#e2d8ff',
        approved: '#daf1de',
        rejected: '#ffd7d7',
      };
      let start = 0;
      Object.entries(data).forEach(([status, value]) => {
        const angle = (value / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(width / 2, height / 2);
        ctx.fillStyle = colors[status] || '#cfd8ff';
        ctx.arc(width / 2, height / 2, Math.min(width, height) / 2 - 40, start, start + angle);
        ctx.closePath();
        ctx.fill();
        start += angle;
      });
      ctx.fillStyle = '#0b1a3a';
      ctx.font = '14px sans-serif';
      let offsetY = 20;
      Object.entries(data).forEach(([status, value]) => {
        ctx.fillText(`${status}: ${value}`, width - 160, offsetY);
        offsetY += 18;
      });
    }

    function renderCharts() {
      if (!els.chartClient || !els.chartTrend || !els.chartStatus) return;
      const ctxClient = els.chartClient.getContext('2d');
      const ctxTrend = els.chartTrend.getContext('2d');
      const ctxStatus = els.chartStatus.getContext('2d');

      const totalsByClient = {};
      state.filteredRows.forEach((row) => {
        totalsByClient[row.client] = (totalsByClient[row.client] || 0) + row.totalStd + row.totalOt;
      });
      drawBarChart(ctxClient, totalsByClient);

      const weeksMap = new Map();
      state.allRows.forEach((row) => {
        const week = formatDateUk(row.weekEnding);
        if (!weeksMap.has(week)) weeksMap.set(week, { submitted: 0, approved: 0 });
        const entry = weeksMap.get(week);
        if (row.status === 'submitted') entry.submitted += 1;
        if (row.status === 'approved') entry.approved += 1;
      });
      const sortedWeeks = Array.from(weeksMap.entries()).slice(-12);
      const trendSubmitted = sortedWeeks.map(([label, value]) => ({ label, value: value.submitted }));
      const trendApproved = sortedWeeks.map(([label, value]) => ({ label, value: value.approved }));
      drawLineChart(ctxTrend, trendSubmitted, trendApproved);

      const statusCounts = state.filteredRows.reduce((acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      }, {});
      drawPieChart(ctxStatus, statusCounts);
    }

    function updateWeekLabel() {
      if (!els.weekLabel) return;
      els.weekLabel.textContent = `Week ending ${formatDateUk(state.activeWeek)}`;
    }

    function moveWeek(offset) {
      const next = new Date(state.activeWeek);
      next.setDate(next.getDate() + offset * 7);
      state.activeWeek = next;
      updateWeekLabel();
      applyFilters();
    }

    function resetWeek() {
      state.activeWeek = new Date();
      updateWeekLabel();
      applyFilters();
    }

    function exportData(format) {
      const rows = (state.selected.size ? state.allRows.filter((row) => state.selected.has(row.id)) : state.filteredRows);
      const header = ['id', 'week_ending', 'status', 'contractor', 'client', 'site', 'std_hours', 'ot_hours', 'gross', 'approver', 'notes'];
      const lines = [header.join(',')];
      rows.forEach((row) => {
        const line = [
          row.id,
          formatDateUk(row.weekEnding),
          row.status,
          row.contractor,
          row.client,
          row.site,
          row.totalStd.toFixed(2),
          row.totalOt.toFixed(2),
          row.gross.toFixed(2),
          row.approver || '',
          (row.notes || '').replace(/"/g, "'"),
        ];
        lines.push(line.map((value) => `"${String(value)}"`).join(','));
      });
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const filename = `timesheets-${Date.now()}.${format === 'xlsx' ? 'xlsx' : 'csv'}`;
      downloadBlob(blob, filename);
    }

    function downloadBlob(blob, filename) {
      if (typeof window === 'undefined') return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    function exportLogs() {
      const content = state.debugLogs.map((entry) => `${new Date(entry.at).toISOString()} ${entry.type} ${JSON.stringify(entry.payload)}`).join('\n');
      const blob = new Blob([content], { type: 'text/plain' });
      downloadBlob(blob, `timesheets-logs-${Date.now()}.txt`);
    }

    function initEvents() {
      if (els.filterSearch) {
        els.filterSearch.addEventListener('input', (event) => setFilter('search', event.target.value));
      }
      if (els.filterStatus) {
        els.filterStatus.addEventListener('change', (event) => setFilter('status', event.target.value));
      }
      if (els.filterContractor) {
        els.filterContractor.addEventListener('change', (event) => setFilter('contractor', event.target.value));
      }
      if (els.filterClient) {
        els.filterClient.addEventListener('change', (event) => setFilter('client', event.target.value));
      }
      if (els.filterSite) {
        els.filterSite.addEventListener('change', (event) => setFilter('site', event.target.value));
      }
      if (els.filterRole) {
        els.filterRole.addEventListener('change', (event) => setFilter('role', event.target.value));
      }
      if (els.filterWeekFrom) {
        els.filterWeekFrom.addEventListener('change', (event) => setFilter('weekFrom', event.target.value));
      }
      if (els.filterWeekTo) {
        els.filterWeekTo.addEventListener('change', (event) => setFilter('weekTo', event.target.value));
      }
      if (els.filterWeekNumber) {
        els.filterWeekNumber.addEventListener('input', (event) => setFilter('weekNumber', event.target.value));
      }
      if (els.filterApprover) {
        els.filterApprover.addEventListener('change', (event) => setFilter('approver', event.target.value));
      }
      if (els.filterMissing) {
        els.filterMissing.addEventListener('change', (event) => setFilter('missing', event.target.value));
      }
      if (els.filterClear) {
        els.filterClear.addEventListener('click', () => {
          Object.keys(state.filters).forEach((key) => { state.filters[key] = ''; });
          saveFilters();
          updateFilterInputs();
          applyFilters();
        });
      }
      if (els.selectAll) {
        els.selectAll.addEventListener('change', () => {
          if (els.selectAll.checked) {
            state.filteredRows.forEach((row) => state.selected.add(row.id));
          } else {
            state.selected.clear();
          }
          renderTable();
          updateSummaries();
        });
      }
      if (els.bulkApprove) {
        els.bulkApprove.addEventListener('click', () => changeStatus(Array.from(state.selected), 'approved'));
      }
      if (els.bulkReject) {
        els.bulkReject.addEventListener('click', () => changeStatus(Array.from(state.selected), 'rejected'));
      }
      if (els.bulkRemind) {
        els.bulkRemind.addEventListener('click', () => {
          previewReminders();
          toast('Reminders queued', 'success');
        });
      }
      if (els.bulkDelete) {
        els.bulkDelete.addEventListener('click', () => deleteDrafts(Array.from(state.selected)));
      }
      if (els.bulkExportCsv) {
        els.bulkExportCsv.addEventListener('click', () => exportData('csv'));
      }
      if (els.bulkExportXlsx) {
        els.bulkExportXlsx.addEventListener('click', () => exportData('xlsx'));
      }
      if (els.createButton) {
        els.createButton.addEventListener('click', () => createDraft({ assignmentId: els.createAssignment.value, weekEnding: els.createWeek.value }));
      }
      if (els.csvInput) {
        els.csvInput.addEventListener('change', () => {
          const file = els.csvInput.files && els.csvInput.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const text = reader.result;
            const result = dryRunCsv(text);
            updateCsvPreview(result);
          };
          reader.readAsText(file);
        });
      }
      if (els.csvDryRun) {
        els.csvDryRun.addEventListener('click', () => {
          const file = els.csvInput.files && els.csvInput.files[0];
          if (!file) {
            toast('Choose a CSV file first', 'error');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => updateCsvPreview(dryRunCsv(reader.result));
          reader.readAsText(file);
        });
      }
      if (els.csvImport) {
        els.csvImport.addEventListener('click', () => {
          const file = els.csvInput.files && els.csvInput.files[0];
          if (!file) {
            toast('Choose a CSV file first', 'error');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const result = importCsv(reader.result);
            updateCsvPreview(result);
          };
          reader.readAsText(file);
        });
      }
      if (els.reminderButton) {
        els.reminderButton.addEventListener('click', () => previewReminders());
      }
      if (els.weekPrev) {
        els.weekPrev.addEventListener('click', () => moveWeek(-1));
      }
      if (els.weekNext) {
        els.weekNext.addEventListener('click', () => moveWeek(1));
      }
      if (els.weekCurrent) {
        els.weekCurrent.addEventListener('click', () => resetWeek());
      }
      if (els.calendarButton && els.calendarModal) {
        els.calendarButton.addEventListener('click', () => {
          renderCalendar();
          if (typeof els.calendarModal.showModal === 'function') {
            els.calendarModal.showModal();
          }
        });
      }
      if (els.chartsButton && els.chartsModal) {
        els.chartsButton.addEventListener('click', () => {
          renderCharts();
          if (typeof els.chartsModal.showModal === 'function') {
            els.chartsModal.showModal();
          }
        });
      }
      doc.querySelectorAll('[data-close]').forEach((btn) => {
        const target = btn.getAttribute('data-close');
        const dialog = doc.getElementById(target);
        if (dialog) {
          btn.addEventListener('click', () => dialog.close());
        }
      });
      if (els.debugExport) {
        els.debugExport.addEventListener('click', () => exportLogs());
      }
      doc.addEventListener('keydown', (event) => {
        if (event.key === '/' && doc.activeElement !== els.filterSearch) {
          event.preventDefault();
          els.filterSearch.focus();
        }
        if (event.key === 'R' || event.key === 'r') {
          event.preventDefault();
          applyFilters();
        }
        if (event.key === 'B' || event.key === 'b') {
          event.preventDefault();
          changeStatus(Array.from(state.selected), 'approved');
        }
        if (event.key === 'E' || event.key === 'e') {
          event.preventDefault();
          exportData('csv');
        }
        if (event.key === 'ArrowLeft') {
          moveWeek(-1);
        }
        if (event.key === 'ArrowRight') {
          moveWeek(1);
        }
        if (event.key === 'Escape') {
          if (els.calendarModal && typeof els.calendarModal.close === 'function') els.calendarModal.close();
          if (els.chartsModal && typeof els.chartsModal.close === 'function') els.chartsModal.close();
        }
      });
    }

    function updateCsvPreview(result) {
      if (!els.csvPreview) return;
      if (result.errors && result.errors.length) {
        els.csvPreview.innerHTML = `<span style="color:#821b1b">${result.errors.join('<br>')}</span>`;
      } else {
        const previewRows = result.rows.slice(0, 10).map((row) => `${row.assignmentId} – ${formatDateUk(row.weekEnding)} (${row.totalStd.toFixed(2)}h std)`);
        els.csvPreview.innerHTML = `${result.rows.length} rows ready.<br>${previewRows.join('<br>')}`;
      }
    }

    function buildStateFromOptions() {
      if (opt.seed && Array.isArray(opt.seed)) {
        state.allRows = opt.seed.map((row) => normaliseRow(row));
      } else {
        const cached = loadCache();
        state.allRows = cached || seedData();
      }
      populateFilterOptions();
      loadFilters();
      updateFilterInputs();
      applyFilters();
      saveCache(state.allRows);
    }

    function initialise() {
      setIdentityPill('offline demo');
      updateWeekLabel();
      buildStateFromOptions();
      initEvents();
      renderAudit();
      logDebug('init', { rows: state.allRows.length });
    }

    initialise();

    return {
      state,
      setFilter,
      applyFilters,
      getVisibleRows: () => clone(state.filteredRows),
      createDraft,
      changeStatus,
      deleteDrafts,
      previewReminders,
      dryRunCsv,
      importCsv,
      handleHoursChange,
      updateCsvPreview,
      renderTable,
      logAudit,
    };
  }

  if (typeof module !== 'undefined') {
    module.exports = { createTimesheetsApp };
  }
  if (typeof window !== 'undefined') {
    global.createTimesheetsApp = createTimesheetsApp;
  }
}(typeof window !== 'undefined' ? window : globalThis));
