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

test('case 2: near-limit scenario breaches after several weeks with breach metadata', () => {
  const scenario = buildScenario({
    creditLimit: 132000,
    currentOutstandingBalance: 92000,
    contractor: {
      currentContractors: 10,
      additionalContractors: 5,
      weeklyPayPerContractor: 900,
      marginPercent: 28,
    },
  });

  const forecast = buildForecast(scenario);
  const capacity = analyseCapacity(scenario);

  assert.equal(forecast.overallStatus, 'over_limit');
  assert.ok(forecast.firstBreach);
  assert.ok(forecast.firstBreach.weekNumber >= 2);
  assert.ok(capacity.maxAdditionalContractorsAllowed < scenario.contractor.additionalContractors);
});

test('case 3: already over limit shows over-limit status and contractor removals when receipts are modelled', () => {
  const scenario = buildScenario({
    creditLimit: 120000,
    currentOutstandingBalance: 123000,
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

test('case 4: VAT off reduces projected exposure', () => {
  const vatOn = buildScenario({
    contractor: {
      currentContractors: 7,
      additionalContractors: 3,
      weeklyPayPerContractor: 1000,
      marginPercent: 22,
    },
  });
  const vatOff = buildScenario({
    vatApplicable: false,
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
