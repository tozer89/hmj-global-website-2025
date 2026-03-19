(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.HMJDealProfitCalc = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MS_PER_DAY = 24 * 60 * 60 * 1000;
  var WEEKS_PER_MONTH = 52 / 12;
  var DURATION_PRESETS = Object.freeze({
    week: { key: 'week', label: '1 week', weeks: 1 },
    month: { key: 'month', label: '1 month', weeks: WEEKS_PER_MONTH },
    quarter: { key: 'quarter', label: '3 months', weeks: 13 },
    half_year: { key: 'half_year', label: '6 months', weeks: 26 },
    custom: { key: 'custom', label: 'Custom weeks', weeks: null },
  });
  var PAYMENT_TERM_DEFINITIONS = Object.freeze({
    '7_doi': { key: '7_doi', label: '7 days from invoice', kind: 'fixed', days: 7 },
    '14_doi': { key: '14_doi', label: '14 days date of invoice', kind: 'fixed', days: 14 },
    '30_doi': { key: '30_doi', label: '30 days from invoice', kind: 'fixed', days: 30 },
    '30_eom': { key: '30_eom', label: '30 days EOM', kind: 'eom', days: 30 },
    '45_doi': { key: '45_doi', label: '45 days from invoice', kind: 'fixed', days: 45 },
    '60_doi': { key: '60_doi', label: '60 days from invoice', kind: 'fixed', days: 60 },
    '90_eom': { key: '90_eom', label: '90 days EOM', kind: 'eom', days: 90 },
    custom: { key: 'custom', label: 'Custom days', kind: 'custom', days: null },
  });

  function todayIsoDate() {
    var now = new Date();
    var local = new Date(now.getTime() - (now.getTimezoneOffset() * 60 * 1000));
    return local.toISOString().slice(0, 10);
  }

  var DEFAULT_INPUT = Object.freeze({
    dealName: '',
    candidateLabel: '',
    clientName: '',
    startDate: todayIsoDate(),
    currency: 'GBP',
    workerCount: 1,
    payRate: 22,
    marginMode: 'margin_per_hour',
    marginPerHour: 5,
    chargeRateOverride: 27,
    hoursPerWeek: 50,
    durationPreset: 'month',
    customWeeks: 8,
    paymentTermsPreset: '30_doi',
    customPaymentDays: 30,
    financeFeeMode: 'annualised_split',
    fundingAdvancePercent: 85,
    taxRatePercent: 25,
    weeklyOverhead: 0,
    annualDiscountFeePercent: 2.15,
    annualInterestFeePercent: 0.15,
    showVat: false,
    vatRatePercent: 20,
    notes: '',
  });

  function toNumber(value, fallback) {
    var num = Number(value);
    if (Number.isFinite(num)) return num;
    return Number.isFinite(fallback) ? fallback : 0;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function round(value, decimals) {
    var factor = Math.pow(10, Number.isFinite(decimals) ? decimals : 2);
    return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
  }

  function trimString(value) {
    return String(value == null ? '' : value).trim();
  }

  function normaliseCurrency(value) {
    return String(value || '').toUpperCase() === 'EUR' ? 'EUR' : 'GBP';
  }

  function normaliseFinanceFeeMode(value) {
    return trimString(value) === 'bundled_invoice_fee' ? 'bundled_invoice_fee' : 'annualised_split';
  }

  function normalisePaymentTermsPreset(value) {
    var preset = trimString(value);
    var legacyMap = {
      '7': '7_doi',
      '14': '14_doi',
      '30': '30_doi',
      '45': '45_doi',
      '60': '60_doi',
    };
    if (legacyMap[preset]) return legacyMap[preset];
    if (PAYMENT_TERM_DEFINITIONS[preset]) return preset;
    return DEFAULT_INPUT.paymentTermsPreset;
  }

  function resolveDurationWeeks(input) {
    var preset = DURATION_PRESETS[input.durationPreset] || DURATION_PRESETS.month;
    if (preset.weeks != null) return preset.weeks;
    return Math.max(0.5, toNumber(input.customWeeks, DEFAULT_INPUT.customWeeks));
  }

  function parseIsoDate(value) {
    var text = trimString(value);
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return parseIsoDate(DEFAULT_INPUT.startDate);
    var year = Number(match[1]);
    var month = Number(match[2]) - 1;
    var day = Number(match[3]);
    return new Date(Date.UTC(year, month, day, 12, 0, 0));
  }

  function formatIsoDate(date) {
    return new Date(date.getTime()).toISOString().slice(0, 10);
  }

  function addDays(date, days) {
    return new Date(date.getTime() + (days * MS_PER_DAY));
  }

  function endOfMonth(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 12, 0, 0));
  }

  function daysBetween(fromDate, toDate) {
    return Math.max(0, round((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY, 4));
  }

  function resolvePaymentTerms(input) {
    var term = PAYMENT_TERM_DEFINITIONS[input.paymentTermsPreset] || PAYMENT_TERM_DEFINITIONS[DEFAULT_INPUT.paymentTermsPreset];
    if (term.kind === 'custom') {
      return {
        key: 'custom',
        label: Math.max(0, input.customPaymentDays) + ' custom days',
        kind: 'custom',
        days: Math.max(0, input.customPaymentDays),
      };
    }
    return term;
  }

  function invoiceDateForSegment(startDate, elapsedWeeks, segmentWeeks) {
    return addDays(startDate, (elapsedWeeks + segmentWeeks) * 7);
  }

  function resolveDueDate(invoiceDate, input) {
    var terms = resolvePaymentTerms(input);
    if (terms.kind === 'eom') {
      return addDays(endOfMonth(invoiceDate), terms.days);
    }
    return addDays(invoiceDate, terms.days);
  }

  function resolveDaysOutstandingForInvoice(invoiceDate, input) {
    return daysBetween(invoiceDate, resolveDueDate(invoiceDate, input));
  }

  function resolveRepresentativePaymentDays(input) {
    var invoiceDate = invoiceDateForSegment(input.parsedStartDate, 0, 1);
    return round(resolveDaysOutstandingForInvoice(invoiceDate, input), 2);
  }

  function resolvePaymentDays(input) {
    return resolveRepresentativePaymentDays(input);
  }

  function normaliseInput(rawInput) {
    var base = Object.assign({}, DEFAULT_INPUT, rawInput || {});
    var marginMode = trimString(base.marginMode) === 'charge_rate_override'
      ? 'charge_rate_override'
      : 'margin_per_hour';
    var paymentTermsPreset = normalisePaymentTermsPreset(base.paymentTermsPreset);
    var parsedStartDate = parseIsoDate(base.startDate);
    var interestFallback = base.annualInterestFeePercent;
    if (!Number.isFinite(Number(interestFallback))) {
      interestFallback = base.dailyInterestFeePercent;
    }
    if (!Number.isFinite(Number(interestFallback))) {
      interestFallback = DEFAULT_INPUT.annualInterestFeePercent;
    }
    var annualInterestFeePercent = Math.max(0, toNumber(interestFallback, DEFAULT_INPUT.annualInterestFeePercent));
    var input = {
      dealName: trimString(base.dealName),
      candidateLabel: trimString(base.candidateLabel),
      clientName: trimString(base.clientName),
      startDate: formatIsoDate(parsedStartDate),
      parsedStartDate: parsedStartDate,
      currency: normaliseCurrency(base.currency),
      workerCount: Math.max(1, toNumber(base.workerCount, DEFAULT_INPUT.workerCount)),
      payRate: Math.max(0, toNumber(base.payRate, DEFAULT_INPUT.payRate)),
      marginMode: marginMode,
      marginPerHour: toNumber(base.marginPerHour, DEFAULT_INPUT.marginPerHour),
      chargeRateOverride: Math.max(0, toNumber(base.chargeRateOverride, DEFAULT_INPUT.chargeRateOverride)),
      hoursPerWeek: Math.max(0, toNumber(base.hoursPerWeek, DEFAULT_INPUT.hoursPerWeek)),
      durationPreset: DURATION_PRESETS[base.durationPreset] ? base.durationPreset : DEFAULT_INPUT.durationPreset,
      customWeeks: Math.max(0.5, toNumber(base.customWeeks, DEFAULT_INPUT.customWeeks)),
      paymentTermsPreset: paymentTermsPreset,
      customPaymentDays: Math.max(0, toNumber(base.customPaymentDays, DEFAULT_INPUT.customPaymentDays)),
      financeFeeMode: normaliseFinanceFeeMode(base.financeFeeMode),
      fundingAdvancePercent: clamp(toNumber(base.fundingAdvancePercent, DEFAULT_INPUT.fundingAdvancePercent), 0, 100),
      taxRatePercent: clamp(toNumber(base.taxRatePercent, DEFAULT_INPUT.taxRatePercent), 0, 100),
      weeklyOverhead: Math.max(0, toNumber(base.weeklyOverhead, DEFAULT_INPUT.weeklyOverhead)),
      annualDiscountFeePercent: Math.max(0, toNumber(base.annualDiscountFeePercent, DEFAULT_INPUT.annualDiscountFeePercent)),
      annualInterestFeePercent: annualInterestFeePercent,
      showVat: String(base.showVat) === 'true' || base.showVat === true,
      vatRatePercent: Math.max(0, toNumber(base.vatRatePercent, DEFAULT_INPUT.vatRatePercent)),
      notes: trimString(base.notes),
    };
    input.selectedDurationWeeks = resolveDurationWeeks(input);
    input.paymentTerms = resolvePaymentTerms(input);
    input.paymentTermsLabel = input.paymentTerms.label;
    input.paymentDays = resolveRepresentativePaymentDays(input);
    return input;
  }

  function resolveChargeRate(input) {
    if (input.marginMode === 'charge_rate_override') {
      return round(input.chargeRateOverride, 4);
    }
    return round(input.payRate + input.marginPerHour, 4);
  }

  function resolveImpliedMarginPerHour(input, chargeRate) {
    return round(chargeRate - input.payRate, 4);
  }

  function buildWeekSegments(weeks) {
    var segments = [];
    var remaining = Math.max(0, weeks);
    var index = 0;
    while (remaining > 0.0001) {
      var segmentWeeks = remaining >= 1 ? 1 : round(remaining, 4);
      segments.push({ index: index, weeks: segmentWeeks });
      remaining = round(remaining - segmentWeeks, 4);
      index += 1;
    }
    return segments;
  }

  function calculateFinanceProfile(input, config, weeklyInvoiceValue) {
    var fundingAdvanceRate = input.fundingAdvancePercent / 100;
    var annualDiscountRate = input.annualDiscountFeePercent / 100;
    var annualInterestRate = input.annualInterestFeePercent / 100;
    var segments = buildWeekSegments(config.weeks);
    var totals = {
      fundedAmount: 0,
      reserveRetained: 0,
      discountFee: 0,
      interestFee: 0,
      totalFinanceCost: 0,
      weightedDaysOutstanding: 0,
      firstInvoiceDate: null,
      lastInvoiceDate: null,
    };
    var elapsedWeeks = 0;

    segments.forEach(function (segment) {
      var invoiceValue = weeklyInvoiceValue * segment.weeks;
      var fundedAmount = invoiceValue * fundingAdvanceRate;
      var reserveRetained = invoiceValue - fundedAmount;
      var invoiceDate = invoiceDateForSegment(input.parsedStartDate, elapsedWeeks, segment.weeks);
      var daysOutstanding = resolveDaysOutstandingForInvoice(invoiceDate, input);
      var discountFee = 0;
      var interestFee = 0;

      if (input.financeFeeMode === 'bundled_invoice_fee') {
        discountFee = invoiceValue * annualDiscountRate;
      } else {
        discountFee = invoiceValue * annualDiscountRate * (daysOutstanding / 365);
        interestFee = fundedAmount * annualInterestRate * (daysOutstanding / 365);
      }

      totals.fundedAmount += fundedAmount;
      totals.reserveRetained += reserveRetained;
      totals.discountFee += discountFee;
      totals.interestFee += interestFee;
      totals.totalFinanceCost += discountFee + interestFee;
      totals.weightedDaysOutstanding += (invoiceValue * daysOutstanding);
      totals.firstInvoiceDate = totals.firstInvoiceDate || invoiceDate;
      totals.lastInvoiceDate = invoiceDate;
      elapsedWeeks = round(elapsedWeeks + segment.weeks, 4);
    });

    var averageDaysOutstanding = config.weeks > 0 && weeklyInvoiceValue > 0
      ? totals.weightedDaysOutstanding / (weeklyInvoiceValue * config.weeks)
      : input.paymentDays;

    return {
      fundedAmount: round(totals.fundedAmount, 2),
      reserveRetained: round(totals.reserveRetained, 2),
      discountFee: round(totals.discountFee, 2),
      interestFee: round(totals.interestFee, 2),
      totalFinanceCost: round(totals.totalFinanceCost, 2),
      averageDaysOutstanding: round(averageDaysOutstanding, 2),
      firstInvoiceDate: totals.firstInvoiceDate ? formatIsoDate(totals.firstInvoiceDate) : input.startDate,
      lastInvoiceDate: totals.lastInvoiceDate ? formatIsoDate(totals.lastInvoiceDate) : input.startDate,
    };
  }

  function calculatePeriod(input, config) {
    var chargeRate = resolveChargeRate(input);
    var impliedMarginPerHour = resolveImpliedMarginPerHour(input, chargeRate);
    var weeklyHours = input.hoursPerWeek * input.workerCount;
    var payRate = input.payRate;
    var weeklyInvoiceValue = chargeRate * weeklyHours;
    var invoiceValue = weeklyInvoiceValue * config.weeks;
    var payCost = payRate * weeklyHours * config.weeks;
    var grossMargin = invoiceValue - payCost;
    var taxRate = input.taxRatePercent / 100;
    var finance = calculateFinanceProfile(input, config, weeklyInvoiceValue);
    var overheads = input.weeklyOverhead * config.weeks;
    var profitBeforeTax = grossMargin - finance.totalFinanceCost - overheads;
    var tax = Math.max(profitBeforeTax, 0) * taxRate;
    var netProfit = profitBeforeTax - tax;
    var netCashReleased = finance.fundedAmount - finance.totalFinanceCost;
    var vatAmount = input.showVat ? invoiceValue * (input.vatRatePercent / 100) : 0;

    return {
      key: config.key,
      label: config.label,
      weeks: round(config.weeks, 4),
      daysOutstanding: finance.averageDaysOutstanding,
      paymentTermsLabel: input.paymentTermsLabel,
      firstInvoiceDate: finance.firstInvoiceDate,
      lastInvoiceDate: finance.lastInvoiceDate,
      workerCount: input.workerCount,
      payRate: round(payRate, 4),
      chargeRate: round(chargeRate, 4),
      impliedMarginPerHour: round(impliedMarginPerHour, 4),
      productiveHours: round(weeklyHours * config.weeks, 2),
      weeklyHours: round(weeklyHours, 2),
      revenue: round(invoiceValue, 2),
      payCost: round(payCost, 2),
      grossMargin: round(grossMargin, 2),
      fundedAmount: finance.fundedAmount,
      reserveRetained: finance.reserveRetained,
      discountFee: finance.discountFee,
      interestFee: finance.interestFee,
      totalFinanceCost: finance.totalFinanceCost,
      overheads: round(overheads, 2),
      profitBeforeTax: round(profitBeforeTax, 2),
      tax: round(tax, 2),
      netProfit: round(netProfit, 2),
      netCashReleased: round(netCashReleased, 2),
      vatAmount: round(vatAmount, 2),
    };
  }

  function buildPeriods(input) {
    var periods = [
      calculatePeriod(input, { key: 'week', label: 'Per week', weeks: 1 }),
      calculatePeriod(input, { key: 'month', label: '1 month', weeks: WEEKS_PER_MONTH }),
      calculatePeriod(input, { key: 'quarter', label: '3 months', weeks: 13 }),
      calculatePeriod(input, { key: 'half_year', label: '6 months', weeks: 26 }),
    ];

    if (input.durationPreset === 'custom') {
      periods.push(calculatePeriod(input, {
        key: 'selected',
        label: 'Selected contract',
        weeks: input.selectedDurationWeeks,
      }));
    }

    return periods;
  }

  function buildSelectedPeriod(input, periods) {
    if (input.durationPreset === 'week') return periods[0];
    if (input.durationPreset === 'month') return periods[1];
    if (input.durationPreset === 'quarter') return periods[2];
    if (input.durationPreset === 'half_year') return periods[3];
    return periods[periods.length - 1];
  }

  function buildBreakEvenMetrics(input, weeklyPeriod) {
    var productiveHours = weeklyPeriod.weeklyHours;
    if (!productiveHours) {
      return {
        beforeTaxMarginPerHour: 0,
        afterTaxMarginPerHour: 0,
      };
    }
    var beforeTaxMarginPerHour = (weeklyPeriod.totalFinanceCost + weeklyPeriod.overheads) / productiveHours;
    var divisor = Math.max(1 - (input.taxRatePercent / 100), 0.01);
    return {
      beforeTaxMarginPerHour: round(beforeTaxMarginPerHour, 4),
      afterTaxMarginPerHour: round(beforeTaxMarginPerHour / divisor, 4),
    };
  }

  function buildWarnings(input, selectedPeriod, weeklyPeriod) {
    var warnings = [];
    if (weeklyPeriod.chargeRate < input.payRate) {
      warnings.push({
        tone: 'danger',
        text: 'Charge rate is below pay rate. The deal is running at a negative gross margin before finance and overheads.',
      });
    }
    if (weeklyPeriod.totalFinanceCost > weeklyPeriod.grossMargin && weeklyPeriod.grossMargin > 0) {
      warnings.push({
        tone: 'warn',
        text: 'Weekly finance cost is higher than weekly gross margin. Review payment terms, advance %, or charge rate.',
      });
    }
    if (selectedPeriod.netProfit < 0) {
      warnings.push({
        tone: 'danger',
        text: 'Selected-horizon net profit is negative. This deal does not currently clear finance cost, overhead, and tax assumptions.',
      });
    }
    if (input.paymentTerms.kind === 'eom') {
      warnings.push({
        tone: 'warn',
        text: 'EOM terms are date-sensitive. HMJ is estimating each weekly invoice from the selected start date and averaging the resulting days outstanding.',
      });
    }
    if (input.financeFeeMode === 'bundled_invoice_fee') {
      warnings.push({
        tone: 'warn',
        text: 'Bundled invoice-fee mode is active. This matches the Zodeq offer basis more closely, but the £1,000 pcm minimum fee and VAT on the funder fee are not included in net profit.',
      });
    } else {
      warnings.push({
        tone: 'warn',
        text: 'The signed Zodeq offer letter states 2.15% + VAT of gross invoice value assigned with 90 days EOM, not a pure annual split-fee basis. Use the Zodeq preset if you want the documented offer terms.',
      });
    }
    if (!weeklyPeriod.weeklyHours) {
      warnings.push({
        tone: 'warn',
        text: 'Hours per week are zero. Add hours to generate a usable profit view.',
      });
    }
    return warnings;
  }

  function createVariantInput(input, variantKey) {
    var next = Object.assign({}, input);
    if (variantKey === 'lower_hours') {
      next.hoursPerWeek = round(input.hoursPerWeek * 0.9, 2);
    } else if (variantKey === 'longer_terms') {
      next.paymentTermsPreset = 'custom';
      next.customPaymentDays = round(input.paymentDays + 15, 0);
    } else if (variantKey === 'reduced_margin') {
      if (input.marginMode === 'margin_per_hour') {
        next.marginPerHour = round(input.marginPerHour - 0.5, 4);
      } else {
        next.chargeRateOverride = round(Math.max(0, input.chargeRateOverride - 0.5), 4);
      }
    }
    return next;
  }

  function buildScenarioComparison(input) {
    var normalized = normaliseInput(input);
    var variants = [
      {
        key: 'current',
        label: 'Current scenario',
        note: 'Live input values',
        input: normalized,
      },
      {
        key: 'lower_hours',
        label: 'Lower hours',
        note: '10% lower hours per week',
        input: createVariantInput(normalized, 'lower_hours'),
      },
      {
        key: 'longer_terms',
        label: 'Longer payment terms',
        note: '+15 days on payment terms',
        input: createVariantInput(normalized, 'longer_terms'),
      },
      {
        key: 'reduced_margin',
        label: 'Reduced margin',
        note: 'Margin down by 0.50 per hour',
        input: createVariantInput(normalized, 'reduced_margin'),
      },
    ];

    return variants.map(function (variant) {
      var model = calculateDealProfit(variant.input);
      return {
        key: variant.key,
        label: variant.label,
        note: variant.note,
        selectedPeriod: model.selectedPeriod,
        weekly: model.periodMap.week,
        metrics: model.metrics,
      };
    });
  }

  function calculateDealProfit(rawInput) {
    var input = normaliseInput(rawInput);
    var periods = buildPeriods(input);
    var selectedPeriod = buildSelectedPeriod(input, periods);
    var weeklyPeriod = periods[0];
    var chargeRate = weeklyPeriod.chargeRate;
    var impliedMarginPerHour = weeklyPeriod.impliedMarginPerHour;
    var grossMarginPercent = weeklyPeriod.revenue > 0
      ? round((weeklyPeriod.grossMargin / weeklyPeriod.revenue) * 100, 2)
      : 0;
    var netMarginPercent = selectedPeriod.revenue > 0
      ? round((selectedPeriod.netProfit / selectedPeriod.revenue) * 100, 2)
      : 0;
    var breakEven = buildBreakEvenMetrics(input, weeklyPeriod);

    return {
      input: input,
      chargeRate: round(chargeRate, 4),
      impliedMarginPerHour: round(impliedMarginPerHour, 4),
      periodMap: periods.reduce(function (acc, period) {
        acc[period.key] = period;
        return acc;
      }, {}),
      periods: periods,
      selectedPeriod: selectedPeriod,
      metrics: {
        grossMarginPerHour: round(impliedMarginPerHour, 4),
        grossMarginPercent: grossMarginPercent,
        netMarginPercent: netMarginPercent,
        breakEvenMarginPerHourBeforeTax: breakEven.beforeTaxMarginPerHour,
        breakEvenMarginPerHourAfterTax: breakEven.afterTaxMarginPerHour,
      },
      funding: {
        grossInvoiceValue: selectedPeriod.revenue,
        fundedAmount: selectedPeriod.fundedAmount,
        reserveRetained: selectedPeriod.reserveRetained,
        totalFinanceCost: selectedPeriod.totalFinanceCost,
        netCashReleasedAfterFees: selectedPeriod.netCashReleased,
      },
      warnings: buildWarnings(input, selectedPeriod, weeklyPeriod),
    };
  }

  function applyZodeqOfferPreset(rawInput) {
    return normaliseInput(Object.assign({}, rawInput || {}, {
      financeFeeMode: 'bundled_invoice_fee',
      fundingAdvancePercent: 90,
      annualDiscountFeePercent: 2.15,
      annualInterestFeePercent: 0,
      paymentTermsPreset: '90_eom',
    }));
  }

  return {
    DEFAULT_INPUT: DEFAULT_INPUT,
    DURATION_PRESETS: DURATION_PRESETS,
    PAYMENT_TERM_DEFINITIONS: PAYMENT_TERM_DEFINITIONS,
    normaliseInput: normaliseInput,
    resolveChargeRate: resolveChargeRate,
    resolvePaymentDays: resolvePaymentDays,
    resolveDurationWeeks: resolveDurationWeeks,
    resolvePaymentTerms: resolvePaymentTerms,
    calculatePeriod: calculatePeriod,
    calculateDealProfit: calculateDealProfit,
    buildScenarioComparison: buildScenarioComparison,
    applyZodeqOfferPreset: applyZodeqOfferPreset,
  };
}));
