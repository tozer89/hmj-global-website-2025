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
    wizard: null,
    wizardReturnFocus: null,
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
      'wizardStateChip',
      'heroPeakBalance',
      'heroCapacity',
      'btnUseWizard',
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
      'operationalGuidanceHost',
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
      'wizardDialog',
      'wizardTitle',
      'wizardSubtitle',
      'wizardProgressHost',
      'wizardStepHost',
      'wizardBodyShell',
      'wizardActionsHost',
      'btnCloseWizard',
      'wizardStatementUploadInput',
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
      wizardMeta: null,
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
          wizardMeta: scenario.wizardMeta && typeof scenario.wizardMeta === 'object'
            ? {
                mode: scenario.wizardMeta.mode === 'advanced' ? 'advanced' : 'basic',
                completedAt: String(scenario.wizardMeta.completedAt || ''),
              }
            : null,
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
          wizardMeta: scenario.wizardMeta || null,
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

  function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
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
      + statementParseMethodLabel(statement)
      + ' • '
      + statement.includedRowCount
      + ' included row'
      + (statement.includedRowCount === 1 ? '' : 's')
      + ' • '
      + formatMoney(reconciliation.reconciliationTotal, currency)
      + ' • '
      + reconciliationModeLabel(reconciliation.reconciliationMode);
  }

  function statementParseMethodLabel(statement) {
    if (!statement) return 'Statement import';
    const method = String(statement.parseMethod || '').trim();
    const extraction = statement.extraction || {};
    if (method === 'ai_assisted_json') return 'AI-assisted PDF extraction';
    if ((statement.sourceType === 'csv' || statement.sourceType === 'xlsx') && method === 'table_headers') return 'Spreadsheet import';
    if (method === 'heuristic_lines') return 'PDF heuristic recovery';
    if (extraction.strategy === 'ocr_pdf_text') return 'PDF OCR text';
    if (statement.sourceType === 'pdf') return 'PDF text extraction';
    return 'Statement import';
  }

  function stepStateLabel(state) {
    switch (state) {
      case 'complete':
        return 'Complete';
      case 'warning':
        return 'Needs attention';
      case 'current':
        return 'Current';
      default:
        return 'Next';
    }
  }

  function inferredOperationalCapacity(assumptions) {
    const raw = Engine.cloneJson(ensureScenarioArrays(assumptions));
    if (normaliseGrowthMode(raw.growthMode) === 'direct') {
      raw.contractor = raw.contractor || {};
      raw.contractor.additionalContractors = 0;
    }
    return Engine.analyseCapacity(raw);
  }

  function buildOperationalDeltaForecast(active, deltaContractors, inferredCapacity) {
    const unitGross = Number(inferredCapacity && inferredCapacity.unitGross) || 0;
    const unitNet = Number(inferredCapacity && inferredCapacity.unitNet) || 0;
    if (unitGross <= 0 || unitNet <= 0) return null;

    const raw = Engine.cloneJson(ensureScenarioArrays(active.assumptions));
    const mode = normaliseGrowthMode(raw.growthMode);

    if (mode === 'direct') {
      const payload = buildCalculationPayload(raw);
      const nextGross = Math.max(0, Number(payload.direct && payload.direct.scenarioWeeklyGross) + (deltaContractors * unitGross));
      const nextNet = Math.max(0, Number(payload.direct && payload.direct.scenarioWeeklyNet) + (deltaContractors * unitNet));
      return Engine.buildForecast(payload, {
        baseWeeklyNet: Number(payload.direct && payload.direct.baseWeeklyNet) || 0,
        baseWeeklyGross: Number(payload.direct && payload.direct.baseWeeklyGross) || 0,
        scenarioWeeklyNet: nextNet,
        scenarioWeeklyGross: nextGross,
      });
    }

    const currentAdditional = Number(raw.contractor && raw.contractor.additionalContractors) || 0;
    const currentWorkforce = Number(raw.contractor && raw.contractor.currentContractors) || 0;
    const nextAdditional = currentAdditional + deltaContractors;
    if (nextAdditional >= 0) {
      raw.contractor.additionalContractors = nextAdditional;
    } else {
      raw.contractor.additionalContractors = 0;
      raw.contractor.currentContractors = Math.max(0, currentWorkforce + nextAdditional);
    }
    return Engine.buildForecast(buildCalculationPayload(raw));
  }

  function buildOperationalGuidance(active) {
    if (!active || !active.result) return null;
    const result = active.result;
    const currency = active.assumptions.currency;
    const creditLimit = Number(result.metrics.creditLimit) || 0;
    const peakOverLimit = Number(result.metrics.peakOverLimit != null
      ? result.metrics.peakOverLimit
      : Math.max(0, (result.metrics.forecastPeakBalance || 0) - creditLimit)) || 0;
    const inferredCapacity = inferredOperationalCapacity(active.assumptions);
    const perContractorGross = Number(inferredCapacity && inferredCapacity.unitGross) || 0;
    const plusOneForecast = buildOperationalDeltaForecast(active, 1, inferredCapacity);
    const minusOneForecast = buildOperationalDeltaForecast(active, -1, inferredCapacity);
    const plusOneImpact = plusOneForecast
      ? Math.max(0, roundMoney(plusOneForecast.metrics.forecastPeakBalance - result.metrics.forecastPeakBalance))
      : 0;
    const minusOneRelief = minusOneForecast
      ? Math.max(0, roundMoney(result.metrics.forecastPeakBalance - minusOneForecast.metrics.forecastPeakBalance))
      : 0;
    const contractorEquivalentBasis = minusOneRelief > 0 ? minusOneRelief : plusOneImpact;
    const contractorEquivalentExcess = peakOverLimit > 0 && contractorEquivalentBasis > 0
      ? Math.round((peakOverLimit / contractorEquivalentBasis) * 10) / 10
      : null;
    const currentScenarioGross = Number(result.derived && result.derived.totalScenarioGross) || 0;
    const weeklyReductionToSafe = result.capacity && result.capacity.maxSafeWeeklyGrossIncrease != null
      ? Math.max(0, roundMoney(currentScenarioGross - result.capacity.maxSafeWeeklyGrossIncrease))
      : 0;
    const firstBreach = result.metrics.firstBreach;
    const peakWeekLabel = result.metrics.peakWeekNumber
      ? ('Week ' + result.metrics.peakWeekNumber)
      : 'Peak week';

    let lead = 'This scenario remains within the insured limit on the current assumptions.';
    if (result.overallStatus === 'over_limit') {
      lead = 'This scenario peaks '
        + formatMoney(peakOverLimit, currency)
        + ' over limit in '
        + peakWeekLabel
        + '.';
    } else if (result.overallStatus === 'at_risk') {
      lead = 'This scenario stays inside limit but enters the risk zone, with headroom tightening to '
        + formatMoney(result.metrics.minimumHeadroom, currency)
        + '.';
    }

    return {
      lead: lead,
      peakOverLimit: peakOverLimit,
      peakWeekLabel: peakWeekLabel,
      firstBreachLabel: firstBreach ? ('Week ' + firstBreach.weekNumber + ' • ' + Engine.formatLongDate(firstBreach.breachDate || firstBreach.weekCommencing)) : 'None forecast',
      perContractorGross: perContractorGross,
      contractorEquivalentExcess: contractorEquivalentExcess,
      contractorEquivalentBasis: contractorEquivalentBasis,
      plusOneImpact: plusOneImpact,
      minusOneRelief: minusOneRelief,
      weeklyReductionToSafe: weeklyReductionToSafe,
      inferredCapacityAvailable: !!(inferredCapacity && inferredCapacity.available),
      contractorsToRemove: Number(result.capacity && result.capacity.contractorsToRemove) || 0,
      additionalAllowed: result.capacity && result.capacity.available ? Number(result.capacity.maxAdditionalContractorsAllowed) || 0 : null,
      mode: normaliseGrowthMode(active.assumptions.growthMode),
    };
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
    if (assumptions.openingBalance
      && assumptions.openingBalance.importedStatement
      && Array.isArray(assumptions.openingBalance.importedStatement.adjustmentLines)
      && assumptions.openingBalance.importedStatement.adjustmentLines.some(function (line) {
        return line && line.include !== false && (Number(line.amount) !== 0 || String(line.note || '').trim() || String(line.date || '').trim());
      })) count += 1;
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
      const adjustmentCount = imported && Number(imported.adjustmentIncludedCount || 0);
      return imported
        ? ('Imported statement • ' + imported.includedRowCount + ' row' + (imported.includedRowCount === 1 ? '' : 's')
          + (adjustmentCount ? (' • ' + adjustmentCount + ' adjustment line' + (adjustmentCount === 1 ? '' : 's')) : ''))
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
      importedStatementAdjustmentCount: importedStatement ? Number(importedStatement.adjustmentIncludedCount || 0) : 0,
      importedStatementAdjustmentTotal: importedStatement ? Number(importedStatement.adjustmentTotal || 0) : 0,
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
      if (summary.importedStatement.parseMethod === 'ai_assisted_json') {
        warnings.push('AI-assisted extraction was used for this statement. Review the imported rows before sharing the forecast externally.');
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

  function buildStatementOptionsFromAssumptions(assumptions) {
    const source = assumptions && typeof assumptions === 'object' ? assumptions : Engine.DEFAULT_ASSUMPTIONS;
    return {
      scenarioCurrency: source.currency,
      paymentTerms: source.paymentTerms,
      forecastStartDate: source.forecastStartDate,
    };
  }

  function buildStatementOptions(scenario) {
    return buildStatementOptionsFromAssumptions(
      scenario && scenario.assumptions ? scenario.assumptions : Engine.DEFAULT_ASSUMPTIONS
    );
  }

  function defaultStatementAdjustmentLine(scenario) {
    const assumptions = scenario && scenario.assumptions ? scenario.assumptions : Engine.DEFAULT_ASSUMPTIONS;
    return {
      id: uid('import-adjustment'),
      include: true,
      date: assumptions.forecastStartDate || Engine.DEFAULT_ASSUMPTIONS.forecastStartDate,
      amount: 0,
      note: '',
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

  async function requestStatementImport(file, assumptions, options) {
    if (!file) {
      throw new Error('statement_file_required');
    }
    const data = await readFileAsBase64(file);
    return state.helpers.api('admin-credit-limit-statement-parse', 'POST', Object.assign({
      file: {
        name: file.name,
        contentType: file.type || '',
        size: file.size,
        data: data,
      },
    }, buildStatementOptionsFromAssumptions(assumptions), options || {}));
  }

  async function importOpeningBalanceStatement(file, scenario) {
    if (!file || !scenario) return;
    const token = ++state.statementImportTask.token;
    setStatementTask(scenario.id, true, 'reading', 'Reading file');
    renderWorkspace();

    try {
      if (token !== state.statementImportTask.token) return;
      setStatementTask(scenario.id, true, 'extracting', 'Extracting statement rows');
      renderWorkspace();

      const response = await requestStatementImport(file, scenario.assumptions);

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
        response.aiAssistUsed
          ? 'AI-assisted review ready'
          : (response.ok ? 'Ready for review' : 'Needs review')
      );
      renderWorkspace();
      const reconciliation = response.statement
        ? StatementImport.buildReconciliationSummary(response.statement, scenario.assumptions.currentOutstandingBalance)
        : null;
      state.helpers.toast.ok(
        response.aiAssistUsed
          ? 'AI-assisted statement extraction is ready for review.'
          : (response.ok
            ? (reconciliation && reconciliation.matches
              ? 'Statement ready for review and tied to the opening balance.'
              : 'Statement ready for review. Check the opening-balance reconciliation before confirming.')
            : 'Statement imported with warnings. Review before confirming.'),
        2400
      );
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
    const reconciliation = StatementImport.buildReconciliationSummary(
      active.assumptions.openingBalance.importedStatement,
      active.assumptions.currentOutstandingBalance
    );
    state.helpers.toast.ok(
      reconciliation.matches
        ? 'Imported statement is now driving the opening-balance receipts.'
        : 'Imported statement is live. Reconciliation is still different from the entered opening balance.',
      2600
    );
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

  function openDialogElement(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', 'open');
    }
  }

  function closeDialogElement(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      if (dialog.open) dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  function inferWizardMode(scenario) {
    return scenario && scenario.wizardMeta && scenario.wizardMeta.mode === 'advanced' ? 'advanced' : 'basic';
  }

  function inferWizardContractorInputMode(assumptions) {
    const contractor = assumptions && assumptions.contractor ? assumptions.contractor : {};
    if (Number(contractor.perContractorGrossInvoice) > 0 || Number(contractor.perContractorNetInvoice) > 0) {
      return 'gross';
    }
    if (Number(contractor.hourlyWage) > 0) {
      return 'hourly';
    }
    return 'pay';
  }

  function inferWizardDirectBasis(assumptions) {
    const direct = assumptions && assumptions.direct ? assumptions.direct : {};
    if (Number(direct.scenarioWeeklyGross) > 0 || Number(direct.baseWeeklyGross) > 0) {
      return 'gross';
    }
    return 'net';
  }

  function createWizardTask() {
    return {
      busy: false,
      stage: '',
      message: '',
      token: 0,
    };
  }

  function createWizardState(scenario) {
    const assumptions = cloneScenarioAssumptions(scenario && scenario.assumptions ? scenario.assumptions : Engine.DEFAULT_ASSUMPTIONS);
    const confirmed = activeImportedStatement(assumptions);
    return {
      open: true,
      step: 'welcome',
      mode: inferWizardMode(scenario),
      assumptions: assumptions,
      invoiceCadenceChoice: assumptions.invoice && assumptions.invoice.cadence === 'monthly' ? 'monthly' : 'weekly',
      contractorInputMode: inferWizardContractorInputMode(assumptions),
      directBasis: inferWizardDirectBasis(assumptions),
      statementDraft: confirmed
        ? StatementImport.materialiseImportedStatement(confirmed, buildStatementOptionsFromAssumptions(assumptions))
        : null,
      statementReviewed: !!confirmed,
      task: createWizardTask(),
      parseFailure: null,
      lastUploadedFile: null,
      lastUploadedFileName: confirmed ? confirmed.fileName : '',
      resetScroll: true,
      pendingFocus: true,
    };
  }

  function getWizard() {
    return state.wizard && state.wizard.open ? state.wizard : null;
  }

  function setWizardModalState(isOpen) {
    document.body.classList.toggle('clf-modal-open', !!isOpen);
  }

  function syncWizardViewport(wizard) {
    if (!wizard) return;
    const shouldReset = !!wizard.resetScroll;
    const shouldFocus = !!wizard.pendingFocus;
    if (!shouldReset && !shouldFocus) return;
    wizard.resetScroll = false;
    wizard.pendingFocus = false;
    window.requestAnimationFrame(function () {
      if (shouldReset && els.wizardBodyShell) {
        els.wizardBodyShell.scrollTop = 0;
      }
      if (!shouldFocus) return;
      const focusTarget = els.wizardStepHost && els.wizardStepHost.querySelector(
        '[data-wizard-autofocus], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
      );
      if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus({ preventScroll: true });
        return;
      }
      if (els.wizardTitle && typeof els.wizardTitle.focus === 'function') {
        els.wizardTitle.focus({ preventScroll: true });
      }
    });
  }

  function wizardStepDefinitions(wizard) {
    const steps = [
      { id: 'welcome', label: 'Mode' },
      { id: 'basics', label: 'Account setup' },
      { id: 'opening', label: 'Opening receipts' },
    ];
    if (wizard && wizard.assumptions && wizard.assumptions.openingBalance && wizard.assumptions.openingBalance.receiptMode === 'import_statement') {
      steps.push({ id: 'statement-upload', label: 'Upload statement' });
      if (wizard.statementDraft && Number(wizard.statementDraft.includedRowCount) > 0) {
        steps.push({ id: 'statement-review', label: 'Review import' });
      }
    }
    steps.push(
      { id: 'terms', label: 'Terms & tax' },
      { id: 'invoice', label: 'Invoice pattern' },
      { id: 'growth', label: 'Growth model' },
      { id: 'receipts', label: 'Receipt check' },
      { id: 'review', label: 'Review & run' }
    );
    return steps;
  }

  function ensureWizardStep() {
    const wizard = getWizard();
    if (!wizard) return [];
    const steps = wizardStepDefinitions(wizard);
    if (!steps.some(function (step) { return step.id === wizard.step; })) {
      if (steps.some(function (step) { return step.id === 'opening'; })) {
        wizard.step = 'opening';
      } else {
        wizard.step = steps[0] ? steps[0].id : 'welcome';
      }
    }
    return steps;
  }

  function wizardCurrentStepMeta() {
    const wizard = getWizard();
    const steps = ensureWizardStep();
    const index = steps.findIndex(function (step) { return step.id === (wizard && wizard.step); });
    return {
      steps: steps,
      index: index < 0 ? 0 : index,
      total: steps.length,
      current: steps[index < 0 ? 0 : index] || { id: 'welcome', label: 'Mode' },
      next: steps[index + 1] || null,
      previous: index > 0 ? steps[index - 1] : null,
    };
  }

  function wizardValueMultiplier(assumptions) {
    return assumptions && assumptions.vatApplicable ? 1 + (Number(assumptions.vatRate) || 0) / 100 : 1;
  }

  function setNestedValue(target, path, value) {
    const parts = String(path || '').split('.');
    let cursor = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (!cursor[parts[index]] || typeof cursor[parts[index]] !== 'object') {
        cursor[parts[index]] = {};
      }
      cursor = cursor[parts[index]];
    }
    cursor[parts[parts.length - 1]] = value;
  }

  function updateWizardAssumptions(mutator) {
    const wizard = getWizard();
    if (!wizard) return;
    mutator(wizard.assumptions);
    wizard.assumptions = ensureScenarioArrays(wizard.assumptions);
  }

  function refreshWizardStatementDraft() {
    const wizard = getWizard();
    if (!wizard || !wizard.statementDraft) return;
    wizard.statementDraft = StatementImport.materialiseImportedStatement(
      wizard.statementDraft,
      buildStatementOptionsFromAssumptions(wizard.assumptions)
    );
  }

  function updateWizardStatementDraft(mutator) {
    const wizard = getWizard();
    if (!wizard || !wizard.statementDraft) return;
    wizard.statementDraft = StatementImport.materialiseImportedStatement(
      mutator(Engine.cloneJson(wizard.statementDraft)),
      buildStatementOptionsFromAssumptions(wizard.assumptions)
    );
  }

  function setWizardTask(busy, stage, message, tokenOverride) {
    const wizard = getWizard();
    if (!wizard) return 0;
    wizard.task = {
      busy: !!busy,
      stage: stage || '',
      message: message || '',
      token: typeof tokenOverride === 'number'
        ? tokenOverride
        : (busy ? wizard.task.token + 1 : wizard.task.token),
    };
    return wizard.task.token;
  }

  function currentWizardAmountValue(wizard) {
    if (!wizard) return 0;
    if (wizard.directBasis === 'gross') {
      return Number(wizard.assumptions.direct && wizard.assumptions.direct.scenarioWeeklyGross) || 0;
    }
    return Number(wizard.assumptions.direct && wizard.assumptions.direct.scenarioWeeklyNet) || 0;
  }

  function applyWizardDirectScenarioValue(amount) {
    const wizard = getWizard();
    if (!wizard) return;
    const value = Math.max(0, Number(amount) || 0);
    const multiplier = wizardValueMultiplier(wizard.assumptions);
    updateWizardAssumptions(function (assumptions) {
      assumptions.direct.baseWeeklyNet = 0;
      assumptions.direct.baseWeeklyGross = 0;
      if (wizard.directBasis === 'gross') {
        assumptions.direct.scenarioWeeklyGross = value;
        assumptions.direct.scenarioWeeklyNet = roundMoney(multiplier > 0 ? value / multiplier : value);
      } else {
        assumptions.direct.scenarioWeeklyNet = value;
        assumptions.direct.scenarioWeeklyGross = roundMoney(value * multiplier);
      }
    });
  }

  function applyWizardContractorInputMode(mode) {
    const wizard = getWizard();
    if (!wizard) return;
    wizard.contractorInputMode = mode === 'gross' || mode === 'hourly' ? mode : 'pay';
    updateWizardAssumptions(function (assumptions) {
      const contractor = assumptions.contractor;
      if (wizard.contractorInputMode === 'pay') {
        contractor.hourlyWage = 0;
        contractor.perContractorGrossInvoice = 0;
        contractor.perContractorNetInvoice = 0;
      } else if (wizard.contractorInputMode === 'hourly') {
        contractor.weeklyPayPerContractor = 0;
        contractor.perContractorGrossInvoice = 0;
        contractor.perContractorNetInvoice = 0;
      } else {
        contractor.weeklyPayPerContractor = 0;
        contractor.hourlyWage = 0;
      }
    });
  }

  function applyWizardDirectBasis(basis) {
    const wizard = getWizard();
    if (!wizard) return;
    const nextBasis = basis === 'gross' ? 'gross' : 'net';
    const currentGross = Number(wizard.assumptions.direct && wizard.assumptions.direct.scenarioWeeklyGross) || 0;
    const currentNet = Number(wizard.assumptions.direct && wizard.assumptions.direct.scenarioWeeklyNet) || 0;
    wizard.directBasis = nextBasis;
    applyWizardDirectScenarioValue(nextBasis === 'gross' ? currentGross : currentNet);
  }

  function wizardStepIssues(stepId, wizard) {
    const issues = { blocking: [], warnings: [] };
    if (!wizard) return issues;
    const assumptions = wizard.assumptions;
    const receiptMode = assumptions.openingBalance.receiptMode;
    const growthMode = normaliseGrowthMode(assumptions.growthMode);
    const derived = Engine.deriveRunRateComponents(buildCalculationPayload(assumptions));
    const statement = wizard.statementDraft;

    switch (stepId) {
      case 'basics':
        if (!String(assumptions.clientName || '').trim()) {
          issues.blocking.push('Enter the client name so the forecast can be saved and reused clearly.');
        }
        if (Number(assumptions.creditLimit) <= 0) {
          issues.blocking.push('Enter the insured credit limit before continuing.');
        }
        break;
      case 'opening':
        if (receiptMode === 'even_runoff' && Number(assumptions.openingBalance.runoffWeeks) <= 0) {
          issues.blocking.push('Enter how many weeks the opening balance should run off across.');
        }
        if (receiptMode === 'no_receipts' && Number(assumptions.currentOutstandingBalance) > 0) {
          issues.warnings.push('No opening-balance receipts will be scheduled, so this route gives a harsher stress-test view.');
        }
        break;
      case 'statement-upload':
        if (!statement || Number(statement.includedRowCount) <= 0) {
          issues.blocking.push('Upload a debtor statement, or switch to another opening-balance receipt method.');
        }
        break;
      case 'statement-review':
        if (!statement || Number(statement.includedRowCount) <= 0) {
          issues.blocking.push('There are no imported rows ready to review yet.');
        }
        break;
      case 'terms':
        if (assumptions.paymentTerms.type === 'custom_net' && Number(assumptions.paymentTerms.customNetDays) <= 0) {
          issues.blocking.push('Enter the custom net days for this client.');
        }
        if (assumptions.vatApplicable && Number(assumptions.vatRate) <= 0) {
          issues.blocking.push('Enter the VAT rate, or switch VAT off if it does not apply.');
        }
        break;
      case 'growth':
        if (growthMode === 'contractor') {
          if (derived.capacityUnitGross <= 0) {
            issues.blocking.push('Enter the contractor value basis so the wizard can model each extra contractor.');
          }
          if (Number(assumptions.contractor.additionalContractors) < 0) {
            issues.blocking.push('Additional contractors cannot be negative in the wizard flow.');
          }
        } else if (Number(derived.totalScenarioGross) <= 0) {
          issues.blocking.push('Enter the weekly uplift amount you want to test.');
        }
        break;
      case 'receipts':
        if (receiptMode === 'manual' && (!Array.isArray(assumptions.receiptLines) || !assumptions.receiptLines.length)) {
          issues.warnings.push('Manual opening-balance mode is selected, but no dated opening-balance receipts have been added yet.');
        }
        if (receiptMode === 'import_statement' && statement) {
          const reconciliation = StatementImport.buildReconciliationSummary(statement, assumptions.currentOutstandingBalance);
          if (!reconciliation.matches) {
            issues.warnings.push('The imported statement total does not match the opening balance yet. Choose the reconciliation handling before you run the forecast.');
          }
        }
        break;
      case 'review':
        if (receiptMode === 'import_statement') {
          if (!statement || Number(statement.includedRowCount) <= 0) {
            issues.blocking.push('Import statement mode is selected, but no imported rows have been confirmed.');
          }
        }
        if (growthMode === 'contractor' && derived.capacityUnitGross <= 0) {
          issues.blocking.push('The current contractor-value setup does not produce a usable weekly value yet.');
        }
        if (growthMode === 'direct' && Number(derived.totalScenarioGross) <= 0) {
          issues.blocking.push('The direct weekly uplift is still blank.');
        }
        if (receiptMode === 'no_receipts' && Number(assumptions.currentOutstandingBalance) > 0) {
          issues.warnings.push('This setup keeps the opening receivables static, so the result is a deliberate stress-test view.');
        }
        break;
      default:
        break;
    }

    return issues;
  }

  function wizardGlobalIssues(wizard) {
    return wizardStepDefinitions(wizard)
      .filter(function (step) { return step.id !== 'welcome'; })
      .reduce(function (memo, step) {
        const issues = wizardStepIssues(step.id, wizard);
        memo.blocking = memo.blocking.concat(issues.blocking);
        memo.warnings = memo.warnings.concat(issues.warnings);
        return memo;
      }, { blocking: [], warnings: [] });
  }

  function wizardReliability(wizard) {
    const statement = wizard && wizard.statementDraft;
    const receiptMode = wizard && wizard.assumptions && wizard.assumptions.openingBalance
      ? wizard.assumptions.openingBalance.receiptMode
      : 'term_profile';
    const issues = wizardGlobalIssues(wizard);
    if (issues.blocking.length) {
      return {
        tone: 'danger',
        label: 'Needs review',
        note: 'Some essentials are still missing before the wizard can hand back a dependable result.',
      };
    }
    if (receiptMode === 'import_statement' && statement) {
      if (statement.confidence === 'high' && wizard.statementReviewed) {
        return {
          tone: 'ok',
          label: 'High confidence',
          note: 'Imported statement rows have been reviewed and the timing assumptions are complete.',
        };
      }
      return {
        tone: 'warn',
        label: 'Medium confidence',
        note: 'Imported statement rows are available, but keep a close eye on the review grid and reconciliation before sharing the result.',
      };
    }
    if (receiptMode === 'manual' || receiptMode === 'even_runoff' || receiptMode === 'term_profile') {
      return {
        tone: 'warn',
        label: 'Medium confidence',
        note: 'The setup is usable, but the opening-balance receipt schedule is still based on assumptions rather than a ledger import.',
      };
    }
    return {
      tone: 'danger',
      label: 'Needs review',
      note: 'No opening-balance receipt plan is active, so the result will reflect a harsher stress-test position.',
    };
  }

  function wizardDisplayValue(path, fallback) {
    const wizard = getWizard();
    if (!wizard) return fallback == null ? '' : fallback;
    const parts = String(path || '').split('.');
    let cursor = wizard.assumptions;
    for (let index = 0; index < parts.length; index += 1) {
      cursor = cursor && cursor[parts[index]];
    }
    return cursor == null ? (fallback == null ? '' : fallback) : cursor;
  }

  function wizardAlertMarkup(issues) {
    const cards = [];
    issues.blocking.forEach(function (message) {
      cards.push('<div class="clf-alert" data-tone="danger"><strong>Complete this step</strong><span>' + escapeHtml(message) + '</span></div>');
    });
    issues.warnings.forEach(function (message) {
      cards.push('<div class="clf-alert" data-tone="warn"><strong>Check this before you run</strong><span>' + escapeHtml(message) + '</span></div>');
    });
    return cards.join('');
  }

  function wizardStepTitle(stepId) {
    switch (stepId) {
      case 'welcome': return 'Set up this forecast with the wizard';
      case 'basics': return 'Client and currency basics';
      case 'opening': return 'Treat the opening balance';
      case 'statement-upload': return 'Upload a debtor statement';
      case 'statement-review': return 'Review imported statement rows';
      case 'terms': return 'Payment terms and VAT';
      case 'invoice': return 'Normal invoicing pattern';
      case 'growth': return 'Choose the growth test';
      case 'receipts': return 'Check expected payments and receipts';
      case 'review': return 'Review before the forecast runs';
      default: return 'Wizard';
    }
  }

  function wizardStepSubtitle(stepId, wizard) {
    switch (stepId) {
      case 'welcome':
        return 'Choose the quickest path for this forecast. You can still edit the live form afterwards.';
      case 'basics':
        return 'These figures are the starting point for the insured-limit check.';
      case 'opening':
        return wizard && wizard.mode === 'advanced'
          ? 'Choose how expected cash collections from the opening receivables should be handled.'
          : 'Pick the simplest way to treat receipts against the starting receivables.';
      case 'statement-upload':
        return 'Upload a PDF, XLSX, or CSV statement so the opening balance can be scheduled using actual invoice due dates.';
      case 'statement-review':
        return 'Check the rows, tick what should be included, and reconcile them to the opening balance.';
      case 'terms':
        return 'These settings control when invoices are expected to turn into cash receipts.';
      case 'invoice':
        return 'Keep this light. Choose the closest invoicing rhythm and only open advanced timing later if needed.';
      case 'growth':
        return 'Choose one modelling method only. The inactive path stays out of the live calculation.';
      case 'receipts':
        return 'Confirm the opening-balance receipt plan before the forecast is generated.';
      case 'review':
        return 'This is the final sense-check before the wizard updates the live forecast.';
      default:
        return '';
    }
  }

  function wizardReceiptModeChoice(mode, title, text, active) {
    return '<button class="clf-wizard-choice' + (active ? ' is-active' : '') + '" type="button" data-wizard-opening-mode="' + escapeAttr(mode) + '">'
      + '<strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(text) + '</span></button>';
  }

  function wizardChoiceButton(type, value, title, text, active) {
    return '<button class="clf-wizard-choice' + (active ? ' is-active' : '') + '" type="button" data-wizard-choice-type="' + escapeAttr(type) + '" data-wizard-choice-value="' + escapeAttr(value) + '">'
      + '<strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(text) + '</span></button>';
  }

  function renderWizardWelcome(wizard) {
    return '<article class="clf-wizard-content-card">'
      + '<div class="clf-wizard-choice-grid">'
      + wizardChoiceButton('mode', 'basic', 'Basic', 'Use this for a quick answer on whether more people can be added safely. Best for standard weekly checks.', wizard.mode !== 'advanced')
      + wizardChoiceButton('mode', 'advanced', 'Advanced', 'Use this when you need statement imports, custom receipt timing, receipt overrides, or tighter control.', wizard.mode === 'advanced')
      + '</div>'
      + '<div class="clf-wizard-inline-note"><strong>What happens next</strong><span>The wizard will ask only the essentials, populate the live forecaster for you, and then run the report automatically when you finish.</span></div>'
      + '</article>';
  }

  function renderWizardBasics(wizard) {
    return '<article class="clf-wizard-content-card">'
      + '<div class="clf-wizard-grid">'
      + '<label class="clf-field clf-field-full"><span class="clf-label">Client name</span><input type="text" data-wizard-field="clientName" value="' + escapeAttr(wizardDisplayValue('clientName')) + '" placeholder="Client account"/></label>'
      + '<label class="clf-field clf-field-full"><span class="clf-label">Scenario name</span><input type="text" data-wizard-field="scenarioName" value="' + escapeAttr(wizardDisplayValue('scenarioName')) + '" placeholder="Base case"/></label>'
      + '<label class="clf-field"><span class="clf-label">Currency</span><select data-wizard-field="currency"><option value="GBP"' + (wizardDisplayValue('currency', 'GBP') === 'GBP' ? ' selected' : '') + '>GBP</option><option value="EUR"' + (wizardDisplayValue('currency', 'GBP') === 'EUR' ? ' selected' : '') + '>EUR</option></select></label>'
      + '<label class="clf-field"><span class="clf-label">Credit limit</span><input type="number" min="0" step="0.01" inputmode="decimal" data-wizard-field="creditLimit" value="' + escapeAttr(String(wizardDisplayValue('creditLimit', 0))) + '"/></label>'
      + '<label class="clf-field"><span class="clf-label">Current opening balance</span><input type="number" min="0" step="0.01" inputmode="decimal" data-wizard-field="currentOutstandingBalance" value="' + escapeAttr(String(wizardDisplayValue('currentOutstandingBalance', 0))) + '"/></label>'
      + '<label class="clf-field"><span class="clf-label">Forecast horizon (weeks)</span><input type="number" min="4" max="52" step="1" inputmode="numeric" data-wizard-field="forecastHorizonWeeks" value="' + escapeAttr(String(wizardDisplayValue('forecastHorizonWeeks', 20))) + '"/></label>'
      + '</div>'
      + '</article>';
  }

  function renderWizardOpeningStep(wizard) {
    const mode = wizard.assumptions.openingBalance.receiptMode;
    const rows = [];
    rows.push('<article class="clf-wizard-content-card">');
    rows.push('<div class="clf-wizard-choice-grid">');
    rows.push(wizardReceiptModeChoice('import_statement', 'Upload statement', 'Best if you have a PDF, Excel, or CSV debtor statement or open invoice ledger.', mode === 'import_statement'));
    rows.push(wizardReceiptModeChoice('manual', 'Enter expected receipts manually', 'Best if you already know a few payment dates and values.', mode === 'manual'));
    rows.push(wizardReceiptModeChoice('even_runoff', 'Spread opening balance across future weeks', 'Use a simple runoff estimate when exact payment dates are unknown.', mode === 'even_runoff'));
    rows.push(wizardReceiptModeChoice('no_receipts', 'No opening-balance receipts yet', 'Use a harsher stress-test view only.', mode === 'no_receipts'));
    if (wizard.mode === 'advanced') {
      rows.push(wizardReceiptModeChoice('term_profile', 'Follow payment-term profile', 'Estimate runoff from the opening ledger using the selected payment terms and invoicing pattern.', mode === 'term_profile'));
    }
    rows.push('</div>');
    if (mode === 'even_runoff') {
      rows.push('<div class="clf-wizard-grid"><label class="clf-field"><span class="clf-label">Runoff weeks</span><input type="number" min="1" max="26" step="1" inputmode="numeric" data-wizard-field="openingBalance.runoffWeeks" value="' + escapeAttr(String(wizardDisplayValue('openingBalance.runoffWeeks', 6))) + '"/></label></div>');
    }
    if (mode === 'import_statement') {
      rows.push('<div class="clf-wizard-inline-note"><strong>Recommended path</strong><span>Upload the statement next. The wizard will review the rows before they are used in the forecast.</span></div>');
    } else if (mode === 'manual') {
      rows.push('<div class="clf-wizard-inline-note"><strong>Manual route</strong><span>You can add dated opening-balance receipts in the next receipt check step.</span></div>');
    } else if (mode === 'term_profile') {
      rows.push('<div class="clf-wizard-inline-note"><strong>Approximation</strong><span>This uses the selected terms and invoice cadence to estimate runoff from the opening ledger without pretending to know exact aged-debtor dates.</span></div>');
    } else if (mode === 'no_receipts') {
      rows.push('<div class="clf-wizard-inline-note"><strong>Stress-test view</strong><span>The starting receivables will remain in place unless you add manual receipts later.</span></div>');
    }
    rows.push('</article>');
    return rows.join('');
  }

  function renderWizardImportProgress(task) {
    const stages = [
      { id: 'uploading', label: 'Uploading statement' },
      { id: 'reading', label: 'Reading content' },
      { id: 'extracting', label: 'Extracting invoice rows' },
      { id: 'ai_assist', label: 'Trying backup extraction' },
      { id: 'review', label: 'Preparing review' },
    ];
    return '<div class="clf-list">'
      + stages.map(function (stage, index) {
        const isCurrent = task.stage === stage.id;
        const isComplete = task.stage && (stages.findIndex(function (entry) { return entry.id === task.stage; }) > index);
        return '<div class="clf-list-card"><strong>' + escapeHtml(stage.label) + '</strong><span>'
          + escapeHtml(isCurrent ? (task.message || 'Working…') : (isComplete ? 'Complete' : 'Waiting'))
          + '</span></div>';
      }).join('')
      + '</div>';
  }

  function renderWizardStatementUpload(wizard) {
    const failure = wizard.parseFailure;
    const statement = wizard.statementDraft;
    const summary = statement
      ? statementSummary(statement, wizard.assumptions.currentOutstandingBalance, wizard.assumptions.currency)
      : 'No statement imported yet';
    const rows = [];
    rows.push('<article class="clf-wizard-content-card">');
    rows.push('<article class="clf-import-card clf-upload-card" data-dropzone="wizard-statement-upload">');
    rows.push('<div class="clf-card-head"><div><p class="clf-kicker">Upload statement</p><h3>PDF, XLSX, or CSV</h3></div>');
    if (statement) {
      rows.push('<span class="clf-chip" data-tone="' + escapeAttr(statementConfidenceTone(statement.confidence)) + '">' + escapeHtml(statementConfidenceLabel(statement.confidence)) + '</span>');
    }
    rows.push('</div>');
    rows.push('<p class="clf-inline-note">Upload a debtor statement or open invoice report so the wizard can estimate when the opening balance is likely to be paid.</p>');
    rows.push('<div class="clf-toolbar clf-no-print"><button class="clf-btn clf-btn-primary" type="button" data-wizard-action="browse-upload">Upload statement</button>');
    if (wizard.lastUploadedFileName) {
      rows.push('<span class="clf-chip" data-tone="neutral">' + escapeHtml(wizard.lastUploadedFileName) + '</span>');
    }
    rows.push('</div>');
    rows.push('<p class="clf-muted-small">Supported files: PDF, XLSX, CSV.</p>');
    rows.push('</article>');
    if (wizard.task.busy) {
      rows.push('<div class="clf-wizard-inline-note"><strong>' + escapeHtml(wizard.task.message || 'Preparing your receipt schedule…') + '</strong><span>The wizard is reading the file and building a reviewable opening-balance schedule.</span></div>');
      rows.push(renderWizardImportProgress(wizard.task));
    }
    if (failure) {
      rows.push('<div class="clf-alert" data-tone="warn"><strong>We could not read this statement confidently</strong><span>'
        + escapeHtml((failure.warnings && failure.warnings[0]) || 'You can keep going with another receipt method, or try a cleaner spreadsheet export.')
        + '</span></div>');
      rows.push('<div class="clf-toolbar">');
      if (failure.aiAssistAvailable && !failure.aiAssistUsed && wizard.lastUploadedFile) {
        rows.push('<button class="clf-btn clf-btn-secondary" type="button" data-wizard-action="try-ai-import">Try AI-assisted extraction</button>');
      }
      rows.push('<button class="clf-btn clf-btn-ghost" type="button" data-wizard-fallback="manual">Enter receipts manually</button>');
      rows.push('<button class="clf-btn clf-btn-ghost" type="button" data-wizard-fallback="runoff">Spread opening balance</button>');
      rows.push('<button class="clf-btn clf-btn-ghost" type="button" data-wizard-fallback="no_receipts">Continue without statement import</button>');
      rows.push('</div>');
      if (Array.isArray(failure.fallbackOptions) && failure.fallbackOptions.length) {
        rows.push('<div class="clf-wizard-pill-row">' + failure.fallbackOptions.map(function (item) {
          return '<span class="clf-wizard-pill">' + escapeHtml(item) + '</span>';
        }).join('') + '</div>');
      }
    }
    if (statement && Number(statement.includedRowCount) > 0) {
      rows.push('<div class="clf-wizard-inline-note"><strong>Ready for review</strong><span>' + escapeHtml(summary) + '</span></div>');
    }
    rows.push('</article>');
    return rows.join('');
  }

  function renderWizardStatementReview(wizard) {
    const statement = wizard.statementDraft;
    if (!statement) {
      return '<article class="clf-wizard-content-card"><div class="clf-wizard-empty">Upload a statement first so the wizard has rows to review.</div></article>';
    }
    const reconciliation = StatementImport.buildReconciliationSummary(statement, wizard.assumptions.currentOutstandingBalance);
    const mappingRows = statement.rawTable && Array.isArray(statement.rawTable.headers)
      ? [
          ['invoiceRef', 'Invoice ref'],
          ['invoiceDate', 'Invoice date'],
          ['dueDate', 'Due date'],
          ['outstandingAmount', 'Outstanding amount'],
          ['currency', 'Currency'],
          ['status', 'Status'],
        ]
      : [];
    return '<article class="clf-wizard-content-card">'
      + '<div class="clf-wizard-review-grid">'
      + '<div class="clf-mini-card"><strong>' + escapeHtml(String(statement.includedRowCount || 0)) + '</strong><span>Included rows</span></div>'
      + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.reconciliationTotal || 0, wizard.assumptions.currency)) + '</strong><span>Imported opening-book total</span></div>'
      + '<div class="clf-mini-card"><strong>' + escapeHtml(statementParseMethodLabel(statement)) + '</strong><span>Parsing method</span></div>'
      + '</div>'
      + wizardAlertMarkup({
        blocking: [],
        warnings: (statement.warnings || []).slice(0, 4).concat(reconciliation.matches ? [] : ['Imported total differs from the entered opening balance.'])
      })
      + (mappingRows.length
        ? '<div class="clf-wizard-grid">'
          + mappingRows.map(function (entry) {
            const field = entry[0];
            const label = entry[1];
            const current = statement.mapping && statement.mapping[field] ? statement.mapping[field] : '';
            return '<label class="clf-field"><span class="clf-label">' + escapeHtml(label) + '</span><select data-wizard-import-map-field="' + escapeAttr(field) + '">'
              + '<option value="">Not mapped</option>'
              + statement.rawTable.headers.map(function (header) {
                return '<option value="' + escapeAttr(header) + '"' + (header === current ? ' selected' : '') + '>' + escapeHtml(header) + '</option>';
              }).join('')
              + '</select></label>';
          }).join('')
          + '</div>'
        : '')
      + '<div class="clf-wizard-table-wrap"><table class="clf-wizard-table"><thead><tr><th>Include</th><th>Invoice ref</th><th>Invoice date</th><th>Due date</th><th>Outstanding amount</th><th>Currency</th><th>Warnings / note</th></tr></thead><tbody>'
      + statement.rows.map(function (row, index) {
        const note = row.note || (Array.isArray(row.warnings) && row.warnings[0]) || '';
        return '<tr>'
          + '<td><input type="checkbox" data-wizard-import-row-index="' + index + '" data-wizard-import-key="include"' + (row.include !== false ? ' checked' : '') + '/></td>'
          + '<td><input type="text" data-wizard-import-row-index="' + index + '" data-wizard-import-key="invoiceRef" value="' + escapeAttr(row.invoiceRef || '') + '"/></td>'
          + '<td data-cell="date"><input type="date" data-wizard-import-row-index="' + index + '" data-wizard-import-key="invoiceDate" value="' + escapeAttr(row.invoiceDate || '') + '"/></td>'
          + '<td data-cell="date"><input type="date" data-wizard-import-row-index="' + index + '" data-wizard-import-key="dueDate" value="' + escapeAttr(row.dueDate || '') + '"/></td>'
          + '<td data-cell="amount"><input type="number" min="-999999999" step="0.01" data-wizard-import-row-index="' + index + '" data-wizard-import-key="outstandingAmount" value="' + escapeAttr(String(row.outstandingAmount || 0)) + '"/></td>'
          + '<td><input type="text" maxlength="3" data-wizard-import-row-index="' + index + '" data-wizard-import-key="currency" value="' + escapeAttr(row.currency || '') + '"/></td>'
          + '<td><input type="text" data-wizard-import-row-index="' + index + '" data-wizard-import-key="note" value="' + escapeAttr(note) + '"/></td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div>'
      + '<div class="clf-wizard-reconcile-grid">'
      + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(wizard.assumptions.currentOutstandingBalance || 0, wizard.assumptions.currency)) + '</strong><span>Entered opening balance</span></div>'
      + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.importedTotal || 0, wizard.assumptions.currency)) + '</strong><span>Imported rows total</span></div>'
      + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.adjustmentTotal || 0, wizard.assumptions.currency)) + '</strong><span>Adjustment lines</span></div>'
      + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.variance || 0, wizard.assumptions.currency)) + '</strong><span>Variance</span></div>'
      + '</div>'
      + '<div class="clf-wizard-grid">'
      + '<label class="clf-field"><span class="clf-label">Reconciliation handling</span><select data-wizard-import-setting="reconciliationMode">'
      + ['keep_manual_opening_balance', 'use_imported_total', 'scale_to_opening_balance'].map(function (mode) {
        return '<option value="' + escapeAttr(mode) + '"' + (statement.reconciliationMode === mode ? ' selected' : '') + '>' + escapeHtml(reconciliationModeLabel(mode)) + '</option>';
      }).join('')
      + '</select></label>'
      + '<label class="clf-field"><span class="clf-label">Overdue collection delay (days)</span><input type="number" min="0" max="60" step="1" data-wizard-import-setting="overdueCollectionDays" value="' + escapeAttr(String(statement.overdueCollectionDays || 0)) + '"/></label>'
      + '</div>'
      + '<div class="clf-card-head"><div><p class="clf-kicker">Adjustment lines</p><h3>Reconcile anything missing from the upload</h3></div><button class="clf-btn clf-btn-secondary" type="button" data-wizard-action="add-import-adjustment">Add adjustment line</button></div>'
      + '<div class="clf-wizard-table-wrap"><table class="clf-wizard-table"><thead><tr><th>Include</th><th>Date</th><th>Amount</th><th>Note</th><th>Action</th></tr></thead><tbody>'
      + ((statement.adjustmentLines || []).length
        ? statement.adjustmentLines.map(function (line, index) {
          return '<tr>'
            + '<td><input type="checkbox" data-wizard-adjustment-index="' + index + '" data-wizard-adjustment-key="include"' + (line.include !== false ? ' checked' : '') + '/></td>'
            + '<td data-cell="date"><input type="date" data-wizard-adjustment-index="' + index + '" data-wizard-adjustment-key="date" value="' + escapeAttr(line.date || '') + '"/></td>'
            + '<td data-cell="amount"><input type="number" min="-999999999" step="0.01" data-wizard-adjustment-index="' + index + '" data-wizard-adjustment-key="amount" value="' + escapeAttr(String(line.amount || 0)) + '"/></td>'
            + '<td><input type="text" data-wizard-adjustment-index="' + index + '" data-wizard-adjustment-key="note" value="' + escapeAttr(line.note || '') + '"/></td>'
            + '<td><button class="clf-btn clf-btn-ghost" type="button" data-wizard-action="remove-import-adjustment" data-adjustment-index="' + index + '">Remove</button></td>'
            + '</tr>';
        }).join('')
        : '<tr><td colspan="5"><div class="clf-wizard-empty">No adjustment lines yet. Add one only if the upload does not fully represent the opening balance.</div></td></tr>')
      + '</tbody></table></div>'
      + '</article>';
  }

  function renderWizardTerms(wizard) {
    const termsType = wizard.assumptions.paymentTerms.type;
    return '<article class="clf-wizard-content-card">'
      + '<div class="clf-wizard-choice-grid">'
      + wizardChoiceButton('terms', '30_eom', '30 days end of month', 'Common HMJ funding/credit-control view when invoices collect after month end.', termsType === '30_eom')
      + wizardChoiceButton('terms', '30_from_invoice', '30 days from invoice date', 'Each invoice is collected 30 days after its own invoice date.', termsType === '30_from_invoice')
      + wizardChoiceButton('terms', '14_net', '14 day net', 'Use when the client typically pays within two weeks.', termsType === '14_net')
      + wizardChoiceButton('terms', 'custom_net', 'Custom days', 'Enter a client-specific net-day assumption.', termsType === 'custom_net')
      + '</div>'
      + '<div class="clf-wizard-grid">'
      + '<label class="clf-field"><span class="clf-label">VAT applies</span><select data-wizard-field="vatApplicable" data-wizard-value-type="boolean"><option value="true"' + (wizard.assumptions.vatApplicable ? ' selected' : '') + '>Yes</option><option value="false"' + (!wizard.assumptions.vatApplicable ? ' selected' : '') + '>No</option></select></label>'
      + '<label class="clf-field"><span class="clf-label">VAT rate (%)</span><input type="number" min="0" max="100" step="0.01" inputmode="decimal" data-wizard-field="vatRate" value="' + escapeAttr(String(wizard.assumptions.vatRate || 0)) + '"' + (wizard.assumptions.vatApplicable ? '' : ' disabled') + '/></label>'
      + (termsType === 'custom_net'
        ? '<label class="clf-field"><span class="clf-label">Custom net days</span><input type="number" min="1" max="180" step="1" inputmode="numeric" data-wizard-field="paymentTerms.customNetDays" value="' + escapeAttr(String(wizard.assumptions.paymentTerms.customNetDays || 0)) + '"/></label>'
        : '')
      + '<label class="clf-field"><span class="clf-label">Receipt lag buffer (days)</span><input type="number" min="0" max="60" step="1" inputmode="numeric" data-wizard-field="paymentTerms.receiptLagDays" value="' + escapeAttr(String(wizard.assumptions.paymentTerms.receiptLagDays || 0)) + '"/></label>'
      + '</div>'
      + '<div class="clf-wizard-inline-note"><strong>How this affects receipts</strong><span>If VAT is off, gross equals net. Any receipt lag buffer pushes both imported and forecast-generated receipts later.</span></div>'
      + '</article>';
  }

  function renderWizardInvoicePattern(wizard) {
    const cadence = wizard.invoiceCadenceChoice || wizard.assumptions.invoice.cadence;
    const choices = [
      wizardChoiceButton('cadence', 'weekly', 'Weekly', 'Best for normal weekly contractor invoicing.', cadence === 'weekly'),
      wizardChoiceButton('cadence', 'monthly', 'Monthly', 'Use when invoices are grouped into one monthly event.', cadence === 'monthly'),
    ];
    if (wizard.mode === 'advanced') {
      choices.push(wizardChoiceButton('cadence', 'custom', 'Custom', 'Use the wizard to get close, then finish the timing detail in the advanced form.', cadence === 'custom'));
    }
    return '<article class="clf-wizard-content-card">'
      + '<div class="clf-wizard-choice-grid">' + choices.join('') + '</div>'
      + '<div class="clf-wizard-grid">'
      + '<label class="clf-field"><span class="clf-label">Invoice weekday</span><select data-wizard-field="invoice.invoiceWeekday">'
      + [0, 1, 2, 3, 4, 5, 6].map(function (value) {
        return '<option value="' + value + '"' + (Number(wizard.assumptions.invoice.invoiceWeekday) === value ? ' selected' : '') + '>' + escapeHtml(Engine.weekdayLabel(value)) + '</option>';
      }).join('')
      + '</select></label>'
      + '<label class="clf-field"><span class="clf-label">Count invoice dates automatically</span><select data-wizard-field="invoice.autoCountDates" data-wizard-value-type="boolean"><option value="true"' + (wizard.assumptions.invoice.autoCountDates !== false ? ' selected' : '') + '>Yes</option><option value="false"' + (wizard.assumptions.invoice.autoCountDates === false ? ' selected' : '') + '>No</option></select></label>'
      + '</div>'
      + (cadence === 'custom'
        ? '<div class="clf-wizard-inline-note"><strong>Advanced timing will stay available afterwards</strong><span>The wizard will get you started, then leave the advanced invoice-date controls visible in the live form for final tuning.</span></div>'
        : '')
      + '</article>';
  }

  function renderWizardGrowth(wizard) {
    const growthMode = normaliseGrowthMode(wizard.assumptions.growthMode);
    const contractor = wizard.assumptions.contractor;
    const directValue = currentWizardAmountValue(wizard);
    const multiplier = wizardValueMultiplier(wizard.assumptions);
    return '<article class="clf-wizard-content-card">'
      + '<div class="clf-wizard-choice-grid">'
      + wizardChoiceButton('growth-mode', 'contractor', 'Extra contractors', 'Use this to test how many more contractor slots can be added safely.', growthMode === 'contractor')
      + wizardChoiceButton('growth-mode', 'direct', 'Direct weekly invoice uplift', 'Use this when you know the weekly invoice increase but not the headcount build-up.', growthMode === 'direct')
      + '</div>'
      + (growthMode === 'contractor'
        ? '<div class="clf-wizard-grid">'
          + '<label class="clf-field"><span class="clf-label">Current workforce</span><input type="number" min="0" step="1" inputmode="numeric" data-wizard-field="contractor.currentContractors" value="' + escapeAttr(String(contractor.currentContractors || 0)) + '"/></label>'
          + '<label class="clf-field"><span class="clf-label">Additional contractors to test</span><input type="number" min="0" step="1" inputmode="numeric" data-wizard-field="contractor.additionalContractors" value="' + escapeAttr(String(contractor.additionalContractors || 0)) + '"/></label>'
          + '<div class="clf-field clf-field-full"><span class="clf-label">Per-contractor value basis</span><div class="clf-toolbar">'
          + '<button class="clf-btn' + (wizard.contractorInputMode === 'pay' ? ' clf-btn-primary' : ' clf-btn-ghost') + '" type="button" data-wizard-action="set-contractor-mode" data-value="pay">Weekly pay</button>'
          + '<button class="clf-btn' + (wizard.contractorInputMode === 'gross' ? ' clf-btn-primary' : ' clf-btn-ghost') + '" type="button" data-wizard-action="set-contractor-mode" data-value="gross">Gross value</button>'
          + '<button class="clf-btn' + (wizard.contractorInputMode === 'hourly' ? ' clf-btn-primary' : ' clf-btn-ghost') + '" type="button" data-wizard-action="set-contractor-mode" data-value="hourly">Hourly rate</button>'
          + '</div></div>'
          + (wizard.contractorInputMode === 'gross'
            ? '<label class="clf-field"><span class="clf-label">Gross value per contractor</span><input type="number" min="0" step="0.01" inputmode="decimal" data-wizard-field="contractor.perContractorGrossInvoice" value="' + escapeAttr(String(contractor.perContractorGrossInvoice || 0)) + '"/></label>'
              + '<div class="clf-wizard-inline-note"><strong>Gross basis</strong><span>'
              + escapeHtml(wizard.assumptions.vatApplicable ? ('Net per contractor will be derived using VAT at ' + wizard.assumptions.vatRate + '%.') : 'VAT is off, so gross equals net.')
              + '</span></div>'
            : (wizard.contractorInputMode === 'hourly'
              ? '<label class="clf-field"><span class="clf-label">Hourly wage</span><input type="number" min="0" step="0.01" inputmode="decimal" data-wizard-field="contractor.hourlyWage" value="' + escapeAttr(String(contractor.hourlyWage || 0)) + '"/></label>'
                + '<label class="clf-field"><span class="clf-label">Weekly hours</span><input type="number" min="0" step="0.01" inputmode="decimal" data-wizard-field="contractor.weeklyHours" value="' + escapeAttr(String(contractor.weeklyHours || 40)) + '"/></label>'
                + '<label class="clf-field"><span class="clf-label">Margin / uplift %</span><input type="number" min="0" step="0.01" inputmode="decimal" data-wizard-field="contractor.marginPercent" value="' + escapeAttr(String(contractor.marginPercent || 0)) + '"/></label>'
              : '<label class="clf-field"><span class="clf-label">Weekly pay per contractor</span><input type="number" min="0" step="0.01" inputmode="decimal" data-wizard-field="contractor.weeklyPayPerContractor" value="' + escapeAttr(String(contractor.weeklyPayPerContractor || 0)) + '"/></label>'
                + '<label class="clf-field"><span class="clf-label">Margin / uplift %</span><input type="number" min="0" step="0.01" inputmode="decimal" data-wizard-field="contractor.marginPercent" value="' + escapeAttr(String(contractor.marginPercent || 0)) + '"/></label>'))
          + '</div>'
        : '<div class="clf-wizard-grid">'
          + '<div class="clf-field clf-field-full"><span class="clf-label">Weekly uplift basis</span><div class="clf-toolbar">'
          + '<button class="clf-btn' + (wizard.directBasis === 'gross' ? ' clf-btn-primary' : ' clf-btn-ghost') + '" type="button" data-wizard-action="set-direct-basis" data-value="gross">Gross</button>'
          + '<button class="clf-btn' + (wizard.directBasis === 'net' ? ' clf-btn-primary' : ' clf-btn-ghost') + '" type="button" data-wizard-action="set-direct-basis" data-value="net">Net</button>'
          + '</div></div>'
          + '<label class="clf-field"><span class="clf-label">Weekly invoice increase (' + escapeHtml(wizard.directBasis.toUpperCase()) + ')</span><input type="number" min="0" step="0.01" inputmode="decimal" data-wizard-action="set-direct-value" value="' + escapeAttr(String(directValue || 0)) + '"/></label>'
          + '<div class="clf-wizard-inline-note"><strong>Auto-calculated counterpart</strong><span>'
          + escapeHtml(wizard.directBasis === 'gross'
            ? ('Net weekly uplift will be held at ' + formatMoneyPrecise(multiplier > 0 ? directValue / multiplier : directValue, wizard.assumptions.currency) + '.')
            : ('Gross weekly uplift will be held at ' + formatMoneyPrecise(directValue * multiplier, wizard.assumptions.currency) + '.'))
          + '</span></div>'
          + '</div>')
      + '</article>';
  }

  function renderWizardReceipts(wizard) {
    const mode = wizard.assumptions.openingBalance.receiptMode;
    const statement = wizard.statementDraft;
    if (mode === 'import_statement' && statement) {
      return '<article class="clf-wizard-content-card">'
        + '<div class="clf-wizard-summary-grid">'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(String(statement.includedRowCount || 0)) + '</strong><span>Imported rows</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(String(statement.overdueRowCount || 0)) + '</strong><span>Overdue items</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(statement.reconciliationTotal || 0, wizard.assumptions.currency)) + '</strong><span>Opening-book total</span></div>'
        + '</div>'
        + '<div class="clf-wizard-inline-note"><strong>Imported statement in use</strong><span>The opening-balance receipt schedule will follow the reviewed invoice rows, due dates, overdue handling, and reconciliation choice shown here.</span></div>'
        + '</article>';
    }
    if (mode === 'manual') {
      return '<article class="clf-wizard-content-card">'
        + '<div class="clf-card-head"><div><p class="clf-kicker">Manual opening-balance receipts</p><h3>Expected payment lines</h3></div><button class="clf-btn clf-btn-secondary" type="button" data-wizard-action="add-manual-receipt">Add receipt line</button></div>'
        + '<div class="clf-wizard-table-wrap"><table class="clf-wizard-table"><thead><tr><th>Date</th><th>Amount</th><th>Note</th><th>Action</th></tr></thead><tbody>'
        + ((wizard.assumptions.receiptLines || []).length
          ? wizard.assumptions.receiptLines.map(function (line, index) {
            return '<tr>'
              + '<td data-cell="date"><input type="date" data-wizard-receipt-index="' + index + '" data-wizard-receipt-key="date" value="' + escapeAttr(line.date || '') + '"/></td>'
              + '<td data-cell="amount"><input type="number" min="-999999999" step="0.01" data-wizard-receipt-index="' + index + '" data-wizard-receipt-key="amount" value="' + escapeAttr(String(line.amount || 0)) + '"/></td>'
              + '<td><input type="text" data-wizard-receipt-index="' + index + '" data-wizard-receipt-key="note" value="' + escapeAttr(line.note || '') + '"/></td>'
              + '<td><button class="clf-btn clf-btn-ghost" type="button" data-wizard-action="remove-manual-receipt" data-receipt-index="' + index + '">Remove</button></td>'
              + '</tr>';
          }).join('')
          : '<tr><td colspan="4"><div class="clf-wizard-empty">No manual receipt lines yet. Add the dates you expect this opening balance to be collected.</div></td></tr>')
        + '</tbody></table></div>'
        + '</article>';
    }
    if (mode === 'even_runoff') {
      return '<article class="clf-wizard-content-card"><div class="clf-wizard-inline-note"><strong>Even runoff selected</strong><span>The opening balance will be spread evenly across the next '
        + escapeHtml(String(wizard.assumptions.openingBalance.runoffWeeks || 0))
        + ' week' + (Number(wizard.assumptions.openingBalance.runoffWeeks) === 1 ? '' : 's') + '.</span></div></article>';
    }
    if (mode === 'term_profile') {
      return '<article class="clf-wizard-content-card"><div class="clf-wizard-inline-note"><strong>Payment-term profile selected</strong><span>The engine will estimate runoff from the opening ledger using the selected terms and invoicing cadence.</span></div></article>';
    }
    return '<article class="clf-wizard-content-card"><div class="clf-wizard-inline-note"><strong>No opening-balance receipts selected</strong><span>The opening receivables will remain in place unless you reopen the wizard or edit the live form later.</span></div></article>';
  }

  function renderWizardReview(wizard) {
    const assumptions = wizard.assumptions;
    const growthMode = normaliseGrowthMode(assumptions.growthMode);
    const statement = wizard.statementDraft;
    const reliability = wizardReliability(wizard);
    const derived = Engine.deriveRunRateComponents(buildCalculationPayload(assumptions));
    const summaryRows = [
      { label: 'Client', value: assumptions.clientName || 'Not set' },
      { label: 'Currency', value: assumptions.currency },
      { label: 'Credit limit', value: formatMoney(assumptions.creditLimit || 0, assumptions.currency) },
      { label: 'Opening balance', value: formatMoney(assumptions.currentOutstandingBalance || 0, assumptions.currency) },
      { label: 'Opening-balance receipt mode', value: openingBalanceModeLabel(assumptions.openingBalance.receiptMode) },
      { label: 'Statement import status', value: statement && Number(statement.includedRowCount) > 0 ? (String(statement.includedRowCount) + ' reviewed row' + (statement.includedRowCount === 1 ? '' : 's')) : 'No statement imported' },
      { label: 'Payment terms', value: Engine.TERM_LABELS[assumptions.paymentTerms.type] || assumptions.paymentTerms.type },
      { label: 'Invoice pattern', value: ((wizard.invoiceCadenceChoice === 'custom') ? 'Custom (advanced follow-up)' : assumptions.invoice.cadence === 'monthly' ? 'Monthly' : 'Weekly') + ' • ' + Engine.weekdayLabel(assumptions.invoice.invoiceWeekday) },
      { label: 'Growth method', value: modeLabel(growthMode) },
      { label: growthMode === 'contractor' ? 'Workforce / contractor value' : 'Weekly uplift', value: growthMode === 'contractor'
        ? ((assumptions.contractor.currentContractors || 0) + ' current • +' + (assumptions.contractor.additionalContractors || 0) + ' test • ' + formatMoney(derived.capacityUnitGross || 0, assumptions.currency) + ' per contractor')
        : (formatMoney(derived.totalScenarioGross || 0, assumptions.currency) + ' gross uplift') },
      { label: 'Advanced items active', value: countAdvancedOverrides(assumptions) > 0 ? 'Yes' : 'No' },
    ];
    return '<article class="clf-wizard-content-card">'
      + '<div class="clf-card-head"><div><p class="clf-kicker">Reliability</p><h3>' + escapeHtml(reliability.label) + '</h3></div><span class="clf-chip" data-tone="' + escapeAttr(reliability.tone) + '">' + escapeHtml(reliability.label) + '</span></div>'
      + '<p class="clf-inline-note">' + escapeHtml(reliability.note) + '</p>'
      + '<div class="clf-wizard-summary-grid">'
      + summaryRows.map(function (item) {
        return '<div class="clf-mini-card"><strong>' + escapeHtml(item.value) + '</strong><span>' + escapeHtml(item.label) + '</span></div>';
      }).join('')
      + '</div>'
      + '</article>';
  }

  function renderWizardStepContent(stepId, wizard) {
    switch (stepId) {
      case 'welcome': return renderWizardWelcome(wizard);
      case 'basics': return renderWizardBasics(wizard);
      case 'opening': return renderWizardOpeningStep(wizard);
      case 'statement-upload': return renderWizardStatementUpload(wizard);
      case 'statement-review': return renderWizardStatementReview(wizard);
      case 'terms': return renderWizardTerms(wizard);
      case 'invoice': return renderWizardInvoicePattern(wizard);
      case 'growth': return renderWizardGrowth(wizard);
      case 'receipts': return renderWizardReceipts(wizard);
      case 'review': return renderWizardReview(wizard);
      default: return '';
    }
  }

  function renderWizardProgressPanel(wizard, meta, currentIssues) {
    const fill = meta.total > 1 ? (((meta.index + 1) / meta.total) * 100) : 100;
    const nextCopy = meta.next ? ('Next: ' + meta.next.label) : 'Next: update forecast';
    return '<aside class="clf-wizard-progress-card">'
      + '<p class="clf-kicker">Wizard progress</p>'
      + '<h3>' + escapeHtml(meta.current.label) + '</h3>'
      + '<div class="clf-wizard-progress-bar"><div class="clf-wizard-progress-fill" style="width:' + fill + '%"></div></div>'
      + '<div class="clf-wizard-step-list">'
      + meta.steps.map(function (step, index) {
        let stateName = 'upcoming';
        if (index < meta.index) stateName = 'complete';
        if (index === meta.index) stateName = currentIssues.blocking.length ? 'warning' : 'current';
        return '<div class="clf-wizard-step-chip" data-state="' + escapeAttr(stateName) + '"><strong>' + escapeHtml(step.label) + '</strong><small>' + escapeHtml(index === meta.index ? stepStateLabel(stateName === 'warning' ? 'warning' : 'current') : (index < meta.index ? 'Complete' : 'Next')) + '</small></div>';
      }).join('')
      + '</div>'
      + '<div class="clf-wizard-inline-note"><strong>' + escapeHtml(nextCopy) + '</strong><span>'
      + escapeHtml(meta.current.id === 'welcome'
        ? 'Choose Basic or Advanced to start.'
        : 'The wizard will keep the live form editable after it updates the forecast.')
      + '</span></div>'
      + '</aside>'
      + '<aside class="clf-wizard-helper-card"><p class="clf-kicker">How this works</p><strong>Quick steps</strong><ol><li>Enter the opening balance and credit limit.</li><li>Choose how growth is modelled.</li><li>Import a statement or choose a receipt method.</li><li>Complete the wizard and review the result.</li></ol></aside>';
  }

  function wizardPrimaryActionLabel(stepId, wizard) {
    if (stepId === 'statement-review') return 'Use imported statement';
    if (stepId === 'review') return 'Complete wizard';
    if (stepId === 'statement-upload' && wizard && wizard.statementDraft) return 'Review imported rows';
    return 'Continue';
  }

  function renderWizardActions(wizard, meta, currentIssues) {
    if (!els.wizardActionsHost) return;
    const reliability = wizardReliability(wizard);
    const isFirst = meta.index === 0;
    const primaryDisabled = currentIssues.blocking.length > 0;
    els.wizardActionsHost.innerHTML = '<div class="clf-wizard-foot-meta">'
      + '<span class="clf-chip" data-tone="' + escapeAttr(reliability.tone) + '">' + escapeHtml(reliability.label) + '</span>'
      + '<span>Step ' + escapeHtml(String(meta.index + 1)) + ' of ' + escapeHtml(String(meta.total)) + '</span>'
      + '<span>' + escapeHtml(wizard.mode === 'advanced' ? 'Advanced mode' : 'Basic mode') + '</span>'
      + '</div>'
      + '<div class="clf-wizard-foot-actions">'
      + (!isFirst ? '<button class="clf-btn clf-btn-ghost" type="button" data-wizard-action="back">Back</button>' : '')
      + '<button class="clf-btn clf-btn-secondary" type="button" data-wizard-action="close">Close</button>'
      + '<button class="clf-btn clf-btn-primary" type="button" data-wizard-action="next"' + (primaryDisabled ? ' disabled' : '') + '>'
      + escapeHtml(wizardPrimaryActionLabel(meta.current.id, wizard))
      + '</button>'
      + '</div>';
  }

  function renderWizardStatus(active) {
    if (!els.wizardStateChip || !els.btnUseWizard) return;
    const meta = active && active.wizardMeta ? active.wizardMeta : null;
    if (meta) {
      els.wizardStateChip.textContent = 'Populated by wizard • ' + (meta.mode === 'advanced' ? 'Advanced' : 'Basic');
      els.wizardStateChip.dataset.tone = 'ok';
      els.btnUseWizard.textContent = 'Run wizard again';
    } else {
      els.wizardStateChip.textContent = 'Direct form';
      els.wizardStateChip.dataset.tone = 'neutral';
      els.btnUseWizard.textContent = 'Use wizard';
    }
  }

  function renderWizard() {
    const wizard = getWizard();
    if (!els.wizardDialog || !els.wizardProgressHost || !els.wizardStepHost) return;
    if (!wizard) {
      setWizardModalState(false);
      closeDialogElement(els.wizardDialog);
      return;
    }
    setWizardModalState(true);
    const meta = wizardCurrentStepMeta();
    const currentIssues = wizardStepIssues(meta.current.id, wizard);
    if (els.wizardTitle) {
      els.wizardTitle.textContent = wizardStepTitle(meta.current.id);
    }
    if (els.wizardSubtitle) {
      els.wizardSubtitle.textContent = wizardStepSubtitle(meta.current.id, wizard);
    }
    els.wizardProgressHost.innerHTML = renderWizardProgressPanel(wizard, meta, currentIssues);
    els.wizardStepHost.innerHTML = wizardAlertMarkup(currentIssues) + renderWizardStepContent(meta.current.id, wizard);
    renderWizardActions(wizard, meta, currentIssues);
    openDialogElement(els.wizardDialog);
    syncWizardViewport(wizard);
  }

  function openWizard() {
    updateActiveScenarioFromForm();
    const active = getActiveScenario();
    if (!active) return;
    state.wizardReturnFocus = document.activeElement && typeof document.activeElement.focus === 'function'
      ? document.activeElement
      : els.btnUseWizard;
    state.wizard = createWizardState(active);
    renderWizard();
  }

  function closeWizard(options) {
    state.wizard = null;
    if (els.wizardActionsHost) {
      els.wizardActionsHost.innerHTML = '';
    }
    if (els.wizardProgressHost) {
      els.wizardProgressHost.innerHTML = '';
    }
    if (els.wizardStepHost) {
      els.wizardStepHost.innerHTML = '';
    }
    setWizardModalState(false);
    closeDialogElement(els.wizardDialog);
    const skipReturnFocus = !!(options && options.skipReturnFocus);
    const returnTarget = skipReturnFocus
      ? null
      : (state.wizardReturnFocus && typeof state.wizardReturnFocus.focus === 'function'
        ? state.wizardReturnFocus
        : els.btnUseWizard);
    state.wizardReturnFocus = null;
    if (returnTarget && typeof returnTarget.focus === 'function') {
      window.requestAnimationFrame(function () {
        returnTarget.focus({ preventScroll: true });
      });
    }
    renderWorkspace();
  }

  function goWizard(direction) {
    const wizard = getWizard();
    if (!wizard) return;
    const meta = wizardCurrentStepMeta();
    const nextIndex = Math.max(0, Math.min(meta.total - 1, meta.index + direction));
    const nextStep = meta.steps[nextIndex];
    if (nextStep) {
      wizard.step = nextStep.id;
      wizard.resetScroll = true;
      wizard.pendingFocus = true;
      renderWizard();
    }
  }

  async function importStatementIntoWizard(file, preferAiAssist) {
    const wizard = getWizard();
    if (!wizard || !file) return;
    const token = setWizardTask(true, preferAiAssist ? 'ai_assist' : 'uploading', preferAiAssist ? 'Trying backup extraction…' : 'Uploading statement…');
    wizard.lastUploadedFile = file;
    wizard.lastUploadedFileName = file.name || '';
    wizard.parseFailure = null;
    renderWizard();

    try {
      setWizardTask(true, 'reading', 'Reading file…', token);
      renderWizard();
      setWizardTask(true, preferAiAssist ? 'ai_assist' : 'extracting', preferAiAssist ? 'Trying backup extraction…' : 'Extracting invoice rows…', token);
      renderWizard();
      const response = await requestStatementImport(file, wizard.assumptions, {
        preferAiAssist: !!preferAiAssist,
      });
      if (!getWizard() || getWizard().task.token !== token) return;

      if (response.statement) {
        wizard.statementDraft = StatementImport.materialiseImportedStatement(response.statement, buildStatementOptionsFromAssumptions(wizard.assumptions));
        wizard.statementReviewed = false;
      } else {
        wizard.statementDraft = null;
        wizard.statementReviewed = false;
      }
      wizard.parseFailure = response.ok
        ? null
        : {
            warnings: Array.isArray(response.warnings) ? response.warnings : [],
            fallbackOptions: Array.isArray(response.fallbackOptions) ? response.fallbackOptions : [],
            aiAssistAvailable: !!response.aiAssistAvailable,
            aiAssistUsed: !!response.aiAssistUsed,
          };
      wizard.task = {
        busy: false,
        stage: response.ok ? 'review' : 'extracting',
        message: response.ok
          ? (response.aiAssistUsed ? 'AI-assisted review ready' : 'Ready for review')
          : 'Import needs review',
        token: token,
      };

      if (wizard.statementDraft && Number(wizard.statementDraft.includedRowCount) > 0) {
        wizard.step = 'statement-review';
        wizard.resetScroll = true;
        wizard.pendingFocus = true;
      }
      renderWizard();
      state.helpers.toast.ok(
        response.ok
          ? (response.aiAssistUsed ? 'AI-assisted statement extraction is ready for review.' : 'Statement ready for review.')
          : 'Statement import needs review before it can be used.',
        2400
      );
    } catch (error) {
      if (!getWizard() || getWizard().task.token !== token) return;
      wizard.task = {
        busy: false,
        stage: 'extracting',
        message: 'Import failed',
        token: token,
      };
      wizard.parseFailure = {
        warnings: [error && error.message ? error.message : 'Statement import failed.'],
        fallbackOptions: ['Upload Excel/CSV instead', 'Continue with manual opening-balance receipts'],
        aiAssistAvailable: false,
        aiAssistUsed: false,
      };
      renderWizard();
      state.helpers.toast.warn(error && error.message ? error.message : 'Statement import failed.', 3600);
    }
  }

  function completeWizard() {
    const wizard = getWizard();
    const active = getActiveScenario();
    if (!wizard || !active) return;
    const issues = wizardGlobalIssues(wizard);
    if (issues.blocking.length) {
      renderWizard();
      state.helpers.toast.warn('Complete the required wizard steps before updating the forecast.', 2600);
      return;
    }

    const assumptions = cloneScenarioAssumptions(wizard.assumptions);
    if (wizard.assumptions.openingBalance.receiptMode === 'import_statement' && wizard.statementDraft) {
      assumptions.openingBalance.importedStatement = StatementImport.prepareConfirmedStatement(
        wizard.statementDraft,
        buildStatementOptionsFromAssumptions(assumptions)
      );
    }

    active.assumptions = ensureScenarioArrays(assumptions);
    active.summary = null;
    active.wizardMeta = {
      mode: wizard.mode === 'advanced' ? 'advanced' : 'basic',
      completedAt: nowIso(),
    };
    active.updatedAt = nowIso();
    clearStatementDraft(active.id);
    setInputDensity(active.wizardMeta.mode === 'advanced' || wizard.invoiceCadenceChoice === 'custom' ? 'advanced' : 'basic');
    applyAssumptionsToForm(active.assumptions);
    calculateWorkspace();
    renderWorkspace();
    persistWorkspace();
    scheduleSummaryRefresh(true);
    closeWizard({ skipReturnFocus: true });
    if (els.resultsHeading && typeof els.resultsHeading.scrollIntoView === 'function') {
      els.resultsHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      els.resultsHeading.setAttribute('tabindex', '-1');
      if (typeof els.resultsHeading.focus === 'function') {
        els.resultsHeading.focus({ preventScroll: true });
      }
    }
    if (els.kpiGrid) {
      els.kpiGrid.classList.remove('clf-wizard-highlight');
      window.setTimeout(function () {
        els.kpiGrid.classList.add('clf-wizard-highlight');
        window.setTimeout(function () {
          els.kpiGrid.classList.remove('clf-wizard-highlight');
        }, 1600);
      }, 10);
    }
    state.helpers.toast.ok('Wizard complete — forecast updated.', 2200);
  }

  function renderSetupGuide(active) {
    if (!els.setupGuideHost) return;
    const summary = buildScenarioSummary(active.assumptions, active.result);
    const validation = buildValidationState(active);
    const draft = getStatementDraft(active.id);
    const accountReady = String(els.creditLimit && els.creditLimit.value || '').trim() !== ''
      && String(els.currentOutstandingBalance && els.currentOutstandingBalance.value || '').trim() !== ''
      && Number(summary.raw.creditLimit) > 0;
    const openingReady = summary.raw.openingBalance.receiptMode !== 'import_statement'
      ? true
      : !!summary.importedStatement;
    const termsReady = summary.raw.paymentTerms.type !== 'custom_net'
      ? true
      : Number(summary.raw.paymentTerms.customNetDays) > 0;
    const growthReady = !summary.zeroGrowth;
    let nextCopy = 'Next: calculate forecast';
    if (!accountReady) nextCopy = 'Next: complete the account setup';
    else if (!termsReady) nextCopy = 'Next: confirm the payment terms';
    else if (summary.raw.openingBalance.receiptMode === 'import_statement' && !summary.importedStatement && draft) nextCopy = 'Next: review imported statement rows';
    else if (summary.raw.openingBalance.receiptMode === 'import_statement' && !summary.importedStatement) nextCopy = 'Next: upload a debtor statement';
    else if (!growthReady) nextCopy = 'Next: choose how to model growth';

    const chips = [
      { step: '1', label: 'Account setup', state: accountReady ? 'complete' : 'current' },
      { step: '2', label: 'Terms & tax', state: termsReady ? 'complete' : 'warning' },
      {
        step: '3',
        label: 'Growth model',
        state: growthReady ? 'complete' : 'current',
      },
      {
        step: '4',
        label: 'Opening receipts',
        state: openingReady ? 'complete' : 'warning',
      },
      { step: '5', label: 'Review & calculate', state: validation.canCalculate ? 'current' : 'pending' },
    ];
    document.querySelectorAll('.clf-step-card[data-step]').forEach(function (card) {
      const step = card.getAttribute('data-step');
      const item = chips.find(function (chip) { return chip.step === step; });
      if (!item) return;
      card.dataset.stepState = item.state;
    });

    els.setupGuideHost.innerHTML = '<div class="clf-setup-guide">'
      + '<div class="clf-chip-list">'
      + chips.map(function (chip) {
        return '<span class="clf-chip clf-guide-chip" data-guide-state="' + escapeAttr(chip.state) + '">'
          + escapeHtml(chip.label)
          + '<small>' + escapeHtml(stepStateLabel(chip.state)) + '</small>'
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
    const adjustmentRows = working && Array.isArray(working.adjustmentLines) ? working.adjustmentLines : [];
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
    const importMethod = working ? statementParseMethodLabel(working) : '';
    const usingAiAssist = working && working.parseMethod === 'ai_assisted_json';
    const uploadButtonLabel = working ? 'Upload another statement' : 'Upload statement';

    const uploadCard = [
      '<article class="clf-import-card clf-upload-card" data-dropzone="statement-upload">',
      '<div class="clf-card-head"><div><p class="clf-kicker">Import statement</p><h3>Upload debtor statement</h3></div>',
      working ? '<span class="clf-chip" data-tone="' + escapeAttr(statementConfidenceTone(working.confidence)) + '">' + escapeHtml(statementConfidenceLabel(working.confidence)) + '</span>' : '',
      '</div>',
      '<p class="clf-inline-note">Upload a debtor statement or ledger export so the opening balance can be scheduled using actual invoice due dates.</p>',
      '<div class="clf-toolbar clf-no-print">',
      '<button class="clf-btn clf-btn-primary" type="button" data-statement-action="browse">' + escapeHtml(uploadButtonLabel) + '</button>',
      '<button class="clf-btn clf-btn-ghost" type="button" data-statement-action="switch-manual">Add manual receipt instead</button>',
      working ? '<button class="clf-btn clf-btn-secondary" type="button" data-statement-action="clear">Clear imported statement</button>' : '',
      '</div>',
      '<p class="clf-muted-small">Accepted file types: PDF, XLSX, CSV.</p>',
      task ? '<div class="clf-import-status"><span class="clf-chip" data-tone="' + escapeAttr(task.busy ? 'warn' : (task.stage === 'failed' ? 'danger' : 'ok')) + '">' + escapeHtml(task.message || 'Working') + '</span><span>' + escapeHtml(task.stage === 'reading' ? 'Reading file' : task.stage === 'extracting' ? 'Matching columns' : task.message || '') + '</span></div>' : '',
      '</article>',
    ].join('');

    let uploadCheckCard = '';
    if (working && reconciliation) {
      const checkTone = reconciliation.matches ? 'ok' : 'warn';
      uploadCheckCard = '<article class="clf-import-card"><div class="clf-card-head"><div><p class="clf-kicker">Upload check</p><h3>'
        + (reconciliation.matches ? 'Statement upload ties to opening balance' : 'Statement upload needs reconciliation')
        + '</h3></div><span class="clf-chip" data-tone="' + escapeAttr(checkTone) + '">'
        + escapeHtml(reconciliation.matches ? 'Matched' : 'Needs check')
        + '</span></div>'
        + '<div class="clf-mini-grid">'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(working.sourceType ? working.sourceType.toUpperCase() : 'FILE') + '</strong><span>Uploaded file type</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(String(working.includedRowCount || 0)) + '</strong><span>Included imported rows</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.reconciliationTotal || 0, active.assumptions.currency)) + '</strong><span>Opening-book total in forecast</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(active.assumptions.currentOutstandingBalance || 0, active.assumptions.currency)) + '</strong><span>Entered opening balance</span></div>'
        + '</div>'
        + '<div class="clf-alert" data-tone="' + escapeAttr(checkTone) + '"><strong>'
        + escapeHtml(reconciliation.matches ? 'Upload passed the opening-balance check.' : 'The uploaded schedule does not yet tie to the entered opening balance.')
        + '</strong><span>'
        + escapeHtml(reconciliation.matches
          ? 'The included rows and any adjustment lines reconcile to the opening balance you entered.'
          : 'Review the include ticks below or add a dated adjustment line for anything missing from the file.')
        + '</span></div></article>';
    }

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
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(working.adjustmentTotal || 0, active.assumptions.currency)) + '</strong><span>Adjustment lines total</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney((working.reconciliationTotal != null ? working.reconciliationTotal : ((working.importedTotal || 0) + (working.adjustmentTotal || 0))), active.assumptions.currency)) + '</strong><span>Reconciled opening total</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(working.detectedCurrency || active.assumptions.currency) + '</strong><span>Matched currency</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(String(working.overdueRowCount || 0)) + '</strong><span>Overdue rows</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(importMethod) + '</strong><span>Parsing method</span></div>'
        + '</div>'
        + (usingAiAssist
          ? '<div class="clf-alert" data-tone="info"><strong>AI-assisted extraction</strong><span>The PDF needed AI-assisted extraction after the standard parser showed weak confidence. Review and confirm the rows before sharing the forecast.</span></div>'
          : '')
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
      const adjustmentTable = adjustmentRows.length
        ? '<div class="clf-table-wrap clf-import-table-wrap"><table class="clf-inline-table clf-import-table"><thead><tr><th>Include</th><th>Receipt date</th><th>Amount</th><th>Note</th><th>Remove</th></tr></thead><tbody>'
          + adjustmentRows.map(function (line, index) {
            return '<tr>'
              + '<td><input type="checkbox" data-import-adjustment-index="' + index + '" data-import-adjustment-key="include"' + (line.include !== false ? ' checked' : '') + '/></td>'
              + '<td><input type="date" data-import-adjustment-index="' + index + '" data-import-adjustment-key="date" value="' + escapeAttr(line.date || active.assumptions.forecastStartDate || '') + '"/></td>'
              + '<td><input type="number" step="0.01" data-import-adjustment-index="' + index + '" data-import-adjustment-key="amount" value="' + escapeAttr(line.amount || 0) + '"/></td>'
              + '<td><input type="text" data-import-adjustment-index="' + index + '" data-import-adjustment-key="note" value="' + escapeAttr(line.note || '') + '" placeholder="Missing invoice, timing adjustment, or note"/><div class="clf-muted-small">' + escapeHtml(line.warningText || 'Optional opening-book adjustment') + '</div></td>'
              + '<td><button class="clf-btn clf-btn-ghost clf-btn-small" type="button" data-statement-action="remove-adjustment" data-adjustment-index="' + index + '">Remove</button></td>'
              + '</tr>';
          }).join('')
          + '</tbody></table></div>'
        : '<div class="clf-empty">No dated adjustment lines have been added. Use this only if the uploaded statement still does not tie to the entered opening balance.</div>';
      reconciliationCard = '<article class="clf-import-card"><div class="clf-card-head"><div><p class="clf-kicker">Reconciliation</p><h3>Compare imported total with opening balance</h3></div></div>'
        + '<p class="clf-inline-note">Untick rows in the review table if needed, then add a dated adjustment line below for anything missing from the file.</p>'
        + '<div class="clf-mini-grid">'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.enteredOpeningBalance, active.assumptions.currency)) + '</strong><span>Entered opening balance</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.importedTotal, active.assumptions.currency)) + '</strong><span>Imported statement total</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.adjustmentTotal || 0, active.assumptions.currency)) + '</strong><span>Adjustment lines total</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.reconciliationTotal || 0, active.assumptions.currency)) + '</strong><span>Reconciled opening total</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.variance, active.assumptions.currency)) + '</strong><span>Variance</span></div>'
        + '<div class="clf-mini-card"><strong>' + escapeHtml(formatMoney(reconciliation.effectiveOpeningBalance, active.assumptions.currency)) + '</strong><span>Forecast opening balance</span></div>'
        + '</div>'
        + '<div class="clf-alert" data-tone="' + escapeAttr(reconciliation.matches ? 'ok' : 'warn') + '"><strong>'
        + escapeHtml(reconciliation.matches ? 'Opening balance ties after included rows and adjustments.' : 'Totals do not reconcile yet.')
        + '</strong><span>'
        + escapeHtml(reconciliation.matches
          ? 'You can confirm this import as-is or still change the treatment below.'
          : 'Choose whether the forecast should keep the entered opening balance, use the reconciled imported total, or scale the imported schedule to match the opening balance.')
        + '</span></div>'
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
        + '</div>'
        + '<div class="clf-card-head"><div><p class="clf-kicker">Adjustment lines</p><h3>Dated opening-book adjustments</h3></div><button class="clf-btn clf-btn-secondary" type="button" data-statement-action="add-adjustment">Add adjustment line</button></div>'
        + adjustmentTable
        + '</article>';
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

    els.openingBalanceImportHost.innerHTML = [uploadCard, uploadCheckCard, summaryCard, mappingCard, reconciliationCard, reviewCard].join('');
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

  function renderOperationalGuidance(active) {
    if (!els.operationalGuidanceHost) return;
    const guidance = buildOperationalGuidance(active);
    if (!guidance) {
      els.operationalGuidanceHost.innerHTML = '';
      return;
    }

    const currency = active.assumptions.currency;
    const cards = [
      {
        label: guidance.peakOverLimit > 0 ? 'Peak over limit' : 'Peak headroom view',
        value: guidance.peakOverLimit > 0 ? formatMoney(guidance.peakOverLimit, currency) : formatMoney(active.result.metrics.minimumHeadroom, currency),
        meta: guidance.peakOverLimit > 0 ? guidance.peakWeekLabel : 'Lowest headroom',
      },
      {
        label: 'First breach',
        value: guidance.firstBreachLabel,
        meta: guidance.peakOverLimit > 0 ? 'Earliest week over limit' : 'No breach forecast',
      },
      {
        label: 'Typical contractor impact',
        value: guidance.perContractorGross > 0 ? formatMoneyPrecise(guidance.perContractorGross, currency) : 'Not inferred',
        meta: guidance.perContractorGross > 0 ? 'Gross weekly value per contractor' : 'Add contractor value assumptions to estimate equivalents',
      },
      {
        label: 'Contractor-equivalent excess',
        value: guidance.contractorEquivalentExcess != null ? String(guidance.contractorEquivalentExcess) : 'Not inferred',
        meta: guidance.contractorEquivalentExcess != null ? 'Based on modelled peak exposure per contractor' : 'No per-contractor basis available',
      },
      {
        label: '+1 contractor effect',
        value: guidance.plusOneImpact > 0 ? formatMoney(guidance.plusOneImpact, currency) : 'Not modelled',
        meta: guidance.plusOneImpact > 0 ? 'Extra peak exposure' : 'No contractor-equivalent uplift available',
      },
      {
        label: guidance.peakOverLimit > 0 ? '-1 contractor relief' : 'Safe contractors allowed',
        value: guidance.peakOverLimit > 0
          ? (guidance.minusOneRelief > 0 ? formatMoney(guidance.minusOneRelief, currency) : 'Not modelled')
          : (guidance.additionalAllowed != null ? String(guidance.additionalAllowed) : 'Not modelled'),
        meta: guidance.peakOverLimit > 0
          ? (guidance.minusOneRelief > 0 ? 'Peak reduction from one contractor-equivalent' : 'No contractor-equivalent estimate available')
          : 'Current safe headcount buffer',
      },
    ];

    const actionChips = [];
    if (guidance.peakOverLimit > 0 && guidance.contractorsToRemove > 0) {
      actionChips.push('<span class="clf-chip" data-tone="danger">Reduce by approx ' + guidance.contractorsToRemove + ' contractor' + (guidance.contractorsToRemove === 1 ? '' : 's') + '</span>');
    }
    if (guidance.weeklyReductionToSafe > 0) {
      actionChips.push('<span class="clf-chip" data-tone="' + escapeAttr(guidance.peakOverLimit > 0 ? 'danger' : 'warn') + '">Lower weekly uplift by about ' + escapeHtml(formatMoney(guidance.weeklyReductionToSafe, currency)) + '</span>');
    }
    if (guidance.peakOverLimit === 0 && guidance.additionalAllowed != null) {
      actionChips.push('<span class="clf-chip" data-tone="ok">Current profile still supports ' + guidance.additionalAllowed + ' more contractor' + (guidance.additionalAllowed === 1 ? '' : 's') + '</span>');
    }

    els.operationalGuidanceHost.innerHTML = '<div class="clf-operational-stack">'
      + '<div class="clf-alert" data-tone="' + escapeAttr(active.result.overallStatus === 'over_limit' ? 'danger' : (active.result.overallStatus === 'at_risk' ? 'warn' : 'info')) + '"><strong>Operational view</strong><span>' + escapeHtml(guidance.lead) + '</span></div>'
      + '<div class="clf-mini-grid clf-operational-grid">'
      + cards.map(function (card) {
        return '<div class="clf-mini-card"><strong>' + escapeHtml(card.value) + '</strong><span>' + escapeHtml(card.label) + '</span><small>' + escapeHtml(card.meta) + '</small></div>';
      }).join('')
      + '</div>'
      + (actionChips.length ? '<div class="clf-chip-row">' + actionChips.join('') + '</div>' : '')
      + '</div>';
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
        + '<td class="clf-col-week"><div class="clf-cell-stack"><strong>Week ' + row.weekNumber + '</strong><small>' + escapeHtml(Engine.formatLongDate(row.weekCommencing)) + '</small></div></td>'
        + '<td class="clf-col-dates"><div class="clf-cell-stack"><strong>' + escapeHtml(invoiceDates) + '</strong><small>' + row.invoiceCount + ' event' + (row.invoiceCount === 1 ? '' : 's') + '</small></div></td>'
        + '<td class="clf-col-num"><span class="clf-num">' + escapeHtml(formatMoney(row.openingBalance, currency)) + '</span></td>'
        + '<td class="clf-col-num"><span class="clf-num">' + escapeHtml(formatMoney(row.baseInvoiceIncrease, currency)) + '</span></td>'
        + '<td class="clf-col-num"><span class="clf-num">' + escapeHtml(formatMoney(row.scenarioInvoiceIncrease, currency)) + '</span></td>'
        + '<td class="clf-col-num"><span class="clf-num">' + escapeHtml(formatMoney(row.openingBalanceReceipts, currency)) + '</span></td>'
        + '<td class="clf-col-num"><span class="clf-num">' + escapeHtml(formatMoney(row.forecastInvoiceReceipts, currency)) + '</span></td>'
        + '<td class="clf-col-num"><div class="clf-cell-stack"><strong class="clf-num">' + escapeHtml(formatMoney(row.totalReceipts, currency)) + '</strong><small>Adjustments ' + escapeHtml(formatMoney(row.receiptAdjustments, currency)) + '</small></div></td>'
        + '<td class="clf-col-num"><span class="clf-num">' + escapeHtml(formatMoney(row.closingBalance, currency)) + '</span></td>'
        + '<td class="clf-col-num"><span class="clf-num">' + escapeHtml(formatMoney(row.headroom, currency)) + '</span></td>'
        + '<td class="clf-col-status"><span class="clf-table-badge" data-status="' + escapeAttr(row.status) + '">' + escapeHtml(row.statusLabel) + '</span></td>'
        + '<td class="clf-col-breach"><span class="clf-nowrap">' + escapeHtml(row.breachDate ? Engine.formatLongDate(row.breachDate) : '—') + '</span></td>'
        + '</tr>';
    }).join('');
    els.forecastTableHost.innerHTML = [
      '<table class="clf-table clf-forecast-table">',
      '<thead><tr><th class="clf-col-week">Week</th><th class="clf-col-dates">Invoice dates</th><th class="clf-col-num" title="Opening balance">Opening</th><th class="clf-col-num" title="Base invoice increase">Base invoiced</th><th class="clf-col-num" title="Scenario invoice increase">Scenario uplift</th><th class="clf-col-num" title="Receipts from the opening balance">Opening receipts</th><th class="clf-col-num" title="Receipts from forecast-generated invoices">Forecast receipts</th><th class="clf-col-num" title="Total receipts including weekly adjustments">Total receipts</th><th class="clf-col-num" title="Closing balance">Closing</th><th class="clf-col-num">Headroom</th><th class="clf-col-status">Status</th><th class="clf-col-breach" title="First breach marker">Breach date</th></tr></thead>',
      '<tbody>',
      rows,
      '</tbody></table>',
    ].join('');
  }

  function renderCashTiming(active) {
    const currency = active.assumptions.currency;
    const invoiceRows = active.result.invoiceSchedule.map(function (entry) {
      return '<tr>'
        + '<td class="clf-col-dates"><div class="clf-cell-stack"><strong>' + escapeHtml(entry.invoiceDateLabel) + '</strong><small>Week ' + (entry.weekIndex + 1) + '</small></div></td>'
        + '<td class="clf-col-dates"><span class="clf-nowrap">' + escapeHtml(entry.dueDateLabel) + '</span></td>'
        + '<td class="clf-col-num"><span class="clf-num">' + escapeHtml(formatMoney(entry.totalGross, currency)) + '</span></td>'
        + '<td class="clf-col-source">' + escapeHtml('Forecast-generated invoice • ' + entry.termLabel) + '</td>'
        + '<td class="clf-col-breach"><span class="clf-nowrap">' + escapeHtml(entry.receiptWeekIndex >= 0 ? ('Week ' + (entry.receiptWeekIndex + 1)) : 'Beyond horizon') + '</span></td>'
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
        + '<td class="clf-col-dates"><div class="clf-cell-stack"><strong>' + escapeHtml(sourceDateLabel) + '</strong><small>' + escapeHtml(entry.sourceLabel) + '</small></div></td>'
        + '<td class="clf-col-dates"><span class="clf-nowrap">' + escapeHtml(entry.dueDateLabel) + '</span></td>'
        + '<td class="clf-col-num"><span class="clf-num">' + escapeHtml(formatMoney(entry.amount, currency)) + '</span></td>'
        + '<td class="clf-col-source">' + escapeHtml(sourceText) + '</td>'
        + '<td class="clf-col-breach"><span class="clf-nowrap">' + escapeHtml(entry.receiptWeekIndex >= 0 ? ('Week ' + (entry.receiptWeekIndex + 1)) : 'Beyond horizon') + '</span></td>'
        + '</tr>';
    });
    const rows = openingBalanceRows.concat(invoiceRows);
    if (!rows.length) {
      els.cashTimingHost.innerHTML = '<div class="clf-empty">No future invoice or receipt events are currently scheduled inside the forecast window.</div>';
      return;
    }
    els.cashTimingHost.innerHTML = [
      '<table class="clf-table clf-receipt-table">',
      '<thead><tr><th class="clf-col-dates">Event date</th><th class="clf-col-dates">Expected receipt</th><th class="clf-col-num">Gross</th><th class="clf-col-source">Source</th><th class="clf-col-breach">Receipt week</th></tr></thead>',
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
    renderOperationalGuidance(active);
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
    renderWizardStatus(getActiveScenario());
    renderWizard();
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
      wizardMeta: active.wizardMeta ? Engine.cloneJson(active.wizardMeta) : null,
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
    active.wizardMeta = null;
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
      wizardMeta: active.wizardMeta ? Engine.cloneJson(active.wizardMeta) : null,
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
        wizardMeta: saved.wizardMeta ? Engine.cloneJson(saved.wizardMeta) : null,
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
      active.wizardMeta = saved.wizardMeta ? Engine.cloneJson(saved.wizardMeta) : null;
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

    if (target.hasAttribute('data-import-adjustment-index')) {
      const active = getActiveScenario();
      if (!active) return;
      const index = Number(target.getAttribute('data-import-adjustment-index'));
      const key = target.getAttribute('data-import-adjustment-key');
      if (!Number.isInteger(index) || !key) return;
      const draft = getStatementDraft(active.id);
      const applyLineChange = function (source) {
        source.adjustmentLines = Array.isArray(source.adjustmentLines) ? source.adjustmentLines : [];
        const line = source.adjustmentLines[index];
        if (!line) return source;
        line[key] = key === 'include'
          ? !!target.checked
          : (key === 'amount' ? Number(target.value) || 0 : String(target.value || '').trim());
        return source;
      };
      if (draft) {
        updateDraftImportState(applyLineChange);
        return;
      }
      updateConfirmedImportedStatement(applyLineChange);
      return;
    }

    scheduleRecalc(120);
  }

  function handleWizardFieldEvent(event) {
    const wizard = getWizard();
    if (!wizard) return;
    const target = event.target;
    if (!target) return;
    let shouldRender = event.type === 'change';

    if (target.hasAttribute('data-wizard-field')) {
      const path = target.getAttribute('data-wizard-field');
      const valueType = target.getAttribute('data-wizard-value-type');
      let value;
      if (valueType === 'boolean') {
        value = target.value === 'true';
      } else if (target.type === 'checkbox') {
        value = !!target.checked;
      } else if (target.type === 'number') {
        value = Number(target.value) || 0;
      } else {
        value = String(target.value || '').trim();
      }

      updateWizardAssumptions(function (assumptions) {
        if (path === 'contractor.perContractorGrossInvoice') {
          const multiplier = wizardValueMultiplier(assumptions);
          assumptions.contractor.perContractorGrossInvoice = Math.max(0, Number(value) || 0);
          assumptions.contractor.perContractorNetInvoice = roundMoney(multiplier > 0 ? assumptions.contractor.perContractorGrossInvoice / multiplier : assumptions.contractor.perContractorGrossInvoice);
          return;
        }
        setNestedValue(assumptions, path, value);
      });

      if (path === 'currency' || path.indexOf('paymentTerms.') === 0 || path === 'currentOutstandingBalance' || path === 'forecastStartDate') {
        refreshWizardStatementDraft();
        shouldRender = true;
      }
      if (path === 'vatApplicable' || path === 'vatRate') {
        if (!wizard.assumptions.vatApplicable) {
          wizard.assumptions.vatRate = wizard.assumptions.vatRate || Engine.DEFAULT_ASSUMPTIONS.vatRate;
        }
        if (wizard.directBasis) {
          applyWizardDirectScenarioValue(currentWizardAmountValue(wizard));
        }
        if (wizard.contractorInputMode === 'gross') {
          const multiplier = wizardValueMultiplier(wizard.assumptions);
          wizard.assumptions.contractor.perContractorNetInvoice = roundMoney(multiplier > 0
            ? (Number(wizard.assumptions.contractor.perContractorGrossInvoice) || 0) / multiplier
            : (Number(wizard.assumptions.contractor.perContractorGrossInvoice) || 0));
        }
        shouldRender = true;
      }
    }

    if (target.getAttribute('data-wizard-action') === 'set-direct-value') {
      applyWizardDirectScenarioValue(target.value);
    }

    if (target.hasAttribute('data-wizard-import-map-field')) {
      updateWizardStatementDraft(function (draft) {
        draft.mapping = draft.mapping || {};
        draft.mapping[target.getAttribute('data-wizard-import-map-field')] = target.value || '';
        return draft;
      });
      shouldRender = true;
    }

    if (target.hasAttribute('data-wizard-import-row-index')) {
      const index = Number(target.getAttribute('data-wizard-import-row-index'));
      const key = target.getAttribute('data-wizard-import-key');
      updateWizardStatementDraft(function (draft) {
        if (draft.rawTable) {
          draft.rows = Engine.cloneJson(draft.rows || []);
          delete draft.rawTable;
        }
        const row = draft.rows[index];
        if (!row) return draft;
        row[key] = key === 'include'
          ? !!target.checked
          : (key === 'outstandingAmount' ? Number(target.value) || 0 : String(target.value || '').trim());
        return draft;
      });
      shouldRender = event.type === 'change' || target.type === 'checkbox';
    }

    if (target.hasAttribute('data-wizard-import-setting')) {
      const key = target.getAttribute('data-wizard-import-setting');
      updateWizardStatementDraft(function (draft) {
        draft[key] = key === 'overdueCollectionDays'
          ? Number(target.value) || 0
          : String(target.value || '').trim();
        return draft;
      });
      shouldRender = true;
    }

    if (target.hasAttribute('data-wizard-adjustment-index')) {
      const index = Number(target.getAttribute('data-wizard-adjustment-index'));
      const key = target.getAttribute('data-wizard-adjustment-key');
      updateWizardStatementDraft(function (draft) {
        draft.adjustmentLines = Array.isArray(draft.adjustmentLines) ? draft.adjustmentLines : [];
        const line = draft.adjustmentLines[index];
        if (!line) return draft;
        line[key] = key === 'include'
          ? !!target.checked
          : (key === 'amount' ? Number(target.value) || 0 : String(target.value || '').trim());
        return draft;
      });
      shouldRender = event.type === 'change' || target.type === 'checkbox';
    }

    if (target.hasAttribute('data-wizard-receipt-index')) {
      const index = Number(target.getAttribute('data-wizard-receipt-index'));
      const key = target.getAttribute('data-wizard-receipt-key');
      updateWizardAssumptions(function (assumptions) {
        assumptions.receiptLines = Array.isArray(assumptions.receiptLines) ? assumptions.receiptLines : [];
        const line = assumptions.receiptLines[index];
        if (!line) return;
        line[key] = key === 'amount' ? Number(target.value) || 0 : String(target.value || '').trim();
      });
    }

    if (shouldRender) {
      renderWizard();
    }
  }

  function handleWizardClick(event) {
    const wizard = getWizard();
    if (!wizard) return;
    const target = event.target;
    if (!target) return;

    const closeTrigger = target.closest('#btnCloseWizard, [data-wizard-action="close"]');
    if (closeTrigger) {
      closeWizard();
      return;
    }

    const choice = target.closest('[data-wizard-choice-type]');
    if (choice) {
      const type = choice.getAttribute('data-wizard-choice-type');
      const value = choice.getAttribute('data-wizard-choice-value');
      if (type === 'mode') {
        wizard.mode = value === 'advanced' ? 'advanced' : 'basic';
        wizard.step = 'basics';
        wizard.resetScroll = true;
        wizard.pendingFocus = true;
      } else if (type === 'terms') {
        wizard.assumptions.paymentTerms.type = value || '30_eom';
      } else if (type === 'cadence') {
        wizard.invoiceCadenceChoice = value || 'weekly';
        wizard.assumptions.invoice.cadence = value === 'monthly' ? 'monthly' : 'weekly';
        if (value === 'custom') {
          wizard.assumptions.invoice.autoCountDates = false;
        }
      } else if (type === 'growth-mode') {
        wizard.assumptions.growthMode = normaliseGrowthMode(value);
      }
      renderWizard();
      return;
    }

    const openingChoice = target.closest('[data-wizard-opening-mode]');
    if (openingChoice) {
      wizard.assumptions.openingBalance.receiptMode = openingChoice.getAttribute('data-wizard-opening-mode') || 'term_profile';
      renderWizard();
      return;
    }

    const action = target.closest('[data-wizard-action]');
    if (action) {
      const actionName = action.getAttribute('data-wizard-action');
      if (actionName === 'back') {
        goWizard(-1);
        return;
      }
      if (actionName === 'next') {
        const meta = wizardCurrentStepMeta();
        if (meta.current.id === 'statement-review') {
          wizard.statementReviewed = true;
        }
        if (meta.current.id === 'review') {
          completeWizard();
          return;
        }
        goWizard(1);
        return;
      }
      if (actionName === 'browse-upload') {
        if (els.wizardStatementUploadInput) {
          els.wizardStatementUploadInput.click();
        }
        return;
      }
      if (actionName === 'try-ai-import') {
        if (wizard.lastUploadedFile) {
          importStatementIntoWizard(wizard.lastUploadedFile, true);
        }
        return;
      }
      if (actionName === 'set-contractor-mode') {
        applyWizardContractorInputMode(action.getAttribute('data-value'));
        renderWizard();
        return;
      }
      if (actionName === 'set-direct-basis') {
        applyWizardDirectBasis(action.getAttribute('data-value'));
        renderWizard();
        return;
      }
      if (actionName === 'add-manual-receipt') {
        updateWizardAssumptions(function (assumptions) {
          assumptions.receiptLines = Array.isArray(assumptions.receiptLines) ? assumptions.receiptLines : [];
          assumptions.receiptLines.push({
            id: uid('wizard-receipt'),
            date: assumptions.forecastStartDate,
            amount: 0,
            note: '',
          });
        });
        renderWizard();
        return;
      }
      if (actionName === 'remove-manual-receipt') {
        const index = Number(action.getAttribute('data-receipt-index'));
        updateWizardAssumptions(function (assumptions) {
          assumptions.receiptLines.splice(index, 1);
        });
        renderWizard();
        return;
      }
      if (actionName === 'add-import-adjustment') {
        updateWizardStatementDraft(function (draft) {
          draft.adjustmentLines = Array.isArray(draft.adjustmentLines) ? draft.adjustmentLines : [];
          draft.adjustmentLines.push({
            id: uid('wizard-adjustment'),
            include: true,
            date: wizard.assumptions.forecastStartDate,
            amount: 0,
            note: '',
          });
          return draft;
        });
        renderWizard();
        return;
      }
      if (actionName === 'remove-import-adjustment') {
        const index = Number(action.getAttribute('data-adjustment-index'));
        updateWizardStatementDraft(function (draft) {
          draft.adjustmentLines.splice(index, 1);
          return draft;
        });
        renderWizard();
        return;
      }
    }

    const fallback = target.closest('[data-wizard-fallback]');
    if (fallback) {
      const mode = fallback.getAttribute('data-wizard-fallback');
      if (mode === 'manual') {
        wizard.assumptions.openingBalance.receiptMode = 'manual';
      } else if (mode === 'runoff') {
        wizard.assumptions.openingBalance.receiptMode = 'even_runoff';
        wizard.assumptions.openingBalance.runoffWeeks = wizard.assumptions.openingBalance.runoffWeeks || Engine.DEFAULT_ASSUMPTIONS.openingBalance.runoffWeeks;
      } else {
        wizard.assumptions.openingBalance.receiptMode = 'no_receipts';
      }
      wizard.step = 'terms';
      wizard.resetScroll = true;
      wizard.pendingFocus = true;
      renderWizard();
    }
  }

  function handleWizardKeydown(event) {
    const wizard = getWizard();
    if (!wizard || !els.wizardDialog || !els.wizardDialog.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeWizard();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      els.wizardDialog.querySelectorAll(
        'button:not([disabled]), [href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(function (node) {
      return node.offsetParent !== null || node === document.activeElement;
    });
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
        } else if (action === 'add-adjustment') {
          const addLine = function (source) {
            source.adjustmentLines = Array.isArray(source.adjustmentLines) ? source.adjustmentLines : [];
            source.adjustmentLines.push(defaultStatementAdjustmentLine(active));
            return source;
          };
          if (getStatementDraft(active && active.id)) {
            updateDraftImportState(addLine);
          } else {
            updateConfirmedImportedStatement(addLine);
          }
          return;
        } else if (action === 'remove-adjustment') {
          const index = Number(statementAction.getAttribute('data-adjustment-index'));
          if (Number.isInteger(index) && index >= 0) {
            const removeLine = function (source) {
              source.adjustmentLines = Array.isArray(source.adjustmentLines) ? source.adjustmentLines : [];
              source.adjustmentLines.splice(index, 1);
              return source;
            };
            if (getStatementDraft(active && active.id)) {
              updateDraftImportState(removeLine);
            } else {
              updateConfirmedImportedStatement(removeLine);
            }
          }
          return;
        }
        if (active) {
          renderWorkspace();
        }
      }
    });

    if (els.btnUseWizard) {
      els.btnUseWizard.addEventListener('click', openWizard);
    }
    if (els.btnCloseWizard) {
      els.btnCloseWizard.addEventListener('click', closeWizard);
    }
    if (els.wizardDialog) {
      els.wizardDialog.addEventListener('click', handleWizardClick);
      els.wizardDialog.addEventListener('input', handleWizardFieldEvent);
      els.wizardDialog.addEventListener('change', handleWizardFieldEvent);
      els.wizardDialog.addEventListener('keydown', handleWizardKeydown);
      els.wizardDialog.addEventListener('cancel', function (event) {
        event.preventDefault();
        closeWizard();
      });
    }
    if (els.wizardStatementUploadInput) {
      els.wizardStatementUploadInput.addEventListener('change', function () {
        const file = els.wizardStatementUploadInput.files && els.wizardStatementUploadInput.files[0];
        if (file && getWizard()) {
          importStatementIntoWizard(file, false);
        }
        els.wizardStatementUploadInput.value = '';
      });
    }

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

    if (els.wizardStepHost) {
      ['dragenter', 'dragover'].forEach(function (type) {
        els.wizardStepHost.addEventListener(type, function (event) {
          const zone = event.target.closest('[data-dropzone="wizard-statement-upload"]');
          if (!zone) return;
          event.preventDefault();
          zone.classList.add('is-dragging');
        });
      });
      ['dragleave', 'dragend', 'drop'].forEach(function (type) {
        els.wizardStepHost.addEventListener(type, function (event) {
          const zone = event.target.closest('[data-dropzone="wizard-statement-upload"]');
          if (!zone) return;
          if (type === 'drop') event.preventDefault();
          zone.classList.remove('is-dragging');
        });
      });
      els.wizardStepHost.addEventListener('drop', function (event) {
        const zone = event.target.closest('[data-dropzone="wizard-statement-upload"]');
        if (!zone) return;
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file && getWizard()) {
          importStatementIntoWizard(file, false);
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
