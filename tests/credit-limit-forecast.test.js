const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildForecast,
  analyseCapacity,
  deriveRunRateComponents,
  formatCurrency,
  generateFallbackSummary,
  termDueDate,
  formatDate,
} = require('../lib/credit-limit-forecast.js');

function buildScenario(overrides = {}) {
  return {
    clientName: 'HMJ Test Client',
    scenarioName: 'Base case',
    currency: 'GBP',
    creditLimit: 300000,
    currentOutstandingBalance: 60000,
    vatApplicable: true,
    vatRate: 20,
    forecastStartDate: '2026-01-05',
    forecastHorizonWeeks: 12,
    paymentTerms: {
      type: '14_net',
      customNetDays: 21,
      receiptLagDays: 0,
    },
    openingBalance: {
      receiptMode: 'term_profile',
      runoffWeeks: 6,
    },
    growthMode: 'contractor',
    contractor: {
      currentContractors: 8,
      additionalContractors: 2,
      weeklyPayPerContractor: 850,
      hourlyWage: 0,
      weeklyHours: 40,
      marginPercent: 25,
      perContractorNetInvoice: 0,
      perContractorGrossInvoice: 0,
    },
    direct: {
      baseWeeklyNet: 0,
      baseWeeklyGross: 0,
      scenarioWeeklyNet: 0,
      scenarioWeeklyGross: 0,
    },
    invoice: {
      cadence: 'weekly',
      invoiceWeekday: 2,
      autoCountDates: true,
      manualEventCounts: [],
    },
    receiptLines: [],
    receiptWeekAdjustments: [],
    ...overrides,
    paymentTerms: {
      type: '14_net',
      customNetDays: 21,
      receiptLagDays: 0,
      ...(overrides.paymentTerms || {}),
    },
    openingBalance: {
      receiptMode: 'term_profile',
      runoffWeeks: 6,
      ...(overrides.openingBalance || {}),
    },
    contractor: {
      currentContractors: 8,
      additionalContractors: 2,
      weeklyPayPerContractor: 850,
      hourlyWage: 0,
      weeklyHours: 40,
      marginPercent: 25,
      perContractorNetInvoice: 0,
      perContractorGrossInvoice: 0,
      ...(overrides.contractor || {}),
    },
    direct: {
      baseWeeklyNet: 0,
      baseWeeklyGross: 0,
      scenarioWeeklyNet: 0,
      scenarioWeeklyGross: 0,
      ...(overrides.direct || {}),
    },
    invoice: {
      cadence: 'weekly',
      invoiceWeekday: 2,
      autoCountDates: true,
      manualEventCounts: [],
      ...(overrides.invoice || {}),
    },
  };
}

test('case 1: modest weekly increase stays within limit and shows safe capacity', () => {
  const scenario = buildScenario();
  const forecast = buildForecast(scenario);
  const capacity = analyseCapacity(scenario);

  assert.equal(forecast.overallStatus, 'within_limit');
  assert.equal(forecast.firstBreach, null);
  assert.ok(capacity.available);
  assert.ok(capacity.maxAdditionalContractorsAllowed >= scenario.contractor.additionalContractors);
  assert.ok(forecast.metrics.minimumHeadroom > 0);
});

test('opening-balance case 1: no opening-balance receipts keeps the stress-test profile harsher', () => {
  const harsh = buildScenario({
    currentOutstandingBalance: 120000,
    openingBalance: {
      receiptMode: 'no_receipts',
    },
  });
  const profiled = buildScenario({
    currentOutstandingBalance: 120000,
    openingBalance: {
      receiptMode: 'term_profile',
    },
  });

  const harshForecast = buildForecast(harsh);
  const profiledForecast = buildForecast(profiled);

  assert.equal(harshForecast.metrics.totalOpeningBalanceReceipts, 0);
  assert.ok(profiledForecast.metrics.totalOpeningBalanceReceipts > 0);
  assert.ok(harshForecast.metrics.forecastPeakBalance > profiledForecast.metrics.forecastPeakBalance);
});

test('opening-balance case 2: manual opening-balance receipts reduce weekly balances', () => {
  const scenario = buildScenario({
    currentOutstandingBalance: 100000,
    openingBalance: {
      receiptMode: 'manual',
    },
    receiptLines: [
      { date: '2026-01-09', amount: 15000, note: 'Opening debtor collection 1' },
      { date: '2026-01-23', amount: 12000, note: 'Opening debtor collection 2' },
    ],
  });

  const forecast = buildForecast(scenario);
  const firstWeek = forecast.weeks[0];
  const thirdWeek = forecast.weeks[2];

  assert.equal(firstWeek.openingBalanceReceipts, 15000);
  assert.equal(thirdWeek.openingBalanceReceipts, 12000);
  assert.ok(firstWeek.closingBalance < firstWeek.openingBalance + firstWeek.totalInvoiced);
});

test('opening-balance case 3: even runoff across 6 weeks spreads receipts correctly', () => {
  const scenario = buildScenario({
    currentOutstandingBalance: 96000,
    openingBalance: {
      receiptMode: 'even_runoff',
      runoffWeeks: 6,
    },
    forecastHorizonWeeks: 8,
  });

  const forecast = buildForecast(scenario);
  const firstSix = forecast.weeks.slice(0, 6).map((row) => row.openingBalanceReceipts);
  const laterWeeks = forecast.weeks.slice(6).map((row) => row.openingBalanceReceipts);

  assert.deepEqual(firstSix, [16000, 16000, 16000, 16000, 16000, 16000]);
  assert.deepEqual(laterWeeks, [0, 0]);
  assert.equal(forecast.metrics.totalOpeningBalanceReceipts, 96000);
});

test('opening-balance case 4: opening-balance and forecast-invoice receipts stay separate in weekly output', () => {
  const scenario = buildScenario({
    currentOutstandingBalance: 84000,
    openingBalance: {
      receiptMode: 'even_runoff',
      runoffWeeks: 6,
    },
    forecastHorizonWeeks: 10,
  });

  const forecast = buildForecast(scenario);
  const mixedWeek = forecast.weeks.find((row) => row.openingBalanceReceipts > 0 && row.forecastInvoiceReceipts > 0);

  assert.ok(mixedWeek);
  assert.equal(
    mixedWeek.totalReceipts,
    mixedWeek.openingBalanceReceipts + mixedWeek.forecastInvoiceReceipts + mixedWeek.receiptAdjustments
  );
});

test('opening-balance case 5: no double counting occurs between opening-balance and forecast receipts', () => {
  const scenario = buildScenario({
    currentOutstandingBalance: 90000,
    openingBalance: {
      receiptMode: 'manual',
    },
    receiptLines: [
      { date: '2026-01-16', amount: 10000, note: 'Opening ledger collection' },
      { date: '2026-01-30', amount: 14000, note: 'Opening ledger collection 2' },
    ],
  });

  const forecast = buildForecast(scenario);
  const totalOpening = forecast.weeks.reduce((sum, row) => sum + row.openingBalanceReceipts, 0);
  const totalForecastReceipts = forecast.weeks.reduce((sum, row) => sum + row.forecastInvoiceReceipts, 0);
  const totalAdjustments = forecast.weeks.reduce((sum, row) => sum + row.receiptAdjustments, 0);
  const totalReceipts = forecast.weeks.reduce((sum, row) => sum + row.totalReceipts, 0);
  const invoiceScheduleReceipts = forecast.invoiceSchedule
    .filter((entry) => entry.receiptWeekIndex >= 0)
    .reduce((sum, entry) => sum + entry.totalGross, 0);

  assert.equal(totalOpening, 24000);
  assert.equal(totalForecastReceipts, invoiceScheduleReceipts);
  assert.equal(totalReceipts, totalOpening + totalForecastReceipts + totalAdjustments);
});

test('opening-balance case 6: imported statement rows drive opening-book receipts by due date', () => {
  const scenario = buildScenario({
    currentOutstandingBalance: 90000,
    openingBalance: {
      receiptMode: 'import_statement',
      importedStatement: {
        status: 'confirmed',
        sourceType: 'csv',
        fileName: 'debtor.csv',
        reconciliationMode: 'keep_manual_opening_balance',
        overdueCollectionDays: 7,
        rows: [
          { invoiceRef: 'INV-1001', dueDate: '2026-01-09', outstandingAmount: 18000, currency: 'GBP' },
          { invoiceRef: 'INV-1002', dueDate: '2025-12-30', outstandingAmount: 12000, currency: 'GBP' },
        ],
      },
    },
  });

  const forecast = buildForecast(scenario);

  assert.equal(forecast.weeks[0].openingBalanceReceipts, 18000);
  assert.equal(forecast.weeks[1].openingBalanceReceipts, 12000);
  assert.equal(forecast.openingBalanceSchedule[0].source, 'opening_balance_imported_statement');
  assert.equal(forecast.metrics.importedStatementIncludedRowCount, 2);
});

test('opening-balance case 7: imported statement can set the effective opening balance when chosen', () => {
  const scenario = buildScenario({
    currentOutstandingBalance: 91000,
    openingBalance: {
      receiptMode: 'import_statement',
      importedStatement: {
        status: 'confirmed',
        sourceType: 'xlsx',
        fileName: 'aged-debtor.xlsx',
        reconciliationMode: 'use_imported_total',
        rows: [
          { invoiceRef: 'INV-2001', dueDate: '2026-01-16', outstandingAmount: 22000, currency: 'GBP' },
          { invoiceRef: 'INV-2002', dueDate: '2026-01-23', outstandingAmount: 18000, currency: 'GBP' },
        ],
      },
    },
  });

  const forecast = buildForecast(scenario);

  assert.equal(forecast.metrics.currentBalance, 40000);
  assert.equal(forecast.metrics.enteredCurrentBalance, 91000);
  assert.equal(forecast.metrics.openingBalanceReconciliationMode, 'use_imported_total');
});

test('opening-balance case 8: imported statement receipts remain separate from forecast-generated invoice receipts', () => {
  const scenario = buildScenario({
    currentOutstandingBalance: 85000,
    openingBalance: {
      receiptMode: 'import_statement',
      importedStatement: {
        status: 'confirmed',
        sourceType: 'csv',
        fileName: 'debtor.csv',
        reconciliationMode: 'keep_manual_opening_balance',
        rows: [
          { invoiceRef: 'INV-3001', dueDate: '2026-01-20', outstandingAmount: 15000, currency: 'GBP' },
          { invoiceRef: 'INV-3002', dueDate: '2026-02-03', outstandingAmount: 12000, currency: 'GBP' },
        ],
      },
    },
  });

  const forecast = buildForecast(scenario);
  const mixedWeek = forecast.weeks.find((row) => row.openingBalanceReceipts > 0 && row.forecastInvoiceReceipts > 0);

  assert.ok(mixedWeek);
  assert.equal(
    mixedWeek.totalReceipts,
    mixedWeek.openingBalanceReceipts + mixedWeek.forecastInvoiceReceipts + mixedWeek.receiptAdjustments
  );
});

test('opening-balance case 9: imported statement adjustment lines land as dated opening-book receipts', () => {
  const scenario = buildScenario({
    currentOutstandingBalance: 90000,
    openingBalance: {
      receiptMode: 'import_statement',
      importedStatement: {
        status: 'confirmed',
        sourceType: 'csv',
        fileName: 'debtor.csv',
        reconciliationMode: 'keep_manual_opening_balance',
        rows: [
          { invoiceRef: 'INV-4001', dueDate: '2026-01-09', outstandingAmount: 30000, currency: 'GBP' },
        ],
        adjustmentLines: [
          { date: '2026-01-23', amount: 12000, note: 'Missing statement line' },
        ],
      },
    },
  });

  const forecast = buildForecast(scenario);

  assert.equal(forecast.weeks[0].openingBalanceReceipts, 30000);
  assert.equal(forecast.weeks[2].openingBalanceReceipts, 12000);
  assert.equal(forecast.openingBalanceSchedule[1].source, 'opening_balance_import_adjustment');
  assert.equal(forecast.metrics.openingBalanceVariance, -48000);
});

test('case 2: near-limit scenario breaches after several weeks with breach metadata', () => {
  const scenario = buildScenario({
    creditLimit: 132000,
    currentOutstandingBalance: 92000,
    openingBalance: {
      receiptMode: 'no_receipts',
    },
    contractor: {
      currentContractors: 10,
      additionalContractors: 5,
      weeklyPayPerContractor: 900,
      marginPercent: 28,
    },
  });

  const forecast = buildForecast(scenario);
  const capacity = analyseCapacity(scenario);
  const summary = generateFallbackSummary(forecast, scenario, capacity);

  assert.equal(forecast.overallStatus, 'over_limit');
  assert.ok(forecast.firstBreach);
  assert.ok(forecast.firstBreach.weekNumber >= 2);
  assert.ok(forecast.metrics.peakOverLimit > 0);
  assert.ok(capacity.maxAdditionalContractorsAllowed < scenario.contractor.additionalContractors);
  assert.match(summary, /over limit/i);
});

test('case 3: already over limit shows over-limit status and contractor removals when receipts are modelled', () => {
  const scenario = buildScenario({
    creditLimit: 120000,
    currentOutstandingBalance: 123000,
    openingBalance: {
      receiptMode: 'manual',
    },
    contractor: {
      currentContractors: 12,
      additionalContractors: 0,
      weeklyPayPerContractor: 1000,
      marginPercent: 30,
    },
    receiptLines: [
      { date: '2026-01-09', amount: 10000, note: 'Expected client receipt' },
      { date: '2026-01-23', amount: 12000, note: 'Chased receipt' },
      { date: '2026-01-30', amount: 12000, note: 'Retention release' },
    ],
  });

  const forecast = buildForecast(scenario);
  const capacity = analyseCapacity(scenario);

  assert.equal(forecast.overallStatus, 'over_limit');
  assert.ok(capacity.contractorsToRemove >= 1);
});

test('case 3b: contractor removal estimate is based on the live tested scenario, not just the baseline book', () => {
  const scenario = buildScenario({
    currency: 'EUR',
    creditLimit: 350000,
    currentOutstandingBalance: 295000,
    forecastStartDate: '2026-03-14',
    forecastHorizonWeeks: 12,
    paymentTerms: {
      type: '30_eom',
      customNetDays: 21,
      receiptLagDays: 0,
    },
    openingBalance: {
      receiptMode: 'term_profile',
      runoffWeeks: 6,
    },
    contractor: {
      currentContractors: 22,
      additionalContractors: 4,
      weeklyPayPerContractor: 950,
      marginPercent: 28,
    },
  });

  const capacity = analyseCapacity(scenario);
  assert.equal(capacity.contractorsToRemove, 14);
  assert.equal(capacity.contractorEquivalentExcess, 13.44);

  const deRiskedScenario = buildScenario({
    ...scenario,
    contractor: {
      ...scenario.contractor,
      currentContractors: 12,
      additionalContractors: 0,
    },
  });
  const deRiskedForecast = buildForecast(deRiskedScenario);

  assert.notEqual(deRiskedForecast.overallStatus, 'over_limit');
});

test('case 4: VAT off reduces projected exposure', () => {
  const vatOn = buildScenario({
    currentOutstandingBalance: 30000,
    openingBalance: {
      receiptMode: 'no_receipts',
    },
    contractor: {
      currentContractors: 7,
      additionalContractors: 3,
      weeklyPayPerContractor: 1000,
      marginPercent: 22,
    },
  });
  const vatOff = buildScenario({
    currentOutstandingBalance: 30000,
    vatApplicable: false,
    openingBalance: {
      receiptMode: 'no_receipts',
    },
    contractor: {
      currentContractors: 7,
      additionalContractors: 3,
      weeklyPayPerContractor: 1000,
      marginPercent: 22,
    },
  });

  const forecastVatOn = buildForecast(vatOn);
  const forecastVatOff = buildForecast(vatOff);

  assert.ok(forecastVatOff.metrics.forecastPeakBalance < forecastVatOn.metrics.forecastPeakBalance);
});

test('case 5: 30 days EOM receipts land later than 14 day net', () => {
  const invoiceDate = '2026-01-27';
  const due14 = termDueDate(invoiceDate, { type: '14_net', customNetDays: 21, receiptLagDays: 0 });
  const due30Eom = termDueDate(invoiceDate, { type: '30_eom', customNetDays: 21, receiptLagDays: 0 });

  assert.equal(formatDate(due14), '2026-02-10');
  assert.equal(formatDate(due30Eom), '2026-03-02');
  assert.ok(due30Eom.getTime() > due14.getTime());
});

test('case 6: GBP and EUR formatting work without breaking calculations', () => {
  const gbpScenario = buildScenario({ currency: 'GBP' });
  const eurScenario = buildScenario({ currency: 'EUR' });

  const gbpForecast = buildForecast(gbpScenario);
  const eurForecast = buildForecast(eurScenario);

  assert.equal(gbpForecast.weeks.length, eurForecast.weeks.length);
  assert.match(formatCurrency(12345, 'GBP'), /£12,345/);
  assert.match(formatCurrency(12345, 'EUR'), /€12,345/);
});

test('fallback summary remains available without GPT', () => {
  const scenario = buildScenario({
    creditLimit: 150000,
    currentOutstandingBalance: 90000,
    contractor: {
      currentContractors: 10,
      additionalContractors: 4,
      weeklyPayPerContractor: 920,
      marginPercent: 25,
    },
  });

  const forecast = buildForecast(scenario);
  const capacity = analyseCapacity(scenario);
  const summary = generateFallbackSummary(forecast, scenario, capacity);
  const components = deriveRunRateComponents(scenario);

  assert.equal(typeof summary, 'string');
  assert.ok(summary.length > 40);
  assert.ok(components.capacityUnitGross > 0);
});

test('direct uplift summary does not imply contractor capacity and still reports safe weekly uplift', () => {
  const scenario = buildScenario({
    creditLimit: 600000,
    currentOutstandingBalance: 150000,
    openingBalance: {
      receiptMode: 'term_profile',
      runoffWeeks: 6,
    },
    growthMode: 'direct',
    direct: {
      scenarioWeeklyGross: 9000,
    },
    contractor: {
      currentContractors: 0,
      additionalContractors: 0,
      weeklyPayPerContractor: 0,
      hourlyWage: 0,
      weeklyHours: 40,
      marginPercent: 0,
      perContractorNetInvoice: 0,
      perContractorGrossInvoice: 0,
    },
  });

  const forecast = buildForecast(scenario);
  const capacity = analyseCapacity(scenario);
  const summary = generateFallbackSummary(forecast, scenario, capacity);

  assert.equal(capacity.available, false);
  assert.ok(capacity.maxSafeWeeklyGrossIncrease > 0);
  assert.match(summary, /maximum safe weekly uplift/i);
  assert.doesNotMatch(summary, /0 additional contractors?/i);
});
