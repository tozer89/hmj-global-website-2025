(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HMJCreditLimitForecast = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const CURRENCY_SYMBOLS = {
    GBP: 'GBP',
    EUR: 'EUR',
  };
  const TERM_LABELS = {
    '30_eom': '30 days end of month',
    '30_from_invoice': '30 days from invoice date',
    '14_net': '14 days net',
    custom_net: 'Custom net days',
  };
  const OPENING_BALANCE_MODE_LABELS = {
    no_receipts: 'No opening-balance receipts',
    manual: 'Manual opening-balance receipts',
    even_runoff: 'Even runoff across weeks',
    term_profile: 'Follow payment-term profile',
    import_statement: 'Import statement',
  };
  const OPENING_BALANCE_RECONCILIATION_LABELS = {
    keep_manual_opening_balance: 'Keep entered opening balance',
    use_imported_total: 'Use imported statement total',
    scale_to_opening_balance: 'Scale imported schedule to opening balance',
  };
  const STATUS_LABELS = {
    within_limit: 'Within Limit',
    at_risk: 'At Risk',
    over_limit: 'Over Limit',
  };

  const DEFAULT_ASSUMPTIONS = {
    clientName: '',
    scenarioName: 'Base case',
    notes: '',
    currency: 'GBP',
    creditLimit: 250000,
    currentOutstandingBalance: 0,
    vatApplicable: true,
    vatRate: 20,
    forecastStartDate: isoToday(),
    forecastHorizonWeeks: 20,
    riskThresholdPercent: 90,
    paymentTerms: {
      type: '30_eom',
      customNetDays: 21,
      receiptLagDays: 0,
    },
    openingBalance: {
      receiptMode: 'term_profile',
      runoffWeeks: 6,
      importedStatement: {
        status: '',
        sourceType: '',
        fileName: '',
        fileSize: 0,
        importedAt: '',
        parseMethod: '',
        confidence: '',
        confidenceScore: 0,
        warnings: [],
        rows: [],
        rowCount: 0,
        includedRowCount: 0,
        importedTotal: 0,
        scheduledReceiptTotal: 0,
        overdueRowCount: 0,
        creditNoteCount: 0,
        detectedCurrency: '',
        multipleCurrencies: false,
        reconciliationMode: 'keep_manual_opening_balance',
        overdueCollectionDays: 7,
        extraction: null,
      },
    },
    growthMode: 'contractor',
    direct: {
      baseWeeklyNet: 0,
      baseWeeklyGross: 0,
      scenarioWeeklyNet: 0,
      scenarioWeeklyGross: 0,
    },
    contractor: {
      currentContractors: 0,
      additionalContractors: 0,
      weeklyPayPerContractor: 0,
      hourlyWage: 0,
      weeklyHours: 40,
      marginPercent: 18,
      perContractorNetInvoice: 0,
      perContractorGrossInvoice: 0,
    },
    invoice: {
      cadence: 'weekly',
      invoiceWeekday: 2,
      autoCountDates: true,
      manualEventCounts: [],
    },
    receiptLines: [],
    receiptWeekAdjustments: [],
  };

  function isoToday() {
    return formatDate(new Date());
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function roundMoney(value) {
    const number = Number(value) || 0;
    return Math.round(number * 100) / 100;
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function toNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function toWholeNumber(value, fallback) {
    const number = Math.round(toNumber(value, fallback));
    return Number.isFinite(number) ? number : fallback;
  }

  function normaliseCurrency(value) {
    const currency = String(value || '').trim().toUpperCase();
    return currency === 'EUR' ? 'EUR' : 'GBP';
  }

  function pad(num) {
    return String(num).padStart(2, '0');
  }

  function parseDate(value) {
    if (value instanceof Date) {
      return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    }
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const year = Number(text.slice(0, 4));
      const month = Number(text.slice(5, 7));
      const day = Number(text.slice(8, 10));
      return new Date(Date.UTC(year, month - 1, day));
    }
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      return parseDate(isoToday());
    }
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }

  function formatDate(value) {
    const date = value instanceof Date ? value : parseDate(value);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  function formatLongDate(value) {
    const date = value instanceof Date ? value : parseDate(value);
    return date.toLocaleDateString('en-GB', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  function addDays(value, days) {
    const date = value instanceof Date ? value : parseDate(value);
    return new Date(date.getTime() + days * DAY_MS);
  }

  function startOfWeek(value, startsOn) {
    const date = value instanceof Date ? value : parseDate(value);
    const target = typeof startsOn === 'number' ? startsOn : 1;
    const day = date.getUTCDay();
    const diff = (day - target + 7) % 7;
    return addDays(date, -diff);
  }

  function endOfMonth(value) {
    const date = value instanceof Date ? value : parseDate(value);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  }

  function firstOfMonth(value) {
    const date = value instanceof Date ? value : parseDate(value);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  function compareDates(left, right) {
    return parseDate(left).getTime() - parseDate(right).getTime();
  }

  function dateWithinWeekForWeekday(weekStartDate, weekdayIndex) {
    const start = weekStartDate instanceof Date ? weekStartDate : parseDate(weekStartDate);
    const startDay = start.getUTCDay();
    const diff = (weekdayIndex - startDay + 7) % 7;
    return addDays(start, diff);
  }

  function lastWeekdayOfMonth(monthDate, weekdayIndex) {
    let cursor = endOfMonth(monthDate);
    while (cursor.getUTCDay() !== weekdayIndex) {
      cursor = addDays(cursor, -1);
    }
    return cursor;
  }

  function findWeekIndexForDate(dateValue, weeks) {
    const date = dateValue instanceof Date ? dateValue : parseDate(dateValue);
    for (let index = 0; index < weeks.length; index += 1) {
      const week = weeks[index];
      if (date.getTime() >= week.weekStartDate.getTime() && date.getTime() <= week.weekEndDate.getTime()) {
        return index;
      }
    }
    return -1;
  }

  function normaliseManualEventCounts(value) {
    const list = Array.isArray(value) ? value : [];
    return list.map(function (entry) {
      if (entry == null || entry === '') return null;
      const parsed = toWholeNumber(entry, null);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    });
  }

  function normaliseReceiptLines(lines) {
    const input = Array.isArray(lines) ? lines : [];
    return input
      .map(function (line, index) {
        const amount = roundMoney(toNumber(line && line.amount, 0));
        const date = formatDate(parseDate(line && line.date ? line.date : isoToday()));
        const note = String((line && line.note) || '').trim();
        return {
          id: String((line && line.id) || ('receipt-line-' + index)),
          date: date,
          amount: amount,
          note: note,
        };
      })
      .filter(function (line) {
        return line.amount !== 0;
      });
  }

  function normaliseReceiptAdjustments(list, horizonWeeks) {
    const input = Array.isArray(list) ? list : [];
    const output = [];
    for (let index = 0; index < horizonWeeks; index += 1) {
      const source = input[index] || {};
      output.push({
        weekIndex: index,
        amount: roundMoney(toNumber(source.amount, 0)),
        note: String(source.note || '').trim(),
      });
    }
    return output;
  }

  function normaliseOpeningBalanceMode(value, fallback) {
    const mode = String(value || '').trim();
    return OPENING_BALANCE_MODE_LABELS[mode] ? mode : (fallback || DEFAULT_ASSUMPTIONS.openingBalance.receiptMode);
  }

  function normaliseOptionalDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return '';
    return formatDate(new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())));
  }

  function normaliseReconciliationMode(value) {
    const mode = String(value || '').trim();
    return OPENING_BALANCE_RECONCILIATION_LABELS[mode]
      ? mode
      : DEFAULT_ASSUMPTIONS.openingBalance.importedStatement.reconciliationMode;
  }

  function sanitizeImportedStatementRows(rows, fallbackCurrency) {
    return (Array.isArray(rows) ? rows : [])
      .map(function (row, index) {
        const amount = roundMoney(toNumber(row && row.outstandingAmount, 0));
        return {
          id: String((row && row.id) || ('import-row-' + index)),
          include: row && row.include !== false,
          sourceRowNumber: toWholeNumber(row && row.sourceRowNumber, index + 2),
          invoiceRef: String((row && row.invoiceRef) || '').trim(),
          invoiceDate: normaliseOptionalDate(row && row.invoiceDate),
          dueDate: normaliseOptionalDate(row && row.dueDate),
          dueDateDerived: row && row.dueDateDerived === true,
          outstandingAmount: amount,
          currency: normaliseCurrency((row && row.currency) || fallbackCurrency),
          grossAmount: roundMoney(toNumber(row && row.grossAmount, 0)),
          netAmount: roundMoney(toNumber(row && row.netAmount, 0)),
          vatAmount: roundMoney(toNumber(row && row.vatAmount, 0)),
          clientName: String((row && row.clientName) || '').trim(),
          status: String((row && row.status) || '').trim(),
          daysOverdue: Number.isFinite(Number(row && row.daysOverdue)) ? Math.round(Number(row.daysOverdue)) : null,
          ageingBucket: String((row && row.ageingBucket) || '').trim(),
          creditNote: row && row.creditNote === true,
          paymentReference: String((row && row.paymentReference) || '').trim(),
          note: String((row && row.note) || '').trim(),
          warnings: Array.isArray(row && row.warnings)
            ? row.warnings.map(function (entry) { return String(entry || '').trim(); }).filter(Boolean).slice(0, 8)
            : [],
          warningText: String((row && row.warningText) || '').trim(),
        };
      })
      .filter(function (row) {
        return row.invoiceRef || row.invoiceDate || row.dueDate || row.outstandingAmount;
      });
  }

  function summarizeImportedStatement(rows, fallbackCurrency, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const included = rows.filter(function (row) { return row.include !== false; });
    const forecastStartDate = settings.forecastStartDate ? parseDate(settings.forecastStartDate) : parseDate(isoToday());
    const importedTotal = roundMoney(included.reduce(function (total, row) {
      return total + row.outstandingAmount;
    }, 0));
    const scheduledReceiptTotal = roundMoney(included.reduce(function (total, row) {
      if (row.creditNote || row.outstandingAmount <= 0) return total;
      return total + row.outstandingAmount;
    }, 0));
    const overdueRowCount = included.reduce(function (total, row) {
      const dueDate = row.dueDate ? parseDate(row.dueDate) : null;
      if (!dueDate || row.outstandingAmount <= 0) return total;
      return total + (dueDate.getTime() < forecastStartDate.getTime() ? 1 : 0);
    }, 0);
    const creditNoteCount = included.reduce(function (total, row) {
      return total + (row.creditNote || row.outstandingAmount < 0 ? 1 : 0);
    }, 0);
    const currencies = Array.from(new Set(included.map(function (row) {
      return normaliseCurrency(row.currency || fallbackCurrency);
    }).filter(Boolean)));
    return {
      rowCount: rows.length,
      includedRowCount: included.length,
      importedTotal: importedTotal,
      scheduledReceiptTotal: scheduledReceiptTotal,
      overdueRowCount: overdueRowCount,
      creditNoteCount: creditNoteCount,
      detectedCurrency: currencies.length === 1 ? currencies[0] : normaliseCurrency(fallbackCurrency),
      multipleCurrencies: currencies.length > 1,
    };
  }

  function sanitizeImportedStatement(value, fallbackCurrency) {
    const source = value && typeof value === 'object' ? value : {};
    const rows = sanitizeImportedStatementRows(source.rows, fallbackCurrency);
    const summary = summarizeImportedStatement(rows, fallbackCurrency);
    return {
      status: String(source.status || '').trim(),
      sourceType: String(source.sourceType || '').trim(),
      fileName: String(source.fileName || '').trim(),
      fileSize: Math.max(0, toWholeNumber(source.fileSize, 0)),
      importedAt: String(source.importedAt || '').trim(),
      parseMethod: String(source.parseMethod || '').trim(),
      confidence: String(source.confidence || '').trim(),
      confidenceScore: Math.max(0, Math.min(1, toNumber(source.confidenceScore, 0))),
      warnings: Array.isArray(source.warnings)
        ? source.warnings.map(function (entry) { return String(entry || '').trim(); }).filter(Boolean).slice(0, 12)
        : [],
      rows: rows,
      rowCount: summary.rowCount,
      includedRowCount: summary.includedRowCount,
      importedTotal: source.importedTotal != null ? roundMoney(toNumber(source.importedTotal, summary.importedTotal)) : summary.importedTotal,
      scheduledReceiptTotal: source.scheduledReceiptTotal != null ? roundMoney(toNumber(source.scheduledReceiptTotal, summary.scheduledReceiptTotal)) : summary.scheduledReceiptTotal,
      overdueRowCount: source.overdueRowCount != null ? toWholeNumber(source.overdueRowCount, summary.overdueRowCount) : summary.overdueRowCount,
      creditNoteCount: source.creditNoteCount != null ? toWholeNumber(source.creditNoteCount, summary.creditNoteCount) : summary.creditNoteCount,
      detectedCurrency: normaliseCurrency(source.detectedCurrency || summary.detectedCurrency || fallbackCurrency),
      multipleCurrencies: source.multipleCurrencies === true || summary.multipleCurrencies === true,
      reconciliationMode: normaliseReconciliationMode(source.reconciliationMode),
      overdueCollectionDays: clampNumber(
        source.overdueCollectionDays,
        0,
        60,
        DEFAULT_ASSUMPTIONS.openingBalance.importedStatement.overdueCollectionDays
      ),
      extraction: source.extraction && typeof source.extraction === 'object'
        ? {
          strategy: String(source.extraction.strategy || '').trim(),
          parser: String(source.extraction.parser || '').trim(),
          totalPages: Math.max(0, toWholeNumber(source.extraction.totalPages, 0)),
        }
        : null,
    };
  }

  function openingBalanceContext(model) {
    const statement = sanitizeImportedStatement(
      model && model.openingBalance && model.openingBalance.importedStatement,
      model && model.currency
    );
    const enteredOpeningBalance = roundMoney(model && model.currentOutstandingBalance);
    const importedTotal = roundMoney(statement.importedTotal);
    const reconciliationMode = normaliseReconciliationMode(statement.reconciliationMode);
    const effectiveOpeningBalance = reconciliationMode === 'use_imported_total'
      ? importedTotal
      : enteredOpeningBalance;
    const scheduleScaleFactor = reconciliationMode === 'scale_to_opening_balance' && importedTotal
      ? roundMoney(enteredOpeningBalance / importedTotal)
      : 1;
    return {
      statement: statement,
      hasConfirmedStatement: statement.status === 'confirmed' && statement.rows.length > 0,
      enteredOpeningBalance: enteredOpeningBalance,
      importedTotal: importedTotal,
      variance: roundMoney(importedTotal - enteredOpeningBalance),
      reconciliationMode: reconciliationMode,
      effectiveOpeningBalance: roundMoney(effectiveOpeningBalance),
      scheduleScaleFactor: Number.isFinite(scheduleScaleFactor) ? scheduleScaleFactor : 1,
    };
  }

  function sanitizeAssumptions(input) {
    const source = input && typeof input === 'object' ? input : {};
    const merged = cloneJson(DEFAULT_ASSUMPTIONS);

    merged.clientName = String(source.clientName || '').trim();
    merged.scenarioName = String(source.scenarioName || DEFAULT_ASSUMPTIONS.scenarioName).trim() || DEFAULT_ASSUMPTIONS.scenarioName;
    merged.notes = String(source.notes || '').trim();
    merged.currency = normaliseCurrency(source.currency);
    merged.creditLimit = roundMoney(Math.max(0, toNumber(source.creditLimit, DEFAULT_ASSUMPTIONS.creditLimit)));
    merged.currentOutstandingBalance = roundMoney(toNumber(source.currentOutstandingBalance, 0));
    merged.vatApplicable = source.vatApplicable !== false;
    merged.vatRate = clampNumber(source.vatRate, 0, 100, DEFAULT_ASSUMPTIONS.vatRate);
    merged.forecastStartDate = formatDate(parseDate(source.forecastStartDate || DEFAULT_ASSUMPTIONS.forecastStartDate));
    merged.forecastHorizonWeeks = clampNumber(source.forecastHorizonWeeks, 4, 52, DEFAULT_ASSUMPTIONS.forecastHorizonWeeks);
    merged.riskThresholdPercent = clampNumber(source.riskThresholdPercent, 50, 100, DEFAULT_ASSUMPTIONS.riskThresholdPercent);

    const terms = source.paymentTerms && typeof source.paymentTerms === 'object' ? source.paymentTerms : {};
    merged.paymentTerms.type = TERM_LABELS[String(terms.type || '')] ? String(terms.type) : DEFAULT_ASSUMPTIONS.paymentTerms.type;
    merged.paymentTerms.customNetDays = clampNumber(terms.customNetDays, 0, 180, DEFAULT_ASSUMPTIONS.paymentTerms.customNetDays);
    merged.paymentTerms.receiptLagDays = clampNumber(terms.receiptLagDays, 0, 60, DEFAULT_ASSUMPTIONS.paymentTerms.receiptLagDays);

    const openingBalance = source.openingBalance && typeof source.openingBalance === 'object' ? source.openingBalance : {};
    const legacyReceiptLines = normaliseReceiptLines(source.receiptLines || []);
    const explicitOpeningMode = source.openingBalance && typeof source.openingBalance.receiptMode === 'string';
    merged.openingBalance.receiptMode = normaliseOpeningBalanceMode(
      explicitOpeningMode
        ? openingBalance.receiptMode
        : (legacyReceiptLines.length ? 'manual' : DEFAULT_ASSUMPTIONS.openingBalance.receiptMode)
    );
    merged.openingBalance.runoffWeeks = clampNumber(
      openingBalance.runoffWeeks,
      1,
      52,
      DEFAULT_ASSUMPTIONS.openingBalance.runoffWeeks
    );
    merged.openingBalance.importedStatement = sanitizeImportedStatement(
      openingBalance.importedStatement,
      merged.currency
    );

    merged.growthMode = ['direct', 'contractor', 'combined'].indexOf(String(source.growthMode || '')) >= 0
      ? String(source.growthMode)
      : DEFAULT_ASSUMPTIONS.growthMode;

    const direct = source.direct && typeof source.direct === 'object' ? source.direct : {};
    merged.direct.baseWeeklyNet = roundMoney(Math.max(0, toNumber(direct.baseWeeklyNet, 0)));
    merged.direct.baseWeeklyGross = roundMoney(Math.max(0, toNumber(direct.baseWeeklyGross, 0)));
    merged.direct.scenarioWeeklyNet = roundMoney(Math.max(0, toNumber(direct.scenarioWeeklyNet, 0)));
    merged.direct.scenarioWeeklyGross = roundMoney(Math.max(0, toNumber(direct.scenarioWeeklyGross, 0)));

    const contractor = source.contractor && typeof source.contractor === 'object' ? source.contractor : {};
    merged.contractor.currentContractors = clampNumber(contractor.currentContractors, 0, 5000, 0);
    merged.contractor.additionalContractors = clampNumber(contractor.additionalContractors, 0, 5000, 0);
    merged.contractor.weeklyPayPerContractor = roundMoney(Math.max(0, toNumber(contractor.weeklyPayPerContractor, 0)));
    merged.contractor.hourlyWage = roundMoney(Math.max(0, toNumber(contractor.hourlyWage, 0)));
    merged.contractor.weeklyHours = roundMoney(Math.max(0, toNumber(contractor.weeklyHours, DEFAULT_ASSUMPTIONS.contractor.weeklyHours)));
    merged.contractor.marginPercent = roundMoney(toNumber(contractor.marginPercent, DEFAULT_ASSUMPTIONS.contractor.marginPercent));
    merged.contractor.perContractorNetInvoice = roundMoney(Math.max(0, toNumber(contractor.perContractorNetInvoice, 0)));
    merged.contractor.perContractorGrossInvoice = roundMoney(Math.max(0, toNumber(contractor.perContractorGrossInvoice, 0)));

    const invoice = source.invoice && typeof source.invoice === 'object' ? source.invoice : {};
    merged.invoice.cadence = invoice.cadence === 'monthly' ? 'monthly' : 'weekly';
    merged.invoice.invoiceWeekday = clampNumber(invoice.invoiceWeekday, 0, 6, DEFAULT_ASSUMPTIONS.invoice.invoiceWeekday);
    merged.invoice.autoCountDates = invoice.autoCountDates !== false;
    merged.invoice.manualEventCounts = normaliseManualEventCounts(invoice.manualEventCounts || []);

    merged.receiptLines = legacyReceiptLines;
    merged.receiptWeekAdjustments = normaliseReceiptAdjustments(source.receiptWeekAdjustments || [], merged.forecastHorizonWeeks);

    return merged;
  }

  function vatMultiplier(model) {
    return model.vatApplicable ? 1 + model.vatRate / 100 : 1;
  }

  function resolveAmountPair(netValue, grossValue, multiplier) {
    const gross = Math.max(0, toNumber(grossValue, 0));
    const net = Math.max(0, toNumber(netValue, 0));
    if (gross > 0) {
      return {
        gross: roundMoney(gross),
        net: roundMoney(multiplier > 0 ? gross / multiplier : gross),
      };
    }
    if (net > 0) {
      return {
        net: roundMoney(net),
        gross: roundMoney(net * multiplier),
      };
    }
    return { net: 0, gross: 0 };
  }

  function derivePerContractorInvoice(model, multiplier) {
    const explicit = resolveAmountPair(
      model.contractor.perContractorNetInvoice,
      model.contractor.perContractorGrossInvoice,
      multiplier
    );
    if (explicit.gross > 0 || explicit.net > 0) {
      return explicit;
    }

    const weeklyPay = Math.max(
      0,
      toNumber(model.contractor.weeklyPayPerContractor, 0) || (toNumber(model.contractor.hourlyWage, 0) * toNumber(model.contractor.weeklyHours, 0))
    );
    if (weeklyPay <= 0) {
      return { net: 0, gross: 0 };
    }
    const upliftMultiplier = 1 + (toNumber(model.contractor.marginPercent, 0) / 100);
    const net = roundMoney(weeklyPay * upliftMultiplier);
    return {
      net: net,
      gross: roundMoney(net * multiplier),
    };
  }

  function deriveRunRateComponents(input) {
    const model = sanitizeAssumptions(input);
    const multiplier = vatMultiplier(model);
    const directBase = resolveAmountPair(model.direct.baseWeeklyNet, model.direct.baseWeeklyGross, multiplier);
    const directScenario = resolveAmountPair(model.direct.scenarioWeeklyNet, model.direct.scenarioWeeklyGross, multiplier);
    const perContractor = derivePerContractorInvoice(model, multiplier);
    const contractorBase = {
      net: roundMoney(perContractor.net * model.contractor.currentContractors),
      gross: roundMoney(perContractor.gross * model.contractor.currentContractors),
    };
    const contractorScenario = {
      net: roundMoney(perContractor.net * model.contractor.additionalContractors),
      gross: roundMoney(perContractor.gross * model.contractor.additionalContractors),
    };

    const includeDirect = model.growthMode === 'direct' || model.growthMode === 'combined';
    const includeContractor = model.growthMode === 'contractor' || model.growthMode === 'combined';

    const totals = {
      baseNet: roundMoney((includeDirect ? directBase.net : 0) + (includeContractor ? contractorBase.net : 0)),
      baseGross: roundMoney((includeDirect ? directBase.gross : 0) + (includeContractor ? contractorBase.gross : 0)),
      scenarioNet: roundMoney((includeDirect ? directScenario.net : 0) + (includeContractor ? contractorScenario.net : 0)),
      scenarioGross: roundMoney((includeDirect ? directScenario.gross : 0) + (includeContractor ? contractorScenario.gross : 0)),
    };

    let capacityUnitNet = perContractor.net;
    let capacityUnitGross = perContractor.gross;

    if (capacityUnitGross <= 0 && model.contractor.additionalContractors > 0) {
      capacityUnitGross = roundMoney(totals.scenarioGross / model.contractor.additionalContractors);
      capacityUnitNet = roundMoney(totals.scenarioNet / model.contractor.additionalContractors);
    }

    if (capacityUnitGross <= 0 && model.contractor.currentContractors > 0 && totals.baseGross > 0) {
      capacityUnitGross = roundMoney(totals.baseGross / model.contractor.currentContractors);
      capacityUnitNet = roundMoney(totals.baseNet / model.contractor.currentContractors);
    }

    return {
      vatMultiplier: multiplier,
      directBase: directBase,
      directScenario: directScenario,
      contractorBase: contractorBase,
      contractorScenario: contractorScenario,
      perContractor: perContractor,
      totalBaseNet: totals.baseNet,
      totalBaseGross: totals.baseGross,
      totalScenarioNet: totals.scenarioNet,
      totalScenarioGross: totals.scenarioGross,
      fixedScenarioNetExcludingContractors: includeDirect ? directScenario.net : 0,
      fixedScenarioGrossExcludingContractors: includeDirect ? directScenario.gross : 0,
      capacityUnitNet: roundMoney(Math.max(0, capacityUnitNet)),
      capacityUnitGross: roundMoney(Math.max(0, capacityUnitGross)),
    };
  }

  function generateWeeks(input) {
    const model = sanitizeAssumptions(input);
    const forecastStartDate = parseDate(model.forecastStartDate);
    const firstWeekStart = startOfWeek(forecastStartDate, 1);
    const weeks = [];
    for (let index = 0; index < model.forecastHorizonWeeks; index += 1) {
      const weekStartDate = addDays(firstWeekStart, index * 7);
      const weekEndDate = addDays(weekStartDate, 6);
      weeks.push({
        index: index,
        weekNumber: index + 1,
        weekStartDate: weekStartDate,
        weekEndDate: weekEndDate,
        weekCommencing: formatDate(weekStartDate),
        weekEnding: formatDate(weekEndDate),
      });
    }
    return weeks;
  }

  function buildMonthlyInvoiceDates(startDate, endDate, weekdayIndex) {
    const dates = [];
    let cursor = firstOfMonth(startDate);
    while (cursor.getTime() <= endDate.getTime()) {
      const candidate = lastWeekdayOfMonth(cursor, weekdayIndex);
      if (candidate.getTime() >= startDate.getTime() && candidate.getTime() <= endDate.getTime()) {
        dates.push(candidate);
      }
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
    return dates;
  }

  function synthesiseDatesForWeek(week, preferredDate, count, forecastStartDate) {
    const dates = [];
    const safeCount = Math.max(0, toWholeNumber(count, 0));
    if (!safeCount) return dates;

    let cursor = preferredDate instanceof Date ? preferredDate : parseDate(preferredDate);
    if (cursor.getTime() < week.weekStartDate.getTime()) {
      cursor = week.weekStartDate;
    }
    if (cursor.getTime() < forecastStartDate.getTime()) {
      cursor = forecastStartDate;
    }
    if (cursor.getTime() > week.weekEndDate.getTime()) {
      cursor = week.weekEndDate;
    }

    for (let index = 0; index < safeCount; index += 1) {
      const candidate = addDays(cursor, index);
      dates.push(candidate.getTime() <= week.weekEndDate.getTime() ? candidate : week.weekEndDate);
    }
    return dates;
  }

  function buildInvoicePlan(input, weeks) {
    const model = sanitizeAssumptions(input);
    const startDate = parseDate(model.forecastStartDate);
    const endDate = weeks.length ? weeks[weeks.length - 1].weekEndDate : startDate;
    const defaults = weeks.map(function () {
      return [];
    });

    if (model.invoice.cadence === 'weekly') {
      weeks.forEach(function (week, index) {
        const candidate = dateWithinWeekForWeekday(week.weekStartDate, model.invoice.invoiceWeekday);
        if (candidate.getTime() >= startDate.getTime() && candidate.getTime() <= week.weekEndDate.getTime()) {
          defaults[index].push(candidate);
        }
      });
    } else {
      buildMonthlyInvoiceDates(startDate, endDate, model.invoice.invoiceWeekday).forEach(function (date) {
        const weekIndex = findWeekIndexForDate(date, weeks);
        if (weekIndex >= 0) {
          defaults[weekIndex].push(date);
        }
      });
    }

    return weeks.map(function (week, index) {
      const manualCount = model.invoice.autoCountDates ? null : model.invoice.manualEventCounts[index];
      const defaultDates = defaults[index];
      const count = manualCount != null ? manualCount : defaultDates.length;
      const preferredDate = defaultDates[0] || dateWithinWeekForWeekday(week.weekStartDate, model.invoice.invoiceWeekday);
      const invoiceDates = synthesiseDatesForWeek(week, preferredDate, count, startDate);
      return {
        weekIndex: index,
        invoiceCount: invoiceDates.length,
        defaultCount: defaultDates.length,
        isManual: manualCount != null,
        invoiceDates: invoiceDates,
      };
    });
  }

  function termDueDate(invoiceDate, paymentTerms) {
    const invoice = invoiceDate instanceof Date ? invoiceDate : parseDate(invoiceDate);
    const lag = clampNumber(paymentTerms && paymentTerms.receiptLagDays, 0, 60, 0);
    let dueDate;

    switch (String(paymentTerms && paymentTerms.type || '30_eom')) {
      case '30_from_invoice':
        dueDate = addDays(invoice, 30);
        break;
      case '14_net':
        dueDate = addDays(invoice, 14);
        break;
      case 'custom_net':
        dueDate = addDays(invoice, clampNumber(paymentTerms && paymentTerms.customNetDays, 0, 180, 0));
        break;
      case '30_eom':
      default:
        dueDate = addDays(endOfMonth(invoice), 30);
        break;
    }

    return addDays(dueDate, lag);
  }

  function splitAmount(total, parts) {
    const safeParts = Math.max(1, toWholeNumber(parts, 1));
    const cents = Math.round(roundMoney(total) * 100);
    const base = Math.floor(cents / safeParts);
    const remainder = cents % safeParts;
    const values = [];
    for (let index = 0; index < safeParts; index += 1) {
      values.push((base + (index < remainder ? 1 : 0)) / 100);
    }
    return values;
  }

  function statusForBalance(balance, creditLimit, riskThresholdPercent) {
    if (balance > creditLimit) return 'over_limit';
    if (creditLimit > 0 && (balance / creditLimit) * 100 >= riskThresholdPercent) return 'at_risk';
    return 'within_limit';
  }

  function summariseOverallStatus(rows) {
    let hasRisk = false;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.status === 'over_limit') return 'over_limit';
      if (row.status === 'at_risk') hasRisk = true;
    }
    return hasRisk ? 'at_risk' : 'within_limit';
  }

  function manualReceiptsByWeek(receiptLines, weeks) {
    const grouped = new Map();
    receiptLines.forEach(function (line) {
      const weekIndex = findWeekIndexForDate(line.date, weeks);
      if (weekIndex < 0) return;
      const existing = grouped.get(weekIndex) || [];
      existing.push({
        id: line.id,
        date: formatDate(line.date),
        amount: roundMoney(line.amount),
        note: line.note,
        source: 'manual_receipt',
      });
      grouped.set(weekIndex, existing);
    });
    return grouped;
  }

  function groupReceiptScheduleByWeek(entries, weeks, receiptKey) {
    const grouped = new Map();
    entries.forEach(function (entry) {
      const weekIndex = receiptKey === 'receiptWeekIndex'
        ? entry.receiptWeekIndex
        : findWeekIndexForDate(entry.date, weeks);
      if (weekIndex < 0) return;
      const existing = grouped.get(weekIndex) || [];
      existing.push(entry);
      grouped.set(weekIndex, existing);
    });
    return grouped;
  }

  function openingBalanceTermLeadDays(paymentTerms) {
    const lag = clampNumber(paymentTerms && paymentTerms.receiptLagDays, 0, 60, 0);
    switch (String(paymentTerms && paymentTerms.type || '30_eom')) {
      case '30_from_invoice':
        return 30 + lag;
      case '14_net':
        return 14 + lag;
      case 'custom_net':
        return clampNumber(paymentTerms && paymentTerms.customNetDays, 0, 180, 0) + lag;
      case '30_eom':
      default:
        return 60 + lag;
    }
  }

  function openingBalanceProfileLookbackWeeks(model) {
    const leadDays = openingBalanceTermLeadDays(model && model.paymentTerms);
    return Math.max(12, Math.ceil((leadDays + 35) / 7));
  }

  function estimatedOpeningBalanceRunoffWeeks(model) {
    const leadDays = openingBalanceTermLeadDays(model && model.paymentTerms);
    return Math.max(3, Math.min(12, Math.ceil(leadDays / 7) + 1));
  }

  function buildHistoricalInvoiceDates(model, startDate, endDate) {
    const dates = [];
    if (model.invoice.cadence === 'monthly') {
      buildMonthlyInvoiceDates(startDate, endDate, model.invoice.invoiceWeekday).forEach(function (date) {
        if (date.getTime() >= startDate.getTime() && date.getTime() <= endDate.getTime()) {
          dates.push(date);
        }
      });
      return dates;
    }

    let cursor = startOfWeek(startDate, 1);
    while (cursor.getTime() <= endDate.getTime()) {
      const candidate = dateWithinWeekForWeekday(cursor, model.invoice.invoiceWeekday);
      if (candidate.getTime() >= startDate.getTime() && candidate.getTime() <= endDate.getTime()) {
        dates.push(candidate);
      }
      cursor = addDays(cursor, 7);
    }
    return dates;
  }

  function buildEvenOpeningBalanceSchedule(model, weeks) {
    const total = roundMoney(model.currentOutstandingBalance);
    if (total <= 0) return [];
    const runoffWeeks = clampNumber(
      model.openingBalance && model.openingBalance.runoffWeeks,
      1,
      52,
      DEFAULT_ASSUMPTIONS.openingBalance.runoffWeeks
    );
    const chunks = splitAmount(total, runoffWeeks);
    return chunks.map(function (amount, index) {
      const week = weeks[index];
      const receiptDate = week ? week.weekEndDate : addDays(parseDate(model.forecastStartDate), index * 7);
      return {
        id: 'opening-runoff-' + index,
        date: formatDate(receiptDate),
        dateLabel: formatLongDate(receiptDate),
        dueDate: formatDate(receiptDate),
        dueDateLabel: formatLongDate(receiptDate),
        amount: roundMoney(amount),
        receiptWeekIndex: week ? index : -1,
        source: 'opening_balance_even_runoff',
        sourceLabel: 'Opening balance runoff',
        note: 'Even runoff across ' + runoffWeeks + ' week' + (runoffWeeks === 1 ? '' : 's'),
      };
    });
  }

  function buildManualOpeningBalanceSchedule(model, weeks) {
    return (model.receiptLines || []).map(function (line, index) {
      const receiptDate = parseDate(line.date);
      return {
        id: String(line.id || ('opening-manual-' + index)),
        date: formatDate(receiptDate),
        dateLabel: formatLongDate(receiptDate),
        dueDate: formatDate(receiptDate),
        dueDateLabel: formatLongDate(receiptDate),
        amount: roundMoney(line.amount),
        receiptWeekIndex: findWeekIndexForDate(receiptDate, weeks),
        source: 'opening_balance_manual',
        sourceLabel: 'Opening balance manual receipt',
        note: line.note || 'Known opening-balance receipt',
      };
    });
  }

  function buildImportedOpeningBalanceSchedule(model, weeks, context) {
    const openingContext = context || openingBalanceContext(model);
    const statement = openingContext.statement;
    if (!openingContext.hasConfirmedStatement) return [];

    const forecastStartDate = parseDate(model.forecastStartDate);
    const receiptLagDays = clampNumber(model.paymentTerms && model.paymentTerms.receiptLagDays, 0, 60, 0);
    const overdueCollectionDays = clampNumber(
      statement.overdueCollectionDays,
      0,
      60,
      DEFAULT_ASSUMPTIONS.openingBalance.importedStatement.overdueCollectionDays
    );

    return statement.rows
      .filter(function (row) {
        return row.include !== false && row.outstandingAmount > 0 && row.creditNote !== true;
      })
      .map(function (row, index) {
        const invoiceDate = row.invoiceDate ? parseDate(row.invoiceDate) : null;
        const baseDueDate = row.dueDate
          ? parseDate(row.dueDate)
          : (invoiceDate ? termDueDate(invoiceDate, Object.assign({}, model.paymentTerms, { receiptLagDays: 0 })) : forecastStartDate);
        let expectedReceiptDate = addDays(baseDueDate, receiptLagDays);
        const wasOverdue = expectedReceiptDate.getTime() < forecastStartDate.getTime();
        if (wasOverdue) {
          expectedReceiptDate = addDays(forecastStartDate, overdueCollectionDays);
        }
        const sourceDate = invoiceDate || baseDueDate || forecastStartDate;
        const scaledAmount = roundMoney(row.outstandingAmount * openingContext.scheduleScaleFactor);
        return {
          id: row.id || ('opening-import-' + index),
          date: formatDate(sourceDate),
          dateLabel: formatLongDate(sourceDate),
          dueDate: formatDate(expectedReceiptDate),
          dueDateLabel: formatLongDate(expectedReceiptDate),
          statementDueDate: row.dueDate || '',
          statementDueDateLabel: row.dueDate ? formatLongDate(row.dueDate) : '',
          amount: scaledAmount,
          receiptWeekIndex: findWeekIndexForDate(expectedReceiptDate, weeks),
          source: 'opening_balance_imported_statement',
          sourceLabel: 'Imported statement',
          invoiceRef: row.invoiceRef || '',
          note: row.note
            || (row.invoiceRef
              ? (row.invoiceRef + (wasOverdue ? ' • overdue opening item' : ' • imported due-date receipt'))
              : (wasOverdue ? 'Overdue imported opening item' : 'Imported opening statement row')),
          currency: row.currency || model.currency,
          wasOverdue: wasOverdue,
        };
      });
  }

  function buildTermProfileOpeningBalanceSchedule(model, weeks) {
    const total = roundMoney(model.currentOutstandingBalance);
    if (total <= 0) return [];

    const forecastStartDate = parseDate(model.forecastStartDate);
    const historyEndDate = addDays(forecastStartDate, -1);
    const lookbackWeeks = openingBalanceProfileLookbackWeeks(model);
    const historyStartDate = addDays(forecastStartDate, -(lookbackWeeks * 7));
    // Approximation: we treat the opening balance as a steady-state debtor book built from
    // recent invoices raised on the current cadence, then scale the still-open items to the
    // live opening balance so receipts land in term-shaped weeks without implying exact ageing.
    const historicalInvoiceDates = buildHistoricalInvoiceDates(model, historyStartDate, historyEndDate);
    const openEvents = historicalInvoiceDates
      .map(function (invoiceDate, index) {
        const dueDate = termDueDate(invoiceDate, model.paymentTerms);
        if (dueDate.getTime() < forecastStartDate.getTime()) return null;
        return {
          id: 'opening-profile-' + index,
          invoiceDate: invoiceDate,
          dueDate: dueDate,
        };
      })
      .filter(Boolean);

    if (!openEvents.length) {
      return buildEvenOpeningBalanceSchedule(Object.assign({}, model, {
        openingBalance: Object.assign({}, model.openingBalance, {
          runoffWeeks: estimatedOpeningBalanceRunoffWeeks(model),
        }),
      }), weeks).map(function (entry) {
        return Object.assign({}, entry, {
          source: 'opening_balance_term_profile_fallback',
          sourceLabel: 'Opening balance profile fallback',
          note: 'Fallback runoff when no debtor-profile events could be derived',
        });
      });
    }

    const chunks = splitAmount(total, openEvents.length);
    return openEvents.map(function (event, index) {
      return {
        id: event.id,
        date: formatDate(event.invoiceDate),
        dateLabel: formatLongDate(event.invoiceDate),
        dueDate: formatDate(event.dueDate),
        dueDateLabel: formatLongDate(event.dueDate),
        amount: roundMoney(chunks[index] || 0),
        receiptWeekIndex: findWeekIndexForDate(event.dueDate, weeks),
        source: 'opening_balance_term_profile',
        sourceLabel: 'Opening balance debtor profile',
        note: 'Estimated from selected payment terms and invoice cadence',
      };
    });
  }

  function buildOpeningBalanceReceiptSchedule(model, weeks) {
    const context = openingBalanceContext(model);
    const mode = normaliseOpeningBalanceMode(model && model.openingBalance && model.openingBalance.receiptMode);
    switch (mode) {
      case 'manual':
        return buildManualOpeningBalanceSchedule(model, weeks);
      case 'even_runoff':
        return buildEvenOpeningBalanceSchedule(model, weeks);
      case 'term_profile':
        return buildTermProfileOpeningBalanceSchedule(model, weeks);
      case 'import_statement':
        return buildImportedOpeningBalanceSchedule(model, weeks, context);
      case 'no_receipts':
      default:
        return [];
    }
  }

  function buildForecast(input, options) {
    const model = sanitizeAssumptions(input);
    const config = options && typeof options === 'object' ? options : {};
    const weeks = generateWeeks(model);
    const plan = buildInvoicePlan(model, weeks);
    const derived = deriveRunRateComponents(model);
    const openingContext = openingBalanceContext(model);
    const baseWeeklyNet = config.baseWeeklyNet != null ? roundMoney(Math.max(0, config.baseWeeklyNet)) : derived.totalBaseNet;
    const baseWeeklyGross = config.baseWeeklyGross != null ? roundMoney(Math.max(0, config.baseWeeklyGross)) : derived.totalBaseGross;
    const scenarioWeeklyNet = config.scenarioWeeklyNet != null ? roundMoney(Math.max(0, config.scenarioWeeklyNet)) : derived.totalScenarioNet;
    const scenarioWeeklyGross = config.scenarioWeeklyGross != null ? roundMoney(Math.max(0, config.scenarioWeeklyGross)) : derived.totalScenarioGross;

    const openingBalanceSchedule = buildOpeningBalanceReceiptSchedule(model, weeks);
    const openingBalanceEntriesByWeek = groupReceiptScheduleByWeek(openingBalanceSchedule, weeks, 'receiptWeekIndex');
    const receiptAdjustmentEntriesByWeek = new Map();
    model.receiptWeekAdjustments.forEach(function (entry) {
      if (!entry || !entry.amount) return;
      const existing = receiptAdjustmentEntriesByWeek.get(entry.weekIndex) || [];
      existing.push({
        id: 'receipt-adjustment-' + entry.weekIndex,
        date: weeks[entry.weekIndex] ? weeks[entry.weekIndex].weekEnding : model.forecastStartDate,
        amount: roundMoney(entry.amount),
        note: entry.note || 'Weekly receipt adjustment',
        source: 'receipt_adjustment',
        sourceLabel: 'Weekly receipt adjustment',
      });
      receiptAdjustmentEntriesByWeek.set(entry.weekIndex, existing);
    });

    let currentBalance = roundMoney(openingContext.effectiveOpeningBalance);
    let unbilledBaseNet = 0;
    let unbilledBaseGross = 0;
    let unbilledScenarioNet = 0;
    let unbilledScenarioGross = 0;
    let peakBalance = currentBalance;
    let minHeadroom = roundMoney(model.creditLimit - currentBalance);
    const invoiceSchedule = [];
    const rows = [];
    let firstBreach = null;

    for (let index = 0; index < weeks.length; index += 1) {
      const week = weeks[index];
      const weekPlan = plan[index];
      const openingBalance = roundMoney(currentBalance);

      unbilledBaseNet = roundMoney(unbilledBaseNet + baseWeeklyNet);
      unbilledBaseGross = roundMoney(unbilledBaseGross + baseWeeklyGross);
      unbilledScenarioNet = roundMoney(unbilledScenarioNet + scenarioWeeklyNet);
      unbilledScenarioGross = roundMoney(unbilledScenarioGross + scenarioWeeklyGross);

      let baseInvoiceIncrease = 0;
      let scenarioInvoiceIncrease = 0;

      if (weekPlan.invoiceCount > 0) {
        baseInvoiceIncrease = roundMoney(unbilledBaseGross);
        scenarioInvoiceIncrease = roundMoney(unbilledScenarioGross);
        const totalBaseNet = roundMoney(unbilledBaseNet);
        const totalScenarioNet = roundMoney(unbilledScenarioNet);
        const baseChunksGross = splitAmount(baseInvoiceIncrease, weekPlan.invoiceCount);
        const scenarioChunksGross = splitAmount(scenarioInvoiceIncrease, weekPlan.invoiceCount);
        const baseChunksNet = splitAmount(totalBaseNet, weekPlan.invoiceCount);
        const scenarioChunksNet = splitAmount(totalScenarioNet, weekPlan.invoiceCount);

        weekPlan.invoiceDates.forEach(function (invoiceDate, eventIndex) {
          const dueDate = termDueDate(invoiceDate, model.paymentTerms);
          invoiceSchedule.push({
            id: 'invoice-' + index + '-' + eventIndex,
            weekIndex: index,
            invoiceDate: formatDate(invoiceDate),
            invoiceDateLabel: formatLongDate(invoiceDate),
            dueDate: formatDate(dueDate),
            dueDateLabel: formatLongDate(dueDate),
            receiptWeekIndex: findWeekIndexForDate(dueDate, weeks),
            baseNet: roundMoney(baseChunksNet[eventIndex] || 0),
            baseGross: roundMoney(baseChunksGross[eventIndex] || 0),
            scenarioNet: roundMoney(scenarioChunksNet[eventIndex] || 0),
            scenarioGross: roundMoney(scenarioChunksGross[eventIndex] || 0),
            totalGross: roundMoney((baseChunksGross[eventIndex] || 0) + (scenarioChunksGross[eventIndex] || 0)),
            totalNet: roundMoney((baseChunksNet[eventIndex] || 0) + (scenarioChunksNet[eventIndex] || 0)),
            termLabel: TERM_LABELS[model.paymentTerms.type] || TERM_LABELS['30_eom'],
          });
        });

        unbilledBaseNet = 0;
        unbilledBaseGross = 0;
        unbilledScenarioNet = 0;
        unbilledScenarioGross = 0;
      }

      const scheduledReceipts = invoiceSchedule.filter(function (entry) {
        return entry.receiptWeekIndex === index;
      });
      const openingBalanceReceipts = openingBalanceEntriesByWeek.get(index) || [];
      const receiptAdjustments = receiptAdjustmentEntriesByWeek.get(index) || [];
      const scheduledReceiptsAmount = roundMoney(
        scheduledReceipts.reduce(function (total, entry) { return total + entry.totalGross; }, 0)
      );
      const openingBalanceReceiptsAmount = roundMoney(
        openingBalanceReceipts.reduce(function (total, entry) { return total + entry.amount; }, 0)
      );
      const receiptAdjustmentsAmount = roundMoney(
        receiptAdjustments.reduce(function (total, entry) { return total + entry.amount; }, 0)
      );
      const totalReceipts = roundMoney(scheduledReceiptsAmount + openingBalanceReceiptsAmount + receiptAdjustmentsAmount);
      const closingBalance = roundMoney(openingBalance + baseInvoiceIncrease + scenarioInvoiceIncrease - totalReceipts);
      const headroom = roundMoney(model.creditLimit - closingBalance);
      const status = statusForBalance(closingBalance, model.creditLimit, model.riskThresholdPercent);
      const breachDate = status === 'over_limit'
        ? (weekPlan.invoiceDates[0] ? formatDate(weekPlan.invoiceDates[0]) : week.weekCommencing)
        : '';

      if (!firstBreach && status === 'over_limit') {
        firstBreach = {
          weekIndex: index,
          weekNumber: week.weekNumber,
          weekCommencing: week.weekCommencing,
          weekEnding: week.weekEnding,
          breachDate: breachDate,
        };
      }

      peakBalance = Math.max(peakBalance, closingBalance);
      minHeadroom = Math.min(minHeadroom, headroom);
      currentBalance = closingBalance;

      rows.push({
        weekIndex: index,
        weekNumber: week.weekNumber,
        weekCommencing: week.weekCommencing,
        weekEnding: week.weekEnding,
        weekLabel: 'Week ' + week.weekNumber,
        invoiceCount: weekPlan.invoiceCount,
        invoiceDates: weekPlan.invoiceDates.map(formatDate),
        invoiceDateLabels: weekPlan.invoiceDates.map(formatLongDate),
        openingBalance: openingBalance,
        baseInvoiceIncrease: roundMoney(baseInvoiceIncrease),
        scenarioInvoiceIncrease: roundMoney(scenarioInvoiceIncrease),
        totalInvoiced: roundMoney(baseInvoiceIncrease + scenarioInvoiceIncrease),
        receipts: totalReceipts,
        totalReceipts: totalReceipts,
        forecastInvoiceReceipts: scheduledReceiptsAmount,
        scheduledReceipts: scheduledReceiptsAmount,
        openingBalanceReceipts: openingBalanceReceiptsAmount,
        receiptAdjustments: receiptAdjustmentsAmount,
        manualReceipts: openingBalanceReceiptsAmount,
        closingBalance: closingBalance,
        headroom: headroom,
        status: status,
        statusLabel: STATUS_LABELS[status] || STATUS_LABELS.within_limit,
        breachDate: breachDate,
        receiptNotes: openingBalanceReceipts.concat(receiptAdjustments).map(function (entry) { return entry.note; }).filter(Boolean),
      });
    }

    const overallStatus = summariseOverallStatus(rows);
    const firstRisk = rows.find(function (row) { return row.status === 'at_risk' || row.status === 'over_limit'; }) || null;
    const latestRow = rows.length ? rows[rows.length - 1] : null;

    const result = {
      assumptions: model,
      derived: derived,
      weeks: rows,
      invoicePlan: plan.map(function (entry) {
        return {
          weekIndex: entry.weekIndex,
          invoiceCount: entry.invoiceCount,
          defaultCount: entry.defaultCount,
          isManual: entry.isManual,
          invoiceDates: entry.invoiceDates.map(formatDate),
        };
      }),
      invoiceSchedule: invoiceSchedule,
      openingBalanceSchedule: openingBalanceSchedule,
      openingBalanceContext: openingContext,
      metrics: {
        creditLimit: roundMoney(model.creditLimit),
        currentBalance: roundMoney(openingContext.effectiveOpeningBalance),
        enteredCurrentBalance: roundMoney(model.currentOutstandingBalance),
        effectiveOpeningBalance: roundMoney(openingContext.effectiveOpeningBalance),
        importedOpeningBalanceTotal: roundMoney(openingContext.importedTotal),
        openingBalanceVariance: roundMoney(openingContext.variance),
        openingBalanceReconciliationMode: openingContext.reconciliationMode,
        importedStatementRowCount: openingContext.statement.rowCount,
        importedStatementIncludedRowCount: openingContext.statement.includedRowCount,
        importedStatementOverdueRowCount: openingContext.statement.overdueRowCount,
        importedStatementSourceType: openingContext.statement.sourceType,
        forecastPeakBalance: roundMoney(peakBalance),
        minimumHeadroom: roundMoney(minHeadroom),
        latestClosingBalance: latestRow ? latestRow.closingBalance : roundMoney(openingContext.effectiveOpeningBalance),
        totalOpeningBalanceReceipts: roundMoney(
          rows.reduce(function (total, row) { return total + row.openingBalanceReceipts; }, 0)
        ),
        totalForecastInvoiceReceipts: roundMoney(
          rows.reduce(function (total, row) { return total + row.forecastInvoiceReceipts; }, 0)
        ),
        totalReceiptAdjustments: roundMoney(
          rows.reduce(function (total, row) { return total + row.receiptAdjustments; }, 0)
        ),
        openingBalanceReceiptMode: model.openingBalance.receiptMode,
        openingBalanceReceiptSource: model.openingBalance.receiptMode,
        firstBreach: firstBreach,
        firstRisk: firstRisk ? {
          weekNumber: firstRisk.weekNumber,
          weekCommencing: firstRisk.weekCommencing,
          weekEnding: firstRisk.weekEnding,
          status: firstRisk.status,
        } : null,
        overallStatus: overallStatus,
      },
      overallStatus: overallStatus,
      overallStatusLabel: STATUS_LABELS[overallStatus] || STATUS_LABELS.within_limit,
      firstBreach: firstBreach,
      firstRisk: firstRisk,
    };

    return result;
  }

  function buildCapacityVariant(assumptions, components, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const additionalContractors = Math.max(0, toWholeNumber(settings.additionalContractors, 0));
    const contractorsRemoved = Math.max(0, toWholeNumber(settings.contractorsRemoved, 0));
    const baseWeeklyNet = roundMoney(Math.max(0, components.totalBaseNet - (contractorsRemoved * components.capacityUnitNet)));
    const baseWeeklyGross = roundMoney(Math.max(0, components.totalBaseGross - (contractorsRemoved * components.capacityUnitGross)));
    const scenarioWeeklyNet = roundMoney(components.fixedScenarioNetExcludingContractors + (additionalContractors * components.capacityUnitNet));
    const scenarioWeeklyGross = roundMoney(components.fixedScenarioGrossExcludingContractors + (additionalContractors * components.capacityUnitGross));
    return buildForecast(assumptions, {
      baseWeeklyNet: baseWeeklyNet,
      baseWeeklyGross: baseWeeklyGross,
      scenarioWeeklyNet: scenarioWeeklyNet,
      scenarioWeeklyGross: scenarioWeeklyGross,
    });
  }

  function maxSafeWeeklyIncrease(assumptions, components) {
    const fixedBaseNet = components.totalBaseNet;
    const fixedBaseGross = components.totalBaseGross;
    const fixedScenarioNet = components.fixedScenarioNetExcludingContractors;
    const fixedScenarioGross = components.fixedScenarioGrossExcludingContractors;
    let low = 0;
    let high = 500000;

    for (let index = 0; index < 24; index += 1) {
      const mid = (low + high) / 2;
      const ratio = components.capacityUnitGross > 0 && components.capacityUnitNet > 0
        ? components.capacityUnitNet / components.capacityUnitGross
        : (fixedScenarioGross > 0 && fixedScenarioNet > 0 ? fixedScenarioNet / fixedScenarioGross : (assumptions.vatApplicable ? 1 / vatMultiplier(sanitizeAssumptions(assumptions)) : 1));
      const forecast = buildForecast(assumptions, {
        baseWeeklyNet: fixedBaseNet,
        baseWeeklyGross: fixedBaseGross,
        scenarioWeeklyNet: roundMoney(fixedScenarioNet + (mid * ratio)),
        scenarioWeeklyGross: roundMoney(fixedScenarioGross + mid),
      });
      if (forecast.overallStatus === 'over_limit') {
        high = mid;
      } else {
        low = mid;
      }
    }

    return roundMoney(Math.floor(low / 100) * 100);
  }

  function analyseCapacity(input) {
    const assumptions = sanitizeAssumptions(input);
    const components = deriveRunRateComponents(assumptions);
    const unitGross = roundMoney(components.capacityUnitGross);
    const unitNet = roundMoney(components.capacityUnitNet);
    const safeWeeklyIncrease = maxSafeWeeklyIncrease(assumptions, components);
    const currentForecast = buildCapacityVariant(assumptions, components, {
      additionalContractors: assumptions.contractor.additionalContractors,
      contractorsRemoved: 0,
    });

    if (unitGross <= 0 || unitNet <= 0) {
      return {
        available: false,
        reason: assumptions.growthMode === 'direct'
          ? 'direct_mode_not_headcount_modelled'
          : 'per_contractor_value_missing',
        unitGross: 0,
        unitNet: 0,
        currentScenarioForecast: currentForecast,
        maxSafeWeeklyGrossIncrease: safeWeeklyIncrease,
        sensitivity: [],
      };
    }

    let maxAdditional = 0;
    for (let additional = 0; additional <= 500; additional += 1) {
      const forecast = buildCapacityVariant(assumptions, components, {
        additionalContractors: additional,
        contractorsRemoved: 0,
      });
      if (forecast.overallStatus === 'over_limit') {
        break;
      }
      maxAdditional = additional;
    }

    let contractorsToRemove = 0;
    const baselineForecast = buildCapacityVariant(assumptions, components, {
      additionalContractors: 0,
      contractorsRemoved: 0,
    });
    if (baselineForecast.overallStatus === 'over_limit') {
      const maxRemovalSearch = Math.max(assumptions.contractor.currentContractors, 1);
      for (let removal = 1; removal <= maxRemovalSearch; removal += 1) {
        const forecast = buildCapacityVariant(assumptions, components, {
          additionalContractors: 0,
          contractorsRemoved: removal,
        });
        if (forecast.overallStatus !== 'over_limit') {
          contractorsToRemove = removal;
          break;
        }
      }
    }

    const sensitivitySteps = [1, 5, 10].map(function (additional) {
      const forecast = buildCapacityVariant(assumptions, components, {
        additionalContractors: additional,
        contractorsRemoved: 0,
      });
      return {
        additionalContractors: additional,
        overallStatus: forecast.overallStatus,
        overallStatusLabel: forecast.overallStatusLabel,
        firstBreach: forecast.firstBreach,
        minimumHeadroom: forecast.metrics.minimumHeadroom,
        forecastPeakBalance: forecast.metrics.forecastPeakBalance,
      };
    });

    return {
      available: true,
      unitGross: unitGross,
      unitNet: unitNet,
      maxAdditionalContractorsAllowed: maxAdditional,
      contractorsToRemove: contractorsToRemove,
      currentScenarioForecast: currentForecast,
      baselineForecast: baselineForecast,
      maxSafeWeeklyGrossIncrease: safeWeeklyIncrease,
      sensitivity: sensitivitySteps,
    };
  }

  function formatCurrency(amount, currency) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: normaliseCurrency(currency),
      maximumFractionDigits: 0,
    }).format(Number(amount) || 0);
  }

  function formatDecimalCurrency(amount, currency) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: normaliseCurrency(currency),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amount) || 0);
  }

  function generateFallbackSummary(result, input, capacity) {
    const forecast = result && result.weeks ? result : buildForecast(input);
    const assumptions = sanitizeAssumptions(input || forecast.assumptions || {});
    const capacityResult = capacity || result.capacity || analyseCapacity(assumptions);
    const metrics = forecast.metrics || {};
    const currency = assumptions.currency;
    const clientName = assumptions.clientName || 'This account';
    const statusLabel = forecast.overallStatusLabel || STATUS_LABELS[forecast.overallStatus] || STATUS_LABELS.within_limit;
    const termsLabel = TERM_LABELS[assumptions.paymentTerms.type] || TERM_LABELS['30_eom'];
    const cadenceLabel = assumptions.invoice.cadence === 'monthly' ? 'monthly invoicing' : 'weekly invoicing';
    const vatLabel = assumptions.vatApplicable ? ('VAT at ' + assumptions.vatRate + '%') : 'VAT excluded';
    const openingBalanceLabel = OPENING_BALANCE_MODE_LABELS[assumptions.openingBalance.receiptMode] || OPENING_BALANCE_MODE_LABELS.term_profile;
    const directMode = assumptions.growthMode === 'direct';
    const safeWeeklyIncreaseText = capacityResult && capacityResult.maxSafeWeeklyGrossIncrease != null
      ? formatCurrency(capacityResult.maxSafeWeeklyGrossIncrease, currency)
      : null;
    const capacityNarrative = capacityResult && capacityResult.available
      ? ('up to '
        + capacityResult.maxAdditionalContractorsAllowed
        + ' additional contractor'
        + (capacityResult.maxAdditionalContractorsAllowed === 1 ? '' : 's')
        + ' appear supportable before the account tips over limit.')
      : directMode
        ? ('contractor headcount capacity is not being modelled in direct uplift mode'
          + (safeWeeklyIncreaseText ? (', and the maximum safe weekly uplift is approximately ' + safeWeeklyIncreaseText + ' gross.') : '.'))
        : 'contractor headcount capacity is not being modelled until a per-contractor invoice value is entered.';

    if (forecast.overallStatus === 'over_limit') {
      const breach = metrics.firstBreach;
      const removeText = capacityResult && capacityResult.contractorsToRemove
        ? (' Reducing by approximately ' + capacityResult.contractorsToRemove + ' contractor' + (capacityResult.contractorsToRemove === 1 ? '' : 's') + ' would bring the profile back inside limit on the current assumptions.')
        : (directMode && safeWeeklyIncreaseText
          ? (' Direct weekly uplift is being modelled here, so no contractor removal estimate is shown; the maximum safe weekly uplift is approximately ' + safeWeeklyIncreaseText + ' gross.')
          : '');
      return clientName + ' moves over the insured limit under this forecast. The first breach lands in week '
        + (breach ? breach.weekNumber : '?') + ' (' + (breach ? formatLongDate(breach.breachDate || breach.weekCommencing) : 'date to be confirmed') + '), with a projected peak balance of '
        + formatCurrency(metrics.forecastPeakBalance || 0, currency) + ' against a limit of '
        + formatCurrency(metrics.creditLimit || 0, currency) + '. The model assumes ' + termsLabel + ', '
        + cadenceLabel + ', ' + vatLabel + ', and ' + openingBalanceLabel.toLowerCase() + '.' + removeText;
    }

    if (forecast.overallStatus === 'at_risk') {
      const risk = metrics.firstRisk;
      return clientName + ' stays inside the insured limit but enters an at-risk zone. Headroom narrows to '
        + formatCurrency(metrics.minimumHeadroom || 0, currency) + ', with the balance first tightening in week '
        + (risk ? risk.weekNumber : '?') + ' and peaking at '
        + formatCurrency(metrics.forecastPeakBalance || 0, currency) + '. On the current assumptions (' + termsLabel + ', '
        + cadenceLabel + ', ' + vatLabel + ', ' + openingBalanceLabel.toLowerCase() + '), ' + capacityNarrative;
    }

    return clientName + ' remains within the insured limit across the full '
      + assumptions.forecastHorizonWeeks + '-week forecast. Peak balance reaches '
      + formatCurrency(metrics.forecastPeakBalance || 0, currency) + ', leaving minimum headroom of '
      + formatCurrency(metrics.minimumHeadroom || 0, currency) + ' against the '
      + formatCurrency(metrics.creditLimit || 0, currency) + ' limit. Based on '
      + termsLabel + ', ' + cadenceLabel + ', ' + vatLabel + ', and ' + openingBalanceLabel.toLowerCase() + ', the model indicates '
      + (capacityResult && capacityResult.available
        ? (capacityResult.maxAdditionalContractorsAllowed
          + ' additional contractor' + (capacityResult.maxAdditionalContractorsAllowed === 1 ? '' : 's')
          + ' could be added safely before the account reaches the insured ceiling.')
        : capacityNarrative);
  }

  function weekdayLabel(index) {
    return WEEKDAY_NAMES[clampNumber(index, 0, 6, 2)];
  }

  return {
    DAY_MS: DAY_MS,
    TERM_LABELS: TERM_LABELS,
    OPENING_BALANCE_MODE_LABELS: OPENING_BALANCE_MODE_LABELS,
    OPENING_BALANCE_RECONCILIATION_LABELS: OPENING_BALANCE_RECONCILIATION_LABELS,
    STATUS_LABELS: STATUS_LABELS,
    DEFAULT_ASSUMPTIONS: DEFAULT_ASSUMPTIONS,
    sanitizeAssumptions: sanitizeAssumptions,
    deriveRunRateComponents: deriveRunRateComponents,
    generateWeeks: generateWeeks,
    buildInvoicePlan: buildInvoicePlan,
    buildForecast: buildForecast,
    analyseCapacity: analyseCapacity,
    generateFallbackSummary: generateFallbackSummary,
    formatCurrency: formatCurrency,
    formatDecimalCurrency: formatDecimalCurrency,
    formatDate: formatDate,
    formatLongDate: formatLongDate,
    parseDate: parseDate,
    addDays: addDays,
    startOfWeek: startOfWeek,
    endOfMonth: endOfMonth,
    termDueDate: termDueDate,
    weekdayLabel: weekdayLabel,
    cloneJson: cloneJson,
  };
});
