'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REPORTING_CURRENCY = 'GBP';
const DEFAULT_SCENARIO_KEY = 'base';
const DEFAULT_EUR_TO_GBP_RATE = 0.86;
const WEEK_COUNT = 13;

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function lowerText(value, maxLength) {
  return trimString(value, maxLength).toLowerCase();
}

function toNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value == null ? '' : value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

function normalizeCurrency(value, fallback = DEFAULT_REPORTING_CURRENCY) {
  const raw = trimString(value, 12).toUpperCase();
  if (raw === 'EUR') return 'EUR';
  if (raw === 'GBP') return 'GBP';
  return trimString(fallback, 12).toUpperCase() || DEFAULT_REPORTING_CURRENCY;
}

function normalizeDate(value) {
  const raw = trimString(value, 80);
  if (!raw) return '';
  const parsed = raw.length <= 10
    ? new Date(`${raw}T00:00:00Z`)
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function startOfIsoWeek(value) {
  const normalized = normalizeDate(value) || normalizeDate(new Date().toISOString());
  const current = new Date(`${normalized}T00:00:00Z`);
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() - (day - 1));
  return current.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const base = new Date(`${startOfIsoWeek(value)}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function addCalendarDays(value, days) {
  const normalized = normalizeDate(value);
  if (!normalized) return '';
  const base = new Date(`${normalized}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function addMonths(value, months) {
  const normalized = normalizeDate(value);
  if (!normalized) return '';
  const base = new Date(`${normalized}T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() + Number(months || 0));
  return base.toISOString().slice(0, 10);
}

function compareDates(a, b) {
  const left = normalizeDate(a);
  const right = normalizeDate(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function withinRange(date, start, end) {
  const normalized = normalizeDate(date);
  if (!normalized) return false;
  return normalized >= normalizeDate(start) && normalized <= normalizeDate(end);
}

function currencySymbol(currency) {
  return normalizeCurrency(currency) === 'EUR' ? 'EUR' : 'GBP';
}

function normalizeVatTreatment(value) {
  const raw = lowerText(value, 60);
  if (['reverse_charge', 'reverse-charge', 'reverse charge'].includes(raw)) return 'reverse_charge';
  if (['zero', 'zero_rated', 'zero-rated', 'zero rated', 'nil', 'nil_vat'].includes(raw)) return 'zero_rated';
  if (['exempt', 'vat_exempt'].includes(raw)) return 'exempt';
  return 'uk_standard';
}

function vatMultiplier(treatment, vatRate) {
  const normalized = normalizeVatTreatment(treatment);
  if (normalized === 'reverse_charge' || normalized === 'zero_rated' || normalized === 'exempt') return 0;
  return toNumber(vatRate, 20) / 100;
}

function deriveGrossAmount(input = {}) {
  const explicitGross = toNumber(input.gross_amount ?? input.grossAmount, NaN);
  if (Number.isFinite(explicitGross) && explicitGross > 0) return roundMoney(explicitGross);
  const explicitVat = toNumber(input.vat_amount ?? input.vatAmount, NaN);
  const net = toNumber(input.net_amount ?? input.netAmount, 0);
  if (Number.isFinite(explicitVat) && explicitVat >= 0) return roundMoney(net + explicitVat);
  return roundMoney(net * (1 + vatMultiplier(input.vat_treatment ?? input.vatTreatment, input.vat_rate ?? input.vatRate)));
}

function convertToReporting(amount, sourceCurrency, assumptions = {}) {
  const reportingCurrency = normalizeCurrency(assumptions.reporting_currency ?? assumptions.reportingCurrency, DEFAULT_REPORTING_CURRENCY);
  const currency = normalizeCurrency(sourceCurrency, reportingCurrency);
  const eurToGbpRate = toNumber(
    assumptions.eur_to_gbp_rate ?? assumptions.eurToGbpRate,
    DEFAULT_EUR_TO_GBP_RATE
  ) || DEFAULT_EUR_TO_GBP_RATE;
  if (currency === reportingCurrency) return roundMoney(amount);
  if (currency === 'EUR' && reportingCurrency === 'GBP') return roundMoney(amount * eurToGbpRate);
  if (currency === 'GBP' && reportingCurrency === 'EUR') return roundMoney(amount / eurToGbpRate);
  return roundMoney(amount);
}

function buildWeekRange(anchorWeekStart, count = WEEK_COUNT) {
  const start = startOfIsoWeek(anchorWeekStart);
  const weeks = [];
  for (let index = 0; index < count; index += 1) {
    const weekStart = addDays(start, index * 7);
    const weekEnd = addCalendarDays(weekStart, 6);
    weeks.push({
      key: weekStart,
      label: weekStart,
      weekStart,
      weekEnd,
      openingBalance: 0,
      inflows: 0,
      outflows: 0,
      netMovement: 0,
      closingBalance: 0,
      actualInflows: 0,
      forecastInflows: 0,
      actualOutflows: 0,
      forecastOutflows: 0,
      lines: [],
      categoryTotals: {},
      tone: 'forecast',
    });
  }
  return weeks;
}

function weekForDate(date, weeks = []) {
  const normalized = normalizeDate(date);
  if (!normalized) return null;
  return weeks.find((week) => normalized >= week.weekStart && normalized <= week.weekEnd) || null;
}

function matchFundingRule(customerName, fundingRules = []) {
  const customerKey = lowerText(customerName, 240);
  if (!customerKey) return null;
  return fundingRules.find((row) => row.is_active !== false && lowerText(row.customer_name ?? row.customerName, 240) === customerKey) || null;
}

function matchCustomerProfile(customerName, customers = []) {
  const customerKey = lowerText(customerName, 240);
  if (!customerKey) return null;
  return customers.find((row) => row.is_active !== false && lowerText(row.customer_name ?? row.customerName, 240) === customerKey) || null;
}

function pushWeekLine(weeks, line) {
  const week = weekForDate(line.date, weeks);
  if (!week) return;
  const amount = roundMoney(line.amount);
  const next = {
    ...line,
    amount,
    category: trimString(line.category, 80) || 'other',
    direction: line.direction === 'outflow' ? 'outflow' : 'inflow',
    label: trimString(line.label, 240) || 'Finance line',
    source: trimString(line.source, 80) || 'manual',
    actual: line.actual === true,
  };
  week.lines.push(next);
  const categoryKey = `${next.direction}:${next.category}`;
  week.categoryTotals[categoryKey] = roundMoney((week.categoryTotals[categoryKey] || 0) + amount);

  if (next.direction === 'inflow') {
    week.inflows = roundMoney(week.inflows + amount);
    if (next.actual) week.actualInflows = roundMoney(week.actualInflows + amount);
    else week.forecastInflows = roundMoney(week.forecastInflows + amount);
  } else {
    week.outflows = roundMoney(week.outflows + amount);
    if (next.actual) week.actualOutflows = roundMoney(week.actualOutflows + amount);
    else week.forecastOutflows = roundMoney(week.forecastOutflows + amount);
  }
}

function addInvoiceCashLines({ invoice, fundingRules, customers, assumptions, weeks, source, actual }) {
  const customerName = trimString(invoice.customer_name ?? invoice.customerName, 240);
  const customer = matchCustomerProfile(customerName, customers);
  const fundingRule = matchFundingRule(customerName, fundingRules);
  const currency = normalizeCurrency(invoice.currency, customer?.default_currency || assumptions.reporting_currency || DEFAULT_REPORTING_CURRENCY);
  const gross = deriveGrossAmount({
    grossAmount: invoice.total_amount ?? invoice.gross_amount ?? invoice.grossAmount,
    netAmount: invoice.net_amount ?? invoice.netAmount,
    vatAmount: invoice.vat_amount ?? invoice.vatAmount,
    vatTreatment: invoice.vat_treatment ?? customer?.vat_treatment,
    vatRate: invoice.vat_rate ?? customer?.vat_rate,
  });
  const balanceAmount = roundMoney(
    Number.isFinite(toNumber(invoice.balance_amount ?? invoice.balanceAmount, NaN))
      ? toNumber(invoice.balance_amount ?? invoice.balanceAmount, 0)
      : gross
  );
  if (balanceAmount <= 0) return { retained: 0, fees: 0 };

  const shouldFund = invoice.funded === true
    || invoice.funding_enabled === true
    || customer?.funding_enabled === true
    || fundingRule?.is_active === true;

  const issueDate = normalizeDate(invoice.invoice_date ?? invoice.txn_date ?? invoice.txnDate) || weeks[0]?.weekStart || startOfIsoWeek(new Date().toISOString());
  const dueDate = normalizeDate(
    invoice.expected_payment_date
      ?? invoice.due_date
      ?? invoice.expectedPaymentDate
  ) || addCalendarDays(issueDate, customer?.expected_payment_days ?? assumptions.default_payment_days ?? 30);

  if (!shouldFund || !fundingRule) {
    pushWeekLine(weeks, {
      date: compareDates(dueDate, weeks[0]?.weekStart) < 0 ? weeks[0]?.weekStart : dueDate,
      label: `${customerName || 'Customer'} receipt`,
      amount: convertToReporting(balanceAmount, currency, assumptions),
      direction: 'inflow',
      category: source === 'qbo_invoice' ? 'customer_receipts' : 'forecast_invoices',
      source,
      actual,
      meta: {
        customerName,
        currency,
        gross,
      },
    });
    return { retained: 0, fees: 0 };
  }

  const advancePercent = toNumber(fundingRule.advance_percent ?? fundingRule.advancePercent, 90);
  const retentionPercent = toNumber(fundingRule.retention_percent ?? fundingRule.retentionPercent, Math.max(0, 100 - advancePercent));
  const feePercent = toNumber(fundingRule.fee_percent ?? fundingRule.feePercent, 0);
  const interestPercent = toNumber(fundingRule.interest_percent ?? fundingRule.interestPercent, 0);
  const settlementLagDays = toNumber(fundingRule.settlement_lag_days ?? fundingRule.settlementLagDays, 14);
  const advanceAmount = roundMoney(balanceAmount * (advancePercent / 100));
  const retentionAmount = roundMoney(balanceAmount * (retentionPercent / 100));
  const feeAmount = roundMoney(balanceAmount * ((feePercent + interestPercent) / 100));
  const settlementDate = addCalendarDays(dueDate, settlementLagDays);

  pushWeekLine(weeks, {
    date: compareDates(issueDate, weeks[0]?.weekStart) < 0 ? weeks[0]?.weekStart : issueDate,
    label: `${customerName || 'Customer'} funded advance`,
    amount: convertToReporting(advanceAmount, currency, assumptions),
    direction: 'inflow',
    category: 'funded_invoice_advance',
    source,
    actual,
    meta: { customerName, gross, currency },
  });

  if (retentionAmount > 0) {
    pushWeekLine(weeks, {
      date: settlementDate,
      label: `${customerName || 'Customer'} retention release`,
      amount: convertToReporting(retentionAmount, currency, assumptions),
      direction: 'inflow',
      category: 'retention_release',
      source,
      actual: false,
      meta: { customerName, gross, currency },
    });
  }

  if (feeAmount > 0) {
    pushWeekLine(weeks, {
      date: settlementDate,
      label: `${customerName || 'Customer'} funding fees`,
      amount: convertToReporting(feeAmount, currency, assumptions),
      direction: 'outflow',
      category: 'finance_fees',
      source,
      actual: false,
      meta: { customerName, gross, currency },
    });
  }

  return {
    retained: convertToReporting(retentionAmount, currency, assumptions),
    fees: convertToReporting(feeAmount, currency, assumptions),
  };
}

function expandOverheadDates(row, rangeStart, rangeEnd) {
  const firstDueDate = normalizeDate(row.first_due_date ?? row.firstDueDate ?? row.due_date ?? row.dueDate);
  if (!firstDueDate) return [];
  const frequency = lowerText(row.frequency, 40) || 'monthly';
  const intervalCount = Math.max(1, Math.round(toNumber(row.interval_count ?? row.intervalCount, 1)));
  const dates = [];
  let cursor = firstDueDate;
  let guard = 0;

  while (compareDates(cursor, rangeEnd) <= 0 && guard < 80) {
    if (compareDates(cursor, rangeStart) >= 0) dates.push(cursor);
    guard += 1;
    if (frequency === 'one_off' || frequency === 'once') break;
    if (frequency === 'weekly') cursor = addCalendarDays(cursor, 7 * intervalCount);
    else if (frequency === 'fortnightly') cursor = addCalendarDays(cursor, 14 * intervalCount);
    else if (frequency === 'quarterly') cursor = addMonths(cursor, 3 * intervalCount);
    else cursor = addMonths(cursor, intervalCount);
  }
  return dates;
}

function buildCashflowForecast(input = {}) {
  const assumptions = input.assumptions && typeof input.assumptions === 'object' ? input.assumptions : {};
  const customers = Array.isArray(input.customers) ? input.customers : [];
  const fundingRules = Array.isArray(input.fundingRules) ? input.fundingRules : [];
  const invoicePlans = Array.isArray(input.invoicePlans) ? input.invoicePlans : [];
  const overheads = Array.isArray(input.overheads) ? input.overheads : [];
  const adjustments = Array.isArray(input.adjustments) ? input.adjustments : [];
  const qboInvoices = Array.isArray(input.qboInvoices) ? input.qboInvoices : [];
  const qboPayments = Array.isArray(input.qboPayments) ? input.qboPayments : [];
  const qboBills = Array.isArray(input.qboBills) ? input.qboBills : [];
  const qboPurchases = Array.isArray(input.qboPurchases) ? input.qboPurchases : [];

  const anchorWeekStart = startOfIsoWeek(assumptions.anchor_week_start ?? assumptions.anchorWeekStart ?? new Date().toISOString());
  const weeks = buildWeekRange(anchorWeekStart, toNumber(input.weekCount, WEEK_COUNT) || WEEK_COUNT);
  const rangeStart = weeks[0]?.weekStart || anchorWeekStart;
  const rangeEnd = weeks[weeks.length - 1]?.weekEnd || addCalendarDays(anchorWeekStart, 90);
  const currentWeekStart = startOfIsoWeek(new Date().toISOString());
  const openingBalance = convertToReporting(
    toNumber(assumptions.opening_balance ?? assumptions.openingBalance, 0),
    assumptions.reporting_currency ?? assumptions.reportingCurrency ?? DEFAULT_REPORTING_CURRENCY,
    assumptions
  );

  let retentionLocked = 0;
  let fundingFeesForecast = 0;

  qboPayments.forEach((payment) => {
    const paymentDate = normalizeDate(payment.txn_date ?? payment.txnDate);
    if (!withinRange(paymentDate, rangeStart, rangeEnd)) return;
    pushWeekLine(weeks, {
      date: paymentDate,
      label: `${trimString(payment.customer_name ?? payment.customerName, 240) || 'Customer'} payment`,
      amount: convertToReporting(toNumber(payment.total_amount ?? payment.totalAmount, 0), payment.currency, assumptions),
      direction: 'inflow',
      category: 'customer_receipts',
      source: 'qbo_payment',
      actual: true,
    });
  });

  qboPurchases.forEach((purchase) => {
    const purchaseDate = normalizeDate(purchase.txn_date ?? purchase.txnDate);
    if (!withinRange(purchaseDate, rangeStart, rangeEnd)) return;
    pushWeekLine(weeks, {
      date: purchaseDate,
      label: trimString(purchase.payee_name ?? purchase.payeeName, 240) || 'QuickBooks expense',
      amount: convertToReporting(toNumber(purchase.total_amount ?? purchase.totalAmount, 0), purchase.currency, assumptions),
      direction: 'outflow',
      category: 'expenses',
      source: 'qbo_purchase',
      actual: true,
    });
  });

  if (assumptions.include_qbo_open_bills !== false) {
    qboBills.forEach((bill) => {
      const balance = toNumber(bill.balance_amount ?? bill.balanceAmount, 0);
      if (balance <= 0) return;
      const dueDate = normalizeDate(bill.due_date ?? bill.dueDate) || normalizeDate(bill.txn_date ?? bill.txnDate);
      const effectiveDate = compareDates(dueDate, rangeStart) < 0 ? rangeStart : dueDate;
      if (!withinRange(effectiveDate, rangeStart, rangeEnd)) return;
      pushWeekLine(weeks, {
        date: effectiveDate,
        label: trimString(bill.vendor_name ?? bill.vendorName, 240) || 'QuickBooks bill',
        amount: convertToReporting(balance, bill.currency, assumptions),
        direction: 'outflow',
        category: 'accounts_payable',
        source: 'qbo_bill',
        actual: false,
      });
    });
  }

  if (assumptions.include_qbo_open_invoices !== false) {
    qboInvoices.forEach((invoice) => {
      const balance = toNumber(invoice.balance_amount ?? invoice.balanceAmount, 0);
      if (balance <= 0) return;
      const result = addInvoiceCashLines({
        invoice: {
          ...invoice,
          gross_amount: balance,
          funded: invoice.funded === true,
        },
        fundingRules,
        customers,
        assumptions,
        weeks,
        source: 'qbo_invoice',
        actual: false,
      });
      retentionLocked = roundMoney(retentionLocked + result.retained);
      fundingFeesForecast = roundMoney(fundingFeesForecast + result.fees);
    });
  }

  invoicePlans.forEach((invoice) => {
    if (lowerText(invoice.status, 40) === 'cancelled') return;
    const result = addInvoiceCashLines({
      invoice,
      fundingRules,
      customers,
      assumptions,
      weeks,
      source: 'forecast_invoice',
      actual: false,
    });
    retentionLocked = roundMoney(retentionLocked + result.retained);
    fundingFeesForecast = roundMoney(fundingFeesForecast + result.fees);
  });

  overheads.forEach((row) => {
    if (row.is_active === false) return;
    const amount = convertToReporting(toNumber(row.amount, 0), row.currency, assumptions);
    if (amount <= 0) return;
    expandOverheadDates(row, rangeStart, rangeEnd).forEach((date) => {
      pushWeekLine(weeks, {
        date,
        label: trimString(row.label, 240) || 'Overhead',
        amount,
        direction: 'outflow',
        category: trimString(row.category, 80) || 'overheads',
        source: 'overhead',
        actual: false,
      });
    });
  });

  adjustments.forEach((row) => {
    const effectiveDate = normalizeDate(row.effective_date ?? row.effectiveDate);
    if (!withinRange(effectiveDate, rangeStart, rangeEnd)) return;
    const amount = convertToReporting(toNumber(row.amount, 0), row.currency, assumptions);
    if (amount <= 0) return;
    pushWeekLine(weeks, {
      date: effectiveDate,
      label: trimString(row.label, 240) || 'Adjustment',
      amount,
      direction: lowerText(row.direction, 20) === 'inflow' ? 'inflow' : 'outflow',
      category: trimString(row.category, 80) || 'adjustments',
      source: 'adjustment',
      actual: row.is_actual === true,
    });
  });

  let running = openingBalance;
  weeks.forEach((week) => {
    week.lines.sort((left, right) => compareDates(left.date, right.date));
    week.openingBalance = roundMoney(running);
    week.netMovement = roundMoney(week.inflows - week.outflows);
    week.closingBalance = roundMoney(week.openingBalance + week.netMovement);
    week.tone = compareDates(week.weekStart, currentWeekStart) <= 0 ? 'actual' : 'forecast';
    running = week.closingBalance;
  });

  const closingBalances = weeks.map((week) => week.closingBalance);
  const summary = {
    scenarioKey: trimString(assumptions.scenario_key ?? assumptions.scenarioKey, 80) || DEFAULT_SCENARIO_KEY,
    reportingCurrency: normalizeCurrency(assumptions.reporting_currency ?? assumptions.reportingCurrency, DEFAULT_REPORTING_CURRENCY),
    openingBalance,
    currentCash: weeks[0]?.openingBalance ?? openingBalance,
    forecastMinimumCash: closingBalances.length ? Math.min(...closingBalances) : openingBalance,
    totalInflows: roundMoney(weeks.reduce((sum, week) => sum + week.inflows, 0)),
    totalOutflows: roundMoney(weeks.reduce((sum, week) => sum + week.outflows, 0)),
    retentionLocked: roundMoney(retentionLocked),
    fundingFeesForecast: roundMoney(fundingFeesForecast),
    actualWeeks: weeks.filter((week) => week.tone === 'actual').length,
    weekCount: weeks.length,
    rangeStart,
    rangeEnd,
  };

  return {
    summary,
    weeks,
  };
}

function buildDashboardSnapshot(input = {}) {
  const result = buildCashflowForecast(input);
  const { summary, weeks } = result;
  const nextTwelveNet = roundMoney(weeks.reduce((sum, week) => sum + week.netMovement, 0));
  return {
    ...summary,
    nextTwelveNet,
    worstWeek: weeks.reduce((lowest, week) => {
      if (!lowest || week.closingBalance < lowest.closingBalance) return week;
      return lowest;
    }, null),
  };
}

module.exports = {
  DAY_MS,
  WEEK_COUNT,
  DEFAULT_SCENARIO_KEY,
  DEFAULT_REPORTING_CURRENCY,
  DEFAULT_EUR_TO_GBP_RATE,
  trimString,
  lowerText,
  toNumber,
  roundMoney,
  normalizeCurrency,
  normalizeDate,
  normalizeVatTreatment,
  startOfIsoWeek,
  addDays,
  addCalendarDays,
  addMonths,
  compareDates,
  withinRange,
  currencySymbol,
  deriveGrossAmount,
  convertToReporting,
  buildWeekRange,
  buildCashflowForecast,
  buildDashboardSnapshot,
};
