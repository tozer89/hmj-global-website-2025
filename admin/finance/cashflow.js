(function () {
  'use strict';

  const state = {
    payload: null,
    selectedWeekKey: '',
    selectedPreset: 'base',
    helpers: null,
  };

  const forms = {};
  const els = {};
  const PRESETS = [
    { key: 'base', label: 'Base', detail: 'Working HMJ forecast with no extra stress.' },
    { key: 'late_receipts', label: 'Receipts slip', detail: 'Push expected receipts back by one week.' },
    { key: 'funding_squeeze', label: 'Funding squeeze', detail: 'Lower advance rates and add fee drag.' },
    { key: 'payroll_pressure', label: 'Payroll pressure', detail: 'Lift payroll-style outflows by 6%.' },
    { key: 'tight_cash', label: 'Tight cash', detail: 'Combine slower receipts, softer funding, and payroll pressure.' },
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function setup() {
    [
      'cashflowWelcomeMeta',
      'cashflowStatusChips',
      'metricCurrentCash',
      'metricCurrentCashMeta',
      'metricLowCash',
      'metricLowCashMeta',
      'cashflowAlerts',
      'cashflowScenarioMeta',
      'cashflowPresetStrip',
      'cashflowMetricGrid',
      'cashBalanceChart',
      'cashFlowBars',
      'cashflowCommentary',
      'cashflowExposure',
      'weekCardGrid',
      'cashflowTable',
      'weekDetailHeading',
      'weekDetailMeta',
      'weekDetailList',
      'btnRefreshCashflow',
      'btnSyncQboCashflow',
      'btnExportCashflowCsv',
      'btnJumpCurrentWeek',
      'customerTable',
      'fundingTable',
      'invoicePlanTable',
      'overheadTable',
      'adjustmentTable',
      'customerOptions',
    ].forEach((id) => { els[id] = $(id); });

    forms.assumptions = $('assumptionsForm');
    forms.customer = $('customerForm');
    forms.funding = $('fundingForm');
    forms.invoicePlan = $('invoicePlanForm');
    forms.overhead = $('overheadForm');
    forms.adjustment = $('adjustmentForm');
  }

  function clearNode(node) {
    if (node) node.innerHTML = '';
  }

  function money(value, currency) {
    const code = (currency || 'GBP').toUpperCase() === 'EUR' ? 'EUR' : 'GBP';
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  }

  function dateLabel(value) {
    if (!value) return '—';
    try {
      return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      });
    } catch {
      return value;
    }
  }

  function dateTimeLabel(value) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return value;
    }
  }

  function statusChip(label, tone) {
    const span = document.createElement('span');
    span.className = 'finance-status';
    if (tone) span.dataset.tone = tone;
    span.textContent = label;
    return span;
  }

  function showAlerts(items = []) {
    clearNode(els.cashflowAlerts);
    items.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'finance-alert';
      if (item.tone) div.dataset.tone = item.tone;
      div.textContent = item.text;
      els.cashflowAlerts.appendChild(div);
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
    if (!response.ok) throw new Error(payload?.error || payload?.message || 'Cashflow request failed.');
    return payload;
  }

  function formPayload(form) {
    const fd = new FormData(form);
    return Object.fromEntries(fd.entries());
  }

  function readSelectedPreset() {
    const params = new URLSearchParams(window.location.search);
    return params.get('preset') || 'base';
  }

  function writeSelectedPreset(value) {
    const params = new URLSearchParams(window.location.search);
    if (!value || value === 'base') params.delete('preset');
    else params.set('preset', value);
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', next);
  }

  function presetMeta(value) {
    return PRESETS.find((preset) => preset.key === value) || PRESETS[0];
  }

  function resetForm(form) {
    form.reset();
    const hiddenId = form.querySelector('input[name="id"]');
    if (hiddenId) hiddenId.value = '';
  }

  function fillForm(form, record) {
    Array.from(form.elements).forEach((field) => {
      if (!field.name) return;
      field.value = record[field.name] == null ? '' : String(record[field.name]);
    });
  }

  function toneForWeek(week) {
    if (!week) return 'warn';
    if (Number(week.closingBalance || 0) < 0) return 'danger';
    if (Number(week.closingBalance || 0) < Number(week.openingBalance || 0) * 0.5) return 'warn';
    return 'ok';
  }

  function renderStatus(payload) {
    const summary = payload.forecast?.summary || {};
    const assumptions = payload.state?.assumptions || {};
    const insights = payload.forecast?.insights || {};
    clearNode(els.cashflowStatusChips);
    els.cashflowStatusChips.appendChild(statusChip(payload.schema?.ready ? 'Finance schema ready' : 'Finance schema pending', payload.schema?.ready ? 'ok' : 'warn'));
    els.cashflowStatusChips.appendChild(statusChip(payload.connection ? 'QuickBooks connected' : 'QuickBooks optional', payload.connection ? 'ok' : 'warn'));
    els.cashflowStatusChips.appendChild(statusChip(`Reporting ${summary.reportingCurrency || 'GBP'}`, 'ok'));
    els.cashflowStatusChips.appendChild(statusChip(`${summary.scenarioLabel || 'Base'} lens`, summary.scenarioPreset === 'base' ? 'ok' : 'warn'));

    els.metricCurrentCash.textContent = money(summary.currentCash || 0, summary.reportingCurrency);
    els.metricCurrentCashMeta.textContent = summary.rangeStart ? `${summary.rangeStart} to ${summary.rangeEnd}` : 'Waiting for finance data';
    els.metricLowCash.textContent = money(summary.forecastMinimumCash || 0, summary.reportingCurrency);
    const worstWeek = (payload.forecast?.weeks || []).reduce((lowest, week) => {
      if (!lowest || Number(week.closingBalance) < Number(lowest.closingBalance)) return week;
      return lowest;
    }, null);
    els.metricLowCashMeta.textContent = worstWeek ? `${dateLabel(worstWeek.weekStart)} week closes at ${money(worstWeek.closingBalance || 0, summary.reportingCurrency)}` : 'Waiting for finance data';

    const alerts = [];
    if (!payload.schema?.ready) {
      alerts.push({ tone: 'warn', text: 'Finance schema is not yet available. Apply the finance migration before using this workspace.' });
    }
    (payload.qbo?.warnings || []).forEach((warning) => alerts.push({ tone: 'warn', text: warning }));
    if (!payload.connection) {
      alerts.push({ tone: 'warn', text: 'QuickBooks is not connected. Cashflow still works with manual assumptions, but historic actuals and open-item imports will stay limited until QBO is connected.' });
    }
    if (payload.connection?.lastSyncAt) {
      const ageDays = Math.floor((Date.now() - new Date(payload.connection.lastSyncAt).getTime()) / (1000 * 60 * 60 * 24));
      const staleDays = Number(assumptions.qbo_sync_warning_days || 3);
      if (Number.isFinite(ageDays) && ageDays >= staleDays) {
        alerts.push({ tone: ageDays >= staleDays * 2 ? 'danger' : 'warn', text: `QuickBooks sync is ${ageDays} day${ageDays === 1 ? '' : 's'} old. Refresh before relying on the cash position.` });
      }
    }
    (insights.warnings || []).forEach((warning) => {
      alerts.push({
        tone: warning.tone || 'warn',
        text: `${warning.title}: ${warning.text}${warning.action ? ` ${warning.action}` : ''}`,
      });
    });
    showAlerts(alerts);
  }

  function renderMetricGrid(summary) {
    clearNode(els.cashflowMetricGrid);
    const currency = summary.reportingCurrency || 'GBP';
    const cards = [
      ['Opening balance', summary.openingBalance, 'Opening cash used for the current 13-week run.'],
      ['Total inflows', summary.totalInflows, 'Actual receipts, forecast invoices, funding advances, and retention releases.'],
      ['Total outflows', summary.totalOutflows, 'Expenses, AP, overheads, funding fees, and manual outflows.'],
      ['Retention locked', summary.retentionLocked, 'Retention still held until settlement clears.'],
      ['Funding fees', summary.fundingFeesForecast, 'Forecast settlement fees and finance deductions.'],
      ['Overdue receipts', summary.overdueReceivables || 0, 'Open receivables already past due in QuickBooks.'],
      ['Payroll cover', summary.payrollCoverWeeks || 0, 'Approximate weeks of payroll cover from current cash.'],
      ['Largest customer share', summary.largestCustomerShare || 0, 'Share of receivable exposure held by the largest customer in view.'],
      ['Weeks in view', summary.weekCount, 'Active 13-week horizon, ready to roll forward weekly.'],
    ];
    cards.forEach(([title, value, detail]) => {
      const card = document.createElement('article');
      card.className = 'finance-stat';
      card.innerHTML = `
        <span class="finance-kicker">${title}</span>
        <strong>${typeof value === 'number' && !['Weeks in view', 'Payroll cover', 'Largest customer share'].includes(title)
          ? money(value, currency)
          : title === 'Payroll cover'
            ? `${Number(value || 0).toFixed(1)}w`
            : title === 'Largest customer share'
              ? `${Number(value || 0).toFixed(1)}%`
              : value}</strong>
        <span>${detail}</span>
      `;
      els.cashflowMetricGrid.appendChild(card);
    });
  }

  function renderPresetStrip(summary = {}) {
    clearNode(els.cashflowPresetStrip);
    const selected = state.selectedPreset || summary.scenarioPreset || 'base';
    PRESETS.forEach((preset) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'finance-preset';
      if (preset.key === selected) button.dataset.selected = 'true';
      button.innerHTML = `
        <strong>${preset.label}</strong>
        <span>${preset.detail}</span>
      `;
      button.addEventListener('click', () => {
        if (state.selectedPreset === preset.key) return;
        state.selectedPreset = preset.key;
        writeSelectedPreset(preset.key);
        load()
          .then(() => state.helpers.toast(`Scenario set to ${preset.label}.`, 'ok', 2200))
          .catch((error) => state.helpers.toast(error.message, 'warn', 3200));
      });
      els.cashflowPresetStrip.appendChild(button);
    });
    const current = presetMeta(selected);
    els.cashflowScenarioMeta.textContent = `${current.label}: ${current.detail}`;
  }

  function buildLineChartSvg(weeks, summary, assumptions) {
    if (!weeks.length) return '<div class="finance-empty">No weekly cash data is available yet.</div>';
    const width = 720;
    const height = 280;
    const paddingX = 42;
    const paddingTop = 22;
    const paddingBottom = 34;
    const values = weeks.map((week) => Number(week.closingBalance || 0));
    const buffer = Number(assumptions.minimum_cash_buffer || 0);
    const min = Math.min(...values, 0, buffer);
    const max = Math.max(...values, buffer, 1);
    const span = Math.max(max - min, 1);
    const stepX = weeks.length > 1 ? (width - (paddingX * 2)) / (weeks.length - 1) : 0;
    const yFor = (value) => paddingTop + ((max - value) / span) * (height - paddingTop - paddingBottom);
    const xFor = (index) => paddingX + (stepX * index);
    const points = weeks.map((week, index) => `${xFor(index)},${yFor(Number(week.closingBalance || 0))}`).join(' ');
    const zeroY = yFor(0);
    const bufferY = yFor(buffer);

    return `
      <svg viewBox="0 0 ${width} ${height}" class="finance-chart-svg" role="img" aria-label="Closing cash line chart">
        <rect x="0" y="0" width="${width}" height="${height}" rx="20" fill="#ffffff"></rect>
        <line x1="${paddingX}" y1="${zeroY}" x2="${width - paddingX}" y2="${zeroY}" class="finance-chart-line finance-chart-line--zero"></line>
        <line x1="${paddingX}" y1="${bufferY}" x2="${width - paddingX}" y2="${bufferY}" class="finance-chart-line finance-chart-line--buffer"></line>
        <polyline points="${points}" class="finance-chart-path"></polyline>
        ${weeks.map((week, index) => `
          <circle cx="${xFor(index)}" cy="${yFor(Number(week.closingBalance || 0))}" r="4.5" class="finance-chart-point ${Number(week.closingBalance || 0) < 0 ? 'finance-chart-point--danger' : ''}"></circle>
          <text x="${xFor(index)}" y="${height - 10}" text-anchor="middle" class="finance-chart-label">${dateLabel(week.weekStart)}</text>
        `).join('')}
      </svg>
      <div class="finance-chart-legend">
        <span><i class="finance-chart-swatch finance-chart-swatch--cash"></i>Closing cash</span>
        <span><i class="finance-chart-swatch finance-chart-swatch--buffer"></i>Cash buffer</span>
        <span><i class="finance-chart-swatch finance-chart-swatch--zero"></i>Zero line</span>
      </div>
    `;
  }

  function renderFlowBars(weeks, currency) {
    if (!weeks.length) {
      els.cashFlowBars.innerHTML = '<div class="finance-empty">No weekly movement is available yet.</div>';
      return;
    }
    const peak = Math.max(1, ...weeks.map((week) => Math.max(Number(week.inflows || 0), Number(week.outflows || 0))));
    els.cashFlowBars.innerHTML = `
      <div class="finance-bars">
        ${weeks.map((week) => {
          const inflowHeight = Math.max(10, (Number(week.inflows || 0) / peak) * 132);
          const outflowHeight = Math.max(10, (Number(week.outflows || 0) / peak) * 132);
          return `
            <div class="finance-bar-card">
              <div class="finance-bars__visual">
                <div class="finance-bars__stack">
                  <div class="finance-bar finance-bar--inflow" style="height:${inflowHeight}px" title="Inflows ${money(week.inflows || 0, currency)}"></div>
                  <div class="finance-bar finance-bar--outflow" style="height:${outflowHeight}px" title="Outflows ${money(week.outflows || 0, currency)}"></div>
                </div>
              </div>
              <strong>${dateLabel(week.weekStart)}</strong>
              <span>Net ${money(week.netMovement || 0, currency)}</span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="finance-chart-legend">
        <span><i class="finance-chart-swatch finance-chart-swatch--inflow"></i>Inflows</span>
        <span><i class="finance-chart-swatch finance-chart-swatch--outflow"></i>Outflows</span>
      </div>
    `;
  }

  function renderCommentary(insights = {}) {
    clearNode(els.cashflowCommentary);
    const items = Array.isArray(insights.commentary) ? insights.commentary : [];
    if (!items.length) {
      els.cashflowCommentary.innerHTML = '<div class="finance-empty">Commentary will appear once enough finance data exists to analyse.</div>';
      return;
    }
    items.forEach((item) => {
      const node = document.createElement('div');
      node.className = 'finance-list-item';
      node.dataset.tone = item.tone || 'ok';
      node.innerHTML = `
        <strong>${item.title}</strong>
        <small>${item.text}</small>
      `;
      if (item.weekStart) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'finance-btn finance-btn--soft';
        button.textContent = 'Open week';
        button.addEventListener('click', () => selectWeek(item.weekStart));
        node.appendChild(button);
      }
      els.cashflowCommentary.appendChild(node);
    });
  }

  function renderExposure(insights = {}, summary = {}) {
    clearNode(els.cashflowExposure);
    const rows = Array.isArray(insights.exposureEntries) ? insights.exposureEntries.slice(0, 8) : [];
    const currency = summary.reportingCurrency || 'GBP';
    if (!rows.length) {
      els.cashflowExposure.innerHTML = '<div class="finance-empty">Customer exposure appears once QBO invoices or HMJ invoice plans are available.</div>';
      return;
    }
    rows.forEach((row) => {
      const node = document.createElement('div');
      node.className = 'finance-exposure';
      node.innerHTML = `
        <div class="finance-exposure__top">
          <strong>${row.customerName}</strong>
          <span>${money(row.totalExposure || 0, currency)} · ${Number(row.shareOfExposure || 0).toFixed(1)}%</span>
        </div>
        <div class="finance-exposure__bar"><span style="width:${Math.min(100, Number(row.shareOfExposure || 0))}%"></span></div>
        <div class="finance-exposure__meta">
          <span>${row.invoiceCount} item${row.invoiceCount === 1 ? '' : 's'}</span>
          <span>Overdue ${money(row.overdueExposure || 0, currency)}</span>
          <span>${row.fundedExposure > 0 ? `Funded ${money(row.fundedExposure || 0, currency)}` : 'Normal receipts'}</span>
        </div>
      `;
      els.cashflowExposure.appendChild(node);
    });
  }

  function renderVisuals(payload) {
    const weeks = payload.forecast?.weeks || [];
    const summary = payload.forecast?.summary || {};
    const assumptions = payload.state?.assumptions || {};
    els.cashBalanceChart.innerHTML = buildLineChartSvg(weeks, summary, assumptions);
    renderFlowBars(weeks, summary.reportingCurrency || 'GBP');
    renderCommentary(payload.forecast?.insights || {});
    renderExposure(payload.forecast?.insights || {}, summary);
  }

  function selectWeek(weekKey) {
    state.selectedWeekKey = weekKey;
    renderWeekDetail();
    renderWeekCards(state.payload.forecast?.weeks || []);
    renderCashflowTable(state.payload.forecast?.weeks || []);
  }

  function renderWeekCards(weeks) {
    clearNode(els.weekCardGrid);
    const currency = state.payload?.forecast?.summary?.reportingCurrency || 'GBP';
    weeks.forEach((week) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'finance-week-card';
      card.dataset.tone = toneForWeek(week);
      if (week.weekStart === state.selectedWeekKey) card.style.outline = '3px solid rgba(36, 70, 156, 0.24)';
      card.innerHTML = `
        <span class="finance-kicker">${dateLabel(week.weekStart)} → ${dateLabel(week.weekEnd)}</span>
        <strong>${money(week.closingBalance || 0, currency)}</strong>
        <span>Net ${money(week.netMovement || 0, currency)} · In ${money(week.inflows || 0, currency)} · Out ${money(week.outflows || 0, currency)}</span>
      `;
      card.addEventListener('click', () => selectWeek(week.weekStart));
      els.weekCardGrid.appendChild(card);
    });
  }

  function renderCashflowTable(weeks) {
    const currency = state.payload?.forecast?.summary?.reportingCurrency || 'GBP';
    els.cashflowTable.innerHTML = `
      <thead>
        <tr>
          <th>Week</th>
          <th>Opening</th>
          <th>Inflows</th>
          <th>Outflows</th>
          <th>Net</th>
          <th>Closing</th>
          <th>Mode</th>
        </tr>
      </thead>
      <tbody>
        ${weeks.map((week) => `
          <tr class="is-clickable" data-week="${week.weekStart}">
            <td><strong>${dateLabel(week.weekStart)}</strong><br/><small>${week.weekStart}</small></td>
            <td>${money(week.openingBalance || 0, currency)}</td>
            <td>${money(week.inflows || 0, currency)}<br/><small>Actual ${money(week.actualInflows || 0, currency)} · Forecast ${money(week.forecastInflows || 0, currency)}</small></td>
            <td>${money(week.outflows || 0, currency)}<br/><small>Actual ${money(week.actualOutflows || 0, currency)} · Forecast ${money(week.forecastOutflows || 0, currency)}</small></td>
            <td>${money(week.netMovement || 0, currency)}</td>
            <td><strong>${money(week.closingBalance || 0, currency)}</strong></td>
            <td>${week.tone === 'actual' ? 'Realised / current' : 'Forecast'}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    Array.from(els.cashflowTable.querySelectorAll('tbody tr')).forEach((row) => {
      row.addEventListener('click', () => selectWeek(row.dataset.week));
    });
  }

  function renderWeekDetail() {
    const weeks = state.payload?.forecast?.weeks || [];
    const week = weeks.find((row) => row.weekStart === state.selectedWeekKey) || weeks[0] || null;
    const currency = state.payload?.forecast?.summary?.reportingCurrency || 'GBP';
    if (!week) {
      els.weekDetailHeading.textContent = 'Select a week';
      els.weekDetailMeta.textContent = 'No weeks are available yet.';
      els.weekDetailList.innerHTML = '<div class="finance-empty">No week detail is available.</div>';
      return;
    }
    els.weekDetailHeading.textContent = `${dateLabel(week.weekStart)} to ${dateLabel(week.weekEnd)}`;
    els.weekDetailMeta.textContent = `Opening ${money(week.openingBalance || 0, currency)} · Closing ${money(week.closingBalance || 0, currency)} · ${week.lines.length} cash lines`;
    clearNode(els.weekDetailList);
    if (!week.lines.length) {
      els.weekDetailList.innerHTML = '<div class="finance-empty">No cash lines land in this week.</div>';
      return;
    }
    week.lines.forEach((line) => {
      const item = document.createElement('div');
      item.className = 'finance-list-item';
      item.innerHTML = `
        <strong>${line.label}</strong>
        <small>${line.direction === 'outflow' ? 'Outflow' : 'Inflow'} · ${line.category} · ${line.actual ? 'Actual' : 'Forecast'} · ${line.source}</small>
        <small>${line.date} · ${money(line.amount || 0, currency)}</small>
      `;
      els.weekDetailList.appendChild(item);
    });
  }

  function renderTable(host, columns, rows, options = {}) {
    const currency = state.payload?.forecast?.summary?.reportingCurrency || 'GBP';
    host.innerHTML = `
      <thead>
        <tr>${columns.map((column) => `<th>${column.label}</th>`).join('')}<th>Actions</th></tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr data-id="${row.id || ''}">
            ${columns.map((column) => `<td>${typeof column.render === 'function' ? column.render(row, currency) : (row[column.key] ?? '—')}</td>`).join('')}
            <td>
              <div class="finance-inline-actions">
                <button class="finance-btn finance-btn--soft" type="button" data-action="edit">Edit</button>
                <button class="finance-btn finance-btn--soft" type="button" data-action="delete">Delete</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    `;
    Array.from(host.querySelectorAll('tbody tr')).forEach((rowNode) => {
      const id = rowNode.dataset.id;
      rowNode.querySelector('[data-action="edit"]')?.addEventListener('click', () => options.onEdit?.(rows.find((row) => String(row.id) === String(id))));
      rowNode.querySelector('[data-action="delete"]')?.addEventListener('click', () => options.onDelete?.(rows.find((row) => String(row.id) === String(id))));
    });
  }

  function renderDataTables() {
    const currentState = state.payload?.state || {};
    const exposureMap = new Map((state.payload?.forecast?.insights?.exposureEntries || []).map((row) => [String(row.customerName || '').toLowerCase(), row]));
    renderTable(els.customerTable, [
      { label: 'Customer', key: 'customer_name' },
      { label: 'Currency', key: 'default_currency' },
      { label: 'VAT', render: (row) => `${row.vat_treatment || 'uk_standard'} · ${row.vat_rate || 0}%` },
      { label: 'Pay days', key: 'expected_payment_days' },
      { label: 'Funding', render: (row) => row.funding_enabled ? 'Enabled' : 'No' },
      { label: 'Exposure', render: (row) => money(exposureMap.get(String(row.customer_name || '').toLowerCase())?.totalExposure || 0, row.default_currency || currency) },
      { label: 'Overdue', render: (row) => money(exposureMap.get(String(row.customer_name || '').toLowerCase())?.overdueExposure || 0, row.default_currency || currency) },
    ], currentState.customers || [], {
      onEdit: (row) => fillForm(forms.customer, row),
      onDelete: (row) => deleteRecord('finance_customers', row.id),
    });

    renderTable(els.fundingTable, [
      { label: 'Customer', key: 'customer_name' },
      { label: 'Advance', render: (row) => `${row.advance_percent || 0}%` },
      { label: 'Retention', render: (row) => `${row.retention_percent || 0}%` },
      { label: 'Fees', render: (row) => `${row.fee_percent || 0}% + ${row.interest_percent || 0}%` },
      { label: 'Lag', render: (row) => `${row.settlement_lag_days || 0} days` },
    ], currentState.fundingRules || [], {
      onEdit: (row) => fillForm(forms.funding, row),
      onDelete: (row) => deleteRecord('finance_funding_rules', row.id),
    });

    renderTable(els.invoicePlanTable, [
      { label: 'Customer', key: 'customer_name' },
      { label: 'Description', key: 'description' },
      { label: 'Invoice date', key: 'invoice_date' },
      { label: 'Expected pay', key: 'expected_payment_date' },
      { label: 'Value', render: (row) => money(row.gross_amount || row.net_amount || 0, row.currency || currency) },
      { label: 'Funding', render: (row) => row.funded ? 'Funded' : 'Normal receipt' },
    ], currentState.invoicePlans || [], {
      onEdit: (row) => fillForm(forms.invoicePlan, row),
      onDelete: (row) => deleteRecord('finance_cashflow_invoice_plans', row.id),
    });

    renderTable(els.overheadTable, [
      { label: 'Label', key: 'label' },
      { label: 'Category', key: 'category' },
      { label: 'Amount', render: (row) => money(row.amount || 0, row.currency || currency) },
      { label: 'First due', key: 'first_due_date' },
      { label: 'Frequency', key: 'frequency' },
    ], currentState.overheads || [], {
      onEdit: (row) => fillForm(forms.overhead, row),
      onDelete: (row) => deleteRecord('finance_cashflow_overheads', row.id),
    });

    renderTable(els.adjustmentTable, [
      { label: 'Label', key: 'label' },
      { label: 'Direction', key: 'direction' },
      { label: 'Category', key: 'category' },
      { label: 'Amount', render: (row) => money(row.amount || 0, row.currency || currency) },
      { label: 'Date', key: 'effective_date' },
      { label: 'Mode', render: (row) => row.is_actual ? 'Actual' : 'Forecast' },
    ], currentState.adjustments || [], {
      onEdit: (row) => fillForm(forms.adjustment, row),
      onDelete: (row) => deleteRecord('finance_cashflow_adjustments', row.id),
    });
  }

  function renderCustomerOptions() {
    clearNode(els.customerOptions);
    const names = new Set();
    (state.payload?.state?.qboCustomers || []).forEach((row) => {
      const name = row.display_name || '';
      if (name) names.add(name);
    });
    (state.payload?.state?.customers || []).forEach((row) => {
      const name = row.customer_name || '';
      if (name) names.add(name);
    });
    Array.from(names).sort().forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      els.customerOptions.appendChild(option);
    });
  }

  function renderAssumptionsForm() {
    fillForm(forms.assumptions, state.payload?.state?.assumptions || {});
  }

  async function saveAction(action, payload, successMessage) {
    const next = await fetchJson('/.netlify/functions/admin-finance-cashflow', {
      method: 'POST',
      body: JSON.stringify({ action, payload, preset: state.selectedPreset || 'base' }),
    });
    state.payload = next;
    state.selectedWeekKey = next.forecast?.weeks?.[0]?.weekStart || '';
    renderAll();
    state.helpers.toast(successMessage, 'ok', 2600);
  }

  async function deleteRecord(table, id) {
    await saveAction('deleteRecord', { table, id }, 'Finance row deleted.');
  }

  function exportCsv() {
    const weeks = state.payload?.forecast?.weeks || [];
    const currency = state.payload?.forecast?.summary?.reportingCurrency || 'GBP';
    const rows = [
      ['week_start', 'week_end', 'opening_balance', 'inflows', 'outflows', 'net_movement', 'closing_balance', 'currency'],
      ...weeks.map((week) => [
        week.weekStart,
        week.weekEnd,
        week.openingBalance,
        week.inflows,
        week.outflows,
        week.netMovement,
        week.closingBalance,
        currency,
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'hmj-13-week-cashflow.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function syncQuickBooks() {
    state.helpers.toast('Running QuickBooks sync…', 'info', 1800);
    await fetchJson('/.netlify/functions/admin-finance-qbo-sync', { method: 'POST' });
    await load();
    state.helpers.toast('QuickBooks sync completed.', 'ok', 2600);
  }

  function attachFormHandlers() {
    forms.assumptions?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveAction('saveAssumptions', formPayload(forms.assumptions), 'Assumptions saved.').catch((error) => state.helpers.toast(error.message, 'warn', 3200));
    });
    forms.customer?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveAction('saveCustomer', formPayload(forms.customer), 'Customer profile saved.').then(() => resetForm(forms.customer)).catch((error) => state.helpers.toast(error.message, 'warn', 3200));
    });
    forms.funding?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveAction('saveFundingRule', formPayload(forms.funding), 'Funding rule saved.').then(() => resetForm(forms.funding)).catch((error) => state.helpers.toast(error.message, 'warn', 3200));
    });
    forms.invoicePlan?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveAction('saveInvoicePlan', formPayload(forms.invoicePlan), 'Invoice plan saved.').then(() => resetForm(forms.invoicePlan)).catch((error) => state.helpers.toast(error.message, 'warn', 3200));
    });
    forms.overhead?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveAction('saveOverhead', formPayload(forms.overhead), 'Overhead saved.').then(() => resetForm(forms.overhead)).catch((error) => state.helpers.toast(error.message, 'warn', 3200));
    });
    forms.adjustment?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveAction('saveAdjustment', formPayload(forms.adjustment), 'Adjustment saved.').then(() => resetForm(forms.adjustment)).catch((error) => state.helpers.toast(error.message, 'warn', 3200));
    });
  }

  function renderAll() {
    const payload = state.payload || {};
    renderStatus(payload);
    renderMetricGrid(payload.forecast?.summary || {});
    renderPresetStrip(payload.forecast?.summary || {});
    renderAssumptionsForm();
    renderCustomerOptions();
    state.selectedWeekKey = state.selectedWeekKey || payload.forecast?.weeks?.[0]?.weekStart || '';
    renderVisuals(payload);
    renderWeekCards(payload.forecast?.weeks || []);
    renderCashflowTable(payload.forecast?.weeks || []);
    renderWeekDetail();
    renderDataTables();
  }

  async function load() {
    const preset = encodeURIComponent(state.selectedPreset || 'base');
    const payload = await fetchJson(`/.netlify/functions/admin-finance-cashflow?preset=${preset}`);
    state.payload = payload;
    renderAll();
  }

  function bindToolbar() {
    els.btnRefreshCashflow?.addEventListener('click', () => load().then(() => state.helpers.toast('Cashflow recalculated.', 'ok', 2200)).catch((error) => state.helpers.toast(error.message, 'warn', 3200)));
    els.btnSyncQboCashflow?.addEventListener('click', () => syncQuickBooks().catch((error) => state.helpers.toast(error.message, 'warn', 3200)));
    els.btnExportCashflowCsv?.addEventListener('click', exportCsv);
    els.btnJumpCurrentWeek?.addEventListener('click', () => {
      const current = state.payload?.forecast?.weeks?.find((week) => week.tone === 'actual');
      if (current) selectWeek(current.weekStart);
    });
  }

  function boot() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      window.setTimeout(boot, 40);
      return;
    }
    state.selectedPreset = readSelectedPreset();
    setup();
    attachFormHandlers();
    window.Admin.bootAdmin(async (helpers) => {
      state.helpers = helpers;
      helpers.sel('#cashflowWelcomeMeta').textContent = `Signed in as ${helpers.identity ? 'admin user' : 'admin user'}`;
      bindToolbar();
      await load();
      helpers.sel('#cashflowWelcomeMeta').textContent = 'Signed in to the HMJ finance workspace';
    });
  }

  boot();
})();
