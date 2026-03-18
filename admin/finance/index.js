(function () {
  'use strict';

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function setup() {
    [
      'financeWelcomeMeta',
      'financeStatusChips',
      'heroMinCash',
      'heroMinCashMeta',
      'heroQboStatus',
      'heroQboMeta',
      'financeAlerts',
      'financeSummaryGrid',
      'financeModuleGrid',
      'qboRunList',
      'btnRefreshFinance',
      'btnSyncFinanceQbo',
    ].forEach((id) => {
      els[id] = $(id);
    });
  }

  function money(value, currency) {
    const amount = Number(value || 0);
    const code = (currency || 'GBP').toUpperCase() === 'EUR' ? 'EUR' : 'GBP';
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  function timeLabel(value) {
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

  function clearNode(node) {
    if (node) node.innerHTML = '';
  }

  function statusChip(label, tone) {
    const span = document.createElement('span');
    span.className = 'finance-status';
    if (tone) span.dataset.tone = tone;
    span.textContent = label;
    return span;
  }

  function renderAlerts(alerts = []) {
    clearNode(els.financeAlerts);
    if (!alerts.length) return;
    alerts.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'finance-alert';
      if (item.tone) div.dataset.tone = item.tone;
      div.textContent = item.text;
      els.financeAlerts.appendChild(div);
    });
  }

  function renderSummaryCards(summary) {
    clearNode(els.financeSummaryGrid);
    const currency = summary?.reportingCurrency || 'GBP';
    const cards = [
      ['Current cash', money(summary?.currentCash || 0, currency), 'Opening cash position for the visible forecast horizon.'],
      ['Forecast minimum', money(summary?.forecastMinimumCash || 0, currency), 'Lowest projected closing balance across the 13-week horizon.'],
      ['Total inflows', money(summary?.totalInflows || 0, currency), 'All actual and forecast inflows inside the current horizon.'],
      ['Total outflows', money(summary?.totalOutflows || 0, currency), 'All actual and forecast outflows inside the current horizon.'],
      ['Retention locked', money(summary?.retentionLocked || 0, currency), 'Retention still held back from planned funded invoices.'],
      ['Funding fees', money(summary?.fundingFeesForecast || 0, currency), 'Forecast funding fees and settlement deductions.'],
    ];
    cards.forEach(([title, value, detail]) => {
      const card = document.createElement('article');
      card.className = 'finance-stat';
      card.innerHTML = `
        <span class="finance-kicker">${title}</span>
        <strong>${value}</strong>
        <span>${detail}</span>
      `;
      els.financeSummaryGrid.appendChild(card);
    });
  }

  function renderModules(modules = []) {
    clearNode(els.financeModuleGrid);
    modules.forEach((item) => {
      const card = document.createElement('a');
      card.className = 'finance-card';
      card.href = item.href || '/admin/finance/';
      card.innerHTML = `
        <div class="finance-card__meta">
          <span class="finance-status" data-tone="${
            item.status === 'Live' || item.status === 'Connected' ? 'ok'
              : item.status === 'Planned' ? 'warn'
              : 'danger'
          }">${item.status || 'Module'}</span>
        </div>
        <h3>${item.title || 'Finance module'}</h3>
        <p>${item.detail || ''}</p>
      `;
      els.financeModuleGrid.appendChild(card);
    });
  }

  function renderRuns(runs = []) {
    clearNode(els.qboRunList);
    if (!runs.length) {
      els.qboRunList.innerHTML = '<div class="finance-empty">No QuickBooks sync runs have been recorded yet.</div>';
      return;
    }
    runs.forEach((run) => {
      const item = document.createElement('div');
      item.className = 'finance-list-item';
      item.innerHTML = `
        <strong>${run.sync_type || 'manual'} sync · ${run.status || 'unknown'}</strong>
        <small>${timeLabel(run.started_at)}${run.completed_at ? ` → ${timeLabel(run.completed_at)}` : ''}</small>
        <small>${run.error_message || Object.entries(run.entity_counts || {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'No counts recorded.'}</small>
      `;
      els.qboRunList.appendChild(item);
    });
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(options?.body ? { 'content-type': 'application/json' } : {}),
        ...(options?.headers || {}),
      },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || payload?.message || 'Finance request failed.');
    }
    return payload;
  }

  async function loadDashboard(helpers) {
    const payload = await fetchJson('/.netlify/functions/admin-finance-dashboard');
    const finance = payload.finance || {};
    const summary = finance.cashflowSummary || {};
    const qbo = finance.qbo || {};
    const qboRuntimeStatus = finance.qboRuntimeStatus || {};
    const alerts = [];

    clearNode(els.financeStatusChips);
    els.financeStatusChips.appendChild(statusChip(finance.schema?.ready ? 'Finance schema ready' : 'Finance schema pending', finance.schema?.ready ? 'ok' : 'warn'));
    els.financeStatusChips.appendChild(statusChip(qbo.connection ? 'QuickBooks connected' : 'QuickBooks not connected', qbo.connection ? 'ok' : 'warn'));
    if (qbo.environment) els.financeStatusChips.appendChild(statusChip(`QBO ${qbo.environment}`, 'ok'));

    els.heroMinCash.textContent = summary && !summary.error
      ? money(summary.forecastMinimumCash || 0, summary.reportingCurrency)
      : '—';
    els.heroMinCashMeta.textContent = summary?.rangeStart
      ? `${summary.rangeStart} to ${summary.rangeEnd}`
      : (summary?.error || 'Forecast preview available after schema setup.');

    els.heroQboStatus.textContent = qbo.connection ? 'Connected' : (qbo.connectReady ? 'Ready to connect' : 'Needs config');
    els.heroQboMeta.textContent = qbo.connection?.lastSyncAt
      ? `Last sync ${timeLabel(qbo.connection.lastSyncAt)}`
      : (qboRuntimeStatus?.lastError || qbo.warnings?.[0] || 'No QuickBooks sync recorded yet.');

    if (!finance.schema?.ready) {
      alerts.push({ tone: 'warn', text: 'Finance schema is not available yet. Apply the new finance migration before using the cashflow workspace.' });
    }
    (qbo.warnings || []).forEach((warning) => alerts.push({ tone: 'warn', text: warning }));
    if (qboRuntimeStatus?.lastError) {
      alerts.push({ tone: 'warn', text: `QuickBooks callback issue: ${qboRuntimeStatus.lastError}` });
    }
    if (summary?.error) alerts.push({ tone: 'warn', text: summary.error });

    renderAlerts(alerts);
    renderSummaryCards(summary);
    renderModules(finance.modules || []);
    renderRuns(finance.recentSyncRuns || []);
    helpers.sel('#financeWelcomeMeta').textContent = `Signed in as ${payload.viewer?.email || 'admin user'}`;
  }

  async function syncQuickBooks(helpers) {
    helpers.toast('Running QuickBooks sync…', 'info', 1800);
    await fetchJson('/.netlify/functions/admin-finance-qbo-sync', { method: 'POST' });
    helpers.toast('QuickBooks sync completed.', 'ok', 2600);
    await loadDashboard(helpers);
  }

  function boot() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      window.setTimeout(boot, 40);
      return;
    }
    setup();
    window.Admin.bootAdmin(async (helpers) => {
      await loadDashboard(helpers);
      els.btnRefreshFinance?.addEventListener('click', () => loadDashboard(helpers).catch((error) => helpers.toast(error.message, 'warn', 3200)));
      els.btnSyncFinanceQbo?.addEventListener('click', () => syncQuickBooks(helpers).catch((error) => helpers.toast(error.message, 'warn', 3600)));
    });
  }

  boot();
})();
