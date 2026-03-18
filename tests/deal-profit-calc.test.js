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
    currency: 'GBP',
    workerCount: 1,
    payRate: 20,
    marginMode: 'margin_per_hour',
    marginPerHour: 5,
    hoursPerWeek: 50,
    durationPreset: 'quarter',
    paymentTermsPreset: '30',
    fundingAdvancePercent: 90,
    taxRatePercent: 25,
    weeklyOverhead: 100,
    annualDiscountFeePercent: 2.15,
    dailyInterestFeePercent: 0.15,
  });

  assert.equal(model.chargeRate, 25);
  assert.equal(model.periodMap.week.revenue, 1250);
  assert.equal(model.periodMap.week.payCost, 1000);
  assert.equal(model.periodMap.week.grossMargin, 250);
  assert.equal(model.periodMap.week.discountFee, 2.21);
  assert.equal(model.periodMap.week.interestFee, 50.63);
  assert.equal(model.periodMap.week.totalFinanceCost, 52.83);
  assert.equal(model.periodMap.week.profitBeforeTax, 97.17);
  assert.equal(model.periodMap.week.tax, 24.29);
  assert.equal(model.periodMap.week.netProfit, 72.87);
  assert.equal(model.periodMap.quarter.revenue, 16250);
  assert.equal(model.periodMap.quarter.netProfit, 947.37);
});

test('deal profit calc computes implied margin in direct charge rate override mode with multiple workers', () => {
  const model = calculateDealProfit({
    currency: 'EUR',
    workerCount: 3,
    payRate: 27.5,
    marginMode: 'charge_rate_override',
    chargeRateOverride: 35,
    hoursPerWeek: 46,
    durationPreset: 'half_year',
    paymentTermsPreset: '45',
    fundingAdvancePercent: 85,
    taxRatePercent: 25,
    weeklyOverhead: 180,
    annualDiscountFeePercent: 2.15,
    dailyInterestFeePercent: 0.15,
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
  assert.equal(model.periodMap.week.totalFinanceCost, 289.92);
  assert.equal(model.periodMap.week.netProfit, 423.81);
  assert.equal(model.periodMap.half_year.netProfit, 11018.98);
});

test('deal profit calc keeps tax at zero when profit before tax is negative', () => {
  const model = calculateDealProfit({
    payRate: 25,
    marginMode: 'margin_per_hour',
    marginPerHour: 1,
    hoursPerWeek: 40,
    durationPreset: 'month',
    paymentTermsPreset: '60',
    fundingAdvancePercent: 90,
    taxRatePercent: 25,
    weeklyOverhead: 120,
    annualDiscountFeePercent: 2.15,
    dailyInterestFeePercent: 0.15,
  });

  assert.ok(model.periodMap.week.profitBeforeTax < 0);
  assert.equal(model.periodMap.week.tax, 0);
  assert.ok(model.periodMap.week.netProfit < 0);
});

test('deal profit calc scenario comparison reflects worse outcomes for lower hours and longer terms', () => {
  const scenarios = buildScenarioComparison({
    payRate: 22,
    marginMode: 'margin_per_hour',
    marginPerHour: 5,
    hoursPerWeek: 50,
    durationPreset: 'quarter',
    paymentTermsPreset: '30',
    fundingAdvancePercent: 85,
    taxRatePercent: 25,
    weeklyOverhead: 0,
    annualDiscountFeePercent: 2.15,
    dailyInterestFeePercent: 0.15,
  });

  const current = scenarios.find((item) => item.key === 'current');
  const lowerHours = scenarios.find((item) => item.key === 'lower_hours');
  const longerTerms = scenarios.find((item) => item.key === 'longer_terms');

  assert.ok(lowerHours.selectedPeriod.netProfit < current.selectedPeriod.netProfit);
  assert.ok(longerTerms.selectedPeriod.totalFinanceCost > current.selectedPeriod.totalFinanceCost);
  assert.equal(longerTerms.selectedPeriod.daysOutstanding, 45);
});
