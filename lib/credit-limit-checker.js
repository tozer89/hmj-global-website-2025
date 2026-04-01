(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HMJCreditLimitChecker = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TURNOVER_BANDS = [
    { value: 'lt500k', label: 'Under GBP 500k', midpoint: 250000 },
    { value: '500k_2m', label: 'GBP 500k to GBP 2m', midpoint: 1250000 },
    { value: '2m_5m', label: 'GBP 2m to GBP 5m', midpoint: 3500000 },
    { value: '5m_15m', label: 'GBP 5m to GBP 15m', midpoint: 10000000 },
    { value: '15m_50m', label: 'GBP 15m to GBP 50m', midpoint: 32500000 },
    { value: 'gt50m', label: 'Over GBP 50m', midpoint: 75000000 },
  ];

  const YEARS_TRADING_BANDS = [
    { value: 'lt2', label: 'Less than 2 years', multiplier: 0.38 },
    { value: '2_5', label: '2 to 5 years', multiplier: 0.62 },
    { value: '5_10', label: '5 to 10 years', multiplier: 0.88 },
    { value: 'gt10', label: 'Over 10 years', multiplier: 1.1 },
  ];

  const SECTOR_OPTIONS = [
    { value: 'data_centre', label: 'Data Centre / Technology', multiplier: 1.15 },
    { value: 'pharma', label: 'Pharmaceutical / Life Sciences', multiplier: 1.1 },
    { value: 'professional', label: 'Professional Services', multiplier: 1.05 },
    { value: 'manufacturing', label: 'Manufacturing / Engineering', multiplier: 0.92 },
    { value: 'logistics', label: 'Logistics / Distribution', multiplier: 0.85 },
    { value: 'construction', label: 'Construction / Infrastructure', multiplier: 0.78 },
    { value: 'retail', label: 'Retail / E-commerce', multiplier: 0.72 },
    { value: 'hospitality', label: 'Hospitality / Leisure', multiplier: 0.62 },
    { value: 'other', label: 'Other', multiplier: 0.82 },
  ];

  const LEAD_STATUSES = [
    { value: 'new', label: 'New' },
    { value: 'contacted', label: 'Contacted' },
    { value: 'qualified', label: 'Qualified' },
    { value: 'closed', label: 'Closed' },
  ];

  const DEFAULT_CREDIT_CHECKER_SETTINGS = {
    enabled: true,
    widgetEnabled: true,
    widgetEyebrow: 'Finance tool',
    widgetTitle: 'Indicative credit check',
    widgetIntro: 'Three quick business questions and a contact email give a realistic trade-credit range for follow-up.',
    widgetButtonLabel: 'Check indicative limit',
    pageHeading: 'Indicative Credit Limit Checker',
    pageIntro: 'Answer three quick commercial questions and leave your contact details to see a realistic indicative range. HMJ can then sense-check the opportunity against live underwriter appetite.',
    pageDisclaimer: 'Indicative only. This is a lead-screening estimate based on turnover, trading history and sector appetite, not a formal bureau or insurer decision.',
    thankYouMessage: 'HMJ can now review this against live insurer appetite and your broader trading profile before discussing formal terms.',
    notificationRecipients: ['accounts@hmj-global.com', 'info@hmj-global.com'],
    calculator: {
      baseRatio: 0.012,
      roundStep: 2500,
      minLimit: 2500,
      maxMidLimit: 200000,
      maxHighLimit: 250000,
      lowSpread: 0.72,
      highSpread: 1.32,
      turnoverBandMidpoints: TURNOVER_BANDS.reduce(function (acc, item) {
        acc[item.value] = item.midpoint;
        return acc;
      }, {}),
      yearsTradingMultipliers: YEARS_TRADING_BANDS.reduce(function (acc, item) {
        acc[item.value] = item.multiplier;
        return acc;
      }, {}),
      sectorMultipliers: SECTOR_OPTIONS.reduce(function (acc, item) {
        acc[item.value] = item.multiplier;
        return acc;
      }, {}),
    },
  };

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function trimString(value, maxLength) {
    const text = typeof value === 'string'
      ? value.trim()
      : String(value == null ? '' : value).trim();
    if (!text) return '';
    if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
    return text.slice(0, maxLength);
  }

  function lowerEmail(value) {
    const email = trimString(value, 320).toLowerCase();
    return email || '';
  }

  function toNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clampNumber(value, min, max, fallback) {
    const number = toNumber(value, fallback);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function toBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const text = trimString(value, 40).toLowerCase();
    if (!text) return !!fallback;
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return !!fallback;
  }

  function roundToStep(value, step) {
    const safeStep = Math.max(Number(step) || 0, 1);
    return Math.round((Number(value) || 0) / safeStep) * safeStep;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lowerEmail(value));
  }

  function formatCurrency(value, currency) {
    const amount = Number(value || 0);
    const code = String(currency || 'GBP').toUpperCase() === 'EUR' ? 'EUR' : 'GBP';
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  function optionMap(list, field) {
    return list.reduce(function (acc, item) {
      acc[item.value] = item[field];
      return acc;
    }, {});
  }

  function normaliseRecipients(value) {
    const list = Array.isArray(value)
      ? value
      : trimString(value, 4000).split(',');

    return Array.from(new Set(
      list
        .map(function (entry) { return lowerEmail(entry); })
        .filter(isValidEmail)
    ));
  }

  function mergeKeyedNumbers(base, input, validKeys, options) {
    const next = {};
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const min = options && Number.isFinite(options.min) ? options.min : -Infinity;
    const max = options && Number.isFinite(options.max) ? options.max : Infinity;
    const fallback = options && Number.isFinite(options.fallback) ? options.fallback : 0;

    validKeys.forEach(function (key) {
      next[key] = clampNumber(source[key], min, max, base[key] != null ? base[key] : fallback);
    });
    return next;
  }

  function normaliseSettings(input) {
    const defaults = cloneJson(DEFAULT_CREDIT_CHECKER_SETTINGS);
    const source = input && typeof input === 'object' ? input : {};
    const next = {
      ...defaults,
      enabled: toBoolean(source.enabled, defaults.enabled),
      widgetEnabled: toBoolean(source.widgetEnabled, defaults.widgetEnabled),
      widgetEyebrow: trimString(source.widgetEyebrow, 80) || defaults.widgetEyebrow,
      widgetTitle: trimString(source.widgetTitle, 120) || defaults.widgetTitle,
      widgetIntro: trimString(source.widgetIntro, 320) || defaults.widgetIntro,
      widgetButtonLabel: trimString(source.widgetButtonLabel, 80) || defaults.widgetButtonLabel,
      pageHeading: trimString(source.pageHeading, 120) || defaults.pageHeading,
      pageIntro: trimString(source.pageIntro, 420) || defaults.pageIntro,
      pageDisclaimer: trimString(source.pageDisclaimer, 420) || defaults.pageDisclaimer,
      thankYouMessage: trimString(source.thankYouMessage, 320) || defaults.thankYouMessage,
      notificationRecipients: normaliseRecipients(source.notificationRecipients),
      calculator: cloneJson(defaults.calculator),
    };

    if (!next.notificationRecipients.length) {
      next.notificationRecipients = cloneJson(defaults.notificationRecipients);
    }

    const rawCalculator = source.calculator && typeof source.calculator === 'object' ? source.calculator : {};
    next.calculator.baseRatio = clampNumber(rawCalculator.baseRatio, 0.001, 0.05, defaults.calculator.baseRatio);
    next.calculator.roundStep = clampNumber(rawCalculator.roundStep, 500, 25000, defaults.calculator.roundStep);
    next.calculator.minLimit = clampNumber(rawCalculator.minLimit, 1000, 100000, defaults.calculator.minLimit);
    next.calculator.maxMidLimit = clampNumber(rawCalculator.maxMidLimit, next.calculator.minLimit, 1000000, defaults.calculator.maxMidLimit);
    next.calculator.maxHighLimit = clampNumber(rawCalculator.maxHighLimit, next.calculator.maxMidLimit, 1500000, defaults.calculator.maxHighLimit);
    next.calculator.lowSpread = clampNumber(rawCalculator.lowSpread, 0.3, 1, defaults.calculator.lowSpread);
    next.calculator.highSpread = clampNumber(rawCalculator.highSpread, 1, 2.5, defaults.calculator.highSpread);
    next.calculator.turnoverBandMidpoints = mergeKeyedNumbers(
      defaults.calculator.turnoverBandMidpoints,
      rawCalculator.turnoverBandMidpoints,
      TURNOVER_BANDS.map(function (item) { return item.value; }),
      { min: 50000, max: 250000000, fallback: 0 }
    );
    next.calculator.yearsTradingMultipliers = mergeKeyedNumbers(
      defaults.calculator.yearsTradingMultipliers,
      rawCalculator.yearsTradingMultipliers,
      YEARS_TRADING_BANDS.map(function (item) { return item.value; }),
      { min: 0.1, max: 2, fallback: 1 }
    );
    next.calculator.sectorMultipliers = mergeKeyedNumbers(
      defaults.calculator.sectorMultipliers,
      rawCalculator.sectorMultipliers,
      SECTOR_OPTIONS.map(function (item) { return item.value; }),
      { min: 0.1, max: 2, fallback: 1 }
    );

    return next;
  }

  function normalisePublicSubmission(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    return {
      fullName: trimString(input.full_name != null ? input.full_name : input.fullName, 120),
      companyName: trimString(
        input.company_name != null
          ? input.company_name
          : (input.companyName != null ? input.companyName : input.company),
        160
      ),
      email: lowerEmail(input.email),
      phone: trimString(input.phone, 40),
      turnoverBand: trimString(input.turnover_band != null ? input.turnover_band : input.turnoverBand, 40),
      yearsTradingBand: trimString(
        input.years_trading_band != null
          ? input.years_trading_band
          : (input.yearsTradingBand != null ? input.yearsTradingBand : input.years),
        40
      ),
      sector: trimString(input.sector, 40),
      consentConfirmed: toBoolean(
        input.consent_confirmed != null ? input.consent_confirmed : input.consentConfirmed,
        false
      ),
      sourcePage: trimString(input.source_page != null ? input.source_page : input.sourcePage, 240),
      sourceContext: trimString(input.source_context != null ? input.source_context : input.sourceContext, 120),
      website: trimString(input.website, 120),
    };
  }

  function validatePublicSubmission(input, settings) {
    const safeSettings = normaliseSettings(settings);
    const errors = [];
    if (!trimString(input.fullName, 120)) errors.push('Please enter your name.');
    if (!trimString(input.companyName, 160)) errors.push('Please enter your company name.');
    if (!isValidEmail(input.email)) errors.push('Please enter a valid email address.');
    if (!safeSettings.calculator.turnoverBandMidpoints[input.turnoverBand]) errors.push('Please choose an annual turnover band.');
    if (!safeSettings.calculator.yearsTradingMultipliers[input.yearsTradingBand]) errors.push('Please choose how long the business has traded.');
    if (!safeSettings.calculator.sectorMultipliers[input.sector]) errors.push('Please choose the closest sector.');
    if (!input.consentConfirmed) errors.push('Please confirm that HMJ may contact you about this indicative check.');
    if (trimString(input.website, 120)) errors.push('Spam check failed.');
    return errors;
  }

  function creditBandForMid(mid) {
    if (mid >= 100000) return 'strong';
    if (mid >= 30000) return 'standard';
    return 'starter';
  }

  function bandNarrative(input, result) {
    const sectorLabelMap = optionMap(SECTOR_OPTIONS, 'label');
    const sectorLabel = sectorLabelMap[input.sector] || 'Selected sector';
    if (result.band === 'strong') {
      return sectorLabel + ' profile with established trading history supports a stronger indicative range, subject to live underwriter review.';
    }
    if (result.band === 'standard') {
      return sectorLabel + ' profile supports a workable indicative range, with final appetite likely shaped by accounts, debtor quality and requested terms.';
    }
    return sectorLabel + ' profile points to a more cautious starting range until underwriters can review the fuller trading picture.';
  }

  function calculateIndicativeLimit(input, settings) {
    const safeSettings = normaliseSettings(settings);
    const safeInput = normalisePublicSubmission(input);
    const turnoverMidpoint = safeSettings.calculator.turnoverBandMidpoints[safeInput.turnoverBand];
    const yearsMultiplier = safeSettings.calculator.yearsTradingMultipliers[safeInput.yearsTradingBand];
    const sectorMultiplier = safeSettings.calculator.sectorMultipliers[safeInput.sector];

    if (!turnoverMidpoint || !yearsMultiplier || !sectorMultiplier) {
      return null;
    }

    const baseExposure = turnoverMidpoint * safeSettings.calculator.baseRatio;
    const rawIndicative = baseExposure * yearsMultiplier * sectorMultiplier;
    const mid = clampNumber(
      roundToStep(rawIndicative, safeSettings.calculator.roundStep),
      safeSettings.calculator.minLimit,
      safeSettings.calculator.maxMidLimit,
      safeSettings.calculator.minLimit
    );
    const low = clampNumber(
      roundToStep(mid * safeSettings.calculator.lowSpread, safeSettings.calculator.roundStep),
      safeSettings.calculator.minLimit,
      safeSettings.calculator.maxHighLimit,
      safeSettings.calculator.minLimit
    );
    const high = clampNumber(
      roundToStep(mid * safeSettings.calculator.highSpread, safeSettings.calculator.roundStep),
      mid,
      safeSettings.calculator.maxHighLimit,
      mid
    );

    const result = {
      low,
      mid,
      high,
      lowLabel: formatCurrency(low, 'GBP'),
      midLabel: formatCurrency(mid, 'GBP'),
      highLabel: formatCurrency(high, 'GBP'),
      rangeLabel: formatCurrency(low, 'GBP') + ' to ' + formatCurrency(high, 'GBP'),
      band: creditBandForMid(mid),
      narrative: '',
      disclaimer: safeSettings.pageDisclaimer,
      breakdown: {
        turnoverMidpoint,
        baseRatio: safeSettings.calculator.baseRatio,
        baseExposure,
        yearsMultiplier,
        sectorMultiplier,
        rawIndicative,
      },
    };
    result.narrative = bandNarrative(safeInput, result);
    return result;
  }

  function buildLeadReference(nowValue) {
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue || Date.now());
    const stamp = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      String(now.getUTCDate()).padStart(2, '0'),
    ].join('');
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return 'CCK-' + stamp + '-' + random;
  }

  function publicWidgetSettings(settings) {
    const safe = normaliseSettings(settings);
    return {
      enabled: safe.enabled,
      widgetEnabled: safe.enabled && safe.widgetEnabled,
      eyebrow: safe.widgetEyebrow,
      title: safe.widgetTitle,
      intro: safe.widgetIntro,
      buttonLabel: safe.widgetButtonLabel,
      pageHeading: safe.pageHeading,
      pageIntro: safe.pageIntro,
      pageDisclaimer: safe.pageDisclaimer,
      thankYouMessage: safe.thankYouMessage,
      href: '/credit-check',
    };
  }

  return {
    TURNOVER_BANDS,
    YEARS_TRADING_BANDS,
    SECTOR_OPTIONS,
    LEAD_STATUSES,
    DEFAULT_CREDIT_CHECKER_SETTINGS,
    buildLeadReference,
    calculateIndicativeLimit,
    formatCurrency,
    isValidEmail,
    lowerEmail,
    normalisePublicSubmission,
    normaliseRecipients,
    normaliseSettings,
    publicWidgetSettings,
    trimString,
    validatePublicSubmission,
  };
});
