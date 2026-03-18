(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.HMJDealProfitCalc = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var WEEKS_PER_MONTH = 52 / 12;
  var DURATION_PRESETS = Object.freeze({
    week: { key: 'week', label: '1 week', weeks: 1 },
    month: { key: 'month', label: '1 month', weeks: WEEKS_PER_MONTH },
    quarter: { key: 'quarter', label: '3 months', weeks: 13 },
    half_year: { key: 'half_year', label: '6 months', weeks: 26 },
    custom: { key: 'custom', label: 'Custom weeks', weeks: null },
  });

  var DEFAULT_INPUT = Object.freeze({
    dealName: '',
    candidateLabel: '',
    clientName: '',
    currency: 'GBP',
    workerCount: 1,
    payRate: 22,
    marginMode: 'margin_per_hour',
    marginPerHour: 5,
    chargeRateOverride: 27,
    hoursPerWeek: 50,
    durationPreset: 'month',
    customWeeks: 8,
    paymentTermsPreset: '30',
    customPaymentDays: 30,
    fundingAdvancePercent: 85,
    taxRatePercent: 25,
    weeklyOverhead: 0,
    annualDiscountFeePercent: 2.15,
    dailyInterestFeePercent: 0.15,
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

  function resolveDurationWeeks(input) {
    var preset = DURATION_PRESETS[input.durationPreset] || DURATION_PRESETS.month;
    if (preset.weeks != null) return preset.weeks;
    return Math.max(0.5, toNumber(input.customWeeks, DEFAULT_INPUT.customWeeks));
  }

  function resolvePaymentDays(input) {
    var preset = trimString(input.paymentTermsPreset);
    if (preset && preset !== 'custom') return Math.max(0, toNumber(preset, 30));
    return Math.max(0, toNumber(input.customPaymentDays, DEFAULT_INPUT.customPaymentDays));
  }

  function normaliseInput(rawInput) {
    var base = Object.assign({}, DEFAULT_INPUT, rawInput || {});
    var marginMode = trimString(base.marginMode) === 'charge_rate_override'
      ? 'charge_rate_override'
      : 'margin_per_hour';
    var input = {
      dealName: trimString(base.dealName),
      candidateLabel: trimString(base.candidateLabel),
      clientName: trimString(base.clientName),
      currency: normaliseCurrency(base.currency),
      workerCount: Math.max(1, toNumber(base.workerCount, DEFAULT_INPUT.workerCount)),
      payRate: Math.max(0, toNumber(base.payRate, DEFAULT_INPUT.payRate)),
      marginMode: marginMode,
      marginPerHour: toNumber(base.marginPerHour, DEFAULT_INPUT.marginPerHour),
      chargeRateOverride: Math.max(0, toNumber(base.chargeRateOverride, DEFAULT_INPUT.chargeRateOverride)),
      hoursPerWeek: Math.max(0, toNumber(base.hoursPerWeek, DEFAULT_INPUT.hoursPerWeek)),
      durationPreset: DURATION_PRESETS[base.durationPreset] ? base.durationPreset : DEFAULT_INPUT.durationPreset,
      customWeeks: Math.max(0.5, toNumber(base.customWeeks, DEFAULT_INPUT.customWeeks)),
      paymentTermsPreset: trimString(base.paymentTermsPreset) || DEFAULT_INPUT.paymentTermsPreset,
      customPaymentDays: Math.max(0, toNumber(base.customPaymentDays, DEFAULT_INPUT.customPaymentDays)),
      fundingAdvancePercent: clamp(toNumber(base.fundingAdvancePercent, DEFAULT_INPUT.fundingAdvancePercent), 0, 100),
      taxRatePercent: clamp(toNumber(base.taxRatePercent, DEFAULT_INPUT.taxRatePercent), 0, 100),
      weeklyOverhead: Math.max(0, toNumber(base.weeklyOverhead, DEFAULT_INPUT.weeklyOverhead)),
      annualDiscountFeePercent: Math.max(0, toNumber(base.annualDiscountFeePercent, DEFAULT_INPUT.annualDiscountFeePercent)),
      dailyInterestFeePercent: Math.max(0, toNumber(base.dailyInterestFeePercent, DEFAULT_INPUT.dailyInterestFeePercent)),
      showVat: Boolean(base.showVat),
      vatRatePercent: Math.max(0, toNumber(base.vatRatePercent, DEFAULT_INPUT.vatRatePercent)),
      notes: trimString(base.notes),
    };
    input.selectedDurationWeeks = resolveDurationWeeks(input);
    input.paymentDays = resolvePaymentDays(input);
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

  function calculatePeriod(input, config) {
    var chargeRate = resolveChargeRate(input);
    var impliedMarginPerHour = resolveImpliedMarginPerHour(input, chargeRate);
    var hoursPerWeek = input.hoursPerWeek * input.workerCount;
    var payRate = input.payRate;
    var invoiceValue = chargeRate * hoursPerWeek * config.weeks;
    var payCost = payRate * hoursPerWeek * config.weeks;
    var grossMargin = invoiceValue - payCost;
    var fundingAdvanceRate = input.fundingAdvancePercent / 100;
    var taxRate = input.taxRatePercent / 100;
    var annualDiscountRate = input.annualDiscountFeePercent / 100;
    var dailyInterestRate = input.dailyInterestFeePercent / 100;
    var fundedAmount = invoiceValue * fundingAdvanceRate;
    var reserveRetained = invoiceValue - fundedAmount;
    var discountFee = invoiceValue * annualDiscountRate * (config.daysOutstanding / 365);
    var interestFee = fundedAmount * dailyInterestRate * config.daysOutstanding;
    var totalFinanceCost = discountFee + interestFee;
    var overheads = input.weeklyOverhead * config.weeks;
    var profitBeforeTax = grossMargin - totalFinanceCost - overheads;
    var tax = Math.max(profitBeforeTax, 0) * taxRate;
    var netProfit = profitBeforeTax - tax;
    var netCashReleased = fundedAmount - totalFinanceCost;
    var vatAmount = input.showVat ? invoiceValue * (input.vatRatePercent / 100) : 0;

    return {
      key: config.key,
      label: config.label,
      weeks: round(config.weeks, 4),
      daysOutstanding: round(config.daysOutstanding, 2),
      workerCount: input.workerCount,
      payRate: round(payRate, 4),
      chargeRate: round(chargeRate, 4),
      impliedMarginPerHour: round(impliedMarginPerHour, 4),
      productiveHours: round(hoursPerWeek * config.weeks, 2),
      weeklyHours: round(hoursPerWeek, 2),
      revenue: round(invoiceValue, 2),
      payCost: round(payCost, 2),
      grossMargin: round(grossMargin, 2),
      fundedAmount: round(fundedAmount, 2),
      reserveRetained: round(reserveRetained, 2),
      discountFee: round(discountFee, 2),
      interestFee: round(interestFee, 2),
      totalFinanceCost: round(totalFinanceCost, 2),
      overheads: round(overheads, 2),
      profitBeforeTax: round(profitBeforeTax, 2),
      tax: round(tax, 2),
      netProfit: round(netProfit, 2),
      netCashReleased: round(netCashReleased, 2),
      vatAmount: round(vatAmount, 2),
    };
  }

  function buildPeriods(input) {
    var selectedWeeks = input.selectedDurationWeeks;
    var daysOutstanding = input.paymentDays;
    var periods = [
      calculatePeriod(input, { key: 'week', label: 'Per week', weeks: 1, daysOutstanding: daysOutstanding }),
      calculatePeriod(input, { key: 'month', label: '1 month', weeks: WEEKS_PER_MONTH, daysOutstanding: daysOutstanding }),
      calculatePeriod(input, { key: 'quarter', label: '3 months', weeks: 13, daysOutstanding: daysOutstanding }),
      calculatePeriod(input, { key: 'half_year', label: '6 months', weeks: 26, daysOutstanding: daysOutstanding }),
    ];

    if (input.durationPreset === 'custom') {
      periods.push(calculatePeriod(input, {
        key: 'selected',
        label: 'Selected contract',
        weeks: selectedWeeks,
        daysOutstanding: daysOutstanding,
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
    if (input.paymentDays > 45) {
      warnings.push({
        tone: 'warn',
        text: 'Extended payment terms materially increase discounting and daily interest cost.',
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
      next.customPaymentDays = input.paymentDays + 15;
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

  return {
    DEFAULT_INPUT: DEFAULT_INPUT,
    DURATION_PRESETS: DURATION_PRESETS,
    normaliseInput: normaliseInput,
    resolveChargeRate: resolveChargeRate,
    resolvePaymentDays: resolvePaymentDays,
    resolveDurationWeeks: resolveDurationWeeks,
    calculatePeriod: calculatePeriod,
    calculateDealProfit: calculateDealProfit,
    buildScenarioComparison: buildScenarioComparison,
  };
}));
