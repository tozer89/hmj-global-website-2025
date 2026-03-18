'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCashflowForecast, startOfIsoWeek } = require('../lib/finance-cashflow.js');

test('cashflow forecast builds funded advances, retention releases, and fees across 13 weeks', () => {
  const anchorWeekStart = startOfIsoWeek('2026-03-16');
  const result = buildCashflowForecast({
    assumptions: {
      anchor_week_start: anchorWeekStart,
      opening_balance: 10000,
      reporting_currency: 'GBP',
      eur_to_gbp_rate: 0.85,
    },
    fundingRules: [
      {
        customer_name: 'A+C Electrical Ltd',
        advance_percent: 90,
        retention_percent: 10,
        fee_percent: 2,
        settlement_lag_days: 14,
        is_active: true,
      },
    ],
    customers: [
      {
        customer_name: 'A+C Electrical Ltd',
        funding_enabled: true,
        expected_payment_days: 30,
      },
    ],
    invoicePlans: [
      {
        customer_name: 'A+C Electrical Ltd',
        invoice_date: '2026-03-18',
        expected_payment_date: '2026-04-15',
        currency: 'GBP',
        net_amount: 10000,
        gross_amount: 12000,
        funded: true,
      },
    ],
    overheads: [
      {
        label: 'Weekly payroll',
        category: 'payroll',
        amount: 3000,
        currency: 'GBP',
        first_due_date: '2026-03-20',
        frequency: 'weekly',
        interval_count: 1,
        is_active: true,
      },
    ],
  });

  assert.equal(result.weeks.length, 13);
  assert.equal(result.summary.retentionLocked, 1200);
  assert.equal(result.summary.fundingFeesForecast, 240);
  assert.equal(result.weeks[0].openingBalance, 10000);
  assert.ok(result.weeks.some((week) => week.lines.some((line) => line.category === 'funded_invoice_advance')));
  assert.ok(result.weeks.some((week) => week.lines.some((line) => line.category === 'retention_release')));
  assert.ok(result.weeks.some((week) => week.lines.some((line) => line.category === 'finance_fees')));
});

test('cashflow forecast brings open QBO invoices and bills into forecast weeks', () => {
  const result = buildCashflowForecast({
    assumptions: {
      anchor_week_start: '2026-03-16',
      opening_balance: 0,
      include_qbo_open_invoices: true,
      include_qbo_open_bills: true,
    },
    qboInvoices: [
      {
        customer_name: 'Client One',
        due_date: '2026-03-24',
        balance_amount: 5000,
        currency: 'GBP',
      },
    ],
    qboBills: [
      {
        vendor_name: 'Office lease',
        due_date: '2026-03-27',
        balance_amount: 1200,
        currency: 'GBP',
      },
    ],
  });

  const receiptWeek = result.weeks.find((week) => week.lines.some((line) => line.category === 'customer_receipts'));
  const billWeek = result.weeks.find((week) => week.lines.some((line) => line.category === 'accounts_payable'));
  assert.ok(receiptWeek);
  assert.ok(billWeek);
  assert.equal(result.summary.totalInflows, 5000);
  assert.equal(result.summary.totalOutflows, 1200);
});

test('cashflow scenario presets can delay receipts and surface commercial warnings', () => {
  const result = buildCashflowForecast({
    scenarioPreset: 'tight_cash',
    assumptions: {
      anchor_week_start: '2026-03-16',
      opening_balance: 2000,
      minimum_cash_buffer: 5000,
      payroll_cover_warning_weeks: 1.5,
      concentration_warning_percent: 35,
      reporting_currency: 'GBP',
    },
    customers: [
      { customer_name: 'Major Client', expected_payment_days: 14, funding_enabled: false, is_active: true },
    ],
    invoicePlans: [
      {
        customer_name: 'Major Client',
        invoice_date: '2026-03-17',
        expected_payment_date: '2026-03-19',
        gross_amount: 15000,
        currency: 'GBP',
      },
    ],
    overheads: [
      {
        label: 'Weekly payroll',
        category: 'payroll',
        amount: 3500,
        currency: 'GBP',
        first_due_date: '2026-03-18',
        frequency: 'weekly',
        is_active: true,
      },
    ],
    qboInvoices: [
      {
        customer_name: 'Major Client',
        due_date: '2026-03-10',
        balance_amount: 4000,
        currency: 'GBP',
      },
    ],
  });

  assert.equal(result.summary.scenarioPreset, 'tight_cash');
  assert.ok(result.insights.warnings.some((warning) => /cash|receivables|payroll|concentrated/i.test(`${warning.title} ${warning.text}`)));
  assert.ok(result.insights.exposureEntries[0].shareOfExposure >= 35);
  const plannedReceiptWeek = result.weeks.find((week) => week.lines.some((line) => line.source === 'forecast_invoice'));
  assert.ok(plannedReceiptWeek);
  assert.equal(plannedReceiptWeek.weekStart, '2026-03-23');
});
