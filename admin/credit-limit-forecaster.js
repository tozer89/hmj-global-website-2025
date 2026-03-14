(function () {
  'use strict';

  const Engine = window.HMJCreditLimitForecast;
  const StatementImport = window.HMJCreditLimitStatementImport;
  if (!Engine) {
    console.error('[HMJ Credit Limit Forecaster] Forecast engine not loaded.');
    return;
  }
  if (!StatementImport) {
    console.error('[HMJ Credit Limit Forecaster] Statement import helper not loaded.');
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
    inputDensity: 'basic',
    isApplyingForm: false,
    recalcTimer: null,
    summaryTimer: null,
    summaryToken: 0,
    user: null,
    statementDrafts: {},
    statementImportTask: {
      scenarioId: '',
      busy: false,
      stage: '',
      message: '',
      token: 0,
    },
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
      'btnBasicMode',
      'btnAdvancedMode',
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
      'validationHost',
      'setupGuideHost',
      'activeDriverLabel',
      'advancedPanel',
      'clientName',
      'scenarioName',
      'currency',
      'creditLimit',
      'currentOutstandingBalance',
      'forecastStartDate',
      'forecastHorizonWeeks',
      'openingBalanceReceiptMode',
      'openingBalanceRunoffWeeks',
      'openingBalancePreview',
      'openingBalanceImportHost',
      'statementUploadInput',
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
      'resultsNoticeHost',
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
    return Engine.cloneJson(ensureScenarioArrays(assumptions));
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
      compareScenarioId: '',
    };
  }

  function ensureScenarioArrays(input) {
    const source = input && typeof input === 'object' ? input : {};
    const assumptions = normaliseScenarioAssumptions(source);
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

    const receiptLines = Array.isArray(source.receiptLines)
      ? source.receiptLines
      : Array.isArray(assumptions.receiptLines)
        ? assumptions.receiptLines
        : [];
    assumptions.receiptLines = receiptLines.map(function (line, index) {
        return {
          id: String((line && line.id) || uid('receipt') + '-' + index),
          date: Engine.formatDate(line && line.date ? line.date : assumptions.forecastStartDate),
          amount: Number(line && line.amount) || 0,
          note: String(line && line.note || '').trim(),
        };
      });

    return assumptions;
  }

  function buildScenarioSignature(assumptions) {
    return JSON.stringify(buildCalculationPayload(assumptions));
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

  function getStatementDraft(scenarioId) {
    const key = String(scenarioId || '');
    return key ? state.statementDrafts[key] || null : null;
  }

  function setStatementDraft(scenarioId, draft) {
    const key = String(scenarioId || '');
    if (!key) return;
    if (!draft) {
      delete state.statementDrafts[key];
      return;
    }
    state.statementDrafts[key] = StatementImport.materialiseImportedStatement(draft, {
      scenarioCurrency: getScenarioById(key) && getScenarioById(key).assumptions
        ? getScenarioById(key).assumptions.currency
        : 'GBP',
      paymentTerms: getScenarioById(key) && getScenarioById(key).assumptions
        ? getScenarioById(key).assumptions.paymentTerms
        : Engine.DEFAULT_ASSUMPTIONS.paymentTerms,
      forecastStartDate: getScenarioById(key) && getScenarioById(key).assumptions
        ? getScenarioById(key).assumptions.forecastStartDate
        : Engine.DEFAULT_ASSUMPTIONS.forecastStartDate,
    });
  }

  function clearStatementDraft(scenarioId) {
    const key = String(scenarioId || '');
    if (!key) return;
    delete state.statementDrafts[key];
  }

  function activeImportedStatement(assumptions) {
    return assumptions
      && assumptions.openingBalance
      && assumptions.openingBalance.importedStatement
      && assumptions.openingBalance.importedStatement.status === 'confirmed'
      && Array.isArray(assumptions.openingBalance.importedStatement.rows)
      && assumptions.openingBalance.importedStatement.rows.length
      ? assumptions.openingBalance.importedStatement
      : null;
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

  function normaliseGrowthMode(value) {
    return String(value || '').trim() === 'direct' ? 'direct' : 'contractor';
  }

  function modeLabel(mode) {
    return normaliseGrowthMode(mode) === 'direct' ? 'Direct weekly uplift' : 'Contractor mode';
  }

  function openingBalanceModeLabel(mode) {
    return Engine.OPENING_BALANCE_MODE_LABELS[mode] || Engine.OPENING_BALANCE_MODE_LABELS.term_profile;
  }

  function reconciliationModeLabel(mode) {
    return Engine.OPENING_BALANCE_RECONCILIATION_LABELS[mode]
      || Engine.OPENING_BALANCE_RECONCILIATION_LABELS.keep_manual_opening_balance;
  }

  function statementConfidenceLabel(level) {
    if (level === 'high') return 'High confidence';
    if (level === 'medium') return 'Needs review';
    if (level === 'low') return 'Low confidence';
    return 'Draft';
  }

  function statementConfidenceTone(level) {
    if (level === 'high') return 'ok';
    if (level === 'medium') return 'warn';
    if (level === 'low') return 'danger';
    return 'neutral';
  }

  function statementSummary(statement, openingBalance, currency) {
    if (!statement) return 'No imported statement confirmed';
    const reconciliation = StatementImport.buildReconciliationSummary(statement, openingBalance);
    return (statement.fileName || 'Imported statement')
      + ' • '
      + statement.includedRowCount
      + ' included row'
      + (statement.includedRowCount === 1 ? '' : 's')
      + ' • '
      + formatMoney(statement.importedTotal, currency)
      + ' • '
      + reconciliationModeLabel(reconciliation.reconciliationMode);
  }

  function hasDirectInputs(assumptions) {
    const direct = assumptions && assumptions.direct ? assumptions.direct : {};
    return [
      direct.baseWeeklyNet,
      direct.baseWeeklyGross,
      direct.scenarioWeeklyNet,
      direct.scenarioWeeklyGross,
    ].some(function (value) {
      return Number(value) > 0;
    });
  }

  function hasContractorInputs(assumptions) {
    const contractor = assumptions && assumptions.contractor ? assumptions.contractor : {};
    return [
      contractor.currentContractors,
      contractor.additionalContractors,
      contractor.weeklyPayPerContractor,
      contractor.hourlyWage,
      contractor.perContractorNetInvoice,
      contractor.perContractorGrossInvoice,
    ].some(function (value) {
      return Number(value) > 0;
    });
  }

  function normaliseScenarioAssumptions(input) {
    const assumptions = Engine.sanitizeAssumptions(input || {});
    if (assumptions.growthMode === 'combined') {
      assumptions.growthMode = hasContractorInputs(assumptions)
        ? 'contractor'
        : (hasDirectInputs(assumptions) ? 'direct' : 'contractor');
    } else {
      assumptions.growthMode = normaliseGrowthMode(assumptions.growthMode);
    }
    return assumptions;
  }

  function buildCalculationPayload(input) {
    const assumptions = ensureScenarioArrays(input);
    const payload = Engine.cloneJson(assumptions);
    payload.growthMode = normaliseGrowthMode(payload.growthMode);
    if (payload.growthMode === 'contractor') {
      payload.direct = {
        baseWeeklyNet: 0,
        baseWeeklyGross: 0,
        scenarioWeeklyNet: 0,
        scenarioWeeklyGross: 0,
      };
    } else {
      payload.contractor = {
        currentContractors: 0,
        additionalContractors: 0,
        weeklyPayPerContractor: 0,
        hourlyWage: 0,
        weeklyHours: payload.contractor && payload.contractor.weeklyHours
          ? Number(payload.contractor.weeklyHours)
          : Engine.DEFAULT_ASSUMPTIONS.contractor.weeklyHours,
        marginPercent: 0,
        perContractorNetInvoice: 0,
        perContractorGrossInvoice: 0,
      };
    }
    return Engine.sanitizeAssumptions(payload);
  }

  function countAdvancedOverrides(assumptions) {
    if (!assumptions) return 0;
    let count = 0;
    if (Number(assumptions.paymentTerms && assumptions.paymentTerms.receiptLagDays) > 0) count += 1;
    if ((assumptions.invoice && assumptions.invoice.cadence) === 'monthly') count += 1;
    if (Number(assumptions.invoice && assumptions.invoice.invoiceWeekday) !== 2) count += 1;
    if (assumptions.invoice && assumptions.invoice.autoCountDates === false) count += 1;
    if (Array.isArray(assumptions.invoice && assumptions.invoice.manualEventCounts)
      && assumptions.invoice.manualEventCounts.some(function (value) { return value != null; })) count += 1;
    if (assumptions.openingBalance && assumptions.openingBalance.receiptMode === 'manual'
      && Array.isArray(assumptions.receiptLines) && assumptions.receiptLines.length) count += 1;
    if (assumptions.openingBalance
      && assumptions.openingBalance.receiptMode === 'import_statement'
      && assumptions.openingBalance.importedStatement
      && assumptions.openingBalance.importedStatement.status === 'confirmed'
      && assumptions.openingBalance.importedStatement.reconciliationMode !== 'keep_manual_opening_balance') count += 1;
    if (assumptions.openingBalance
      && assumptions.openingBalance.importedStatement
      && Number(assumptions.openingBalance.importedStatement.overdueCollectionDays) !== Number(Engine.DEFAULT_ASSUMPTIONS.openingBalance.importedStatement.overdueCollectionDays)) count += 1;
    if (Array.isArray(assumptions.receiptWeekAdjustments)
      && assumptions.receiptWeekAdjustments.some(function (entry) { return Number(entry && entry.amount) !== 0; })) count += 1;
    if (String(assumptions.notes || '').trim()) count += 1;
    if (assumptions.forecastStartDate && assumptions.forecastStartDate !== Engine.DEFAULT_ASSUMPTIONS.forecastStartDate) count += 1;
    if (Number(assumptions.riskThresholdPercent) !== Number(Engine.DEFAULT_ASSUMPTIONS.riskThresholdPercent)) count += 1;
    return count;
  }

  function contractorValueSource(assumptions) {
    const contractor = assumptions && assumptions.contractor ? assumptions.contractor : {};
    if (Number(contractor.perContractorGrossInvoice) > 0 || Number(contractor.perContractorNetInvoice) > 0) {
      return 'Per-contractor invoice value';
    }
    if (Number(contractor.hourlyWage) > 0) {
      return 'Hourly wage and weekly hours';
    }
    if (Number(contractor.weeklyPayPerContractor) > 0) {
      return 'Weekly pay and margin';
    }
    return 'No contractor value entered';
  }

  function directValueSource(assumptions) {
    const direct = assumptions && assumptions.direct ? assumptions.direct : {};
    if (Number(direct.scenarioWeeklyGross) > 0) return 'Weekly gross uplift';
    if (Number(direct.scenarioWeeklyNet) > 0) return 'Weekly net uplift';
    if (Number(direct.baseWeeklyGross) > 0 || Number(direct.baseWeeklyNet) > 0) return 'Base weekly uplift only';
    return 'No uplift entered';
  }

  function openingBalanceModeSummary(assumptions) {
    const openingBalance = assumptions && assumptions.openingBalance ? assumptions.openingBalance : Engine.DEFAULT_ASSUMPTIONS.openingBalance;
    const mode = openingBalance.receiptMode || Engine.DEFAULT_ASSUMPTIONS.openingBalance.receiptMode;
    const imported = activeImportedStatement(assumptions);
    if (mode === 'manual') {
      const count = Array.isArray(assumptions && assumptions.receiptLines) ? assumptions.receiptLines.length : 0;
      return count
        ? ('Manual opening-balance receipts • ' + count + ' line' + (count === 1 ? '' : 's'))
        : 'Manual opening-balance receipts';
    }
    if (mode === 'even_runoff') {
      const weeks = Number(openingBalance.runoffWeeks) || Engine.DEFAULT_ASSUMPTIONS.openingBalance.runoffWeeks;
      return 'Even runoff across ' + weeks + ' week' + (weeks === 1 ? '' : 's');
    }
    if (mode === 'import_statement') {
      return imported
        ? ('Imported statement • ' + imported.includedRowCount + ' row' + (imported.includedRowCount === 1 ? '' : 's'))
        : 'Imported statement';
    }
    return openingBalanceModeLabel(mode);
  }

  function buildScenarioSummary(assumptions, result) {
    const raw = ensureScenarioArrays(assumptions);
    const payload = buildCalculationPayload(raw);
    const derived = result && result.derived ? result.derived : Engine.deriveRunRateComponents(payload);
    const manualReceiptCount = Array.isArray(raw.receiptLines) ? raw.receiptLines.length : 0;
    const weeklyAdjustments = Array.isArray(raw.receiptWeekAdjustments)
      ? raw.receiptWeekAdjustments.filter(function (entry) { return Number(entry && entry.amount) !== 0; }).length
      : 0;
    const activeMode = normaliseGrowthMode(raw.growthMode);
    const advancedOverrideCount = countAdvancedOverrides(raw);
    const activeGrowthSource = activeMode === 'contractor'
      ? contractorValueSource(raw)
      : directValueSource(raw);
    const importedStatement = activeImportedStatement(raw);
    return {
      activeMode: activeMode,
      activeModeLabel: modeLabel(activeMode),
      activeGrowthSource: activeGrowthSource,
      termLabel: Engine.TERM_LABELS[raw.paymentTerms.type] || raw.paymentTerms.type,
      vatLabel: raw.vatApplicable ? ('VAT on at ' + raw.vatRate + '%') : 'VAT off',
      openingBalanceMode: raw.openingBalance.receiptMode,
      openingBalanceModeLabel: openingBalanceModeLabel(raw.openingBalance.receiptMode),
      openingBalanceSummary: openingBalanceModeSummary(raw),
      openingBalanceManualReceiptCount: manualReceiptCount,
      activeOpeningBalanceManualReceiptCount: raw.openingBalance.receiptMode === 'manual' ? manualReceiptCount : 0,
      importedStatement: importedStatement,
      importedStatementRowCount: importedStatement ? importedStatement.includedRowCount : 0,
      importedStatementTotal: importedStatement ? importedStatement.importedTotal : 0,
      importedStatementConfidence: importedStatement ? importedStatement.confidence : '',
      importedStatementReconciliationMode: importedStatement ? importedStatement.reconciliationMode : '',
      manualReceiptCount: manualReceiptCount,
      weeklyAdjustmentCount: weeklyAdjustments,
      advancedOverrideCount: advancedOverrideCount,
      advancedOverridesActive: advancedOverrideCount > 0,
      compareLoaded: !!getCompareScenario(),
      compareLabel: getCompareScenario() ? scenarioDisplayName(getCompareScenario()) : 'No comparison loaded',
      invoiceCadenceLabel: payload.invoice.cadence === 'monthly' ? 'Monthly' : 'Weekly',
      invoiceWeekdayLabel: Engine.weekdayLabel(payload.invoice.invoiceWeekday),
      totalBaseGross: derived.totalBaseGross,
      totalScenarioGross: derived.totalScenarioGross,
      capacityUnitGross: derived.capacityUnitGross,
      zeroGrowth: derived.totalBaseGross === 0 && derived.totalScenarioGross === 0,
      noOpeningBalanceReceipts: Number(raw.currentOutstandingBalance) > 0 && raw.openingBalance.receiptMode === 'no_receipts',
      raw: raw,
      payload: payload,
      derived: derived,
    };
  }

  function buildValidationState(target) {
    const scenario = target && target.assumptions ? target : { id: '', assumptions: target };
    const summary = buildScenarioSummary(scenario.assumptions);
    const statementDraft = getStatementDraft(scenario.id);
    const blocking = [];
    const warnings = [];

    if (!String(els.creditLimit && els.creditLimit.value || '').trim()) {
      blocking.push('Enter the client credit limit before calculating.');
    } else if (Number(summary.raw.creditLimit) <= 0) {
      blocking.push('Credit limit must be greater than zero for an insured-limit forecast.');
    }
    if (!String(els.currentOutstandingBalance && els.currentOutstandingBalance.value || '').trim()) {
      blocking.push('Enter the current outstanding balance so the forecast has a starting point.');
    }
    if (summary.raw.paymentTerms.type === 'custom_net' && !String(els.customNetDays && els.customNetDays.value || '').trim()) {
      blocking.push('Enter the custom net days for the selected payment terms.');
    }
    if (summary.raw.openingBalance.receiptMode === 'even_runoff' && Number(summary.raw.openingBalance.runoffWeeks) <= 0) {
      blocking.push('Enter the number of weeks for the opening-balance runoff assumption.');
    }
    if (summary.raw.openingBalance.receiptMode === 'import_statement') {
      if (!summary.importedStatement && !statementDraft) {
        blocking.push('Upload a debtor statement and confirm the imported rows before calculating in Import statement mode.');
      } else if (statementDraft && !summary.importedStatement) {
        blocking.push('Review the imported statement rows and click Use imported statement before calculating.');
      }
    }
    if (summary.activeMode === 'contractor') {
      const hasHeadcount = Number(summary.raw.contractor.currentContractors) > 0 || Number(summary.raw.contractor.additionalContractors) > 0;
      const hasValue = summary.capacityUnitGross > 0;
      if (hasHeadcount && !hasValue) {
        blocking.push('Add weekly pay, hourly rate, or a per-contractor invoice value so contractor mode has a weekly value to model.');
      }
    }
    if (summary.zeroGrowth) {
      warnings.push('No weekly growth input is currently active, so balances remain flat unless opening-balance collections or manual receipt adjustments reduce the ledger.');
    }
    if (summary.noOpeningBalanceReceipts) {
      warnings.push('No receipt schedule has been applied to the opening balance, so the starting receivables will remain in place unless opening-balance collections are added manually or estimated.');
    }
    if (summary.raw.openingBalance.receiptMode === 'manual'
      && Number(summary.raw.currentOutstandingBalance) > 0
      && summary.manualReceiptCount === 0) {
      warnings.push('Manual opening-balance mode is selected, but no dated opening-balance receipts have been entered yet.');
    }
    if (summary.raw.openingBalance.receiptMode === 'import_statement' && summary.importedStatement) {
      const reconciliation = StatementImport.buildReconciliationSummary(
        summary.importedStatement,
        summary.raw.currentOutstandingBalance
      );
      if (!reconciliation.matches) {
        warnings.push('Imported statement total does not match the entered opening balance. Check the reconciliation choice before sharing the result.');
      }
      if (summary.importedStatement.creditNoteCount) {
        warnings.push(summary.importedStatement.creditNoteCount + ' credit note or negative-balance row' + (summary.importedStatement.creditNoteCount === 1 ? '' : 's') + ' will stay in the imported opening total but will not be treated as future cash receipts.');
      }
    }
    if (summary.raw.paymentTerms.receiptLagDays > 0) {
      warnings.push('Receipt lag override is active, so receipt timing will differ from the default payment-term schedule.');
    }

    return {
      canCalculate: blocking.length === 0,
      blocking: blocking,
      warnings: warnings,
      summary: summary,
    };
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
    assumptions.openingBalance = assumptions.openingBalance || {};
    assumptions.openingBalance.receiptMode = els.openingBalanceReceiptMode.value || Engine.DEFAULT_ASSUMPTIONS.openingBalance.receiptMode;
    assumptions.openingBalance.runoffWeeks = Number(els.openingBalanceRunoffWeeks.value) || Engine.DEFAULT_ASSUMPTIONS.openingBalance.runoffWeeks;
    assumptions.growthMode = normaliseGrowthMode(els.growthMode.value || 'contractor');
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
    els.openingBalanceReceiptMode.value = (scenario.openingBalance && scenario.openingBalance.receiptMode) || Engine.DEFAULT_ASSUMPTIONS.openingBalance.receiptMode;
    els.openingBalanceRunoffWeeks.value = (scenario.openingBalance && scenario.openingBalance.runoffWeeks) || Engine.DEFAULT_ASSUMPTIONS.openingBalance.runoffWeeks;
    els.growthMode.value = normaliseGrowthMode(scenario.growthMode || 'contractor');
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
    updatePaymentTermsUi();
    updateOpeningBalanceUi();
    updateVatUi();
    applyGrowthModeUi(els.growthMode.value);
    state.isApplyingForm = false;
  }

  function updateActiveScenarioFromForm() {
    const active = getActiveScenario();
    if (!active) return;
    active.assumptions = readAssumptionsFromForm(active.assumptions);
    if (getStatementDraft(active.id)) {
      setStatementDraft(active.id, getStatementDraft(active.id));
    }
    active.updatedAt = nowIso();
  }

  function calculateScenario(scenario) {
    scenario.assumptions = ensureScenarioArrays(scenario.assumptions);
    scenario.calculationAssumptions = buildCalculationPayload(scenario.assumptions);
    const result = Engine.buildForecast(scenario.calculationAssumptions);
    const capacity = Engine.analyseCapacity(scenario.calculationAssumptions);
    result.capacity = capacity;
    result.fallbackSummary = Engine.generateFallbackSummary(result, scenario.calculationAssumptions, capacity);
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
      const active = getActiveScenario();
      const validation = active ? buildValidationState(active) : { canCalculate: true };
      if (validation.canCalculate) {
        calculateWorkspace();
      } else {
        persistWorkspace();
      }
      renderWorkspace();
      if (validation.canCalculate) {
        scheduleSummaryRefresh(false);
      }
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
    const options = ['<option value="">No comparison loaded</option>'].concat(
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

  function setInputDensity(mode) {
    state.inputDensity = mode === 'advanced' ? 'advanced' : 'basic';
    document.body.dataset.inputDensity = state.inputDensity;
    if (els.btnBasicMode) {
      els.btnBasicMode.classList.toggle('is-active', state.inputDensity === 'basic');
      els.btnBasicMode.setAttribute('aria-pressed', state.inputDensity === 'basic' ? 'true' : 'false');
    }
    if (els.btnAdvancedMode) {
      els.btnAdvancedMode.classList.toggle('is-active', state.inputDensity === 'advanced');
      els.btnAdvancedMode.setAttribute('aria-pressed', state.inputDensity === 'advanced' ? 'true' : 'false');
    }
    Array.from(document.querySelectorAll('.clf-advanced-only')).forEach(function (node) {
      node.hidden = state.inputDensity !== 'advanced';
    });
  }

  function updatePaymentTermsUi() {
    const isCustom = els.paymentTermsType.value === 'custom_net';
    const host = document.querySelector('[data-custom-terms-field]');
    if (host) {
      host.hidden = !isCustom;
      host.classList.toggle('is-disabled', !isCustom);
    }
    els.customNetDays.disabled = !isCustom;
  }

  function updateOpeningBalanceUi() {
    const mode = els.openingBalanceReceiptMode.value || Engine.DEFAULT_ASSUMPTIONS.openingBalance.receiptMode;
    const runoffField = document.getElementById('openingBalanceRunoffField');
    const isRunoff = mode === 'even_runoff';
    if (runoffField) {
      runoffField.hidden = !isRunoff;
      runoffField.classList.toggle('is-disabled', !isRunoff);
    }
    if (els.openingBalanceRunoffWeeks) {
      els.openingBalanceRunoffWeeks.disabled = !isRunoff;
    }
    if (els.btnAddReceiptLine) {
      els.btnAddReceiptLine.disabled = mode !== 'manual';
    }
    if (els.openingBalanceImportHost) {
      els.openingBalanceImportHost.style.display = mode === 'import_statement' ? '' : 'none';
    }
  }

  function updateVatUi() {
    const vatOn = !!els.vatApplicable.checked;
    els.vatRate.disabled = !vatOn;
    const host = els.vatRate.closest('.clf-field');
    if (host) host.classList.toggle('is-disabled', !vatOn);
  }

  function applyGrowthModeUi(mode) {
    const activeMode = normaliseGrowthMode(mode || els.growthMode.value);
    els.growthMode.value = activeMode;
    if (els.activeDriverLabel) {
      els.activeDriverLabel.textContent = modeLabel(activeMode);
    }

    Array.from(document.querySelectorAll('[data-growth-mode]')).forEach(function (node) {
      const isActive = node.getAttribute('data-growth-mode') === activeMode;
      node.classList.toggle('is-active', isActive);
      node.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    Array.from(document.querySelectorAll('[data-mode-panel]')).forEach(function (panel) {
      const isActive = panel.getAttribute('data-mode-panel') === activeMode;
      panel.classList.toggle('is-active', isActive);
      panel.classList.toggle('is-inactive', !isActive);
      const chip = panel.querySelector('[data-mode-state]');
      if (chip) {
        chip.textContent = isActive ? 'Active' : 'Inactive';
        chip.dataset.tone = isActive ? 'ok' : 'neutral';
      }
      Array.from(panel.querySelectorAll('input, select, textarea')).forEach(function (control) {
        control.disabled = !isActive;
      });
    });
  }

  function renderValidation(active) {
    const validation = buildValidationState(active);
    const cards = [];
    validation.blocking.forEach(function (message) {
      cards.push('<div class="clf-alert" data-tone="danger"><strong>Complete this before calculating</strong><span>'
        + escapeHtml(message) + '</span></div>');
    });
    validation.warnings.forEach(function (message) {
      cards.push('<div class="clf-alert" data-tone="warn"><strong>Check the assumptions</strong><span>'
        + escapeHtml(message) + '</span></div>');
    });
    if (validation.blocking.length && active.result) {
      cards.push('<div class="clf-alert" data-tone="info"><strong>Last valid result still shown</strong><span>The results workspace below is still showing the last valid calculation until the required inputs are completed.</span></div>');
    }
    els.validationHost.innerHTML = cards.join('');
    els.validationHost.style.display = cards.length ? '' : 'none';
    els.btnCalculate.disabled = !validation.canCalculate;
    return validation;
  }

  function renderGrowthPreview(active) {
    const summary = buildScenarioSummary(active.assumptions, active.result);
    const derived = summary.derived;
    const currency = summary.payload.currency;
    const cards = [
      {
        label: summary.activeMode === 'contractor' ? 'Current weekly gross' : 'Base weekly gross',
        value: formatMoneyPrecise(derived.totalBaseGross, currency),
      },
      {
        label: summary.activeMode === 'contractor' ? 'Extra weekly gross' : 'Scenario weekly gross',
        value: formatMoneyPrecise(derived.totalScenarioGross, currency),
      },
      {
        label: summary.activeMode === 'contractor' ? 'Per contractor gross' : 'Invoice cadence',
        value: summary.activeMode === 'contractor'
          ? formatMoneyPrecise(derived.capacityUnitGross, currency)
          : summary.invoiceCadenceLabel + ' on ' + summary.invoiceWeekdayLabel,
      },
      {
        label: summary.activeMode === 'contractor' ? 'Value source' : 'Invoice source',
        value: summary.activeGrowthSource,
      },
    ];
    els.growthPreview.innerHTML = cards.map(function (card) {
      return '<div class="clf-mini-card"><strong>' + escapeHtml(card.value) + '</strong><span>' + escapeHtml(card.label) + '</span></div>';
    }).join('');
  }

  function renderOpeningBalancePreview(active) {
    const summary = buildScenarioSummary(active.assumptions, active.result);
    const openingBalance = summary.raw.openingBalance;
    const imported = activeImportedStatement(summary.raw);
    let helper = '';
    if (openingBalance.receiptMode === 'manual') {
      helper = summary.manualReceiptCount
        ? (summary.manualReceiptCount + ' dated opening-balance receipt line' + (summary.manualReceiptCount === 1 ? '' : 's') + ' will reduce the starting ledger.')
        : 'Add dated opening-balance receipts in Advanced if you know the expected collections.';
    } else if (openingBalance.receiptMode === 'even_runoff') {
      helper = 'The opening balance will be spread evenly across the next '
        + openingBalance.runoffWeeks + ' week' + (openingBalance.runoffWeeks === 1 ? '' : 's') + '.';
    } else if (openingBalance.receiptMode === 'term_profile') {
      helper = 'The engine estimates collections from the opening ledger using the selected payment terms and invoicing cadence, without pretending to know exact aged-debtor dates.';
    } else if (openingBalance.receiptMode === 'import_statement') {
      helper = imported
        ? ('Imported rows are scheduling opening-book receipts using due dates, overdue handling, and the selected reconciliation method.')
        : 'Upload a debtor statement to turn the opening balance into a due-date-led receipt schedule.';
    } else {
      helper = 'Stress-test mode keeps the opening receivables in place unless manual adjustments are entered elsewhere.';
    }
    els.openingBalancePreview.innerHTML = '<div class="clf-list-card"><strong>'
      + escapeHtml(summary.openingBalanceSummary)
      + '</strong><span>'
      + escapeHtml(helper)
      + '</span></div>';
    updateOpeningBalanceUi();
  }

  function buildStatementOptions(scenario) {
    const assumptions = scenario && scenario.assumptions ? scenario.assumptions : Engine.DEFAULT_ASSUMPTIONS;
    return {
      scenarioCurrency: assumptions.currency,
      paymentTerms: assumptions.paymentTerms,
      forecastStartDate: assumptions.forecastStartDate,
    };
  }

  function statementTaskForScenario(scenarioId) {
    return state.statementImportTask.scenarioId === scenarioId ? state.statementImportTask : null;
  }

  function setStatementTask(scenarioId, busy, stage, message) {
    state.statementImportTask = {
      scenarioId: scenarioId || '',
      busy: !!busy,
      stage: stage || '',
      message: message || '',
      token: state.statementImportTask.token,
    };
  }

  function arrayBufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || new ArrayBuffer(0));
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      let piece = '';
      for (let cursor = 0; cursor < chunk.length; cursor += 1) {
        piece += String.fromCharCode(chunk[cursor]);
      }
      binary += piece;
    }
    return window.btoa(binary);
  }

  function readFileAsBase64(file) {
    if (file && typeof file.arrayBuffer === 'function') {
      return file.arrayBuffer().then(function (buffer) {
        return arrayBufferToBase64(new Uint8Array(buffer));
      });
    }
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error('statement_read_failed')); };
      reader.onload = function () {
        if (reader.result instanceof ArrayBuffer) {
          resolve(arrayBufferToBase64(new Uint8Array(reader.result)));
          return;
        }
        reject(new Error('statement_read_failed'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  async function importOpeningBalanceStatement(file, scenario) {
    if (!file || !scenario) return;
    const token = ++state.statementImportTask.token;
    setStatementTask(scenario.id, true, 'reading', 'Reading file');
    renderWorkspace();

    try {
      const data = await readFileAsBase64(file);
      if (token !== state.statementImportTask.token) return;
      setStatementTask(scenario.id, true, 'extracting', 'Extracting statement rows');
      renderWorkspace();

      const response = await state.helpers.api('admin-credit-limit-statement-parse', 'POST', {
        file: {
          name: file.name,
          contentType: file.type || '',
          size: file.size,
          data: data,
        },
        scenarioCurrency: scenario.assumptions.currency,
        forecastStartDate: scenario.assumptions.forecastStartDate,
        paymentTerms: scenario.assumptions.paymentTerms,
      });

      if (token !== state.statementImportTask.token) return;

      if (response.statement) {
        setStatementDraft(scenario.id, Object.assign({}, response.statement, {
          fileName: response.statement.fileName || file.name,
          fileSize: response.statement.fileSize || file.size,
          importedAt: new Date().toISOString(),
        }));
      }

      if (!response.ok && !response.statement) {
        setStatementTask(scenario.id, false, 'failed', 'Import needs another file');
        renderWorkspace();
        state.helpers.toast.warn((response.warnings && response.warnings[0]) || 'The statement could not be parsed confidently.', 4200);
        return;
      }

      setStatementTask(
        scenario.id,
        false,
        response.ok ? 'ready' : 'review',
        response.ok ? 'Ready for review' : 'Needs review'
      );
      renderWorkspace();
      state.helpers.toast.ok(response.ok ? 'Statement ready for review.' : 'Statement imported with warnings. Review before confirming.', 2400);
    } catch (error) {
      if (token !== state.statementImportTask.token) return;
      setStatementTask(scenario.id, false, 'failed', 'Import failed');
      renderWorkspace();
      state.helpers.toast.warn(error && error.message ? error.message : 'Statement import failed.', 4200);
    }
  }

  function updateConfirmedImportedStatement(mutator) {
    const active = getActiveScenario();
    if (!active) return;
    const current = activeImportedStatement(active.assumptions);
    if (!current) return;
    const next = StatementImport.prepareConfirmedStatement(mutator(Engine.cloneJson(current)), buildStatementOptions(active));
    active.assumptions.openingBalance.importedStatement = next;
    active.updatedAt = nowIso();
    calculateWorkspace();
    renderWorkspace();
    scheduleSummaryRefresh(false);
    persistWorkspace();
  }

  function confirmStatementDraft() {
    const active = getActiveScenario();
    const draft = active ? getStatementDraft(active.id) : null;
    if (!active || !draft) return;
    active.assumptions.openingBalance = active.assumptions.openingBalance || {};
    active.assumptions.openingBalance.importedStatement = StatementImport.prepareConfirmedStatement(draft, buildStatementOptions(active));
    active.updatedAt = nowIso();
    clearStatementDraft(active.id);
    calculateWorkspace();
    renderWorkspace();
    scheduleSummaryRefresh(false);
    persistWorkspace();
    state.helpers.toast.ok('Imported statement is now driving the opening-balance receipts.', 2600);
  }

  function clearImportedStatementData() {
    const active = getActiveScenario();
    if (!active) return;
    clearStatementDraft(active.id);
    active.assumptions.openingBalance.importedStatement = Engine.cloneJson(Engine.DEFAULT_ASSUMPTIONS.openingBalance.importedStatement);
    active.updatedAt = nowIso();
    calculateWorkspace();
    renderWorkspace();
    scheduleSummaryRefresh(false);
    persistWorkspace();
  }

  function renderSetupGuide(active) {
    if (!els.setupGuideHost) return;
    const summary = buildScenarioSummary(active.assumptions, active.result);
    const draft = getStatementDraft(active.id);
    const accountReady = String(els.creditLimit && els.creditLimit.value || '').trim() !== ''
      && String(els.currentOutstandingBalance && els.currentOutstandingBalance.value || '').trim() !== ''
      && Number(summary.raw.creditLimit) > 0;
    const openingReady = summary.raw.openingBalance.receiptMode !== 'import_statement'
      ? true
      : !!summary.importedStatement;
    const growthReady = !summary.zeroGrowth;
    let nextCopy = 'Next: calculate forecast';
    if (!accountReady) nextCopy = 'Next: complete the account setup';
    else if (summary.raw.openingBalance.receiptMode === 'import_statement' && !summary.importedStatement && draft) nextCopy = 'Next: review imported statement rows';
    else if (summary.raw.openingBalance.receiptMode === 'import_statement' && !summary.importedStatement) nextCopy = 'Next: upload a debtor statement';
    else if (!growthReady) nextCopy = 'Next: choose how to model growth';

    const chips = [
      { label: 'Account setup', state: accountReady ? 'complete' : 'current' },
      { label: 'Opening receipts', state: openingReady ? 'complete' : (summary.raw.openingBalance.receiptMode === 'import_statement' ? 'current' : 'pending') },
      { label: 'Growth method', state: growthReady ? 'complete' : 'current' },
      { label: 'Calculate', state: accountReady && openingReady && growthReady ? 'current' : 'pending' },
    ];

    els.setupGuideHost.innerHTML = '<div class="clf-setup-guide">'
      + '<div class="clf-chip-list">'
      + chips.map(function (chip) {
        return '<span class="clf-chip clf-guide-chip" data-guide-state="' + escapeAttr(chip.state) + '">'
          + escapeHtml(chip.label)
          + '</span>';
      }).join('')
      + '</div>'
      + '<div class="clf-guide-note"><strong>' + escapeHtml(nextCopy) + '</strong><span>Quick steps: set the opening balance, choose how to model growth, import a statement if needed, then calculate and review the breach timing.</span></div>'
      + '</div>';
  }

  function renderOpeningBalanceImport(active) {
    if (!els.openingBalanceImportHost) return;
    const summary = buildScenarioSummary(active.assumptions, active.result);
    const mode = summary.raw.openingBalance.receiptMode;
    const draft = getStatementDraft(active.id);
    const confirmed = activeImportedStatement(active.assumptions);
    const task = statementTaskForScenario(active.id);

    if (mode !== 'import_statement') {
      if (draft || confirmed) {
        const stored = confirmed || draft;
        els.openingBalanceImportHost.innerHTML = '<div class="clf-empty">An imported statement is stored for this scenario, but it is inactive until Opening-balance receipts is set to Import statement. '
          + escapeHtml(statementSummary(stored, active.assumptions.currentOutstandingBalance, active.assumptions.currency))
          + '</div>';
      } else {
        els.openingBalanceImportHost.innerHTML = '';
      }
      els.openingBalanceImportHost.style.display = draft || confirmed ? '' : 'none';
      return;
    }

    const working = draft || confirmed;
    const warnings = working && Array.isArray(working.warnings) ? working.warnings.slice(0, 4) : [];
    const reconciliation = working
      ? StatementImport.buildReconciliationSummary(working, active.assumptions.currentOutstandingBalance)
      : null;
    const headers = draft && draft.rawTable ? draft.rawTable.headers : [];
    const mappingRows = draft && draft.rawTable
      ? [
        ['invoiceRef', 'Invoice ref'],
        ['invoiceDate', 'Invoice date'],
        ['dueDate', 'Due date'],
        ['outstandingAmount', 'Outstanding amount'],
        ['currency', 'Currency'],
        ['status', 'Status'],
      ]
      : [];
    const reviewRows = working && Array.isArray(working.rows) ? working.rows : [];
    const advancedVisible = state.inputDensity === 'advanced';

    const uploadCard = [
      '<article class="clf-import-card clf-upload-card" data-dropzone="statement-upload">',
      '<div class="clf-card-head"><div><p class="clf-kicker">Import statement</p><h3>Upload debtor statement</h3></div>',
      working ? '<span class="clf-chip" data-tone="' + escapeAttr(statementConfidenceTone(working.confidence)) + '">' + escapeHtml(statementConfidenceLabel(working.confidence)) + '</span>' : '',
      '</div>',
      '<p class="clf-inline-note">Upload a debtor statement or ledger export so the opening balance can be scheduled using actual invoice due dates.</p>',
      '<div class="clf-toolbar clf-no-print">',
      '<button class="clf-btn clf-btn-primary" type="button" data-statement-action="browse">Upload statement</button>',
      '<button class="clf-btn clf-btn-ghost" type="button" data-statement-action="switch-manual">Add manual receipt instead</button>',
      working ? '<button class="clf-btn clf-btn-secondary" type="button" data-statement-action="clear">Clear imported statement</button>' : '',
      '</div>',
      '<p class="clf-muted-small">Accepted file types: PDF, XLSX, CSV.</p>',
      task ? '<div class="clf-import-status"><span class="clf-chip" data-tone="' + escapeAttr(task.busy ? 'warn' : (task.stage === 'failed' ? 'danger' : 'ok')) + '">' + escapeHtml(task.message || 'Working') + '</span><span>' + escapeHtml(task.stage === 'reading' ? 'Reading file' : task.stage === 'extracting' ? 'Matching columns' : task.message || '') + '</span></div>' : '',
      '</article>',
    ].join('');

    let summaryCard = '';
    if (working) {
      summaryCard = '<article class="clf-import-card"><div class="clf-card-head"><div><p class="clf-kicker">Imported opening book</p><h3>'
        + escapeHtml(working.fileName || 'Statement schedule')
        + '</h3></div><span class="clf-chip" data-tone="'
        + escapeAttr(statementConfidenceTone(working.confidence))
        + '">'
        + escapeHtml(statementConfidenceLabel(working.confidence))
        + '</span></div>'
        + '<div class="clf-mini-grid">'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(String(working.includedRowCount || 0)) + '</strong><span>Included rows</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(working.importedTotal || 0, active.assumptions.currency)) + '</strong><span>Imported opening total</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(working.detectedCurrency || active.assumptions.currency) + '</strong><span>Matched currency</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(String(working.overdueRowCount || 0)) + '</strong><span>Overdue rows</span></div>'
        + '</div>'
        + (warnings.length
          ? '<div class="clf-alert-stack">' + warnings.map(function (warning) {
            return '<div class="clf-alert" data-tone="warn"><strong>Check import</strong><span>' + escapeHtml(warning) + '</span></div>';
          }).join('') + '</div>'
          : '')
        + '</article>';
    }

    let mappingCard = '';
    if (draft && draft.rawTable && headers.length) {
      mappingCard = '<article class="clf-import-card"><div class="clf-card-head"><div><p class="clf-kicker">Column mapping</p><h3>Review detected columns</h3></div></div>'
        + '<p class="clf-inline-note">If due date is missing, invoice date plus the selected payment terms will be used where possible.</p>'
        + '<div class="clf-form-grid clf-form-grid-3">'
        + mappingRows.map(function (item) {
          return '<label class="clf-field"><span class="clf-label">' + escapeHtml(item[1]) + '</span><select data-import-map-field="' + escapeAttr(item[0]) + '">'
            + '<option value="">Not mapped</option>'
            + headers.map(function (header) {
              const selected = draft.mapping && draft.mapping[item[0]] === header ? ' selected' : '';
              return '<option value="' + escapeAttr(header) + '"' + selected + '>' + escapeHtml(header) + '</option>';
            }).join('')
            + '</select></label>';
        }).join('')
        + '</div></article>';
    }

    let reconciliationCard = '';
    if (working && reconciliation) {
      reconciliationCard = '<article class="clf-import-card"><div class="clf-card-head"><div><p class="clf-kicker">Reconciliation</p><h3>Compare imported total with opening balance</h3></div></div>'
        + '<div class="clf-mini-grid">'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.enteredOpeningBalance, active.assumptions.currency)) + '</strong><span>Entered opening balance</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.importedTotal, active.assumptions.currency)) + '</strong><span>Imported statement total</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.variance, active.assumptions.currency)) + '</strong><span>Variance</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.effectiveOpeningBalance, active.assumptions.currency)) + '</strong><span>Forecast opening balance</span></div>'
        + '</div>'
        + (!reconciliation.matches
          ? '<div class="clf-alert" data-tone="warn"><strong>Totals do not reconcile</strong><span>Choose whether the forecast should keep the entered opening balance, use the imported total, or scale the imported schedule to match the opening balance.</span></div>'
          : '')
        + '<div class="clf-form-grid' + (advancedVisible ? ' clf-form-grid-3' : '') + '">'
        + '<label class="clf-field clf-field-full"><span class="clf-label">Reconciliation treatment</span><select data-import-reconciliation-mode="1">'
        + Object.keys(Engine.OPENING_BALANCE_RECONCILIATION_LABELS).map(function (key) {
          const selected = working.reconciliationMode === key ? ' selected' : '';
          return '<option value="' + escapeAttr(key) + '"' + selected + '>' + escapeHtml(reconciliationModeLabel(key)) + '</option>';
        }).join('')
        + '</select></label>'
        + (advancedVisible
          ? '<label class="clf-field"><span class="clf-label">Overdue collection delay (days)</span><input type="number" min="0" max="60" step="1" data-import-overdue-days="1" value="' + escapeAttr(working.overdueCollectionDays || 7) + '"/></label>'
          : '')
        + '</div></article>';
    }

    let reviewCard = '';
    if (working && reviewRows.length) {
      reviewCard = '<article class="clf-import-card"><div class="clf-card-head"><div><p class="clf-kicker">Review imported rows</p><h3>'
        + escapeHtml(draft ? 'Review imported rows' : 'Imported schedule in use')
        + '</h3></div>'
        + (draft
          ? '<button class="clf-btn clf-btn-primary" type="button" data-statement-action="confirm">Use imported statement</button>'
          : '<span class="clf-chip" data-tone="ok">Imported statement live</span>')
        + '</div>'
        + '<div class="clf-table-wrap clf-import-table-wrap"><table class="clf-inline-table clf-import-table"><thead><tr><th>Include</th><th>Invoice ref</th><th>Invoice date</th><th>Due date</th><th>Outstanding amount</th><th>Currency</th><th>Note / warning</th></tr></thead><tbody>'
        + reviewRows.map(function (row, index) {
          return '<tr>'
            + '<td><input type="checkbox" data-import-row-index="' + index + '" data-import-key="include"' + (row.include !== false ? ' checked' : '') + '/></td>'
            + '<td><input type="text" data-import-row-index="' + index + '" data-import-key="invoiceRef" value="' + escapeAttr(row.invoiceRef || '') + '"/></td>'
            + '<td><input type="date" data-import-row-index="' + index + '" data-import-key="invoiceDate" value="' + escapeAttr(row.invoiceDate || '') + '"/></td>'
            + '<td><input type="date" data-import-row-index="' + index + '" data-import-key="dueDate" value="' + escapeAttr(row.dueDate || '') + '"/></td>'
            + '<td><input type="number" step="0.01" data-import-row-index="' + index + '" data-import-key="outstandingAmount" value="' + escapeAttr(row.outstandingAmount || 0) + '"/></td>'
            + '<td><select data-import-row-index="' + index + '" data-import-key="currency"><option value="GBP"' + (row.currency === 'GBP' ? ' selected' : '') + '>GBP</option><option value="EUR"' + (row.currency === 'EUR' ? ' selected' : '') + '>EUR</option></select></td>'
            + '<td><input type="text" data-import-row-index="' + index + '" data-import-key="note" value="' + escapeAttr(row.note || '') + '" placeholder="' + escapeAttr(row.warningText || 'Optional note') + '"/><div class="clf-muted-small">' + escapeHtml(row.warningText || 'No warnings') + '</div></td>'
            + '</tr>';
        }).join('')
        + '</tbody></table></div></article>';
    }

    els.openingBalanceImportHost.innerHTML = [uploadCard, summaryCard, mappingCard, reconciliationCard, reviewCard].join('');
    els.openingBalanceImportHost.style.display = '';
  }

  function renderInvoiceDatePreview(active) {
    const payload = buildCalculationPayload(active.assumptions);
    const invoicePlan = Engine.buildInvoicePlan(payload, Engine.generateWeeks(payload));
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
    const assumptions = ensureScenarioArrays(active.assumptions);
    if (assumptions.invoice.autoCountDates !== false) {
      els.invoiceOverrideHost.innerHTML = '<div class="clf-empty">Automatic counting is on. Switch it off to confirm or override invoice-event counts week by week.</div>';
      return;
    }
    const weeks = Engine.generateWeeks(buildCalculationPayload(assumptions));
    const rows = weeks.map(function (week, index) {
      const value = assumptions.invoice.manualEventCounts[index];
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
    const isManualMode = active.assumptions.openingBalance && active.assumptions.openingBalance.receiptMode === 'manual';
    if (!isManualMode) {
      const storedCount = Array.isArray(active.assumptions.receiptLines) ? active.assumptions.receiptLines.length : 0;
      els.receiptLinesHost.innerHTML = '<div class="clf-empty">'
        + escapeHtml(storedCount
          ? ('Manual opening-balance receipts are stored but inactive. Switch the opening-balance mode to Manual to use the ' + storedCount + ' saved line' + (storedCount === 1 ? '' : 's') + '.')
          : 'Switch the opening-balance mode to Manual if you want to enter dated receipts against the opening ledger.')
        + '</div>';
      return;
    }
    if (!active.assumptions.receiptLines.length) {
      els.receiptLinesHost.innerHTML = '<div class="clf-empty">No manual opening-balance receipts added yet. Add known expected payments here to reduce the starting receivables book in the relevant week.</div>';
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
        '<input type="text" data-receipt-index="' + index + '" data-receipt-key="note" value="' + escapeAttr(line.note) + '" placeholder="Opening-balance receipt note"/>',
        '</label>',
        '</div>',
        '<div class="clf-toolbar"><button class="clf-btn clf-btn-danger" type="button" data-remove-receipt-index="' + index + '">Remove line</button></div>',
        '</div>',
      ].join('');
    }).join('');
  }

  function renderReceiptAdjustments(active) {
    const assumptions = ensureScenarioArrays(active.assumptions);
    const weeks = Engine.generateWeeks(buildCalculationPayload(assumptions));
    const rows = weeks.map(function (week, index) {
      const item = assumptions.receiptWeekAdjustments[index] || { amount: 0 };
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
    setInputDensity(state.inputDensity);
    updatePaymentTermsUi();
    updateOpeningBalanceUi();
    updateVatUi();
    applyGrowthModeUi(active.assumptions.growthMode);
    renderSetupGuide(active);
    renderValidation(active);
    renderOpeningBalancePreview(active);
    renderOpeningBalanceImport(active);
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
    const growthMode = normaliseGrowthMode(active.assumptions.growthMode);
    const contractorCapacityLabel = capacity.available ? String(capacity.maxAdditionalContractorsAllowed) : (growthMode === 'direct' ? 'Not modelled' : '—');
    const contractorRemovalLabel = capacity.available ? String(capacity.contractorsToRemove || 0) : (growthMode === 'direct' ? 'Not modelled' : '—');
    const safeWeeklyIncreaseLabel = capacity.maxSafeWeeklyGrossIncrease != null
      ? formatMoney(capacity.maxSafeWeeklyGrossIncrease, currency)
      : '—';
    const cards = [
      { label: 'Credit limit', value: formatMoney(result.metrics.creditLimit, currency), meta: 'Insured limit', tone: 'ok' },
      { label: 'Current balance', value: formatMoney(result.metrics.currentBalance, currency), meta: 'Opening receivables', tone: toneForStatus(result.overallStatus) },
      { label: 'Peak balance', value: formatMoney(result.metrics.forecastPeakBalance, currency), meta: 'Highest projected close', tone: toneForStatus(result.overallStatus) },
      { label: 'Minimum headroom', value: formatMoney(result.metrics.minimumHeadroom, currency), meta: 'Lowest remaining capacity', tone: toneForStatus(result.overallStatus) },
      { label: 'First breach', value: firstBreach ? ('Week ' + firstBreach.weekNumber) : 'None', meta: firstBreach ? Engine.formatLongDate(firstBreach.breachDate || firstBreach.weekCommencing) : 'No breach forecast', tone: firstBreach ? 'danger' : 'ok' },
      { label: 'Additional contractors allowed', value: contractorCapacityLabel, meta: growthMode === 'direct' ? 'Direct uplift scenario' : 'Safe extra contractors', tone: capacity.available && capacity.maxAdditionalContractorsAllowed > 0 ? 'ok' : toneForStatus(result.overallStatus) },
      { label: 'Contractors to remove', value: contractorRemovalLabel, meta: growthMode === 'direct' ? 'Headcount not being modelled' : (capacity.available && capacity.contractorsToRemove ? 'Required to de-risk' : 'None implied'), tone: capacity.available && capacity.contractorsToRemove ? 'danger' : 'ok' },
      { label: 'Max safe weekly increase', value: safeWeeklyIncreaseLabel, meta: growthMode === 'direct' ? 'Safe gross uplift' : 'Gross weekly uplift', tone: toneForStatus(result.overallStatus) },
      { label: 'Status', value: result.overallStatusLabel, meta: Engine.TERM_LABELS[active.assumptions.paymentTerms.type] || active.assumptions.paymentTerms.type.replace(/_/g, ' '), tone: toneForStatus(result.overallStatus) },
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
    const summary = buildScenarioSummary(active.assumptions, active.result);
    const assumptions = summary.raw;
    const invoiceDates = active.result
      ? active.result.invoicePlan.reduce(function (total, week) { return total + week.invoiceCount; }, 0)
      : 0;
    const rows = [
      {
        title: 'Active method',
        value: summary.activeModeLabel,
      },
      {
        title: 'What drives the forecast',
        value: summary.activeGrowthSource,
      },
      {
        title: 'VAT basis',
        value: summary.vatLabel,
      },
      {
        title: 'Opening balance treatment',
        value: summary.openingBalanceSummary,
      },
      {
        title: 'Opening-book source',
        value: summary.raw.openingBalance.receiptMode === 'import_statement' && summary.importedStatement
          ? statementSummary(summary.importedStatement, assumptions.currentOutstandingBalance, assumptions.currency)
          : openingBalanceModeLabel(summary.raw.openingBalance.receiptMode),
      },
      {
        title: 'Payment terms',
        value: summary.termLabel + (assumptions.paymentTerms.receiptLagDays ? (' • lag ' + assumptions.paymentTerms.receiptLagDays + ' day(s)') : ''),
      },
      {
        title: 'Advanced overrides',
        value: summary.advancedOverridesActive ? ('Yes • ' + summary.advancedOverrideCount + ' active') : 'No advanced overrides active',
      },
      {
        title: 'Receipt overrides in play',
        value: (summary.raw.openingBalance.receiptMode === 'import_statement'
          ? (summary.importedStatementRowCount + ' imported row' + (summary.importedStatementRowCount === 1 ? '' : 's'))
          : (summary.activeOpeningBalanceManualReceiptCount + ' opening-balance line' + (summary.activeOpeningBalanceManualReceiptCount === 1 ? '' : 's')))
          + ' • ' + summary.weeklyAdjustmentCount + ' weekly adjustment' + (summary.weeklyAdjustmentCount === 1 ? '' : 's'),
      },
      {
        title: 'Comparison scenario',
        value: summary.compareLabel,
      },
      {
        title: 'Invoice schedule',
        value: summary.invoiceCadenceLabel + ' on ' + summary.invoiceWeekdayLabel + (invoiceDates ? (' • ' + invoiceDates + ' projected dates') : ''),
      },
    ];
    if (summary.importedStatement) {
      const reconciliation = StatementImport.buildReconciliationSummary(summary.importedStatement, assumptions.currentOutstandingBalance);
      rows.splice(5, 0, {
        title: 'Opening balance reconciliation',
        value: reconciliation.matches
          ? 'Imported total matches the opening balance'
          : ('Variance ' + formatMoney(reconciliation.variance, assumptions.currency) + ' • ' + reconciliationModeLabel(reconciliation.reconciliationMode)),
      });
    }
    els.assumptionSnapshot.innerHTML = rows.map(function (row) {
      return '<div class="clf-list-card"><strong>' + escapeHtml(row.title) + '</strong><span>' + escapeHtml(row.value) + '</span></div>';
    }).join('');
  }

  function renderResultNotices(active) {
    const validation = buildValidationState(active);
    const notices = [];
    if (validation.summary.zeroGrowth) {
      notices.push('<div class="clf-alert" data-tone="warn"><strong>Flat forecast profile</strong><span>No weekly growth input is currently active, so balances stay flat unless opening-balance collections or manual receipt adjustments reduce the ledger.</span></div>');
    }
    if (validation.summary.noOpeningBalanceReceipts) {
      notices.push('<div class="clf-alert" data-tone="warn"><strong>Opening balance has no receipt schedule</strong><span>No receipt schedule has been applied to the opening balance, so the starting receivables will remain in place unless opening-balance collections are added manually or estimated.</span></div>');
    }
    if (validation.summary.raw.openingBalance.receiptMode === 'manual'
      && Number(validation.summary.raw.currentOutstandingBalance) > 0
      && validation.summary.manualReceiptCount === 0) {
      notices.push('<div class="clf-alert" data-tone="info"><strong>Manual opening-balance mode is empty</strong><span>Add dated opening-balance receipts in Advanced if you want the opening ledger to run off during the forecast.</span></div>');
    }
    if (validation.summary.raw.openingBalance.receiptMode === 'import_statement' && validation.summary.importedStatement) {
      const reconciliation = StatementImport.buildReconciliationSummary(
        validation.summary.importedStatement,
        validation.summary.raw.currentOutstandingBalance
      );
      if (!reconciliation.matches) {
        notices.push('<div class="clf-alert" data-tone="warn"><strong>Imported statement does not reconcile</strong><span>Imported statement total differs from the entered opening balance. The forecast is currently using '
          + escapeHtml(reconciliationModeLabel(reconciliation.reconciliationMode).toLowerCase())
          + '.</span></div>');
      }
      notices.push('<div class="clf-alert" data-tone="info"><strong>Opening-balance receipt source</strong><span>'
        + escapeHtml(validation.summary.importedStatement.includedRowCount + ' imported row' + (validation.summary.importedStatement.includedRowCount === 1 ? '' : 's'))
        + ' are driving the opening-book receipt schedule separately from forecast-generated invoice receipts.</span></div>');
    }
    if (active.result && active.result.metrics.creditLimit > 0) {
      const ratio = active.result.metrics.minimumHeadroom / active.result.metrics.creditLimit;
      if (ratio <= 0.05) {
        notices.push('<div class="clf-alert" data-tone="danger"><strong>Very low headroom</strong><span>Minimum headroom falls below 5% of the insured limit, so even a small timing change could push the account over limit.</span></div>');
      } else if (ratio <= 0.1) {
        notices.push('<div class="clf-alert" data-tone="warn"><strong>Headroom is tightening</strong><span>Minimum headroom falls below 10% of the insured limit. Review breach timing and cash receipts closely.</span></div>');
      }
    }
    els.resultsNoticeHost.innerHTML = notices.join('');
    els.resultsNoticeHost.style.display = notices.length ? '' : 'none';
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
      els.compareSummary.innerHTML = '<div class="clf-empty">No comparison loaded. Open Advanced if you want to overlay another scenario and compare breach timing side by side.</div>';
      return;
    }
    const currency = active.assumptions.currency;
    const rows = [
      ['Status', active.result.overallStatusLabel, compare.result.overallStatusLabel],
      ['Peak balance', formatMoney(active.result.metrics.forecastPeakBalance, currency), formatMoney(compare.result.metrics.forecastPeakBalance, currency)],
      ['Minimum headroom', formatMoney(active.result.metrics.minimumHeadroom, currency), formatMoney(compare.result.metrics.minimumHeadroom, currency)],
      ['Additional contractors allowed', active.result.capacity.available ? String(active.result.capacity.maxAdditionalContractorsAllowed) : 'Not modelled', compare.result.capacity.available ? String(compare.result.capacity.maxAdditionalContractorsAllowed) : 'Not modelled'],
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
      const mode = normaliseGrowthMode(active.assumptions.growthMode);
      els.sensitivityHost.innerHTML = '<div class="clf-empty">'
        + escapeHtml(mode === 'direct'
          ? ('Contractor capacity is not being modelled in direct uplift mode. Switch to contractor mode if you want a safe headcount answer.'
            + (capacity.maxSafeWeeklyGrossIncrease != null
              ? (' The current assumptions support roughly ' + formatMoney(capacity.maxSafeWeeklyGrossIncrease, active.assumptions.currency) + ' of gross weekly uplift before breaching the limit.')
              : ''))
          : 'Add contractor value assumptions to unlock safe-capacity calculations.')
        + '</div>';
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
        + '<td>' + escapeHtml(formatMoney(row.openingBalanceReceipts, currency)) + '</td>'
        + '<td>' + escapeHtml(formatMoney(row.forecastInvoiceReceipts, currency)) + '</td>'
        + '<td><div class="clf-cell-stack"><strong>' + escapeHtml(formatMoney(row.totalReceipts, currency)) + '</strong><small>Weekly adjustments ' + escapeHtml(formatMoney(row.receiptAdjustments, currency)) + '</small></div></td>'
        + '<td>' + escapeHtml(formatMoney(row.closingBalance, currency)) + '</td>'
        + '<td>' + escapeHtml(formatMoney(row.headroom, currency)) + '</td>'
        + '<td><span class="clf-table-badge" data-status="' + escapeAttr(row.status) + '">' + escapeHtml(row.statusLabel) + '</span></td>'
        + '<td>' + escapeHtml(row.breachDate ? Engine.formatLongDate(row.breachDate) : '—') + '</td>'
        + '</tr>';
    }).join('');
    els.forecastTableHost.innerHTML = [
      '<table class="clf-table">',
      '<thead><tr><th>Week</th><th>Invoice date(s)</th><th>Opening balance</th><th>Base invoice increase</th><th>Scenario invoice increase</th><th>Opening-balance receipts</th><th>Forecast-invoice receipts</th><th>Total receipts</th><th>Closing balance</th><th>Headroom</th><th>Status</th><th>First breach marker</th></tr></thead>',
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
        + '<td>' + escapeHtml('Forecast-generated invoice • ' + entry.termLabel) + '</td>'
        + '<td>' + escapeHtml(entry.receiptWeekIndex >= 0 ? ('Week ' + (entry.receiptWeekIndex + 1)) : 'Beyond horizon') + '</td>'
        + '</tr>';
    });
    const openingBalanceRows = active.result.openingBalanceSchedule.map(function (entry) {
      const sourceDateLabel = entry.source === 'opening_balance_term_profile'
        ? (entry.dateLabel + ' assumed invoice')
        : entry.dateLabel;
      const sourceText = entry.source === 'opening_balance_imported_statement'
        ? ('Imported statement' + (entry.invoiceRef ? (' • ' + entry.invoiceRef) : ''))
        : (entry.note || entry.sourceLabel);
      return '<tr>'
        + '<td><div class="clf-cell-stack"><strong>' + escapeHtml(sourceDateLabel) + '</strong><small>' + escapeHtml(entry.sourceLabel) + '</small></div></td>'
        + '<td>' + escapeHtml(entry.dueDateLabel) + '</td>'
        + '<td>' + escapeHtml(formatMoney(entry.amount, currency)) + '</td>'
        + '<td>' + escapeHtml(sourceText) + '</td>'
        + '<td>' + escapeHtml(entry.receiptWeekIndex >= 0 ? ('Week ' + (entry.receiptWeekIndex + 1)) : 'Beyond horizon') + '</td>'
        + '</tr>';
    });
    const rows = openingBalanceRows.concat(invoiceRows);
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
    const summary = buildScenarioSummary(active.assumptions, active.result);
    els.pageStatusBadge.dataset.status = active.result.overallStatus;
    els.pageStatusBadge.textContent = active.result.overallStatusLabel;
    els.heroPeakBalance.textContent = formatMoney(active.result.metrics.forecastPeakBalance, active.assumptions.currency);
    els.heroCapacity.textContent = active.result.capacity.available ? String(active.result.capacity.maxAdditionalContractorsAllowed) : '—';
    els.resultsHeading.textContent = scenarioDisplayName(active) + ' output';
    els.resultsMeta.textContent = (active.assumptions.clientName || 'No client selected')
      + ' • '
      + summary.activeModeLabel
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
    renderResultNotices(active);
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
    clearStatementDraft(active.id);
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
      clearStatementDraft(scenario.id);
      state.activeScenarioId = scenario.id;
      applyAssumptionsToForm(scenario.assumptions);
    } else {
      const active = getActiveScenario();
      if (!active) return;
      active.assumptions = assumptions;
      active.summary = null;
      active.updatedAt = nowIso();
      clearStatementDraft(active.id);
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
      'Opening Balance Receipts',
      'Forecast Invoice Receipts',
      'Receipt Adjustments',
      'Total Receipts',
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
        row.openingBalanceReceipts,
        row.forecastInvoiceReceipts,
        row.receiptAdjustments,
        row.totalReceipts,
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
        + '<td>' + escapeHtml(String(row.openingBalanceReceipts)) + '</td>'
        + '<td>' + escapeHtml(String(row.forecastInvoiceReceipts)) + '</td>'
        + '<td>' + escapeHtml(String(row.receiptAdjustments)) + '</td>'
        + '<td>' + escapeHtml(String(row.totalReceipts)) + '</td>'
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
      '<table><thead><tr><th>Week</th><th>Week Commencing</th><th>Week Ending</th><th>Invoice Dates</th><th>Invoice Count</th><th>Opening Balance</th><th>Base Invoice Increase</th><th>Scenario Invoice Increase</th><th>Opening Balance Receipts</th><th>Forecast Invoice Receipts</th><th>Receipt Adjustments</th><th>Total Receipts</th><th>Closing Balance</th><th>Headroom</th><th>Status</th></tr></thead><tbody>',
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
    const payload = buildCalculationPayload(active.assumptions);
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
        assumptions: payload,
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

  function applyPreset(preset) {
    switch (preset) {
      case 'hmj-standard':
        els.paymentTermsType.value = '30_eom';
        els.forecastHorizonWeeks.value = 20;
        els.openingBalanceReceiptMode.value = 'term_profile';
        els.openingBalanceRunoffWeeks.value = Engine.DEFAULT_ASSUMPTIONS.openingBalance.runoffWeeks;
        els.vatApplicable.checked = true;
        els.vatRate.value = 20;
        els.invoiceCadence.value = 'weekly';
        els.invoiceWeekday.value = '2';
        els.autoCountDates.checked = true;
        els.growthMode.value = 'contractor';
        setInputDensity('basic');
        break;
      case 'terms-30-eom':
        els.paymentTermsType.value = '30_eom';
        break;
      case 'terms-30-invoice':
        els.paymentTermsType.value = '30_from_invoice';
        break;
      case 'terms-14-net':
        els.paymentTermsType.value = '14_net';
        break;
      case 'weekly-tuesday':
        els.invoiceCadence.value = 'weekly';
        els.invoiceWeekday.value = '2';
        break;
      case 'vat-20':
        els.vatApplicable.checked = true;
        els.vatRate.value = 20;
        break;
      default:
        return;
    }
    updatePaymentTermsUi();
    updateOpeningBalanceUi();
    updateVatUi();
    applyGrowthModeUi(els.growthMode.value);
    scheduleRecalc(40);
  }

  function expandAll(open) {
    Array.from(document.querySelectorAll('.clf-advanced-group')).forEach(function (node) {
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

  function updateDraftImportState(mutator) {
    const active = getActiveScenario();
    const draft = active ? getStatementDraft(active.id) : null;
    if (!active || !draft) return;
    const next = mutator(Engine.cloneJson(draft));
    setStatementDraft(active.id, next);
    renderWorkspace();
  }

  function handleFormEvent(event) {
    if (state.isApplyingForm) return;
    const target = event.target;
    if (!target) return;

    if (target.id === 'paymentTermsType') {
      updatePaymentTermsUi();
    }
    if (target.id === 'openingBalanceReceiptMode') {
      updateOpeningBalanceUi();
    }
    if (target.id === 'vatApplicable') {
      updateVatUi();
    }

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

    if (target.hasAttribute('data-import-map-field')) {
      updateDraftImportState(function (draft) {
        draft.mapping = draft.mapping || {};
        draft.mapping[target.getAttribute('data-import-map-field')] = target.value || '';
        return draft;
      });
      return;
    }

    if (target.hasAttribute('data-import-row-index')) {
      const active = getActiveScenario();
      if (!active) return;
      const index = Number(target.getAttribute('data-import-row-index'));
      const key = target.getAttribute('data-import-key');
      const draft = getStatementDraft(active.id);
      if (draft) {
        updateDraftImportState(function (source) {
          const next = Engine.cloneJson(source);
          if (next.rawTable) {
            next.rows = Engine.cloneJson(next.rows || []);
            delete next.rawTable;
          }
          const row = next.rows[index];
          if (!row) return next;
          row[key] = key === 'include'
            ? !!target.checked
            : (key === 'outstandingAmount' ? Number(target.value) || 0 : String(target.value || '').trim());
          return next;
        });
        return;
      }

      updateConfirmedImportedStatement(function (statement) {
        const row = statement.rows[index];
        if (!row) return statement;
        row[key] = key === 'include'
          ? !!target.checked
          : (key === 'outstandingAmount' ? Number(target.value) || 0 : String(target.value || '').trim());
        return statement;
      });
      return;
    }

    if (target.hasAttribute('data-import-reconciliation-mode')) {
      const active = getActiveScenario();
      if (!active) return;
      const draft = getStatementDraft(active.id);
      if (draft) {
        updateDraftImportState(function (source) {
          source.reconciliationMode = target.value || 'keep_manual_opening_balance';
          return source;
        });
        return;
      }
      updateConfirmedImportedStatement(function (statement) {
        statement.reconciliationMode = target.value || 'keep_manual_opening_balance';
        return statement;
      });
      return;
    }

    if (target.hasAttribute('data-import-overdue-days')) {
      const active = getActiveScenario();
      if (!active) return;
      const value = Number(target.value) || 0;
      const draft = getStatementDraft(active.id);
      if (draft) {
        updateDraftImportState(function (source) {
          source.overdueCollectionDays = value;
          return source;
        });
        return;
      }
      updateConfirmedImportedStatement(function (statement) {
        statement.overdueCollectionDays = value;
        return statement;
      });
      return;
    }

    scheduleRecalc(120);
  }

  function bindStaticActions() {
    els.forecastForm.addEventListener('input', handleFormEvent);
    els.forecastForm.addEventListener('change', handleFormEvent);
    els.forecastForm.addEventListener('click', function (event) {
      const receiptButton = event.target.closest('#btnAddReceiptLine');
      if (receiptButton) {
        addReceiptLine();
        return;
      }

      const modeButton = event.target.closest('[data-growth-mode]');
      if (modeButton) {
        const nextMode = normaliseGrowthMode(modeButton.getAttribute('data-growth-mode'));
        if (els.growthMode.value !== nextMode) {
          els.growthMode.value = nextMode;
          applyGrowthModeUi(nextMode);
          scheduleRecalc(40);
        }
        return;
      }

      const presetButton = event.target.closest('[data-preset]');
      if (presetButton) {
        applyPreset(presetButton.getAttribute('data-preset'));
        return;
      }

      const statementAction = event.target.closest('[data-statement-action]');
      if (statementAction) {
        const active = getActiveScenario();
        const action = statementAction.getAttribute('data-statement-action');
        if (action === 'browse' && els.statementUploadInput) {
          els.statementUploadInput.click();
        } else if (action === 'confirm') {
          confirmStatementDraft();
        } else if (action === 'clear') {
          clearImportedStatementData();
        } else if (action === 'switch-manual' && els.openingBalanceReceiptMode) {
          els.openingBalanceReceiptMode.value = 'manual';
          updateOpeningBalanceUi();
          scheduleRecalc(40);
        }
        if (active) {
          renderWorkspace();
        }
      }
    });

    if (els.statementUploadInput) {
      els.statementUploadInput.addEventListener('change', function () {
        const file = els.statementUploadInput.files && els.statementUploadInput.files[0];
        const active = getActiveScenario();
        if (file && active) {
          importOpeningBalanceStatement(file, active);
        }
        els.statementUploadInput.value = '';
      });
    }

    if (els.openingBalanceImportHost) {
      ['dragenter', 'dragover'].forEach(function (type) {
        els.openingBalanceImportHost.addEventListener(type, function (event) {
          const zone = event.target.closest('[data-dropzone="statement-upload"]');
          if (!zone) return;
          event.preventDefault();
          zone.classList.add('is-dragging');
        });
      });
      ['dragleave', 'dragend', 'drop'].forEach(function (type) {
        els.openingBalanceImportHost.addEventListener(type, function (event) {
          const zone = event.target.closest('[data-dropzone="statement-upload"]');
          if (!zone) return;
          if (type === 'drop') event.preventDefault();
          zone.classList.remove('is-dragging');
        });
      });
      els.openingBalanceImportHost.addEventListener('drop', function (event) {
        const zone = event.target.closest('[data-dropzone="statement-upload"]');
        if (!zone) return;
        event.preventDefault();
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        const active = getActiveScenario();
        if (file && active) {
          importOpeningBalanceStatement(file, active);
        }
      });
    }

    els.btnBasicMode.addEventListener('click', function () {
      setInputDensity('basic');
      renderWorkspace();
    });
    els.btnAdvancedMode.addEventListener('click', function () {
      setInputDensity('advanced');
      renderWorkspace();
    });

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
      const active = getActiveScenario();
      const validation = active ? buildValidationState(active) : { canCalculate: true };
      if (!validation.canCalculate) {
        renderWorkspace();
        state.helpers.toast.warn('Complete the required setup fields before calculating.', 2600);
        return;
      }
      calculateWorkspace();
      renderWorkspace();
      scheduleSummaryRefresh(true);
      state.helpers.toast.ok('Forecast recalculated.', 1800);
    });
    els.btnRefreshSummary.addEventListener('click', function () {
      updateActiveScenarioFromForm();
      const active = getActiveScenario();
      const validation = active ? buildValidationState(active) : { canCalculate: true };
      if (!validation.canCalculate) {
        renderWorkspace();
        state.helpers.toast.warn('Complete the required setup fields before refreshing the summary.', 2600);
        return;
      }
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
      setInputDensity(state.inputDensity);
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
