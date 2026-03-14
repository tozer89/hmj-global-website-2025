(function () {
  'use strict';

  const Engine = window.HMJCreditLimitForecast;
  if (!Engine) {
    console.error('[HMJ Credit Limit Forecaster] Forecast engine not loaded.');
    return;
  }

  const STORAGE_KEYS = {
    workspace: 'hmj.credit-limit-forecaster.workspace.v1',
    library: 'hmj.credit-limit-forecaster.library.v1',
  };
  const MAX_SCENARIOS = 6;

  const state = {
    helpers: null,
    scenarios: [],
    activeScenarioId: '',
    compareScenarioId: '',
    savedLibrary: [],
    isApplyingForm: false,
    recalcTimer: null,
    summaryTimer: null,
    summaryToken: 0,
    user: null,
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function setupElements() {
    [
      'pageStatusBadge',
      'userMetaChip',
      'summarySourceChip',
      'heroPeakBalance',
      'heroCapacity',
      'btnCalculate',
      'btnRefreshSummary',
      'btnPrint',
      'btnExportCsv',
      'btnExportXlsx',
      'btnLoadScenario',
      'btnDuplicateScenario',
      'btnSaveScenario',
      'btnResetScenario',
      'btnExpandAll',
      'btnCollapseAll',
      'btnAddReceiptLine',
      'btnCloseScenarioDialog',
      'scenarioTabs',
      'forecastForm',
      'clientName',
      'scenarioName',
      'currency',
      'creditLimit',
      'currentOutstandingBalance',
      'forecastStartDate',
      'forecastHorizonWeeks',
      'riskThresholdPercent',
      'vatApplicable',
      'vatRate',
      'paymentTermsType',
      'customNetDays',
      'receiptLagDays',
      'growthMode',
      'directBaseWeeklyNet',
      'directBaseWeeklyGross',
      'directScenarioWeeklyNet',
      'directScenarioWeeklyGross',
      'currentContractors',
      'additionalContractors',
      'weeklyPayPerContractor',
      'hourlyWage',
      'weeklyHours',
      'marginPercent',
      'perContractorNetInvoice',
      'perContractorGrossInvoice',
      'invoiceCadence',
      'invoiceWeekday',
      'autoCountDates',
      'notes',
      'growthPreview',
      'invoiceDatePreview',
      'invoiceOverrideHost',
      'receiptLinesHost',
      'receiptAdjustmentsHost',
      'compareScenarioSelect',
      'resultsHeading',
      'resultsMeta',
      'kpiGrid',
      'gptSummaryText',
      'summaryLoader',
      'assumptionSnapshot',
      'trajectoryChart',
      'headroomChart',
      'compareSummary',
      'sensitivityHost',
      'forecastTableHost',
      'cashTimingHost',
      'savedScenarioDialog',
      'savedScenarioList',
      'clientNames',
    ].forEach(function (id) {
      els[id] = $(id);
    });
  }

  function safeRead(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function safeWrite(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 10);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function cloneScenarioAssumptions(assumptions) {
    return Engine.cloneJson(Engine.sanitizeAssumptions(assumptions));
  }

  function createScenario(name, overrides) {
    const assumptions = Engine.cloneJson(Engine.DEFAULT_ASSUMPTIONS);
    assumptions.scenarioName = name;
    assumptions.clientName = '';
    const merged = Object.assign({}, assumptions, overrides || {});
    if (overrides && overrides.contractor) {
      merged.contractor = Object.assign({}, assumptions.contractor, overrides.contractor);
    }
    if (overrides && overrides.direct) {
      merged.direct = Object.assign({}, assumptions.direct, overrides.direct);
    }
    if (overrides && overrides.paymentTerms) {
      merged.paymentTerms = Object.assign({}, assumptions.paymentTerms, overrides.paymentTerms);
    }
    if (overrides && overrides.invoice) {
      merged.invoice = Object.assign({}, assumptions.invoice, overrides.invoice);
    }
    return {
      id: uid('scenario'),
      assumptions: ensureScenarioArrays(merged),
      result: null,
      summary: null,
      updatedAt: nowIso(),
    };
  }

  function defaultWorkspace() {
    const base = createScenario('Base case');
    const proposed = createScenario('Proposed case');
    const stretch = createScenario('Stretch case');
    return {
      scenarios: [base, proposed, stretch],
      activeScenarioId: base.id,
      compareScenarioId: proposed.id,
    };
  }

  function ensureScenarioArrays(input) {
    const assumptions = Engine.sanitizeAssumptions(input || {});
    const horizon = assumptions.forecastHorizonWeeks;
    const manualCounts = Array.isArray(assumptions.invoice.manualEventCounts)
      ? assumptions.invoice.manualEventCounts.slice(0, horizon)
      : [];
    while (manualCounts.length < horizon) manualCounts.push(null);
    assumptions.invoice.manualEventCounts = manualCounts;

    const adjustments = Array.isArray(assumptions.receiptWeekAdjustments)
      ? assumptions.receiptWeekAdjustments.slice(0, horizon)
      : [];
    while (adjustments.length < horizon) {
      adjustments.push({
        weekIndex: adjustments.length,
        amount: 0,
        note: '',
      });
    }
    assumptions.receiptWeekAdjustments = adjustments.map(function (entry, index) {
      return {
        weekIndex: index,
        amount: Number(entry && entry.amount) || 0,
        note: String(entry && entry.note || '').trim(),
      };
    });

    assumptions.receiptLines = Array.isArray(assumptions.receiptLines)
      ? assumptions.receiptLines.map(function (line, index) {
        return {
          id: String((line && line.id) || uid('receipt') + '-' + index),
          date: Engine.formatDate(line && line.date ? line.date : assumptions.forecastStartDate),
          amount: Number(line && line.amount) || 0,
          note: String(line && line.note || '').trim(),
        };
      })
      : [];

    return assumptions;
  }

  function buildScenarioSignature(assumptions) {
    return JSON.stringify(ensureScenarioArrays(assumptions));
  }

  function hydrateWorkspace() {
    const saved = safeRead(STORAGE_KEYS.workspace, null);
    const library = safeRead(STORAGE_KEYS.library, []);
    state.savedLibrary = Array.isArray(library) ? library : [];

    if (!saved || !Array.isArray(saved.scenarios) || !saved.scenarios.length) {
      const defaults = defaultWorkspace();
      state.scenarios = defaults.scenarios;
      state.activeScenarioId = defaults.activeScenarioId;
      state.compareScenarioId = defaults.compareScenarioId;
      return;
    }

    state.scenarios = saved.scenarios
      .map(function (scenario) {
        if (!scenario || !scenario.id || !scenario.assumptions) return null;
        return {
          id: String(scenario.id),
          assumptions: ensureScenarioArrays(scenario.assumptions),
          result: null,
          summary: scenario.summary || null,
          updatedAt: scenario.updatedAt || nowIso(),
        };
      })
      .filter(Boolean);

    if (!state.scenarios.length) {
      const defaults = defaultWorkspace();
      state.scenarios = defaults.scenarios;
      state.activeScenarioId = defaults.activeScenarioId;
      state.compareScenarioId = defaults.compareScenarioId;
      return;
    }

    state.activeScenarioId = state.scenarios.some(function (entry) { return entry.id === saved.activeScenarioId; })
      ? saved.activeScenarioId
      : state.scenarios[0].id;
    state.compareScenarioId = state.scenarios.some(function (entry) { return entry.id === saved.compareScenarioId; })
      ? saved.compareScenarioId
      : '';
    if (state.compareScenarioId === state.activeScenarioId) {
      state.compareScenarioId = '';
    }
  }

  function persistWorkspace() {
    safeWrite(STORAGE_KEYS.workspace, {
      scenarios: state.scenarios.map(function (scenario) {
        return {
          id: scenario.id,
          assumptions: scenario.assumptions,
          summary: scenario.summary,
          updatedAt: scenario.updatedAt,
        };
      }),
      activeScenarioId: state.activeScenarioId,
      compareScenarioId: state.compareScenarioId,
    });
    safeWrite(STORAGE_KEYS.library, state.savedLibrary);
  }

  function getScenarioById(id) {
    return state.scenarios.find(function (scenario) { return scenario.id === id; }) || null;
  }

  function getActiveScenario() {
    return getScenarioById(state.activeScenarioId);
  }

  function getCompareScenario() {
    if (!state.compareScenarioId || state.compareScenarioId === state.activeScenarioId) return null;
    return getScenarioById(state.compareScenarioId);
  }

  function activeCurrency() {
    const active = getActiveScenario();
    return active ? active.assumptions.currency : 'GBP';
  }

  function formatMoney(amount, currency) {
    return Engine.formatCurrency(Number(amount) || 0, currency || activeCurrency());
  }

  function formatMoneyPrecise(amount, currency) {
    return Engine.formatDecimalCurrency(Number(amount) || 0, currency || activeCurrency());
  }

  function toneForStatus(status) {
    if (status === 'over_limit') return 'danger';
    if (status === 'at_risk') return 'warn';
    return 'ok';
  }

  function readAssumptionsFromForm(previous) {
    const assumptions = Engine.cloneJson(previous || Engine.DEFAULT_ASSUMPTIONS);
    assumptions.clientName = String(els.clientName.value || '').trim();
    assumptions.scenarioName = String(els.scenarioName.value || '').trim() || 'Scenario';
    assumptions.currency = els.currency.value || 'GBP';
    assumptions.creditLimit = Number(els.creditLimit.value) || 0;
    assumptions.currentOutstandingBalance = Number(els.currentOutstandingBalance.value) || 0;
    assumptions.forecastStartDate = els.forecastStartDate.value || Engine.formatDate(new Date());
    assumptions.forecastHorizonWeeks = Number(els.forecastHorizonWeeks.value) || Engine.DEFAULT_ASSUMPTIONS.forecastHorizonWeeks;
    assumptions.riskThresholdPercent = Number(els.riskThresholdPercent.value) || Engine.DEFAULT_ASSUMPTIONS.riskThresholdPercent;
    assumptions.vatApplicable = !!els.vatApplicable.checked;
    assumptions.vatRate = Number(els.vatRate.value) || 0;
    assumptions.paymentTerms = assumptions.paymentTerms || {};
    assumptions.paymentTerms.type = els.paymentTermsType.value || '30_eom';
    assumptions.paymentTerms.customNetDays = Number(els.customNetDays.value) || 0;
    assumptions.paymentTerms.receiptLagDays = Number(els.receiptLagDays.value) || 0;
    assumptions.growthMode = els.growthMode.value || 'contractor';
    assumptions.direct = assumptions.direct || {};
    assumptions.direct.baseWeeklyNet = Number(els.directBaseWeeklyNet.value) || 0;
    assumptions.direct.baseWeeklyGross = Number(els.directBaseWeeklyGross.value) || 0;
    assumptions.direct.scenarioWeeklyNet = Number(els.directScenarioWeeklyNet.value) || 0;
    assumptions.direct.scenarioWeeklyGross = Number(els.directScenarioWeeklyGross.value) || 0;
    assumptions.contractor = assumptions.contractor || {};
    assumptions.contractor.currentContractors = Number(els.currentContractors.value) || 0;
    assumptions.contractor.additionalContractors = Number(els.additionalContractors.value) || 0;
    assumptions.contractor.weeklyPayPerContractor = Number(els.weeklyPayPerContractor.value) || 0;
    assumptions.contractor.hourlyWage = Number(els.hourlyWage.value) || 0;
    assumptions.contractor.weeklyHours = Number(els.weeklyHours.value) || 0;
    assumptions.contractor.marginPercent = Number(els.marginPercent.value) || 0;
    assumptions.contractor.perContractorNetInvoice = Number(els.perContractorNetInvoice.value) || 0;
    assumptions.contractor.perContractorGrossInvoice = Number(els.perContractorGrossInvoice.value) || 0;
    assumptions.invoice = assumptions.invoice || {};
    assumptions.invoice.cadence = els.invoiceCadence.value || 'weekly';
    assumptions.invoice.invoiceWeekday = Number(els.invoiceWeekday.value) || 2;
    assumptions.invoice.autoCountDates = !!els.autoCountDates.checked;
    assumptions.notes = String(els.notes.value || '').trim();
    return ensureScenarioArrays(assumptions);
  }

  function applyAssumptionsToForm(assumptions) {
    const scenario = ensureScenarioArrays(assumptions);
    state.isApplyingForm = true;
    els.clientName.value = scenario.clientName || '';
    els.scenarioName.value = scenario.scenarioName || '';
    els.currency.value = scenario.currency || 'GBP';
    els.creditLimit.value = scenario.creditLimit || 0;
    els.currentOutstandingBalance.value = scenario.currentOutstandingBalance || 0;
    els.forecastStartDate.value = scenario.forecastStartDate || Engine.formatDate(new Date());
    els.forecastHorizonWeeks.value = scenario.forecastHorizonWeeks || 20;
    els.riskThresholdPercent.value = scenario.riskThresholdPercent || 90;
    els.vatApplicable.checked = !!scenario.vatApplicable;
    els.vatRate.value = scenario.vatRate || 0;
    els.paymentTermsType.value = scenario.paymentTerms.type || '30_eom';
    els.customNetDays.value = scenario.paymentTerms.customNetDays || 0;
    els.receiptLagDays.value = scenario.paymentTerms.receiptLagDays || 0;
    els.growthMode.value = scenario.growthMode || 'contractor';
    els.directBaseWeeklyNet.value = scenario.direct.baseWeeklyNet || 0;
    els.directBaseWeeklyGross.value = scenario.direct.baseWeeklyGross || 0;
    els.directScenarioWeeklyNet.value = scenario.direct.scenarioWeeklyNet || 0;
    els.directScenarioWeeklyGross.value = scenario.direct.scenarioWeeklyGross || 0;
    els.currentContractors.value = scenario.contractor.currentContractors || 0;
    els.additionalContractors.value = scenario.contractor.additionalContractors || 0;
    els.weeklyPayPerContractor.value = scenario.contractor.weeklyPayPerContractor || 0;
    els.hourlyWage.value = scenario.contractor.hourlyWage || 0;
    els.weeklyHours.value = scenario.contractor.weeklyHours || 0;
    els.marginPercent.value = scenario.contractor.marginPercent || 0;
    els.perContractorNetInvoice.value = scenario.contractor.perContractorNetInvoice || 0;
    els.perContractorGrossInvoice.value = scenario.contractor.perContractorGrossInvoice || 0;
    els.invoiceCadence.value = scenario.invoice.cadence || 'weekly';
    els.invoiceWeekday.value = String(scenario.invoice.invoiceWeekday != null ? scenario.invoice.invoiceWeekday : 2);
    els.autoCountDates.checked = scenario.invoice.autoCountDates !== false;
    els.notes.value = scenario.notes || '';
    state.isApplyingForm = false;
  }

  function updateActiveScenarioFromForm() {
    const active = getActiveScenario();
    if (!active) return;
    active.assumptions = readAssumptionsFromForm(active.assumptions);
    active.updatedAt = nowIso();
  }

  function calculateScenario(scenario) {
    scenario.assumptions = ensureScenarioArrays(scenario.assumptions);
    const result = Engine.buildForecast(scenario.assumptions);
    const capacity = Engine.analyseCapacity(scenario.assumptions);
    result.capacity = capacity;
    result.fallbackSummary = Engine.generateFallbackSummary(result, scenario.assumptions, capacity);
    scenario.result = result;
    const signature = buildScenarioSignature(scenario.assumptions);
    if (!scenario.summary || scenario.summary.signature !== signature) {
      scenario.summary = {
        text: result.fallbackSummary,
        source: 'fallback',
        error: '',
        signature: signature,
      };
    }
  }

  function calculateWorkspace() {
    state.scenarios.forEach(calculateScenario);
    persistWorkspace();
  }

  function scheduleRecalc(delay) {
    window.clearTimeout(state.recalcTimer);
    state.recalcTimer = window.setTimeout(function () {
      updateActiveScenarioFromForm();
      calculateWorkspace();
      renderWorkspace();
      scheduleSummaryRefresh(false);
    }, typeof delay === 'number' ? delay : 140);
  }

  function scenarioDisplayName(scenario) {
    return scenario && scenario.assumptions && scenario.assumptions.scenarioName
      ? scenario.assumptions.scenarioName
      : 'Scenario';
  }

  function renderScenarioTabs() {
    els.scenarioTabs.innerHTML = '';
    state.scenarios.forEach(function (scenario) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'clf-tab' + (scenario.id === state.activeScenarioId ? ' is-active' : '');
      button.dataset.scenarioId = scenario.id;
      button.dataset.status = scenario.result ? scenario.result.overallStatus : 'within_limit';
      button.innerHTML = [
        '<div class="clf-cell-stack">',
        '<strong>', escapeHtml(scenarioDisplayName(scenario)), '</strong>',
        '<small>', escapeHtml(scenario.result ? scenario.result.overallStatusLabel : 'Scenario'), '</small>',
        '</div>',
      ].join('');
      button.addEventListener('click', function () {
        if (scenario.id === state.activeScenarioId) return;
        state.activeScenarioId = scenario.id;
        applyAssumptionsToForm(scenario.assumptions);
        renderWorkspace();
      });
      els.scenarioTabs.appendChild(button);
    });
  }

  function renderCompareSelect() {
    const activeId = state.activeScenarioId;
    const options = ['<option value="">No comparison</option>'].concat(
      state.scenarios
        .filter(function (scenario) { return scenario.id !== activeId; })
        .map(function (scenario) {
          const selected = scenario.id === state.compareScenarioId ? ' selected' : '';
          return '<option value="' + escapeAttr(scenario.id) + '"' + selected + '>'
            + escapeHtml(scenarioDisplayName(scenario)) + '</option>';
        })
    );
    els.compareScenarioSelect.innerHTML = options.join('');
  }

  function renderGrowthPreview(active) {
    const derived = Engine.deriveRunRateComponents(active.assumptions);
    const currency = active.assumptions.currency;
    const cards = [
      {
        label: 'Base weekly gross',
        value: formatMoneyPrecise(derived.totalBaseGross, currency),
      },
      {
        label: 'Scenario weekly gross',
        value: formatMoneyPrecise(derived.totalScenarioGross, currency),
      },
      {
        label: 'Per contractor gross',
        value: formatMoneyPrecise(derived.capacityUnitGross, currency),
      },
      {
        label: 'Per contractor net',
        value: formatMoneyPrecise(derived.capacityUnitNet, currency),
      },
    ];
    els.growthPreview.innerHTML = cards.map(function (card) {
      return '<div class="clf-mini-card"><strong>' + escapeHtml(card.value) + '</strong><span>' + escapeHtml(card.label) + '</span></div>';
    }).join('');
  }

  function renderInvoiceDatePreview(active) {
    const invoicePlan = Engine.buildInvoicePlan(active.assumptions, Engine.generateWeeks(active.assumptions));
    const dates = [];
    invoicePlan.forEach(function (week) {
      week.invoiceDates.forEach(function (date) {
        dates.push(Engine.formatLongDate(date));
      });
    });
    if (!dates.length) {
      els.invoiceDatePreview.innerHTML = '<div class="clf-empty">No invoice dates are currently scheduled inside the forecast window.</div>';
      return;
    }
    els.invoiceDatePreview.innerHTML = dates.slice(0, 24).map(function (label) {
      return '<span class="clf-chip">' + escapeHtml(label) + '</span>';
    }).join('') + (dates.length > 24 ? '<span class="clf-chip">+' + (dates.length - 24) + ' more</span>' : '');
  }

  function renderInvoiceOverrideTable(active) {
    if (active.assumptions.invoice.autoCountDates !== false) {
      els.invoiceOverrideHost.innerHTML = '<div class="clf-empty">Automatic counting is on. Switch it off to confirm or override invoice-event counts week by week.</div>';
      return;
    }
    const weeks = Engine.generateWeeks(active.assumptions);
    const rows = weeks.map(function (week, index) {
      const value = active.assumptions.invoice.manualEventCounts[index];
      return '<tr>'
        + '<td>Week ' + week.weekNumber + '</td>'
        + '<td>' + escapeHtml(Engine.formatLongDate(week.weekStartDate)) + '</td>'
        + '<td><input type="number" min="0" step="1" data-invoice-count-index="' + index + '" value="' + escapeAttr(value == null ? '' : value) + '"/></td>'
        + '</tr>';
    }).join('');
    els.invoiceOverrideHost.innerHTML = [
      '<div class="clf-card">',
      '<div class="clf-card-head"><div><p class="clf-kicker">Manual event counts</p><h3>Override invoice events</h3></div></div>',
      '<table class="clf-inline-table"><thead><tr><th>Week</th><th>Week commencing</th><th>Invoice events</th></tr></thead><tbody>',
      rows,
      '</tbody></table>',
      '</div>',
    ].join('');
  }

  function renderReceiptLines(active) {
    if (!active.assumptions.receiptLines.length) {
      els.receiptLinesHost.innerHTML = '<div class="clf-empty">No manual receipt lines added yet. Add known expected payments here to reduce the projected balance in the relevant week.</div>';
      return;
    }
    els.receiptLinesHost.innerHTML = active.assumptions.receiptLines.map(function (line, index) {
      return [
        '<div class="clf-list-card">',
        '<div class="clf-form-grid clf-form-grid-3">',
        '<label class="clf-field">',
        '<span class="clf-label">Receipt date</span>',
        '<input type="date" data-receipt-index="' + index + '" data-receipt-key="date" value="' + escapeAttr(line.date) + '"/>',
        '</label>',
        '<label class="clf-field">',
        '<span class="clf-label">Amount</span>',
        '<input type="number" min="0" step="0.01" data-receipt-index="' + index + '" data-receipt-key="amount" value="' + escapeAttr(line.amount) + '"/>',
        '</label>',
        '<label class="clf-field">',
        '<span class="clf-label">Note</span>',
        '<input type="text" data-receipt-index="' + index + '" data-receipt-key="note" value="' + escapeAttr(line.note) + '" placeholder="Expected receipt note"/>',
        '</label>',
        '</div>',
        '<div class="clf-toolbar"><button class="clf-btn clf-btn-danger" type="button" data-remove-receipt-index="' + index + '">Remove line</button></div>',
        '</div>',
      ].join('');
    }).join('');
  }

  function renderReceiptAdjustments(active) {
    const weeks = Engine.generateWeeks(active.assumptions);
    const rows = weeks.map(function (week, index) {
      const item = active.assumptions.receiptWeekAdjustments[index] || { amount: 0 };
      return '<tr>'
        + '<td>Week ' + week.weekNumber + '</td>'
        + '<td>' + escapeHtml(Engine.formatLongDate(week.weekStartDate)) + '</td>'
        + '<td><input type="number" min="-99999999" step="0.01" data-adjustment-index="' + index + '" value="' + escapeAttr(item.amount || 0) + '"/></td>'
        + '</tr>';
    }).join('');
    els.receiptAdjustmentsHost.innerHTML = [
      '<div class="clf-card">',
      '<div class="clf-card-head"><div><p class="clf-kicker">Weekly adjustments</p><h3>Receipt deltas by week</h3></div></div>',
      '<table class="clf-inline-table"><thead><tr><th>Week</th><th>Week commencing</th><th>Adjustment</th></tr></thead><tbody>',
      rows,
      '</tbody></table>',
      '</div>',
    ].join('');
  }

  function renderAssumptionUi() {
    const active = getActiveScenario();
    if (!active) return;
    renderGrowthPreview(active);
    renderInvoiceDatePreview(active);
    renderInvoiceOverrideTable(active);
    renderReceiptLines(active);
    renderReceiptAdjustments(active);
  }

  function renderKpis(active) {
    const result = active.result;
    const capacity = result.capacity;
    const firstBreach = result.metrics.firstBreach;
    const currency = active.assumptions.currency;
    const cards = [
      { label: 'Credit limit', value: formatMoney(result.metrics.creditLimit, currency), meta: 'Insured limit', tone: 'ok' },
      { label: 'Current balance', value: formatMoney(result.metrics.currentBalance, currency), meta: 'Opening receivables', tone: toneForStatus(result.overallStatus) },
      { label: 'Peak balance', value: formatMoney(result.metrics.forecastPeakBalance, currency), meta: 'Highest projected close', tone: toneForStatus(result.overallStatus) },
      { label: 'Minimum headroom', value: formatMoney(result.metrics.minimumHeadroom, currency), meta: 'Lowest remaining capacity', tone: toneForStatus(result.overallStatus) },
      { label: 'First breach', value: firstBreach ? ('Week ' + firstBreach.weekNumber) : 'None', meta: firstBreach ? Engine.formatLongDate(firstBreach.breachDate || firstBreach.weekCommencing) : 'No breach forecast', tone: firstBreach ? 'danger' : 'ok' },
      { label: 'Additional contractors allowed', value: capacity.available ? String(capacity.maxAdditionalContractorsAllowed) : '—', meta: 'Safe extra contractors', tone: capacity.available && capacity.maxAdditionalContractorsAllowed > 0 ? 'ok' : toneForStatus(result.overallStatus) },
      { label: 'Contractors to remove', value: capacity.available ? String(capacity.contractorsToRemove || 0) : '—', meta: capacity.available && capacity.contractorsToRemove ? 'Required to de-risk' : 'None implied', tone: capacity.available && capacity.contractorsToRemove ? 'danger' : 'ok' },
      { label: 'Max safe weekly increase', value: capacity.available ? formatMoney(capacity.maxSafeWeeklyGrossIncrease, currency) : '—', meta: 'Gross weekly uplift', tone: toneForStatus(result.overallStatus) },
      { label: 'Status', value: result.overallStatusLabel, meta: active.assumptions.paymentTerms.type.replace(/_/g, ' '), tone: toneForStatus(result.overallStatus) },
    ];
    els.kpiGrid.innerHTML = cards.map(function (card) {
      return '<article class="clf-kpi-card" data-tone="' + escapeAttr(card.tone) + '">'
        + '<span class="clf-label">' + escapeHtml(card.label) + '</span>'
        + '<strong>' + escapeHtml(card.value) + '</strong>'
        + '<span>' + escapeHtml(card.meta) + '</span>'
        + '</article>';
    }).join('');
  }

  function renderSummary(active) {
    const summary = active.summary || { text: active.result.fallbackSummary, source: 'fallback', error: '' };
    const sourceText = summary.source === 'openai' ? 'GPT summary' : 'Local summary';
    els.gptSummaryText.innerHTML = '<p>' + escapeHtml(summary.text || active.result.fallbackSummary) + '</p>';
    els.summarySourceChip.textContent = sourceText;
    els.summarySourceChip.dataset.tone = summary.source === 'openai' ? 'ok' : (summary.error ? 'warn' : 'ok');
  }

  function renderAssumptionSnapshot(active) {
    const result = active.result;
    const derived = result.derived;
    const assumptions = active.assumptions;
    const invoiceDates = result.invoicePlan.reduce(function (total, week) { return total + week.invoiceCount; }, 0);
    const rows = [
      {
        title: 'Client & scenario',
        value: (assumptions.clientName || 'Unnamed client') + ' • ' + scenarioDisplayName(active),
      },
      {
        title: 'Payment terms',
        value: (Engine.TERM_LABELS[assumptions.paymentTerms.type] || assumptions.paymentTerms.type) + ' • lag ' + assumptions.paymentTerms.receiptLagDays + ' day(s)',
      },
      {
        title: 'Invoicing cadence',
        value: (assumptions.invoice.cadence === 'monthly' ? 'Monthly' : 'Weekly') + ' on ' + Engine.weekdayLabel(assumptions.invoice.invoiceWeekday) + ' • ' + invoiceDates + ' projected invoice dates',
      },
      {
        title: 'VAT basis',
        value: assumptions.vatApplicable ? ('VAT on at ' + assumptions.vatRate + '%') : 'VAT excluded',
      },
      {
        title: 'Base weekly gross',
        value: formatMoneyPrecise(derived.totalBaseGross, assumptions.currency),
      },
      {
        title: 'Scenario weekly gross',
        value: formatMoneyPrecise(derived.totalScenarioGross, assumptions.currency),
      },
      {
        title: 'Per contractor gross',
        value: formatMoneyPrecise(derived.capacityUnitGross, assumptions.currency),
      },
      {
        title: 'Notes',
        value: assumptions.notes || 'No internal note attached.',
      },
    ];
    els.assumptionSnapshot.innerHTML = rows.map(function (row) {
      return '<div class="clf-list-card"><strong>' + escapeHtml(row.title) + '</strong><span>' + escapeHtml(row.value) + '</span></div>';
    }).join('');
  }

  function linePath(points) {
    return points.map(function (point, index) {
      return (index === 0 ? 'M' : 'L') + point[0].toFixed(2) + ' ' + point[1].toFixed(2);
    }).join(' ');
  }

  function areaPath(points, baselineY) {
    if (!points.length) return '';
    const start = points[0];
    const end = points[points.length - 1];
    return linePath(points) + ' L ' + end[0].toFixed(2) + ' ' + baselineY.toFixed(2) + ' L ' + start[0].toFixed(2) + ' ' + baselineY.toFixed(2) + ' Z';
  }

  function createTrajectorySvg(activeResult, compareResult, currency) {
    const width = 980;
    const height = 340;
    const margin = { top: 24, right: 20, bottom: 46, left: 82 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const activeValues = activeResult.weeks.map(function (row) { return row.closingBalance; });
    const compareValues = compareResult ? compareResult.weeks.map(function (row) { return row.closingBalance; }) : [];
    const maxValue = Math.max(activeResult.metrics.creditLimit * 1.12, activeResult.metrics.forecastPeakBalance * 1.08, compareValues.length ? Math.max.apply(null, compareValues) * 1.08 : 0, 1000);
    const minValue = 0;
    const xStep = activeValues.length > 1 ? plotWidth / (activeValues.length - 1) : plotWidth;
    const yFor = function (value) {
      const safe = Math.max(minValue, Math.min(maxValue, value));
      return margin.top + plotHeight - ((safe - minValue) / (maxValue - minValue || 1)) * plotHeight;
    };
    const xFor = function (index) {
      return margin.left + (index * xStep);
    };
    const activePoints = activeValues.map(function (value, index) { return [xFor(index), yFor(value)]; });
    const comparePoints = compareValues.map(function (value, index) { return [xFor(index), yFor(value)]; });
    const tickValues = [0, 0.25, 0.5, 0.75, 1].map(function (ratio) { return ratio * maxValue; });
    const limitY = yFor(activeResult.metrics.creditLimit);
    const breachX = activeResult.firstBreach ? xFor(activeResult.firstBreach.weekIndex) : null;

    const gridLines = tickValues.map(function (value) {
      const y = yFor(value);
      return '<g>'
        + '<line x1="' + margin.left + '" y1="' + y + '" x2="' + (width - margin.right) + '" y2="' + y + '" stroke="rgba(41,71,143,0.12)" stroke-dasharray="4 8"/>'
        + '<text x="' + (margin.left - 12) + '" y="' + (y + 4) + '" text-anchor="end" fill="#5e709e" font-size="12">' + escapeHtml(formatMoney(value, currency)) + '</text>'
        + '</g>';
    }).join('');

    const xLabels = activeResult.weeks.map(function (row, index) {
      const x = xFor(index);
      return '<text x="' + x + '" y="' + (height - 14) + '" text-anchor="middle" fill="#5e709e" font-size="12">W' + row.weekNumber + '</text>';
    }).join('');

    const limitLabel = '<text x="' + (width - margin.right) + '" y="' + (limitY - 10) + '" text-anchor="end" fill="#b42318" font-size="12" font-weight="700">Limit ' + escapeHtml(formatMoney(activeResult.metrics.creditLimit, currency)) + '</text>';

    const compareLine = comparePoints.length
      ? '<path d="' + areaPath(comparePoints, margin.top + plotHeight) + '" fill="rgba(15,118,110,0.06)"/><path d="' + linePath(comparePoints) + '" fill="none" stroke="#0f766e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
      : '';

    const breachMarker = breachX != null
      ? '<g><line x1="' + breachX + '" y1="' + margin.top + '" x2="' + breachX + '" y2="' + (margin.top + plotHeight) + '" stroke="rgba(180,35,24,0.44)" stroke-dasharray="6 8"/><text x="' + breachX + '" y="' + (margin.top + 16) + '" text-anchor="middle" fill="#b42318" font-size="12" font-weight="700">First breach</text></g>'
      : '';

    return [
      '<svg viewBox="0 0 ' + width + ' ' + height + '" aria-hidden="true">',
      '<defs>',
      '<linearGradient id="clfActiveFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="rgba(41,71,143,0.24)"/><stop offset="100%" stop-color="rgba(41,71,143,0.02)"/></linearGradient>',
      '</defs>',
      '<rect x="' + margin.left + '" y="' + margin.top + '" width="' + plotWidth + '" height="' + (limitY - margin.top) + '" fill="rgba(180,35,24,0.07)"/>',
      gridLines,
      '<line x1="' + margin.left + '" y1="' + limitY + '" x2="' + (width - margin.right) + '" y2="' + limitY + '" stroke="#b42318" stroke-width="2" stroke-dasharray="8 8"/>',
      limitLabel,
      breachMarker,
      '<path d="' + areaPath(activePoints, margin.top + plotHeight) + '" fill="url(#clfActiveFill)"/>',
      '<path d="' + linePath(activePoints) + '" fill="none" stroke="#29478f" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
      compareLine,
      activePoints.map(function (point, index) {
        const row = activeResult.weeks[index];
        const fill = row.status === 'over_limit' ? '#b42318' : row.status === 'at_risk' ? '#c77b18' : '#29478f';
        return '<circle cx="' + point[0] + '" cy="' + point[1] + '" r="4.5" fill="' + fill + '" stroke="#fff" stroke-width="2"/>';
      }).join(''),
      xLabels,
      '</svg>',
    ].join('');
  }

  function createHeadroomSvg(activeResult, currency) {
    const width = 980;
    const height = 300;
    const margin = { top: 26, right: 18, bottom: 40, left: 76 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const values = activeResult.weeks.map(function (row) { return row.headroom; });
    const maxAbs = Math.max.apply(null, values.map(function (value) { return Math.abs(value); }).concat([1000]));
    const yFor = function (value) {
      return margin.top + ((maxAbs - value) / (maxAbs * 2 || 1)) * plotHeight;
    };
    const zeroY = yFor(0);
    const barWidth = plotWidth / Math.max(values.length, 1) * 0.66;
    const xStep = plotWidth / Math.max(values.length, 1);

    const bars = values.map(function (value, index) {
      const x = margin.left + (index * xStep) + ((xStep - barWidth) / 2);
      const y = value >= 0 ? yFor(value) : zeroY;
      const heightValue = Math.max(4, Math.abs(yFor(value) - zeroY));
      const fill = value < 0 ? '#b42318' : (value <= activeResult.metrics.creditLimit * 0.1 ? '#c77b18' : '#138754');
      return '<g>'
        + '<rect x="' + x + '" y="' + y + '" width="' + barWidth + '" height="' + heightValue + '" rx="8" fill="' + fill + '" opacity="0.88"/>'
        + '<text x="' + (x + barWidth / 2) + '" y="' + (height - 12) + '" text-anchor="middle" fill="#5e709e" font-size="12">W' + (index + 1) + '</text>'
        + '</g>';
    }).join('');

    const ticks = [maxAbs, 0, -maxAbs].map(function (value) {
      const y = yFor(value);
      return '<g>'
        + '<line x1="' + margin.left + '" y1="' + y + '" x2="' + (width - margin.right) + '" y2="' + y + '" stroke="rgba(41,71,143,0.12)" stroke-dasharray="4 8"/>'
        + '<text x="' + (margin.left - 12) + '" y="' + (y + 4) + '" text-anchor="end" fill="#5e709e" font-size="12">' + escapeHtml(formatMoney(value, currency)) + '</text>'
        + '</g>';
    }).join('');

    return [
      '<svg viewBox="0 0 ' + width + ' ' + height + '" aria-hidden="true">',
      ticks,
      '<line x1="' + margin.left + '" y1="' + zeroY + '" x2="' + (width - margin.right) + '" y2="' + zeroY + '" stroke="#29478f" stroke-width="1.5"/>',
      bars,
      '</svg>',
    ].join('');
  }

  function renderCompareSummary(active, compare) {
    if (!compare || !compare.result) {
      els.compareSummary.innerHTML = '<div class="clf-empty">Select another scenario to overlay its trajectory and compare peak balance, headroom, and first breach timing side by side.</div>';
      return;
    }
    const currency = active.assumptions.currency;
    const rows = [
      ['Status', active.result.overallStatusLabel, compare.result.overallStatusLabel],
      ['Peak balance', formatMoney(active.result.metrics.forecastPeakBalance, currency), formatMoney(compare.result.metrics.forecastPeakBalance, currency)],
      ['Minimum headroom', formatMoney(active.result.metrics.minimumHeadroom, currency), formatMoney(compare.result.metrics.minimumHeadroom, currency)],
      ['Additional contractors allowed', String(active.result.capacity.maxAdditionalContractorsAllowed), String(compare.result.capacity.maxAdditionalContractorsAllowed)],
      ['First breach', active.result.firstBreach ? ('Week ' + active.result.firstBreach.weekNumber) : 'None', compare.result.firstBreach ? ('Week ' + compare.result.firstBreach.weekNumber) : 'None'],
    ];
    els.compareSummary.innerHTML = rows.map(function (row) {
      return '<div class="clf-compare-row">'
        + '<div><strong>' + escapeHtml(row[0]) + '</strong><span>' + escapeHtml(scenarioDisplayName(active)) + ' vs ' + escapeHtml(scenarioDisplayName(compare)) + '</span></div>'
        + '<div><strong>' + escapeHtml(row[1]) + '</strong></div>'
        + '<div><strong>' + escapeHtml(row[2]) + '</strong></div>'
        + '</div>';
    }).join('');
  }

  function renderSensitivity(active) {
    const capacity = active.result.capacity;
    if (!capacity.available) {
      els.sensitivityHost.innerHTML = '<div class="clf-empty">Add contractor value assumptions to unlock safe-capacity calculations.</div>';
      return;
    }
    const currency = active.assumptions.currency;
    const items = [];
    items.push('<span class="clf-chip" data-tone="' + escapeAttr(toneForStatus(active.result.overallStatus)) + '">Per contractor ' + escapeHtml(formatMoneyPrecise(capacity.unitGross, currency)) + '</span>');
    items.push('<span class="clf-chip" data-tone="ok">Max allowed ' + capacity.maxAdditionalContractorsAllowed + '</span>');
    items.push('<span class="clf-chip" data-tone="' + (capacity.contractorsToRemove ? 'danger' : 'ok') + '">Remove ' + (capacity.contractorsToRemove || 0) + '</span>');
    items.push('<span class="clf-chip" data-tone="' + escapeAttr(toneForStatus(active.result.overallStatus)) + '">Max safe weekly uplift ' + escapeHtml(formatMoney(capacity.maxSafeWeeklyGrossIncrease, currency)) + '</span>');
    capacity.sensitivity.forEach(function (entry) {
      items.push('<span class="clf-chip" data-tone="' + escapeAttr(toneForStatus(entry.overallStatus)) + '">+' + entry.additionalContractors + ' contractor' + (entry.additionalContractors === 1 ? '' : 's') + ' • ' + escapeHtml(entry.overallStatusLabel) + ' • headroom ' + escapeHtml(formatMoney(entry.minimumHeadroom, currency)) + '</span>');
    });
    els.sensitivityHost.innerHTML = items.join('');
  }

  function renderForecastTable(active) {
    const currency = active.assumptions.currency;
    const rows = active.result.weeks.map(function (row) {
      const invoiceDates = row.invoiceDateLabels.length ? row.invoiceDateLabels.join(', ') : '—';
      return '<tr data-status="' + escapeAttr(row.status) + '">'
        + '<td><div class="clf-cell-stack"><strong>Week ' + row.weekNumber + '</strong><small>' + escapeHtml(Engine.formatLongDate(row.weekCommencing)) + '</small></div></td>'
        + '<td><div class="clf-cell-stack"><strong>' + escapeHtml(invoiceDates) + '</strong><small>' + row.invoiceCount + ' event(s)</small></div></td>'
        + '<td>' + escapeHtml(formatMoney(row.openingBalance, currency)) + '</td>'
        + '<td>' + escapeHtml(formatMoney(row.baseInvoiceIncrease, currency)) + '</td>'
        + '<td>' + escapeHtml(formatMoney(row.scenarioInvoiceIncrease, currency)) + '</td>'
        + '<td><div class="clf-cell-stack"><strong>' + escapeHtml(formatMoney(row.receipts, currency)) + '</strong><small>Manual ' + escapeHtml(formatMoney(row.manualReceipts, currency)) + '</small></div></td>'
        + '<td>' + escapeHtml(formatMoney(row.closingBalance, currency)) + '</td>'
        + '<td>' + escapeHtml(formatMoney(row.headroom, currency)) + '</td>'
        + '<td><span class="clf-table-badge" data-status="' + escapeAttr(row.status) + '">' + escapeHtml(row.statusLabel) + '</span></td>'
        + '<td>' + escapeHtml(row.breachDate ? Engine.formatLongDate(row.breachDate) : '—') + '</td>'
        + '</tr>';
    }).join('');
    els.forecastTableHost.innerHTML = [
      '<table class="clf-table">',
      '<thead><tr><th>Week</th><th>Invoice date(s)</th><th>Opening balance</th><th>Base invoice increase</th><th>Scenario invoice increase</th><th>Receipts</th><th>Closing balance</th><th>Headroom</th><th>Status</th><th>First breach marker</th></tr></thead>',
      '<tbody>',
      rows,
      '</tbody></table>',
    ].join('');
  }

  function renderCashTiming(active) {
    const currency = active.assumptions.currency;
    const invoiceRows = active.result.invoiceSchedule.map(function (entry) {
      return '<tr>'
        + '<td><div class="clf-cell-stack"><strong>' + escapeHtml(entry.invoiceDateLabel) + '</strong><small>Week ' + (entry.weekIndex + 1) + '</small></div></td>'
        + '<td>' + escapeHtml(entry.dueDateLabel) + '</td>'
        + '<td>' + escapeHtml(formatMoney(entry.totalGross, currency)) + '</td>'
        + '<td>' + escapeHtml(entry.termLabel) + '</td>'
        + '<td>' + escapeHtml(entry.receiptWeekIndex >= 0 ? ('Week ' + (entry.receiptWeekIndex + 1)) : 'Beyond horizon') + '</td>'
        + '</tr>';
    });
    const manualRows = active.assumptions.receiptLines.map(function (line) {
      return '<tr>'
        + '<td><div class="clf-cell-stack"><strong>' + escapeHtml(Engine.formatLongDate(line.date)) + '</strong><small>Manual receipt</small></div></td>'
        + '<td>Manual input</td>'
        + '<td>' + escapeHtml(formatMoney(line.amount, currency)) + '</td>'
        + '<td>' + escapeHtml(line.note || 'Known receipt') + '</td>'
        + '<td>' + escapeHtml('Mapped by date') + '</td>'
        + '</tr>';
    });
    const rows = invoiceRows.concat(manualRows);
    if (!rows.length) {
      els.cashTimingHost.innerHTML = '<div class="clf-empty">No future invoice or receipt events are currently scheduled inside the forecast window.</div>';
      return;
    }
    els.cashTimingHost.innerHTML = [
      '<table class="clf-table">',
      '<thead><tr><th>Invoice / receipt date</th><th>Expected receipt date</th><th>Gross amount</th><th>Source</th><th>Receipt week</th></tr></thead>',
      '<tbody>',
      rows.join(''),
      '</tbody></table>',
    ].join('');
  }

  function renderCharts(active, compare) {
    els.trajectoryChart.innerHTML = createTrajectorySvg(active.result, compare && compare.result ? compare.result : null, active.assumptions.currency);
    els.headroomChart.innerHTML = createHeadroomSvg(active.result, active.assumptions.currency);
    renderCompareSummary(active, compare);
  }

  function renderHero(active) {
    els.pageStatusBadge.dataset.status = active.result.overallStatus;
    els.pageStatusBadge.textContent = active.result.overallStatusLabel;
    els.heroPeakBalance.textContent = formatMoney(active.result.metrics.forecastPeakBalance, active.assumptions.currency);
    els.heroCapacity.textContent = active.result.capacity.available ? String(active.result.capacity.maxAdditionalContractorsAllowed) : '—';
    els.resultsHeading.textContent = scenarioDisplayName(active) + ' output';
    els.resultsMeta.textContent = (active.assumptions.clientName || 'No client selected')
      + ' • '
      + active.result.overallStatusLabel
      + ' • '
      + active.assumptions.forecastHorizonWeeks
      + ' week horizon';
  }

  function renderResults() {
    const active = getActiveScenario();
    const compare = getCompareScenario();
    if (!active || !active.result) return;
    renderHero(active);
    renderKpis(active);
    renderSummary(active);
    renderAssumptionSnapshot(active);
    renderCharts(active, compare);
    renderSensitivity(active);
    renderForecastTable(active);
    renderCashTiming(active);
  }

  function renderWorkspace() {
    renderScenarioTabs();
    renderCompareSelect();
    renderAssumptionUi();
    renderResults();
    const active = getActiveScenario();
    if (active && active.result) {
      if (active.summary && active.summary.source === 'openai') {
        els.summarySourceChip.dataset.tone = 'ok';
      }
    }
  }

  function addReceiptLine() {
    const active = getActiveScenario();
    if (!active) return;
    active.assumptions.receiptLines.push({
      id: uid('receipt'),
      date: active.assumptions.forecastStartDate,
      amount: 0,
      note: '',
    });
    active.updatedAt = nowIso();
    calculateWorkspace();
    renderWorkspace();
    persistWorkspace();
  }

  function duplicateActiveScenario() {
    const active = getActiveScenario();
    if (!active) return;
    if (state.scenarios.length >= MAX_SCENARIOS) {
      state.helpers.toast.warn('The workspace already has the maximum number of open scenarios.', 2600);
      return;
    }
    const assumptions = cloneScenarioAssumptions(active.assumptions);
    assumptions.scenarioName = scenarioDisplayName(active) + ' copy';
    const duplicate = {
      id: uid('scenario'),
      assumptions: assumptions,
      result: null,
      summary: null,
      updatedAt: nowIso(),
    };
    state.scenarios.push(duplicate);
    state.activeScenarioId = duplicate.id;
    calculateWorkspace();
    applyAssumptionsToForm(duplicate.assumptions);
    renderWorkspace();
    scheduleSummaryRefresh(false);
    persistWorkspace();
  }

  function resetActiveScenario() {
    const active = getActiveScenario();
    if (!active) return;
    active.assumptions = ensureScenarioArrays(Object.assign({}, Engine.DEFAULT_ASSUMPTIONS, {
      scenarioName: scenarioDisplayName(active),
      forecastStartDate: Engine.formatDate(new Date()),
    }));
    active.summary = null;
    active.updatedAt = nowIso();
    calculateWorkspace();
    applyAssumptionsToForm(active.assumptions);
    renderWorkspace();
    scheduleSummaryRefresh(false);
    persistWorkspace();
  }

  function saveActiveScenario() {
    const active = getActiveScenario();
    if (!active) return;
    updateActiveScenarioFromForm();
    calculateWorkspace();
    const snapshot = {
      id: uid('saved-scenario'),
      savedAt: nowIso(),
      assumptions: cloneScenarioAssumptions(active.assumptions),
      overallStatus: active.result ? active.result.overallStatus : 'within_limit',
      peakBalance: active.result ? active.result.metrics.forecastPeakBalance : 0,
      clientName: active.assumptions.clientName || '',
    };
    state.savedLibrary.unshift(snapshot);
    if (state.savedLibrary.length > 30) state.savedLibrary.length = 30;
    persistWorkspace();
    state.helpers.toast.ok('Scenario saved to the local library.', 2200);
    renderScenarioLibrary();
  }

  function openScenarioDialog() {
    renderScenarioLibrary();
    if (typeof els.savedScenarioDialog.showModal === 'function') {
      els.savedScenarioDialog.showModal();
    } else {
      els.savedScenarioDialog.setAttribute('open', 'open');
    }
  }

  function closeScenarioDialog() {
    if (typeof els.savedScenarioDialog.close === 'function') {
      els.savedScenarioDialog.close();
    } else {
      els.savedScenarioDialog.removeAttribute('open');
    }
  }

  function loadSavedScenario(savedId, asNewTab) {
    const saved = state.savedLibrary.find(function (entry) { return entry.id === savedId; });
    if (!saved) return;
    const assumptions = cloneScenarioAssumptions(saved.assumptions);
    if (asNewTab) {
      if (state.scenarios.length >= MAX_SCENARIOS) {
        state.helpers.toast.warn('Close or reset a scenario before loading another one.', 2600);
        return;
      }
      const scenario = {
        id: uid('scenario'),
        assumptions: assumptions,
        result: null,
        summary: null,
        updatedAt: nowIso(),
      };
      state.scenarios.push(scenario);
      state.activeScenarioId = scenario.id;
      applyAssumptionsToForm(scenario.assumptions);
    } else {
      const active = getActiveScenario();
      if (!active) return;
      active.assumptions = assumptions;
      active.summary = null;
      active.updatedAt = nowIso();
      applyAssumptionsToForm(active.assumptions);
    }
    calculateWorkspace();
    renderWorkspace();
    scheduleSummaryRefresh(false);
    persistWorkspace();
    closeScenarioDialog();
  }

  function deleteSavedScenario(savedId) {
    state.savedLibrary = state.savedLibrary.filter(function (entry) { return entry.id !== savedId; });
    persistWorkspace();
    renderScenarioLibrary();
  }

  function renderScenarioLibrary() {
    if (!state.savedLibrary.length) {
      els.savedScenarioList.innerHTML = '<div class="clf-empty">No saved scenarios yet. Save the active scenario to keep a local library of reusable client forecasts.</div>';
      return;
    }
    els.savedScenarioList.innerHTML = state.savedLibrary.map(function (entry) {
      return '<article class="clf-library-item">'
        + '<div class="clf-card-head"><div><p class="clf-kicker">Saved scenario</p><h3>' + escapeHtml(entry.assumptions.scenarioName || 'Scenario') + '</h3></div>'
        + '<span class="clf-status-badge" data-status="' + escapeAttr(entry.overallStatus || 'within_limit') + '">' + escapeHtml(Engine.STATUS_LABELS[entry.overallStatus] || 'Saved') + '</span></div>'
        + '<div class="clf-library-meta"><span>' + escapeHtml(entry.clientName || 'Unnamed client') + '</span><span>Saved ' + escapeHtml(new Date(entry.savedAt).toLocaleString('en-GB')) + '</span><span>Peak ' + escapeHtml(formatMoney(entry.peakBalance || 0, entry.assumptions.currency || 'GBP')) + '</span></div>'
        + '<div class="clf-library-actions">'
        + '<button class="clf-btn clf-btn-primary" type="button" data-load-saved="' + escapeAttr(entry.id) + '">Load into current tab</button>'
        + '<button class="clf-btn clf-btn-secondary" type="button" data-load-saved-new="' + escapeAttr(entry.id) + '">Load as new tab</button>'
        + '<button class="clf-btn clf-btn-danger" type="button" data-delete-saved="' + escapeAttr(entry.id) + '">Delete</button>'
        + '</div>'
        + '</article>';
    }).join('');
  }

  function exportForecastCsv() {
    const active = getActiveScenario();
    if (!active || !active.result) return;
    const headers = [
      'Scenario',
      'Client',
      'Week Number',
      'Week Commencing',
      'Week Ending',
      'Invoice Dates',
      'Invoice Count',
      'Opening Balance',
      'Base Invoice Increase',
      'Scenario Invoice Increase',
      'Receipts',
      'Closing Balance',
      'Headroom',
      'Status',
      'Breach Date',
    ];
    const lines = [headers.join(',')].concat(active.result.weeks.map(function (row) {
      return [
        csvEscape(scenarioDisplayName(active)),
        csvEscape(active.assumptions.clientName || ''),
        row.weekNumber,
        csvEscape(row.weekCommencing),
        csvEscape(row.weekEnding),
        csvEscape(row.invoiceDates.join(' | ')),
        row.invoiceCount,
        row.openingBalance,
        row.baseInvoiceIncrease,
        row.scenarioInvoiceIncrease,
        row.receipts,
        row.closingBalance,
        row.headroom,
        csvEscape(row.statusLabel),
        csvEscape(row.breachDate || ''),
      ].join(',');
    }));
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }), 'credit-limit-forecast.csv');
  }

  function exportForecastXlsx() {
    const active = getActiveScenario();
    if (!active || !active.result) return;
    const assumptions = active.assumptions;
    const rows = active.result.weeks.map(function (row) {
      return '<tr>'
        + '<td>' + escapeHtml(String(row.weekNumber)) + '</td>'
        + '<td>' + escapeHtml(row.weekCommencing) + '</td>'
        + '<td>' + escapeHtml(row.weekEnding) + '</td>'
        + '<td>' + escapeHtml(row.invoiceDates.join(' | ')) + '</td>'
        + '<td>' + escapeHtml(String(row.invoiceCount)) + '</td>'
        + '<td>' + escapeHtml(String(row.openingBalance)) + '</td>'
        + '<td>' + escapeHtml(String(row.baseInvoiceIncrease)) + '</td>'
        + '<td>' + escapeHtml(String(row.scenarioInvoiceIncrease)) + '</td>'
        + '<td>' + escapeHtml(String(row.receipts)) + '</td>'
        + '<td>' + escapeHtml(String(row.closingBalance)) + '</td>'
        + '<td>' + escapeHtml(String(row.headroom)) + '</td>'
        + '<td>' + escapeHtml(row.statusLabel) + '</td>'
        + '</tr>';
    }).join('');
    const html = [
      '<!doctype html><html><head><meta charset="utf-8"/></head><body>',
      '<table><tbody>',
      '<tr><th>Client</th><td>' + escapeHtml(assumptions.clientName || '') + '</td></tr>',
      '<tr><th>Scenario</th><td>' + escapeHtml(scenarioDisplayName(active)) + '</td></tr>',
      '<tr><th>Currency</th><td>' + escapeHtml(assumptions.currency) + '</td></tr>',
      '<tr><th>Credit limit</th><td>' + escapeHtml(String(assumptions.creditLimit)) + '</td></tr>',
      '<tr><th>Current outstanding balance</th><td>' + escapeHtml(String(assumptions.currentOutstandingBalance)) + '</td></tr>',
      '</tbody></table>',
      '<br/>',
      '<table><thead><tr><th>Week</th><th>Week Commencing</th><th>Week Ending</th><th>Invoice Dates</th><th>Invoice Count</th><th>Opening Balance</th><th>Base Invoice Increase</th><th>Scenario Invoice Increase</th><th>Receipts</th><th>Closing Balance</th><th>Headroom</th><th>Status</th></tr></thead><tbody>',
      rows,
      '</tbody></table>',
      '</body></html>',
    ].join('');
    downloadBlob(new Blob([html], { type: 'application/vnd.ms-excel' }), 'credit-limit-forecast.xlsx');
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

  function scheduleSummaryRefresh(force) {
    const active = getActiveScenario();
    if (!active || !active.result) return;
    if (!force && active.summary && active.summary.source === 'openai') return;
    window.clearTimeout(state.summaryTimer);
    state.summaryTimer = window.setTimeout(function () {
      refreshActiveSummary(force);
    }, force ? 0 : 1200);
  }

  async function refreshActiveSummary(force) {
    const active = getActiveScenario();
    if (!active || !active.result) return;
    const signature = buildScenarioSignature(active.assumptions);
    if (!force && active.summary && active.summary.source === 'openai' && active.summary.signature === signature) {
      return;
    }

    const token = ++state.summaryToken;
    els.summaryLoader.style.display = '';
    active.summary = {
      text: active.result.fallbackSummary,
      source: 'fallback',
      error: '',
      signature: signature,
    };
    renderSummary(active);
    persistWorkspace();

    try {
      const response = await state.helpers.api('admin-credit-limit-summary', 'POST', {
        assumptions: active.assumptions,
      });
      if (token !== state.summaryToken) return;
      active.summary = {
        text: response.summary || active.result.fallbackSummary,
        source: response.source === 'openai' ? 'openai' : 'fallback',
        error: response.error || '',
        signature: signature,
      };
      renderSummary(active);
      persistWorkspace();
    } catch (error) {
      if (token !== state.summaryToken) return;
      active.summary = {
        text: active.result.fallbackSummary,
        source: 'fallback',
        error: error && error.message ? error.message : 'summary_failed',
        signature: signature,
      };
      renderSummary(active);
      persistWorkspace();
    } finally {
      if (token === state.summaryToken) {
        els.summaryLoader.style.display = 'none';
      }
    }
  }

  async function fetchClients() {
    try {
      const response = await state.helpers.api('admin-clients-list', 'POST', { q: null });
      const rows = Array.isArray(response) ? response : Array.isArray(response && response.rows) ? response.rows : [];
      els.clientNames.innerHTML = rows.map(function (row) {
        return '<option value="' + escapeAttr(row.name || '') + '"></option>';
      }).join('');
    } catch (error) {
      console.warn('[HMJ Credit Limit Forecaster] Client datalist unavailable', error);
    }
  }

  function expandAll(open) {
    Array.from(document.querySelectorAll('.clf-assumption-group')).forEach(function (node) {
      node.open = !!open;
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/'/g, '&#39;');
  }

  function csvEscape(value) {
    return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  }

  function handleFormEvent(event) {
    if (state.isApplyingForm) return;
    const target = event.target;
    if (!target) return;

    if (target.hasAttribute('data-invoice-count-index')) {
      const active = getActiveScenario();
      if (!active) return;
      const index = Number(target.getAttribute('data-invoice-count-index'));
      const value = target.value === '' ? null : Math.max(0, Math.round(Number(target.value) || 0));
      active.assumptions.invoice.manualEventCounts[index] = value;
      active.updatedAt = nowIso();
      calculateWorkspace();
      renderWorkspace();
      scheduleSummaryRefresh(false);
      return;
    }

    if (target.hasAttribute('data-receipt-index')) {
      const active = getActiveScenario();
      if (!active) return;
      const index = Number(target.getAttribute('data-receipt-index'));
      const key = target.getAttribute('data-receipt-key');
      const line = active.assumptions.receiptLines[index];
      if (!line) return;
      if (key === 'amount') line.amount = Number(target.value) || 0;
      if (key === 'date') line.date = target.value || active.assumptions.forecastStartDate;
      if (key === 'note') line.note = String(target.value || '').trim();
      active.updatedAt = nowIso();
      calculateWorkspace();
      renderWorkspace();
      scheduleSummaryRefresh(false);
      return;
    }

    if (target.hasAttribute('data-adjustment-index')) {
      const active = getActiveScenario();
      if (!active) return;
      const index = Number(target.getAttribute('data-adjustment-index'));
      if (!active.assumptions.receiptWeekAdjustments[index]) {
        active.assumptions.receiptWeekAdjustments[index] = { weekIndex: index, amount: 0, note: '' };
      }
      active.assumptions.receiptWeekAdjustments[index].amount = Number(target.value) || 0;
      active.updatedAt = nowIso();
      calculateWorkspace();
      renderWorkspace();
      scheduleSummaryRefresh(false);
      return;
    }

    scheduleRecalc(120);
  }

  function bindStaticActions() {
    els.forecastForm.addEventListener('input', handleFormEvent);
    els.forecastForm.addEventListener('change', handleFormEvent);

    els.receiptLinesHost.addEventListener('click', function (event) {
      const trigger = event.target.closest('[data-remove-receipt-index]');
      if (!trigger) return;
      const active = getActiveScenario();
      if (!active) return;
      const index = Number(trigger.getAttribute('data-remove-receipt-index'));
      active.assumptions.receiptLines.splice(index, 1);
      active.updatedAt = nowIso();
      calculateWorkspace();
      renderWorkspace();
      scheduleSummaryRefresh(false);
    });

    els.compareScenarioSelect.addEventListener('change', function () {
      state.compareScenarioId = els.compareScenarioSelect.value || '';
      if (state.compareScenarioId === state.activeScenarioId) {
        state.compareScenarioId = '';
      }
      renderWorkspace();
      persistWorkspace();
    });

    els.btnCalculate.addEventListener('click', function () {
      updateActiveScenarioFromForm();
      calculateWorkspace();
      renderWorkspace();
      scheduleSummaryRefresh(true);
      state.helpers.toast.ok('Forecast recalculated.', 1800);
    });
    els.btnRefreshSummary.addEventListener('click', function () {
      scheduleSummaryRefresh(true);
    });
    els.btnPrint.addEventListener('click', function () {
      window.print();
    });
    els.btnExportCsv.addEventListener('click', exportForecastCsv);
    els.btnExportXlsx.addEventListener('click', exportForecastXlsx);
    els.btnLoadScenario.addEventListener('click', openScenarioDialog);
    els.btnDuplicateScenario.addEventListener('click', duplicateActiveScenario);
    els.btnSaveScenario.addEventListener('click', saveActiveScenario);
    els.btnResetScenario.addEventListener('click', resetActiveScenario);
    els.btnExpandAll.addEventListener('click', function () { expandAll(true); });
    els.btnCollapseAll.addEventListener('click', function () { expandAll(false); });
    els.btnAddReceiptLine.addEventListener('click', addReceiptLine);
    els.btnCloseScenarioDialog.addEventListener('click', closeScenarioDialog);
    els.savedScenarioList.addEventListener('click', function (event) {
      const load = event.target.closest('[data-load-saved]');
      if (load) {
        loadSavedScenario(load.getAttribute('data-load-saved'), false);
        return;
      }
      const loadNew = event.target.closest('[data-load-saved-new]');
      if (loadNew) {
        loadSavedScenario(loadNew.getAttribute('data-load-saved-new'), true);
        return;
      }
      const remove = event.target.closest('[data-delete-saved]');
      if (remove) {
        deleteSavedScenario(remove.getAttribute('data-delete-saved'));
      }
    });
    els.savedScenarioDialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      closeScenarioDialog();
    });
  }

  function start() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      window.setTimeout(start, 40);
      return;
    }

    window.Admin.bootAdmin(async function (helpers) {
      setupElements();
      state.helpers = helpers;
      hydrateWorkspace();
      bindStaticActions();

      try {
        state.user = await helpers.identity('admin');
        if (state.user && state.user.email) {
          els.userMetaChip.textContent = state.user.email;
        } else {
          els.userMetaChip.textContent = 'HMJ admin';
        }
      } catch {
        els.userMetaChip.textContent = 'HMJ admin';
      }

      const active = getActiveScenario();
      if (active) {
        applyAssumptionsToForm(active.assumptions);
      }
      calculateWorkspace();
      renderWorkspace();
      fetchClients();
      scheduleSummaryRefresh(false);
    });
  }

  start();
})();
