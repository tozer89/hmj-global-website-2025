'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateDealProfit,
  buildScenarioComparison,
  resolveChargeRate,
  normaliseInput,
} = require('../assets/js/deal-profit-calc-core.js');

test('deal profit calc computes weekly and multi-period profitability in margin-per-hour mode', () => {
  const model = calculateDealProfit({
    startDate: '2026-03-19',
    currency: 'GBP',
    workerCount: 1,
    payRate: 20,
    marginMode: 'margin_per_hour',
    marginPerHour: 5,
    hoursPerWeek: 50,
    durationPreset: 'quarter',
    paymentTermsPreset: '30_doi',
    fundingAdvancePercent: 90,
    taxRatePercent: 25,
    weeklyOverhead: 100,
    annualDiscountFeePercent: 2.15,
    annualInterestFeePercent: 0.15,
  });

  assert.equal(model.chargeRate, 25);
  assert.equal(model.periodMap.week.revenue, 1250);
  assert.equal(model.periodMap.week.payCost, 1000);
  assert.equal(model.periodMap.week.grossMargin, 250);
  assert.equal(model.periodMap.week.discountFee, 2.21);
  assert.equal(model.periodMap.week.interestFee, 0.14);
  assert.equal(model.periodMap.week.totalFinanceCost, 2.35);
  assert.equal(model.periodMap.week.profitBeforeTax, 147.65);
  assert.equal(model.periodMap.week.tax, 36.91);
  assert.equal(model.periodMap.week.netProfit, 110.74);
  assert.equal(model.periodMap.quarter.revenue, 16250);
  assert.equal(model.periodMap.quarter.netProfit, 1439.61);
});

test('deal profit calc computes implied margin in direct charge rate override mode with multiple workers', () => {
  const model = calculateDealProfit({
    startDate: '2026-03-19',
    currency: 'EUR',
    workerCount: 3,
    payRate: 27.5,
    marginMode: 'charge_rate_override',
    chargeRateOverride: 35,
    hoursPerWeek: 46,
    durationPreset: 'half_year',
    paymentTermsPreset: '45_doi',
    fundingAdvancePercent: 85,
    taxRatePercent: 25,
    weeklyOverhead: 180,
    annualDiscountFeePercent: 2.15,
    annualInterestFeePercent: 0.15,
  });

  assert.equal(resolveChargeRate(normaliseInput({
    payRate: 27.5,
    marginMode: 'charge_rate_override',
    chargeRateOverride: 35,
  })), 35);
  assert.equal(model.impliedMarginPerHour, 7.5);
  assert.equal(model.periodMap.week.weeklyHours, 138);
  assert.equal(model.periodMap.week.grossMargin, 1035);
  assert.equal(model.periodMap.week.fundedAmount, 4105.5);
  assert.equal(model.periodMap.week.totalFinanceCost, 13.56);
  assert.equal(model.periodMap.week.netProfit, 631.08);
  assert.equal(model.periodMap.half_year.netProfit, 16408.04);
});

test('deal profit calc keeps tax at zero when profit before tax is negative', () => {
  const model = calculateDealProfit({
    startDate: '2026-03-19',
    payRate: 25,
    marginMode: 'margin_per_hour',
    marginPerHour: 1,
    hoursPerWeek: 40,
    durationPreset: 'month',
    paymentTermsPreset: '60_doi',
    fundingAdvancePercent: 90,
    taxRatePercent: 25,
    weeklyOverhead: 120,
    annualDiscountFeePercent: 2.15,
    annualInterestFeePercent: 0.15,
  });

  assert.ok(model.periodMap.week.profitBeforeTax < 0);
  assert.equal(model.periodMap.week.tax, 0);
  assert.ok(model.periodMap.week.netProfit < 0);
});

test('deal profit calc scenario comparison reflects worse outcomes for lower hours and longer terms', () => {
  const scenarios = buildScenarioComparison({
    startDate: '2026-03-19',
    payRate: 22,
    marginMode: 'margin_per_hour',
    marginPerHour: 5,
    hoursPerWeek: 50,
    durationPreset: 'quarter',
    paymentTermsPreset: '30_doi',
    fundingAdvancePercent: 85,
    taxRatePercent: 25,
    weeklyOverhead: 0,
    annualDiscountFeePercent: 2.15,
    annualInterestFeePercent: 0.15,
  });

  const current = scenarios.find((item) => item.key === 'current');
  const lowerHours = scenarios.find((item) => item.key === 'lower_hours');
  const longerTerms = scenarios.find((item) => item.key === 'longer_terms');

  assert.ok(lowerHours.selectedPeriod.netProfit < current.selectedPeriod.netProfit);
  assert.ok(longerTerms.selectedPeriod.totalFinanceCost > current.selectedPeriod.totalFinanceCost);
  assert.equal(longerTerms.selectedPeriod.daysOutstanding, 45);
});

test('deal profit calc uses the start date to model 30 day EOM payment timing', () => {
  const model = calculateDealProfit({
    startDate: '2026-03-19',
    payRate: 20,
    marginMode: 'margin_per_hour',
    marginPerHour: 5,
    hoursPerWeek: 50,
    durationPreset: 'month',
    paymentTermsPreset: '30_eom',
    fundingAdvancePercent: 90,
    taxRatePercent: 25,
    weeklyOverhead: 0,
    annualDiscountFeePercent: 2.15,
    annualInterestFeePercent: 0.15,
  });

  assert.equal(model.periodMap.week.firstInvoiceDate, '2026-03-26');
  assert.equal(model.periodMap.week.daysOutstanding, 35);
  assert.equal(model.periodMap.month.daysOutstanding, 46.59);
  assert.ok(model.periodMap.month.totalFinanceCost > model.periodMap.week.totalFinanceCost);
});

test('deal profit calc can model the documented Zodeq bundled fee basis', () => {
  const model = calculateDealProfit({
    startDate: '2026-03-19',
    currency: 'GBP',
    workerCount: 1,
    payRate: 25,
    marginMode: 'margin_per_hour',
    marginPerHour: 5,
    hoursPerWeek: 50,
    durationPreset: 'month',
    paymentTermsPreset: '90_eom',
    financeFeeMode: 'bundled_invoice_fee',
    fundingAdvancePercent: 90,
    taxRatePercent: 25,
    weeklyOverhead: 0,
    annualDiscountFeePercent: 2.15,
    annualInterestFeePercent: 0,
  });

  assert.equal(model.periodMap.week.discountFee, 32.25);
  assert.equal(model.periodMap.week.interestFee, 0);
  assert.equal(model.periodMap.month.totalFinanceCost, 139.75);
  assert.equal(model.periodMap.month.netProfit, 707.69);
});
