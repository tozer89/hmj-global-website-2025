(function bootPayroll() {
  if (!window.Admin || typeof window.Admin.bootAdmin !== 'function' || !window.netlifyIdentity) {
    return setTimeout(bootPayroll, 40);
  }

  const Logic = window.PayrollLogic || {};
  if (!Logic.applyFilters) {
    console.error('[payroll] logic helpers missing');
    return;
  }

  Admin.bootAdmin(async ({ api, sel, toast, identity, getTrace }) => {
    const { applyFilters, computeTotals, detectIssues, friendlyErrorMessage, prepareAuditPayload, toNumber } = Logic;

    const chips = sel('#diagChips');
    const chip = (label, tone = 'ok') => {
      if (!chips) return;
      const span = document.createElement('span');
      span.className = 'pill';
      if (tone === 'warn') span.style.background = 'rgba(250,204,21,.18)';
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
    chip('trace ' + getTrace().slice(0, 8));

    if (gate) gate.style.display = 'none';
    if (app) app.style.display = '';

    const storageKey = 'hmj.payroll.filters.v1';
    const state = {
      rows: [],
      filtered: [],
      stats: { rows: 0 },
      issues: new Map(),
      filters: {
        status: 'all',
        search: '',
        client: '',
        candidate: '',
        invoiceRef: '',
        costCentre: '',
        poNumber: '',
        weekFrom: '',
        weekTo: '',
        quick: null,
        showIssues: false,
        showNotes: false,
      },
      selected: new Set(),
      page: 1,
      pageSize: 25,
      config: {},
      loading: false,
      error: null,
      drawerRow: null,
      auditCache: new Map(),
    };

    function loadStoredFilters() {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (stored && typeof stored === 'object') {
          Object.assign(state.filters, stored);
        }
      } catch {}
    }

    loadStoredFilters();

    const elements = {
      totalsBar: sel('#totalsBar'),
      trendWidget: sel('#trendWidget'),
      trendCopy: sel('#trendCopy'),
      clientSummary: sel('#clientSummary ul'),
      statusSummary: sel('#statusSummary ul'),
      resultMeta: sel('#resultMeta'),
      weekBaseMeta: sel('#weekBaseMeta'),
      filterSearch: sel('#filterSearch'),
      filterStatus: sel('#filterStatus'),
      filterClient: sel('#filterClient'),
      filterCandidate: sel('#filterCandidate'),
      filterInvoice: sel('#filterInvoice'),
      filterCost: sel('#filterCost'),
      filterPO: sel('#filterPO'),
      filterFrom: sel('#filterFrom'),
      filterTo: sel('#filterTo'),
      toggleIssues: sel('#toggleIssues'),
      toggleNotes: sel('#toggleNotes'),
      quickFilters: sel('#quickFilters'),
      btnClear: sel('#btnClear'),
      btnRefresh: sel('#btnRefresh'),
      btnRetry: sel('#btnRetry'),
      btnPrevWeek: sel('#btnPrevWeek'),
      btnNextWeek: sel('#btnNextWeek'),
      btnExportCsv: sel('#btnExportCsv'),
      btnExportXlsx: sel('#btnExportXlsx'),
      btnGenerateQuba: sel('#btnGenerateQuba'),
      btnSendRemittance: sel('#btnSendRemittance'),
      btnRecalculate: sel('#btnRecalculate'),
      btnAutoCalc: sel('#btnAutoCalc'),
      btnPdf: sel('#btnGeneratePdf'),
      tableWrap: sel('#tableWrap'),
      pager: sel('#pager'),
      pgInfo: sel('#pgInfo'),
      pgPrev: sel('#pgPrev'),
      pgNext: sel('#pgNext'),
      pgSize: sel('#pgSize'),
      bulkBar: sel('#bulkBar'),
      bulkCount: sel('#bulkCount'),
      bulkValue: sel('#bulkValue'),
      bulkReady: sel('#bulkReady'),
      bulkProcessing: sel('#bulkProcessing'),
      bulkPaid: sel('#bulkPaid'),
      bulkHold: sel('#bulkHold'),
      bulkCsv: sel('#bulkCsv'),
      drawer: sel('#detailDrawer'),
      drawerOverlay: sel('#drawerOverlay'),
      drawerClose: sel('#drawerClose'),
      drawerTitle: sel('#drawerTitle'),
      drawerMeta: sel('#drawerMeta'),
      drawerAssignment: sel('#drawerAssignment'),
      drawerHours: sel('#drawerHours'),
      drawerTimeline: sel('#drawerTimeline'),
      drawerNotes: sel('#notesList'),
      drawerNoteForm: sel('#noteForm'),
      drawerNoteInput: sel('#noteInput'),
      drawerNoteCancel: sel('#noteCancel'),
      attachmentList: sel('#attachmentList'),
      statusButtons: (sel('#drawerStatus') || document).querySelectorAll('button[data-status]'),
      quickFiltersButtons: (sel('#quickFilters') || document).querySelectorAll('button[data-quick]'),
    };

    function syncFiltersToInputs() {
      if (elements.filterStatus) elements.filterStatus.value = state.filters.status || 'all';
      if (elements.filterSearch) elements.filterSearch.value = state.filters.search || '';
      if (elements.filterClient) elements.filterClient.value = state.filters.client || '';
      if (elements.filterCandidate) elements.filterCandidate.value = state.filters.candidate || '';
      if (elements.filterInvoice) elements.filterInvoice.value = state.filters.invoiceRef || '';
      if (elements.filterCost) elements.filterCost.value = state.filters.costCentre || '';
      if (elements.filterPO) elements.filterPO.value = state.filters.poNumber || '';
      if (elements.filterFrom) elements.filterFrom.value = state.filters.weekFrom || '';
      if (elements.filterTo) elements.filterTo.value = state.filters.weekTo || '';
      if (elements.toggleIssues) elements.toggleIssues.checked = !!state.filters.showIssues;
      if (elements.toggleNotes) elements.toggleNotes.checked = !!state.filters.showNotes;
      updateQuickFilterButtons();
    }

    function persistFilters() {
      try {
        localStorage.setItem(storageKey, JSON.stringify(state.filters));
      } catch {}
    }

    function formatMoney(value, currency = 'GBP') {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return '—';
      try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
      } catch {
        return `${currency} ${amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
    }

    function formatNumber(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return '—';
      return num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function updateQuickFilterButtons() {
      if (!elements.quickFiltersButtons) return;
      elements.quickFiltersButtons.forEach((btn) => {
        const val = btn.getAttribute('data-quick');
        if (val && state.filters.quick === val) btn.classList.add('active');
        else btn.classList.remove('active');
      });
    }

    function updateResultMeta() {
      if (!elements.resultMeta) return;
      const total = state.filtered.length;
      const all = state.rows.length;
      elements.resultMeta.textContent = `${total} payroll item${total === 1 ? '' : 's'} (of ${all})`;
    }

    function updateBulkBar() {
      if (!elements.bulkBar) return;
      const count = state.selected.size;
      if (elements.bulkCount) elements.bulkCount.textContent = String(count);
      if (count === 0) {
        elements.bulkBar.classList.remove('active');
        if (elements.bulkValue) elements.bulkValue.textContent = '';
        return;
      }
      const selectedRows = state.filtered.filter((row) => state.selected.has(String(row.id)));
      const totals = selectedRows.reduce(
        (acc, row) => {
          acc.pay += toNumber(row?.totals?.pay);
          acc.charge += toNumber(row?.totals?.charge);
          return acc;
        },
        { pay: 0, charge: 0 }
      );
      if (elements.bulkValue) {
        elements.bulkValue.textContent = `Pay ${formatNumber(totals.pay)} • Charge ${formatNumber(totals.charge)}`;
      }
      elements.bulkBar.classList.add('active');
    }

    function statusChip(status) {
      const val = String(status || '').toLowerCase() || 'unknown';
      const cls = `status-chip status-${val}`;
      const label = val.charAt(0).toUpperCase() + val.slice(1);
      return `<span class="${cls}">${label}</span>`;
    }

    function renderTotals() {
      const stats = state.stats || {};
      if (elements.totalsBar) {
        const payEntries = Object.entries(stats.byCurrency || {});
        const chargeEntries = Object.entries(stats.chargeByCurrency || {});
        const marginEntries = payEntries.map(([cur, pay]) => {
          const charge = Number(chargeEntries.find(([c]) => c === cur)?.[1] || 0);
          return `${cur} ${formatNumber(charge - Number(pay || 0))}`;
        });
        const grossDisplay = payEntries.length
          ? payEntries.map(([cur, val]) => `${cur} ${formatNumber(val)}`).join(' • ')
          : formatMoney(stats.grossPay || 0);
        const chargeDisplay = chargeEntries.length
          ? chargeEntries.map(([cur, val]) => `${cur} ${formatNumber(val)}`).join(' • ')
          : formatNumber(stats.employerCharge || 0);
        const marginDisplay = marginEntries.length ? marginEntries.join(' • ') : formatNumber(stats.margin || 0);
        const placementCopy = `${stats.candidateCount || 0} candidates · ${stats.rows || 0} placements`;
        elements.totalsBar.innerHTML = `
          <div class="summary-card"><h4>Gross pay</h4><strong>${grossDisplay}</strong><small>Filtered items</small></div>
          <div class="summary-card"><h4>Employer charge</h4><strong>${chargeDisplay}</strong><small>Billable charge total</small></div>
          <div class="summary-card"><h4>Margin</h4><strong>${marginDisplay}</strong><small>Charge less pay</small></div>
          <div class="summary-card"><h4>Placements</h4><strong>${placementCopy}</strong><small>Unique contractors in view</small></div>
        `;
      }

      if (elements.clientSummary) {
        const items = (stats.byClient || []).slice(0, 6);
        if (!items.length) {
          elements.clientSummary.innerHTML = '<li><span class="muted">No client data</span></li>';
        } else {
          elements.clientSummary.innerHTML = items
            .map(
              (c) =>
                `<li><span>${c.client}</span><span>${formatNumber(c.pay)} pay · ${formatNumber(c.margin)} gp</span></li>`
            )
            .join('');
        }
      }

      if (elements.statusSummary) {
        const items = state.stats.byStatus || [];
        if (!items.length) {
          elements.statusSummary.innerHTML = '<li><span class="muted">No status data</span></li>';
        } else {
          elements.statusSummary.innerHTML = items
            .map((s) => `<li><span>${s.status}</span><span>${s.count}</span></li>`)
            .join('');
        }
      }

      if (elements.trendWidget && elements.trendCopy) {
        const trend = stats.trend || {};
        const arrow = trend.direction === 'up' ? '▲' : trend.direction === 'down' ? '▼' : '■';
        const change = Number.isFinite(trend.change) ? trend.change.toFixed(1) : '0.0';
        elements.trendCopy.innerHTML = `
          <strong style="font-size:22px">${arrow} ${change}%</strong>
          <div class="muted" style="margin-top:4px">
            Current week ${formatNumber(trend.current || 0)} vs ${formatNumber(trend.previous || 0)} previous.
          </div>`;
      }
    }

    function buildIssueBadge(rowId) {
      const issues = state.issues.get(String(rowId));
      if (!issues) return '';
      return `<div class="validation-flag">⚠ ${issues.length} issue${issues.length > 1 ? 's' : ''}</div>`;
    }

    function applyFiltersAndRender() {
      state.issues = detectIssues(state.rows);
      state.filtered = applyFilters(state.rows, state.filters, { issues: state.issues });
      state.stats = computeTotals(state.filtered);
      if (state.page < 1) state.page = 1;
      const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
      if (state.page > totalPages) state.page = totalPages;
      if (elements.btnRetry) elements.btnRetry.style.display = state.error ? '' : 'none';
      renderTotals();
      renderTable();
      updateResultMeta();
      updateBulkBar();
      persistFilters();
      if (state.drawerRow) {
        const fresh = state.rows.find((r) => String(r.id) === String(state.drawerRow.id));
        if (fresh) renderDrawer(fresh);
      }
    }

    function renderTable() {
      if (!elements.tableWrap) return;
      if (state.loading) {
        elements.tableWrap.textContent = 'Loading…';
        return;
      }
      if (state.error) {
        elements.tableWrap.innerHTML = `<div class="empty">${state.error}</div>`;
        return;
      }
      if (!state.filtered.length) {
        elements.tableWrap.innerHTML = '<div class="empty">No payroll items match your filters.</div>';
        if (elements.pager) elements.pager.style.display = 'none';
        return;
      }

      const start = (state.page - 1) * state.pageSize;
      const end = start + state.pageSize;
      const pageRows = state.filtered.slice(start, end);
      const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));

      const body = pageRows
        .map((row) => {
          const id = String(row.id);
          const checked = state.selected.has(id) ? 'checked' : '';
          const issues = state.issues.has(id);
          const notes = row.notes || row.audit?.meta?.note;
          return `<tr data-id="${id}" class="${issues ? 'issue' : ''} ${state.drawerRow && state.drawerRow.id === row.id ? 'active' : ''}">
            <td><input type="checkbox" data-id="${id}" ${checked}></td>
            <td><div style="font-weight:700">${row.candidateName || '—'}</div><div class="muted" style="font-size:12px">${row.candidate?.payrollRef || ''}</div></td>
            <td><div>${row.assignment?.clientName || '—'}</div><div class="muted" style="font-size:12px">${row.assignment?.jobTitle || ''}</div></td>
            <td>${row.weekEnding || '—'}<div class="muted" style="font-size:12px">Week #${row.weekNo || '—'}</div></td>
            <td><div>${formatNumber(row.totals?.hours || 0)} hrs</div><div class="muted" style="font-size:12px">OT ${formatNumber(row.totals?.ot || 0)}</div></td>
            <td><div>${formatNumber(row.totals?.pay || 0)} ${row.currency || ''}</div><div class="muted" style="font-size:12px">Charge ${formatNumber(row.totals?.charge || 0)}</div></td>
            <td>${statusChip(row.payrollStatus)}</td>
            <td>${notes ? `<div class="muted" style="font-size:12px">Note added</div>` : ''}${buildIssueBadge(id)}</td>
          </tr>`;
        })
        .join('');

      elements.tableWrap.innerHTML = `
        <table>
          <thead>
            <tr>
              <th style="width:32px"><input type="checkbox" id="ckAll"></th>
              <th>Candidate</th>
              <th>Client / Role</th>
              <th>Week</th>
              <th>Hours</th>
              <th>Financials</th>
              <th>Status</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>`;

      if (elements.pager) {
        elements.pager.style.display = '';
        if (elements.pgInfo) elements.pgInfo.textContent = `Page ${state.page} of ${totalPages}`;
        if (elements.pgPrev) elements.pgPrev.disabled = state.page <= 1;
        if (elements.pgNext) elements.pgNext.disabled = state.page >= totalPages;
      }

      const ckAll = document.getElementById('ckAll');
      if (ckAll) {
        ckAll.checked = pageRows.length && pageRows.every((row) => state.selected.has(String(row.id)));
        ckAll.onchange = () => {
          pageRows.forEach((row) => {
            const id = String(row.id);
            if (ckAll.checked) state.selected.add(id);
            else state.selected.delete(id);
          });
          updateBulkBar();
          renderTable();
        };
      }

      elements.tableWrap.querySelectorAll('input[type="checkbox"][data-id]').forEach((box) => {
        box.onchange = () => {
          const id = box.getAttribute('data-id');
          if (box.checked) state.selected.add(id);
          else state.selected.delete(id);
          updateBulkBar();
        };
      });

      elements.tableWrap.querySelectorAll('tbody tr').forEach((tr) => {
        tr.onclick = (ev) => {
          if (ev.target.closest('input')) return;
          const id = tr.getAttribute('data-id');
          const row = state.rows.find((r) => String(r.id) === id);
          if (row) renderDrawer(row);
        };
      });
    }

    function closeDrawer() {
      state.drawerRow = null;
      if (!elements.drawer) return;
      elements.drawer.classList.remove('active');
      elements.drawer.setAttribute('aria-hidden', 'true');
    }

    function formatDateTime(value) {
      const d = new Date(value);
      if (!value || Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    }

    function renderBreakdown(row) {
      if (!elements.drawerHours) return;
      const breakdown = row.breakdown;
      if (!breakdown) {
        elements.drawerHours.textContent = 'No breakdown available.';
        return;
      }
      const entries = Object.entries(breakdown)
        .filter(([, val]) => Number(val) > 0)
        .map(([day, val]) => `<div style="display:flex;justify-content:space-between"><span>${day.toUpperCase()}</span><span>${val}</span></div>`);
      elements.drawerHours.innerHTML = entries.length
        ? entries.join('')
        : '<div class="muted">No recorded hours this week.</div>';
    }

    function renderAttachments(row) {
      if (!elements.attachmentList) return;
      const attachments = Array.isArray(row.attachments) ? row.attachments : [];
      if (!attachments.length) {
        elements.attachmentList.innerHTML = '<div class="muted">No attachments yet.</div>';
        return;
      }
      elements.attachmentList.innerHTML = attachments
        .map((file, idx) => {
          const name = file?.name || `Attachment ${idx + 1}`;
          const href = file?.url || '#';
          const disabled = href === '#';
          return `<div class="attachment"><span>${name}</span><button class="btn tiny" data-attach="${href}" ${disabled ? 'disabled' : ''}>Download</button></div>`;
        })
        .join('');
      elements.attachmentList.querySelectorAll('button[data-attach]').forEach((btn) => {
        btn.onclick = () => {
          const url = btn.getAttribute('data-attach');
          if (!url || url === '#') return;
          window.open(url, '_blank', 'noopener');
        };
      });
    }

    async function fetchAuditTrail(id) {
      const key = String(id);
      if (state.auditCache.has(key)) return state.auditCache.get(key);
      try {
        const res = await api('admin-audit-list', 'POST', { limit: 200 });
        const items = Array.isArray(res?.items) ? res.items : [];
        const filtered = items
          .filter((item) => String(item.target_id) === key && String(item.target_type).toLowerCase() === 'payroll')
          .map((item) => ({
            id: item.id,
            at: item.at,
            action: item.action,
            summary: item.summary,
          }))
          .sort((a, b) => new Date(b.at) - new Date(a.at));
        state.auditCache.set(key, filtered);
        return filtered;
      } catch (err) {
        toast('Audit trail failed: ' + (err.message || err), 'error', 4200);
        return [];
      }
    }

    async function renderDrawer(row) {
      state.drawerRow = row;
      if (!elements.drawer) return;
      elements.drawer.classList.add('active');
      elements.drawer.setAttribute('aria-hidden', 'false');

      if (elements.drawerTitle) {
        elements.drawerTitle.textContent = row.candidateName || `Timesheet #${row.id}`;
      }
      if (elements.drawerMeta) {
        const bits = [
          `Week ending ${row.weekEnding || '—'}`,
          `Status ${(row.payrollStatus || '').toUpperCase()}`,
          `Pay ${formatNumber(row.totals?.pay || 0)}`,
          `Charge ${formatNumber(row.totals?.charge || 0)}`,
        ];
        elements.drawerMeta.textContent = bits.join(' • ');
      }
      if (elements.drawerAssignment) {
        const kv = [
          ['Client', row.assignment?.clientName || '—'],
          ['Role', row.assignment?.jobTitle || '—'],
          ['PO', row.poNumber || row.assignment?.poNumber || '—'],
          ['Invoice ref', row.invoiceRef || '—'],
          ['Cost centre', row.costCentre || '—'],
          ['Site', row.siteName || '—'],
          ['Project', row.projectName || '—'],
        ];
        elements.drawerAssignment.innerHTML = kv
          .map((pair) => `<div>${pair[0]}</div><div>${pair[1]}</div>`)
          .join('');
      }

      renderBreakdown(row);
      renderAttachments(row);

      const timeline = await fetchAuditTrail(row.id);
      const history = Array.isArray(row.statusHistory) ? row.statusHistory : [];
      if (elements.drawerTimeline) {
        const combined = [...timeline];
        history.forEach((item) => {
          combined.push({
            at: item.at || item.date,
            action: item.status || item.action,
            summary: item.note || '',
          });
        });
        combined.sort((a, b) => new Date(b.at) - new Date(a.at));
        elements.drawerTimeline.innerHTML = combined.length
          ? combined
              .map(
                (item) =>
                  `<div><div style="font-weight:600">${item.action || 'update'}</div><div class="muted">${formatDateTime(
                    item.at
                  )}</div>${item.summary ? `<div>${item.summary}</div>` : ''}</div>`
              )
              .join('')
          : '<div class="muted">No audit history yet.</div>';
      }

      if (elements.drawerNotes) {
        const noteEntries = timeline.filter((t) => t.summary && t.summary !== '{}');
        if (row.notes) noteEntries.unshift({ summary: row.notes, at: row.updatedAt, action: 'note' });
        elements.drawerNotes.innerHTML = noteEntries.length
          ? noteEntries
              .map(
                (note) =>
                  `<div class="note-card"><div style="font-weight:600">${formatDateTime(note.at)}</div><div>${
                    note.summary ? note.summary.replace(/[{}]/g, '') : ''
                  }</div></div>`
              )
              .join('')
          : '<div class="muted">No notes captured yet.</div>';
      }
    }

    function updateQuickFilter(val) {
      state.filters.quick = state.filters.quick === val ? null : val;
      state.page = 1;
      updateQuickFilterButtons();
      applyFiltersAndRender();
    }

    async function changeStatus(ids, status, note) {
      const payload = prepareAuditPayload(status, note);
      const cleanStatus = payload.status;
      const validIds = ids
        .map((id) => (Number.isFinite(Number(id)) ? Number(id) : id))
        .filter((id) => id !== null && id !== undefined && id !== '');
      if (!validIds.length) return;
      try {
        state.loading = true;
        renderTable();
        await Promise.all(
          validIds.map((id) => api('admin-payroll-process', 'POST', { id, status: cleanStatus, note: payload.note }))
        );
        toast('Payroll updated', 'ok', 1800);
        await loadData();
      } catch (err) {
        toast('Update failed: ' + (err.message || err), 'error', 4200);
      } finally {
        state.loading = false;
        applyFiltersAndRender();
      }
    }

    async function exportCsv(selectedOnly) {
      try {
        const ids = selectedOnly ? Array.from(state.selected) : state.filtered.map((row) => row.id);
        const res = await fetch('/.netlify/functions/admin-payroll-list', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-trace': getTrace(),
          },
          body: JSON.stringify({
            status: state.filters.status,
            ids,
            format: 'csv',
          }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(text || res.statusText);
        downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8;' }), selectedOnly ? 'payroll-selected.csv' : 'payroll.csv');
        toast('Export ready', 'ok', 1600);
      } catch (err) {
        toast('Export failed: ' + (err.message || err), 'error', 4000);
      }
    }

    function exportXlsx() {
      const rows = state.filtered;
      if (!rows.length) {
        toast('No rows to export', 'warn', 2200);
        return;
      }
      const header = ['Candidate', 'Client', 'Week ending', 'Status', 'Hours', 'OT', 'Pay', 'Charge', 'Currency'];
      const htmlRows = rows
        .map((row) => {
          return `<tr>
            <td>${row.candidateName || ''}</td>
            <td>${row.assignment?.clientName || ''}</td>
            <td>${row.weekEnding || ''}</td>
            <td>${row.payrollStatus || ''}</td>
            <td>${formatNumber(row.totals?.hours || 0)}</td>
            <td>${formatNumber(row.totals?.ot || 0)}</td>
            <td>${formatNumber(row.totals?.pay || 0)}</td>
            <td>${formatNumber(row.totals?.charge || 0)}</td>
            <td>${row.currency || ''}</td>
          </tr>`;
        })
        .join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"/></head><body><table><thead><tr>${header
        .map((h) => `<th>${h}</th>`)
        .join('')}</tr></thead><tbody>${htmlRows}</tbody></table></body></html>`;
      const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
      downloadBlob(blob, 'payroll.xlsx');
      toast('XLSX export generated', 'ok', 1600);
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    function simulateQuba() {
      if (!state.selected.size) {
        toast('Select at least one row to generate a batch', 'warn', 2400);
        return;
      }
      toast(`Generated Quba batch for ${state.selected.size} placements (simulation)`, 'ok', 2600);
    }

    function simulateRemittance() {
      if (!state.selected.size) {
        toast('Select rows to send remittance emails', 'warn', 2400);
        return;
      }
      toast('Queued remittance emails via Supabase mailer (simulation)', 'ok', 2600);
    }

    function adjustWeek(delta) {
      const from = state.filters.weekFrom ? new Date(state.filters.weekFrom) : null;
      const to = state.filters.weekTo ? new Date(state.filters.weekTo) : null;
      if (!from && !to) {
        const ref = new Date();
        ref.setDate(ref.getDate() + delta * 7);
        state.filters.weekFrom = ref.toISOString().slice(0, 10);
        state.filters.weekTo = new Date(ref.getTime() + 6 * 86400000).toISOString().slice(0, 10);
      } else {
        if (from) {
          from.setDate(from.getDate() + delta * 7);
          state.filters.weekFrom = from.toISOString().slice(0, 10);
        }
        if (to) {
          to.setDate(to.getDate() + delta * 7);
          state.filters.weekTo = to.toISOString().slice(0, 10);
        }
      }
      syncFiltersToInputs();
      state.page = 1;
      applyFiltersAndRender();
    }

    function autoCalculateFinancials() {
      state.rows = state.rows.map((row) => {
        const clone = { ...row, totals: { ...(row.totals || {}) } };
        const hours = toNumber(clone.totals.hours);
        if (hours > 0) {
          if (!clone.totals.pay || clone.totals.pay === 0) {
            clone.totals.pay = toNumber(clone.rate?.pay) * hours;
          }
          if (!clone.totals.charge || clone.totals.charge === 0) {
            clone.totals.charge = toNumber(clone.rate?.charge) * hours;
          }
        }
        return clone;
      });
      toast('Financials refreshed using rate cards', 'ok', 2000);
      applyFiltersAndRender();
    }

    function pdfEscape(text) {
      return String(text || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    }

    function generatePdf() {
      const stats = state.stats;
      const rows = state.filtered.slice(0, 60);
      const lines = [
        'HMJ Global Payroll Summary',
        `Generated ${new Date().toLocaleString('en-GB')}`,
        '',
        `Placements in view: ${stats.rows || 0}`,
        `Gross pay: ${Object.entries(stats.byCurrency || {})
          .map(([cur, val]) => `${cur} ${formatNumber(val)}`)
          .join(' • ')}`,
        `Employer charge: ${Object.entries(stats.chargeByCurrency || {})
          .map(([cur, val]) => `${cur} ${formatNumber(val)}`)
          .join(' • ')}`,
        `Margin: ${formatNumber(stats.margin || 0)}`,
        '',
        'Top placements:',
      ];
      rows.forEach((row) => {
        lines.push(
          `${row.candidateName || '—'} · ${row.assignment?.clientName || '—'} · ${row.weekEnding || '—'} · Pay ${formatNumber(
            row.totals?.pay || 0
          )}`
        );
      });

      const content = lines
        .map((line, index) => `BT /F1 11 Tf 40 ${780 - index * 18} Td (${pdfEscape(line)}) Tj ET`)
        .join('\n');
      const objects = [
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
        '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
        `4 0 obj << /Length ${content.length} >> stream\n${content}\nendstream\nendobj`,
        '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      ];
      let pdf = '%PDF-1.3\n';
      const offsets = [0];
      objects.forEach((obj) => {
        offsets.push(pdf.length);
        pdf += obj + '\n';
      });
      const xrefOffset = pdf.length;
      pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
      for (let i = 1; i <= objects.length; i += 1) {
        pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
      }
      pdf += `trailer << /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF`;
      downloadBlob(new Blob([pdf], { type: 'application/pdf' }), 'payroll-summary.pdf');
      toast('Payroll summary PDF generated', 'ok', 2200);
    }

    async function loadData() {
      if (elements.tableWrap) elements.tableWrap.textContent = 'Loading…';
      state.loading = true;
      state.error = null;
      try {
        const res = await api('admin-payroll-list', 'POST', {
          status: state.filters.status,
          q: state.filters.search,
          weekFrom: state.filters.weekFrom || null,
          weekTo: state.filters.weekTo || null,
          limit: state.pageSize * 8,
        });
        state.rows = Array.isArray(res?.rows) ? res.rows : [];
        state.config = res?.config || {};
        if (res?.config?.week1Ending && elements.weekBaseMeta) {
          elements.weekBaseMeta.textContent = `Week 1 ends ${res.config.week1Ending}`;
        }
        state.selected.clear();
        state.auditCache.clear();
        state.loading = false;
        applyFiltersAndRender();
      } catch (err) {
        state.loading = false;
        state.rows = [];
        const message = friendlyErrorMessage(err);
        state.error = message;
        if (elements.btnRetry) elements.btnRetry.style.display = '';
        if (/Session expired/i.test(message)) chip('auth expired', 'warn');
        applyFiltersAndRender();
      }
    }

    function debounce(fn, delay = 300) {
      let handle;
      return (...args) => {
        clearTimeout(handle);
        handle = setTimeout(() => fn(...args), delay);
      };
    }

    // Event wires
    if (elements.filterStatus) {
      elements.filterStatus.onchange = () => {
        state.filters.status = elements.filterStatus.value;
        state.page = 1;
        applyFiltersAndRender();
      };
    }
    if (elements.filterSearch) {
      elements.filterSearch.addEventListener(
        'input',
        debounce(() => {
          state.filters.search = elements.filterSearch.value.trim();
          state.page = 1;
          applyFiltersAndRender();
        }, 280)
      );
    }
    if (elements.filterClient) {
      elements.filterClient.addEventListener(
        'input',
        debounce(() => {
          state.filters.client = elements.filterClient.value.trim();
          state.page = 1;
          applyFiltersAndRender();
        }, 280)
      );
    }
    if (elements.filterCandidate) {
      elements.filterCandidate.addEventListener(
        'input',
        debounce(() => {
          state.filters.candidate = elements.filterCandidate.value.trim();
          state.page = 1;
          applyFiltersAndRender();
        }, 280)
      );
    }
    if (elements.filterInvoice) {
      elements.filterInvoice.addEventListener(
        'input',
        debounce(() => {
          state.filters.invoiceRef = elements.filterInvoice.value.trim();
          state.page = 1;
          applyFiltersAndRender();
        }, 280)
      );
    }
    if (elements.filterCost) {
      elements.filterCost.addEventListener(
        'input',
        debounce(() => {
          state.filters.costCentre = elements.filterCost.value.trim();
          state.page = 1;
          applyFiltersAndRender();
        }, 280)
      );
    }
    if (elements.filterPO) {
      elements.filterPO.addEventListener(
        'input',
        debounce(() => {
          state.filters.poNumber = elements.filterPO.value.trim();
          state.page = 1;
          applyFiltersAndRender();
        }, 280)
      );
    }
    if (elements.filterFrom) {
      elements.filterFrom.onchange = () => {
        state.filters.weekFrom = elements.filterFrom.value;
        state.page = 1;
        applyFiltersAndRender();
      };
    }
    if (elements.filterTo) {
      elements.filterTo.onchange = () => {
        state.filters.weekTo = elements.filterTo.value;
        state.page = 1;
        applyFiltersAndRender();
      };
    }
    if (elements.toggleIssues) {
      elements.toggleIssues.onchange = () => {
        state.filters.showIssues = elements.toggleIssues.checked;
        state.page = 1;
        applyFiltersAndRender();
      };
    }
    if (elements.toggleNotes) {
      elements.toggleNotes.onchange = () => {
        state.filters.showNotes = elements.toggleNotes.checked;
        state.page = 1;
        applyFiltersAndRender();
      };
    }
    if (elements.quickFilters) {
      elements.quickFilters.querySelectorAll('button[data-quick]').forEach((btn) => {
        btn.onclick = () => updateQuickFilter(btn.getAttribute('data-quick'));
      });
    }
    if (elements.btnClear) {
      elements.btnClear.onclick = () => {
        state.filters = {
          status: 'all',
          search: '',
          client: '',
          candidate: '',
          invoiceRef: '',
          costCentre: '',
          poNumber: '',
          weekFrom: '',
          weekTo: '',
          quick: null,
          showIssues: false,
          showNotes: false,
        };
        syncFiltersToInputs();
        state.page = 1;
        applyFiltersAndRender();
      };
    }
    if (elements.btnRefresh) elements.btnRefresh.onclick = () => loadData();
    if (elements.btnRetry) elements.btnRetry.onclick = () => {
      elements.btnRetry.style.display = 'none';
      loadData();
    };
    if (elements.btnPrevWeek) elements.btnPrevWeek.onclick = () => adjustWeek(-1);
    if (elements.btnNextWeek) elements.btnNextWeek.onclick = () => adjustWeek(1);
    if (elements.pgPrev) elements.pgPrev.onclick = () => {
      if (state.page > 1) {
        state.page -= 1;
        renderTable();
        updateBulkBar();
      }
    };
    if (elements.pgNext) elements.pgNext.onclick = () => {
      const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
      if (state.page < totalPages) {
        state.page += 1;
        renderTable();
        updateBulkBar();
      }
    };
    if (elements.pgSize) {
      elements.pgSize.onchange = () => {
        state.pageSize = Number(elements.pgSize.value) || 25;
        state.page = 1;
        loadData();
      };
      elements.pgSize.value = String(state.pageSize);
    }

    if (elements.btnExportCsv) elements.btnExportCsv.onclick = () => exportCsv(false);
    if (elements.btnExportXlsx) elements.btnExportXlsx.onclick = () => exportXlsx();
    if (elements.btnGenerateQuba) elements.btnGenerateQuba.onclick = simulateQuba;
    if (elements.btnSendRemittance) elements.btnSendRemittance.onclick = simulateRemittance;
    if (elements.btnRecalculate) elements.btnRecalculate.onclick = () => loadData();
    if (elements.btnAutoCalc) elements.btnAutoCalc.onclick = autoCalculateFinancials;
    if (elements.btnPdf) elements.btnPdf.onclick = generatePdf;

    if (elements.bulkReady) elements.bulkReady.onclick = () => changeStatus(Array.from(state.selected), 'ready');
    if (elements.bulkProcessing) elements.bulkProcessing.onclick = () => changeStatus(Array.from(state.selected), 'processing');
    if (elements.bulkPaid) elements.bulkPaid.onclick = () => changeStatus(Array.from(state.selected), 'paid');
    if (elements.bulkHold) elements.bulkHold.onclick = () => changeStatus(Array.from(state.selected), 'hold');
    if (elements.bulkCsv) elements.bulkCsv.onclick = () => exportCsv(true);

    if (elements.drawerOverlay) elements.drawerOverlay.onclick = closeDrawer;
    if (elements.drawerClose) elements.drawerClose.onclick = closeDrawer;
    if (elements.drawerNoteCancel) elements.drawerNoteCancel.onclick = (e) => {
      e.preventDefault();
      if (elements.drawerNoteInput) elements.drawerNoteInput.value = '';
    };
    if (elements.drawerNoteForm) {
      elements.drawerNoteForm.onsubmit = async (ev) => {
        ev.preventDefault();
        if (!state.drawerRow) return;
        const note = (elements.drawerNoteInput && elements.drawerNoteInput.value.trim()) || '';
        if (!note) {
          toast('Add some text before saving the note', 'warn', 2200);
          return;
        }
        await changeStatus([state.drawerRow.id], state.drawerRow.payrollStatus || 'ready', note);
        if (elements.drawerNoteInput) elements.drawerNoteInput.value = '';
      };
    }
    if (elements.statusButtons) {
      elements.statusButtons.forEach((btn) => {
        btn.onclick = () => {
          if (!state.drawerRow) return;
          const status = btn.getAttribute('data-status');
          changeStatus([state.drawerRow.id], status);
        };
      });
    }

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (event.key === 'Escape') {
        state.selected.clear();
        updateBulkBar();
        renderTable();
      }
      if (!state.selected.size) return;
      if (event.key.toLowerCase() === 'r') changeStatus(Array.from(state.selected), 'ready');
      if (event.key.toLowerCase() === 'p') changeStatus(Array.from(state.selected), 'paid');
      if (event.key.toLowerCase() === 'o') changeStatus(Array.from(state.selected), 'hold');
    });

    syncFiltersToInputs();
    await loadData();
  });
})();
