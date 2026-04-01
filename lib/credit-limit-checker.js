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

  const COMPANY_STRUCTURE_OPTIONS = [
    { value: 'sole_trader', label: 'Sole trader', multiplier: 0.68 },
    { value: 'partnership', label: 'Partnership / LLP', multiplier: 0.82 },
    { value: 'ltd', label: 'Limited company', multiplier: 1 },
    { value: 'group', label: 'Subsidiary / group-backed company', multiplier: 1.08 },
    { value: 'plc', label: 'PLC / quoted company', multiplier: 1.14 },
  ];

  const PAYMENT_TERMS_OPTIONS = [
    { value: 'up_to_30', label: 'Up to 30 days', multiplier: 1 },
    { value: '31_45', label: '31 to 45 days', multiplier: 0.94 },
    { value: '46_60', label: '46 to 60 days', multiplier: 0.85 },
    { value: '61_90', label: '61 to 90 days', multiplier: 0.72 },
    { value: 'gt90', label: 'Over 90 days', multiplier: 0.58 },
  ];

  const ACCOUNTS_STATUS_OPTIONS = [
    { value: 'strong', label: 'Profitable and balance sheet looks strong', multiplier: 1.12 },
    { value: 'stable', label: 'Trading steadily / around break-even', multiplier: 1 },
    { value: 'mixed', label: 'Margins under pressure or balance sheet is thin', multiplier: 0.84 },
    { value: 'pressured', label: 'Recent losses or cash-flow pressure', multiplier: 0.68 },
  ];

  const LEAD_STATUSES = [
    { value: 'new', label: 'New' },
    { value: 'contacted', label: 'Contacted' },
    { value: 'qualified', label: 'Qualified' },
    { value: 'closed', label: 'Closed' },
  ];

  const LEGACY_WIDGET_INTRO = 'Three quick business questions and a contact email give a realistic trade-credit range for follow-up.';
  const LEGACY_PAGE_INTRO = 'Answer three quick commercial questions and leave your contact details to see a realistic indicative range. HMJ can then sense-check the opportunity against live underwriter appetite.';
  const LEGACY_PAGE_DISCLAIMER = 'Indicative only. This is a lead-screening estimate based on turnover, trading history and sector appetite, not a formal bureau or insurer decision.';

  const DEFAULT_CREDIT_CHECKER_SETTINGS = {
    enabled: true,
    widgetEnabled: true,
    widgetEyebrow: 'Finance tool',
    widgetTitle: 'Indicative credit check',
    widgetIntro: 'A short commercial profile and contact email give a sensible indicative range for trade-credit follow-up.',
    widgetButtonLabel: 'Check indicative limit',
    pageHeading: 'Indicative Credit Limit Checker',
    pageIntro: 'Answer a few short commercial questions and leave your contact details to see a sensible indicative range. HMJ can then sense-check the opportunity against live underwriter appetite.',
    pageDisclaimer: 'Indicative only. We use the information you provide alongside HMJ commercial criteria to estimate a sensible starting range. Final terms remain subject to review and underwriter approval.',
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
      companyStructureMultipliers: COMPANY_STRUCTURE_OPTIONS.reduce(function (acc, item) {
        acc[item.value] = item.multiplier;
        return acc;
      }, {}),
      paymentTermsMultipliers: PAYMENT_TERMS_OPTIONS.reduce(function (acc, item) {
        acc[item.value] = item.multiplier;
        return acc;
      }, {}),
      accountsStatusMultipliers: ACCOUNTS_STATUS_OPTIONS.reduce(function (acc, item) {
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

  function upgradeLegacyCopy(value, maxLength, legacyValue, nextDefault) {
    const text = trimString(value, maxLength);
    if (!text) return nextDefault;
    return text === legacyValue ? nextDefault : text;
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
      widgetIntro: upgradeLegacyCopy(source.widgetIntro, 320, LEGACY_WIDGET_INTRO, defaults.widgetIntro),
      widgetButtonLabel: trimString(source.widgetButtonLabel, 80) || defaults.widgetButtonLabel,
      pageHeading: trimString(source.pageHeading, 120) || defaults.pageHeading,
      pageIntro: upgradeLegacyCopy(source.pageIntro, 420, LEGACY_PAGE_INTRO, defaults.pageIntro),
      pageDisclaimer: upgradeLegacyCopy(source.pageDisclaimer, 420, LEGACY_PAGE_DISCLAIMER, defaults.pageDisclaimer),
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
    next.calculator.companyStructureMultipliers = mergeKeyedNumbers(
      defaults.calculator.companyStructureMultipliers,
      rawCalculator.companyStructureMultipliers,
      COMPANY_STRUCTURE_OPTIONS.map(function (item) { return item.value; }),
      { min: 0.1, max: 2, fallback: 1 }
    );
    next.calculator.paymentTermsMultipliers = mergeKeyedNumbers(
      defaults.calculator.paymentTermsMultipliers,
      rawCalculator.paymentTermsMultipliers,
      PAYMENT_TERMS_OPTIONS.map(function (item) { return item.value; }),
      { min: 0.1, max: 2, fallback: 1 }
    );
    next.calculator.accountsStatusMultipliers = mergeKeyedNumbers(
      defaults.calculator.accountsStatusMultipliers,
      rawCalculator.accountsStatusMultipliers,
      ACCOUNTS_STATUS_OPTIONS.map(function (item) { return item.value; }),
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
      companyStructure: trimString(
        input.company_structure != null
          ? input.company_structure
          : input.companyStructure,
        40
      ),
      paymentTermsBand: trimString(
        input.payment_terms_band != null
          ? input.payment_terms_band
          : (input.paymentTermsBand != null ? input.paymentTermsBand : input.payment_terms),
        40
      ),
      accountsStatus: trimString(
        input.accounts_status != null
          ? input.accounts_status
          : (input.accountsStatus != null ? input.accountsStatus : input.accounts),
        40
      ),
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
    if (!safeSettings.calculator.companyStructureMultipliers[input.companyStructure]) errors.push('Please choose the business structure.');
    if (!safeSettings.calculator.paymentTermsMultipliers[input.paymentTermsBand]) errors.push('Please choose the payment terms you need.');
    if (!safeSettings.calculator.accountsStatusMultipliers[input.accountsStatus]) errors.push('Please choose the latest accounts position.');
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
    const structureLabelMap = optionMap(COMPANY_STRUCTURE_OPTIONS, 'label');
    const paymentTermsLabelMap = optionMap(PAYMENT_TERMS_OPTIONS, 'label');
    const accountsLabelMap = optionMap(ACCOUNTS_STATUS_OPTIONS, 'label');
    const yearsLabelMap = optionMap(YEARS_TRADING_BANDS, 'label');
    const sectorLabel = sectorLabelMap[input.sector] || 'Selected sector';
    const structureLabel = structureLabelMap[input.companyStructure] || 'selected structure';
    const paymentTermsLabel = paymentTermsLabelMap[input.paymentTermsBand] || 'selected terms';
    const accountsLabel = accountsLabelMap[input.accountsStatus] || 'selected accounts profile';
    const yearsLabel = yearsLabelMap[input.yearsTradingBand] || 'current trading history';
    if (result.band === 'strong') {
      return 'A stronger starting range looks sensible here: ' + sectorLabel + ' business, ' + yearsLabel + ', ' + structureLabel + ', ' + accountsLabel + ', and ' + paymentTermsLabel + ' terms. Final appetite remains subject to live review and underwriter approval.';
    }
    if (result.band === 'standard') {
      return 'This profile supports a workable starting range based on ' + sectorLabel + ', ' + yearsLabel + ', ' + structureLabel + ', and ' + paymentTermsLabel + ' terms. Final appetite can still move with accounts strength, debtor spread and wider group support.';
    }
    return 'This profile points to a more cautious starting range at first review, particularly with ' + paymentTermsLabel + ' terms and the current accounts position (' + accountsLabel + '). HMJ can sense-check the fuller trading picture before discussing formal terms.';
  }

  function calculateIndicativeLimit(input, settings) {
    const safeSettings = normaliseSettings(settings);
    const safeInput = normalisePublicSubmission(input);
    const turnoverMidpoint = safeSettings.calculator.turnoverBandMidpoints[safeInput.turnoverBand];
    const yearsMultiplier = safeSettings.calculator.yearsTradingMultipliers[safeInput.yearsTradingBand];
    const sectorMultiplier = safeSettings.calculator.sectorMultipliers[safeInput.sector];
    const companyStructureMultiplier = safeSettings.calculator.companyStructureMultipliers[safeInput.companyStructure];
    const paymentTermsMultiplier = safeSettings.calculator.paymentTermsMultipliers[safeInput.paymentTermsBand];
    const accountsStatusMultiplier = safeSettings.calculator.accountsStatusMultipliers[safeInput.accountsStatus];

    if (
      !turnoverMidpoint ||
      !yearsMultiplier ||
      !sectorMultiplier ||
      !companyStructureMultiplier ||
      !paymentTermsMultiplier ||
      !accountsStatusMultiplier
    ) {
      return null;
    }

    const baseExposure = turnoverMidpoint * safeSettings.calculator.baseRatio;
    const compositeMultiplier =
      yearsMultiplier *
      sectorMultiplier *
      companyStructureMultiplier *
      paymentTermsMultiplier *
      accountsStatusMultiplier;
    const rawIndicative = baseExposure * compositeMultiplier;
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
        companyStructureMultiplier,
        paymentTermsMultiplier,
        accountsStatusMultiplier,
        compositeMultiplier,
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
    COMPANY_STRUCTURE_OPTIONS,
    PAYMENT_TERMS_OPTIONS,
    ACCOUNTS_STATUS_OPTIONS,
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
