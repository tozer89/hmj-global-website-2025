const { randomUUID } = require('node:crypto');
const { slugify, isMissingTableError } = require('./_jobs-helpers.js');

const RATE_BOOK_ROLE_TABLE = 'rate_book_roles';
const RATE_BOOK_MARKET_TABLE = 'rate_book_markets';
const RATE_BOOK_RATE_TABLE = 'rate_book_rates';
const RATE_BOOK_SETTINGS_TABLE = 'rate_book_settings';
const RATE_BOOK_AUDIT_TABLE = 'rate_book_audit_log';
const MAX_SLUG_LENGTH = 96;
const DEFAULT_DISPLAY_ORDER = 100;

const DEFAULT_RATE_BOOK_SETTINGS = Object.freeze({
  publicEnabled: true,
  marginLowThreshold: 34,
  marginLowAdd: 3.5,
  marginHighThreshold: 35,
  marginHighAdd: 5,
  otherCurrencyMessage: 'Other currencies by discussion',
  publicDisclaimer: 'These figures are indicative commercial guide rates and may vary based on market conditions, shift pattern, overtime structure, local compliance, travel, lodge, accommodation and project complexity.',
  ctaLabel: 'Request tailored rates',
  ctaUrl: '/clients#clientFormTitle',
});

const DEFAULT_RATE_BOOK_MARKETS = Object.freeze([
  { code: 'UK', name: 'UK', currency: 'GBP', displayOrder: 10 },
  { code: 'IE', name: 'Ireland', currency: 'EUR', displayOrder: 20 },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', displayOrder: 30 },
  { code: 'DE', name: 'Germany', currency: 'EUR', displayOrder: 40 },
  { code: 'SE', name: 'Sweden', currency: 'EUR', displayOrder: 50 },
]);

const FEATURED_ROLE_NAMES = new Set([
  'Electrician',
  'Mechanical Fitter',
  'BMS Engineer',
  'Commissioning Engineer',
  'QA/QC Engineer',
  'Health & Safety Manager',
  'Planner',
  'Quantity Surveyor',
  'Project Manager',
  'Senior Project Manager',
  'MEP Manager',
  'Project Director',
]);

const PHARMA_FOCUS_ROLE_NAMES = new Set([
  'Mechanical Fitter',
  'Pipefitter',
  'HVAC Duct Fitter',
  'Plumber / Mechanical Technician',
  'BMS Technician',
  'BMS Engineer',
  'QA/QC Inspector',
  'QA/QC Engineer',
  'QA/QC Manager',
  'Health & Safety Advisor',
  'Health & Safety Manager',
  'Commissioning Technician',
  'Commissioning Engineer',
  'Lead Commissioning Engineer',
  'Commissioning Manager',
  'Planner',
  'Senior Planner',
  'Document Controller',
  'BIM Coordinator',
  'BIM Manager',
  'Quantity Surveyor',
  'Senior Quantity Surveyor',
  'Commercial Manager',
  'Procurement Manager',
  'Package Manager - Electrical',
  'Package Manager - Mechanical',
  'Construction Manager',
  'Senior Construction Manager',
  'Project Engineer - Electrical',
  'Project Engineer - Mechanical',
  'Project Manager',
  'Senior Project Manager',
  'Project Director',
  'M&E Manager',
  'MEP Manager',
  'MEP Lead',
  'Cost Estimator',
  'Senior Cost Estimator',
  'Design Manager',
  'Operations Manager',
]);

const RAW_RATE_BOOK_LINES = `
Electrician | 34.00/37.50 | 37.40/42.40 | 35.70/40.70 | 35.02/40.02 | 36.72/41.72
Approved Electrician | 36.00/41.00 | 39.60/44.60 | 37.80/42.80 | 37.08/42.08 | 38.88/43.88
Electrical Improver | 24.00/27.50 | 26.40/29.90 | 25.20/28.70 | 24.72/28.22 | 25.92/29.42
General Operative | 18.00/21.50 | 19.80/23.30 | 18.90/22.40 | 18.54/22.04 | 19.44/22.94
Skilled Labourer | 20.00/23.50 | 22.00/25.50 | 21.00/24.50 | 20.60/24.10 | 21.60/25.10
Cable Puller | 22.00/25.50 | 24.20/27.70 | 23.10/26.60 | 22.66/26.16 | 23.76/27.26
Mechanical Fitter | 28.00/31.50 | 30.80/34.30 | 29.40/32.90 | 28.84/32.34 | 30.24/33.74
Pipefitter | 30.00/33.50 | 33.00/36.50 | 31.50/35.00 | 30.90/34.40 | 32.40/35.90
HVAC Duct Fitter | 29.00/32.50 | 31.90/35.40 | 30.45/33.95 | 29.87/33.37 | 31.32/34.82
Plumber / Mechanical Technician | 28.00/31.50 | 30.80/34.30 | 29.40/32.90 | 28.84/32.34 | 30.24/33.74
BMS Technician | 35.00/40.00 | 38.50/43.50 | 36.75/41.75 | 36.05/41.05 | 37.80/42.80
BMS Engineer | 40.00/45.00 | 44.00/49.00 | 42.00/47.00 | 41.20/46.20 | 43.20/48.20
QA/QC Inspector | 32.00/35.50 | 35.20/40.20 | 33.60/38.60 | 32.96/37.96 | 34.56/39.56
QA/QC Engineer | 38.00/43.00 | 41.80/46.80 | 39.90/44.90 | 39.14/44.14 | 41.04/46.04
QA/QC Manager | 48.00/53.00 | 52.80/57.80 | 50.40/55.40 | 49.44/54.44 | 51.84/56.84
Health & Safety Advisor | 34.00/37.50 | 37.40/42.40 | 35.70/40.70 | 35.02/40.02 | 36.72/41.72
Health & Safety Manager | 45.00/50.00 | 49.50/54.50 | 47.25/52.25 | 46.35/51.35 | 48.60/53.60
Commissioning Technician | 36.00/41.00 | 39.60/44.60 | 37.80/42.80 | 37.08/42.08 | 38.88/43.88
Commissioning Engineer | 45.00/50.00 | 49.50/54.50 | 47.25/52.25 | 46.35/51.35 | 48.60/53.60
Lead Commissioning Engineer | 52.00/57.00 | 57.20/62.20 | 54.60/59.60 | 53.56/58.56 | 56.16/61.16
Commissioning Manager | 60.00/65.00 | 66.00/71.00 | 63.00/68.00 | 61.80/66.80 | 64.80/69.80
CSA Engineer | 38.00/43.00 | 41.80/46.80 | 39.90/44.90 | 39.14/44.14 | 41.04/46.04
CSA Manager | 50.00/55.00 | 55.00/60.00 | 52.50/57.50 | 51.50/56.50 | 54.00/59.00
Site Engineer | 34.00/37.50 | 37.40/42.40 | 35.70/40.70 | 35.02/40.02 | 36.72/41.72
Setting Out Engineer | 35.00/40.00 | 38.50/43.50 | 36.75/41.75 | 36.05/41.05 | 37.80/42.80
Planner | 42.00/47.00 | 46.20/51.20 | 44.10/49.10 | 43.26/48.26 | 45.36/50.36
Senior Planner | 55.00/60.00 | 60.50/65.50 | 57.75/62.75 | 56.65/61.65 | 59.40/64.40
Document Controller | 26.00/29.50 | 28.60/32.10 | 27.30/30.80 | 26.78/30.28 | 28.08/31.58
BIM Coordinator | 35.00/40.00 | 38.50/43.50 | 36.75/41.75 | 36.05/41.05 | 37.80/42.80
BIM Manager | 48.00/53.00 | 52.80/57.80 | 50.40/55.40 | 49.44/54.44 | 51.84/56.84
Quantity Surveyor | 45.00/50.00 | 49.50/54.50 | 47.25/52.25 | 46.35/51.35 | 48.60/53.60
Senior Quantity Surveyor | 58.00/63.00 | 63.80/68.80 | 60.90/65.90 | 59.74/64.74 | 62.64/67.64
Commercial Manager | 65.00/70.00 | 71.50/76.50 | 68.25/73.25 | 66.95/71.95 | 70.20/75.20
Procurement Manager | 45.00/50.00 | 49.50/54.50 | 47.25/52.25 | 46.35/51.35 | 48.60/53.60
Package Manager - Electrical | 48.00/53.00 | 52.80/57.80 | 50.40/55.40 | 49.44/54.44 | 51.84/56.84
Package Manager - Mechanical | 48.00/53.00 | 52.80/57.80 | 50.40/55.40 | 49.44/54.44 | 51.84/56.84
Construction Manager | 55.00/60.00 | 60.50/65.50 | 57.75/62.75 | 56.65/61.65 | 59.40/64.40
Senior Construction Manager | 65.00/70.00 | 71.50/76.50 | 68.25/73.25 | 66.95/71.95 | 70.20/75.20
Project Engineer - Electrical | 40.00/45.00 | 44.00/49.00 | 42.00/47.00 | 41.20/46.20 | 43.20/48.20
Project Engineer - Mechanical | 40.00/45.00 | 44.00/49.00 | 42.00/47.00 | 41.20/46.20 | 43.20/48.20
Project Manager | 60.00/65.00 | 66.00/71.00 | 63.00/68.00 | 61.80/66.80 | 64.80/69.80
Senior Project Manager | 72.00/77.00 | 79.20/84.20 | 75.60/80.60 | 74.16/79.16 | 77.76/82.76
Project Director | 85.00/90.00 | 93.50/98.50 | 89.25/94.25 | 87.55/92.55 | 91.80/96.80
M&E Manager | 55.00/60.00 | 60.50/65.50 | 57.75/62.75 | 56.65/61.65 | 59.40/64.40
MEP Manager | 60.00/65.00 | 66.00/71.00 | 63.00/68.00 | 61.80/66.80 | 64.80/69.80
MEP Lead | 70.00/75.00 | 77.00/82.00 | 73.50/78.50 | 72.10/77.10 | 75.60/80.60
Cost Estimator | 42.00/47.00 | 46.20/51.20 | 44.10/49.10 | 43.26/48.26 | 45.36/50.36
Senior Cost Estimator | 55.00/60.00 | 60.50/65.50 | 57.75/62.75 | 56.65/61.65 | 59.40/64.40
Design Manager | 58.00/63.00 | 63.80/68.80 | 60.90/65.90 | 59.74/64.74 | 62.64/67.64
Operations Manager | 60.00/65.00 | 66.00/71.00 | 63.00/68.00 | 61.80/66.80 | 64.80/69.80
`.trim();

function asString(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asNullableString(value) {
  const text = asString(value);
  return text || null;
}

function asBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === '') return !!fallback;
  if (typeof value === 'string') return /^(1|true|yes|on)$/i.test(value.trim());
  return !!value;
}

function asInteger(value, fallback = DEFAULT_DISPLAY_ORDER) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asIsoTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function asArray(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => asString(item)).filter(Boolean)));
  }
  const text = asString(value);
  if (!text) return [];
  return Array.from(new Set(text.split(',').map((item) => item.trim()).filter(Boolean)));
}

function sanitiseUrl(value) {
  const raw = asString(value);
  if (!raw) return null;
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  if (raw.startsWith('#')) return raw;
  try {
    const parsed = new URL(raw);
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) return parsed.toString();
  } catch {}
  return null;
}

function normaliseRoleSlug(value, name) {
  const base = slugify(asString(value) || asString(name) || `rate-book-${randomUUID().slice(0, 8)}`);
  return base.slice(0, MAX_SLUG_LENGTH);
}

function validationError(message) {
  const error = new Error(message);
  error.code = 400;
  return error;
}

function determineDiscipline(name) {
  const label = asString(name);
  if (!label) return 'Project Delivery';
  if (/electrician|electrical|cable puller|bms/i.test(label)) return 'Electrical';
  if (/mechanical fitter|pipefitter|hvac duct fitter|plumber \/ mechanical technician/i.test(label)) return 'Mechanical';
  if (/qa\/qc|health\s*&\s*safety/i.test(label)) return 'HSE / Quality';
  if (/commissioning/i.test(label)) return 'Commissioning';
  if (/^csa |^csa$|site engineer|setting out engineer/i.test(label)) return 'CSA / Civils';
  if (/planner|document controller/i.test(label)) return 'Project Controls';
  if (/bim|design manager/i.test(label)) return 'BIM / Design';
  if (/quantity surveyor|commercial manager|procurement manager|cost estimator/i.test(label)) return 'Commercial';
  if (/general operative|skilled labourer|operations manager/i.test(label)) return 'Operations';
  return 'Project Delivery';
}

function determineSeniority(name) {
  const label = asString(name);
  if (/director/i.test(label)) return 'Director';
  if (/manager/i.test(label)) return 'Manager';
  if (/lead /i.test(label)) return 'Lead / Senior';
  if (/senior /i.test(label)) {
    if (/project manager|construction manager/i.test(label)) return 'Manager';
    return 'Lead / Senior';
  }
  if (/technician|inspector|document controller/i.test(label)) return 'Technician';
  if (/engineer|planner|quantity surveyor|cost estimator|advisor/i.test(label)) return 'Engineer';
  return 'Trades';
}

function determineSectors(name) {
  const label = asString(name);
  const sectors = ['Data centre', 'Mission critical', 'Engineering'];
  if (PHARMA_FOCUS_ROLE_NAMES.has(label) || /commissioning|qa\/qc|health\s*&\s*safety|bim|design|planner|quantity surveyor|commercial|procurement|project|m&e|mep/i.test(label)) {
    sectors.push('Pharma');
  }
  return Array.from(new Set(sectors));
}

function parseRateBookSeed() {
  const marketCodes = DEFAULT_RATE_BOOK_MARKETS.map((market) => market.code);
  return RAW_RATE_BOOK_LINES
    .split('\n')
    .map((line, index) => {
      const parts = line.split('|').map((chunk) => chunk.trim()).filter(Boolean);
      const name = asString(parts.shift());
      const rates = {};
      parts.forEach((entry, rateIndex) => {
        const [payRate, chargeRate] = String(entry).split('/').map((value) => Number(value));
        rates[marketCodes[rateIndex]] = {
          payRate,
          chargeRate,
          rateUnit: 'hour',
        };
      });
      return {
        slug: normaliseRoleSlug('', name),
        name,
        discipline: determineDiscipline(name),
        sector: determineSectors(name),
        seniority: determineSeniority(name),
        isActive: true,
        isPublic: true,
        displayOrder: (index + 1) * 10,
        notes: '',
        featured: FEATURED_ROLE_NAMES.has(name),
        rates,
      };
    });
}

const RATE_BOOK_SEED = Object.freeze({
  settings: { ...DEFAULT_RATE_BOOK_SETTINGS },
  markets: DEFAULT_RATE_BOOK_MARKETS.map((market) => ({ ...market, isActive: true })),
  roles: parseRateBookSeed(),
});

function getRateBookSeed() {
  return JSON.parse(JSON.stringify(RATE_BOOK_SEED));
}

function settingsFromRow(row = {}) {
  return {
    id: asString(row.id),
    publicEnabled: asBoolean(row.public_enabled ?? row.publicEnabled, DEFAULT_RATE_BOOK_SETTINGS.publicEnabled),
    marginLowThreshold: asNumber(row.margin_low_threshold ?? row.marginLowThreshold, DEFAULT_RATE_BOOK_SETTINGS.marginLowThreshold),
    marginLowAdd: asNumber(row.margin_low_add ?? row.marginLowAdd, DEFAULT_RATE_BOOK_SETTINGS.marginLowAdd),
    marginHighThreshold: asNumber(row.margin_high_threshold ?? row.marginHighThreshold, DEFAULT_RATE_BOOK_SETTINGS.marginHighThreshold),
    marginHighAdd: asNumber(row.margin_high_add ?? row.marginHighAdd, DEFAULT_RATE_BOOK_SETTINGS.marginHighAdd),
    otherCurrencyMessage: asString(row.other_currency_message ?? row.otherCurrencyMessage) || DEFAULT_RATE_BOOK_SETTINGS.otherCurrencyMessage,
    publicDisclaimer: asString(row.public_disclaimer ?? row.publicDisclaimer) || DEFAULT_RATE_BOOK_SETTINGS.publicDisclaimer,
    ctaLabel: asString(row.cta_label ?? row.ctaLabel) || DEFAULT_RATE_BOOK_SETTINGS.ctaLabel,
    ctaUrl: sanitiseUrl(row.cta_url ?? row.ctaUrl) || DEFAULT_RATE_BOOK_SETTINGS.ctaUrl,
    updatedAt: asIsoTimestamp(row.updated_at ?? row.updatedAt),
    updatedByEmail: asNullableString(row.updated_by_email ?? row.updatedByEmail),
  };
}

function calculateChargeFromPay(payRate, settings, currency) {
  const numericPay = asNumber(payRate, null);
  if (!Number.isFinite(numericPay)) return null;
  const money = asString(currency).toUpperCase();
  if (money && money !== 'GBP' && money !== 'EUR') return null;
  const safeSettings = {
    ...DEFAULT_RATE_BOOK_SETTINGS,
    ...(settings || {}),
  };
  const margin = numericPay >= safeSettings.marginHighThreshold
    ? safeSettings.marginHighAdd
    : safeSettings.marginLowAdd;
  return Number((numericPay + margin).toFixed(2));
}

function marketFromRow(row = {}) {
  return {
    id: asString(row.id),
    code: asString(row.code),
    name: asString(row.name),
    currency: asString(row.currency).toUpperCase(),
    isActive: asBoolean(row.is_active ?? row.isActive, true),
    displayOrder: asInteger(row.display_order ?? row.displayOrder, DEFAULT_DISPLAY_ORDER),
    createdAt: asIsoTimestamp(row.created_at ?? row.createdAt),
    updatedAt: asIsoTimestamp(row.updated_at ?? row.updatedAt),
  };
}

function roleFromRow(row = {}) {
  return {
    id: asString(row.id),
    slug: normaliseRoleSlug(row.slug, row.name),
    name: asString(row.name),
    discipline: asString(row.discipline),
    sector: asArray(row.sector),
    seniority: asString(row.seniority),
    isActive: asBoolean(row.is_active ?? row.isActive, true),
    isPublic: asBoolean(row.is_public ?? row.isPublic, true),
    displayOrder: asInteger(row.display_order ?? row.displayOrder, DEFAULT_DISPLAY_ORDER),
    notes: asString(row.notes),
    createdAt: asIsoTimestamp(row.created_at ?? row.createdAt),
    updatedAt: asIsoTimestamp(row.updated_at ?? row.updatedAt),
    createdByEmail: asNullableString(row.created_by_email ?? row.createdByEmail),
    updatedByEmail: asNullableString(row.updated_by_email ?? row.updatedByEmail),
  };
}

function rateFromRow(row = {}) {
  return {
    id: asString(row.id),
    roleId: asString(row.role_id ?? row.roleId),
    marketId: asString(row.market_id ?? row.marketId),
    payRate: asNumber(row.pay_rate ?? row.payRate, null),
    chargeRate: asNumber(row.charge_rate ?? row.chargeRate, null),
    rateUnit: asString(row.rate_unit ?? row.rateUnit) || 'hour',
    isFeatured: asBoolean(row.is_featured ?? row.isFeatured, false),
    isChargeOverridden: asBoolean(row.is_charge_overridden ?? row.isChargeOverridden, false),
    effectiveFrom: asIsoDate(row.effective_from ?? row.effectiveFrom),
    effectiveTo: asIsoDate(row.effective_to ?? row.effectiveTo),
    notes: asString(row.notes),
    createdAt: asIsoTimestamp(row.created_at ?? row.createdAt),
    updatedAt: asIsoTimestamp(row.updated_at ?? row.updatedAt),
    updatedByEmail: asNullableString(row.updated_by_email ?? row.updatedByEmail),
  };
}

function timestampMs(value) {
  const iso = asIsoTimestamp(value);
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateMs(value) {
  const iso = asIsoDate(value);
  if (!iso) return 0;
  const parsed = Date.parse(`${iso}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareRoles(left, right) {
  const leftOrder = asInteger(left.displayOrder, DEFAULT_DISPLAY_ORDER);
  const rightOrder = asInteger(right.displayOrder, DEFAULT_DISPLAY_ORDER);
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return asString(left.name).localeCompare(asString(right.name), 'en-GB', { sensitivity: 'base' });
}

function sortRateBookRoles(items = []) {
  return items.slice().sort(compareRoles);
}

function sortRateBookMarkets(items = []) {
  return items.slice().sort((left, right) => {
    const leftOrder = asInteger(left.displayOrder, DEFAULT_DISPLAY_ORDER);
    const rightOrder = asInteger(right.displayOrder, DEFAULT_DISPLAY_ORDER);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return asString(left.name).localeCompare(asString(right.name), 'en-GB', { sensitivity: 'base' });
  });
}

function pickCurrentRates(rows = [], referenceDate = new Date()) {
  const today = asIsoDate(referenceDate) || asIsoDate(new Date());
  const byKey = new Map();

  function comparePriority(left = [], right = []) {
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const leftValue = Number(left[index] || 0);
      const rightValue = Number(right[index] || 0);
      if (leftValue === rightValue) continue;
      return leftValue - rightValue;
    }
    return 0;
  }

  rows.forEach((row) => {
    const rate = rateFromRow(row);
    if (!rate.roleId || !rate.marketId) return;
    const key = `${rate.roleId}:${rate.marketId}`;
    const current = byKey.get(key);
    const startsBeforeToday = !rate.effectiveFrom || rate.effectiveFrom <= today;
    const endsAfterToday = !rate.effectiveTo || rate.effectiveTo >= today;
    const isActiveWindow = startsBeforeToday && endsAfterToday;
    const score = [
      isActiveWindow ? 3 : 0,
      startsBeforeToday ? 2 : 0,
      dateMs(rate.effectiveFrom),
      timestampMs(rate.updatedAt),
      timestampMs(rate.createdAt),
    ];
    if (!current || comparePriority(score, current.score) > 0) {
      byKey.set(key, { rate, score });
    }
  });

  return Array.from(byKey.values()).map((entry) => entry.rate);
}

function hydrateRateBook(roles = [], markets = [], rates = [], settings = {}, options = {}) {
  const safeSettings = { ...DEFAULT_RATE_BOOK_SETTINGS, ...(settings || {}) };
  const marketList = sortRateBookMarkets(markets.map(marketFromRow));
  const marketById = new Map(marketList.map((market) => [market.id, market]));
  const marketByCode = new Map(marketList.map((market) => [market.code, market]));
  const currentRates = pickCurrentRates(rates, options.referenceDate);
  const ratesByRoleId = new Map();

  currentRates.forEach((row) => {
    const market = marketById.get(row.marketId) || marketByCode.get(asString(row.marketCode));
    if (!market) return;
    const bucket = ratesByRoleId.get(row.roleId) || {};
    bucket[market.code] = {
      ...row,
      marketCode: market.code,
      marketName: market.name,
      currency: market.currency,
      displayOrder: market.displayOrder,
      calculatedChargeRate: calculateChargeFromPay(row.payRate, safeSettings, market.currency),
    };
    ratesByRoleId.set(row.roleId, bucket);
  });

  const roleList = sortRateBookRoles(roles.map(roleFromRow)).map((role) => {
    const ratesByMarket = ratesByRoleId.get(role.id) || {};
    const marketRates = marketList
      .map((market) => ratesByMarket[market.code])
      .filter(Boolean)
      .sort((left, right) => asInteger(left.displayOrder, DEFAULT_DISPLAY_ORDER) - asInteger(right.displayOrder, DEFAULT_DISPLAY_ORDER));
    const isFeatured = marketRates.some((item) => item.isFeatured);
    return {
      ...role,
      isFeatured,
      marketRates,
      ratesByMarket,
      currencies: Array.from(new Set(marketRates.map((item) => item.currency).filter(Boolean))),
      updatedAt: role.updatedAt || marketRates.reduce((latest, item) => (timestampMs(item.updatedAt) > timestampMs(latest) ? item.updatedAt : latest), ''),
      updatedByEmail: role.updatedByEmail || marketRates.find((item) => item.updatedByEmail)?.updatedByEmail || null,
    };
  });

  return {
    settings: safeSettings,
    markets: marketList,
    roles: roleList,
  };
}

function toPublicRateBookRole(role = {}) {
  const item = {
    id: asString(role.id),
    slug: asString(role.slug),
    name: asString(role.name),
    discipline: asString(role.discipline),
    sector: asArray(role.sector),
    seniority: asString(role.seniority),
    notes: asString(role.notes),
    isFeatured: asBoolean(role.isFeatured, false),
    updatedAt: asIsoTimestamp(role.updatedAt),
    marketRates: Array.isArray(role.marketRates)
      ? role.marketRates.map((rate) => ({
        marketCode: asString(rate.marketCode),
        marketName: asString(rate.marketName),
        currency: asString(rate.currency),
        payRate: asNumber(rate.payRate, null),
        chargeRate: asNumber(rate.chargeRate, null),
        calculatedChargeRate: asNumber(rate.calculatedChargeRate, null),
        rateUnit: asString(rate.rateUnit) || 'hour',
      }))
      : [],
  };
  return item;
}

function toPublicRateBook(payload = {}) {
  return {
    settings: settingsFromRow(payload.settings || DEFAULT_RATE_BOOK_SETTINGS),
    markets: sortRateBookMarkets((payload.markets || []).map(marketFromRow)).filter((market) => market.isActive),
    roles: sortRateBookRoles((payload.roles || []).map((role) => ({
      ...roleFromRow(role),
      marketRates: Array.isArray(role.marketRates) ? role.marketRates : [],
      isFeatured: asBoolean(role.isFeatured, false),
      updatedAt: asIsoTimestamp(role.updatedAt),
    })))
      .filter((role) => role.isActive && role.isPublic)
      .map(toPublicRateBookRole),
  };
}

function normaliseSettingsInput(input = {}, currentRow = {}) {
  const current = settingsFromRow(currentRow);
  const next = {
    id: asNullableString(input.id || current.id),
    public_enabled: asBoolean(input.publicEnabled ?? input.public_enabled, current.publicEnabled),
    margin_low_threshold: asNumber(input.marginLowThreshold ?? input.margin_low_threshold, current.marginLowThreshold),
    margin_low_add: asNumber(input.marginLowAdd ?? input.margin_low_add, current.marginLowAdd),
    margin_high_threshold: asNumber(input.marginHighThreshold ?? input.margin_high_threshold, current.marginHighThreshold),
    margin_high_add: asNumber(input.marginHighAdd ?? input.margin_high_add, current.marginHighAdd),
    other_currency_message: asString(input.otherCurrencyMessage ?? input.other_currency_message) || current.otherCurrencyMessage,
    public_disclaimer: asString(input.publicDisclaimer ?? input.public_disclaimer) || current.publicDisclaimer,
    cta_label: asString(input.ctaLabel ?? input.cta_label) || current.ctaLabel,
    cta_url: sanitiseUrl(input.ctaUrl ?? input.cta_url) || current.ctaUrl,
    updated_at: new Date().toISOString(),
    updated_by_email: asNullableString(input.updatedByEmail ?? input.updated_by_email ?? current.updatedByEmail),
  };

  if (next.margin_low_threshold === null || next.margin_high_threshold === null) {
    throw validationError('Both margin thresholds are required.');
  }
  if (next.margin_low_add === null || next.margin_high_add === null) {
    throw validationError('Both margin additions are required.');
  }
  if (!next.public_disclaimer) throw validationError('A public disclaimer is required.');
  if (!next.cta_label) throw validationError('A CTA label is required.');
  if (!next.cta_url) throw validationError('A CTA URL is required.');

  return next;
}

function normaliseRoleInput(input = {}, user) {
  const name = asString(input.name);
  if (!name) throw validationError('Role name is required.');
  const discipline = asString(input.discipline) || determineDiscipline(name);
  const seniority = asString(input.seniority) || determineSeniority(name);

  return {
    id: asNullableString(input.id),
    slug: normaliseRoleSlug(input.slug, name),
    name,
    discipline,
    sector: asArray(input.sector).length ? asArray(input.sector) : determineSectors(name),
    seniority,
    is_active: asBoolean(input.isActive ?? input.is_active, true),
    is_public: asBoolean(input.isPublic ?? input.is_public, true),
    display_order: Math.max(0, asInteger(input.displayOrder ?? input.display_order, DEFAULT_DISPLAY_ORDER)),
    notes: asNullableString(input.notes),
    updated_at: new Date().toISOString(),
    updated_by_email: asNullableString(user?.email || input.updatedByEmail || input.updated_by_email),
  };
}

function normaliseRateInput(input = {}, markets = [], settings = {}, user) {
  const marketByCode = new Map(markets.map((market) => [market.code, market]));
  const marketCode = asString(input.marketCode ?? input.market_code);
  const market = marketByCode.get(marketCode);
  if (!market) throw validationError(`Unknown market "${marketCode || 'n/a'}".`);
  const payRate = asNumber(input.payRate ?? input.pay_rate, null);
  const suppliedChargeRate = asNumber(input.chargeRate ?? input.charge_rate, null);
  const isChargeOverridden = asBoolean(input.isChargeOverridden ?? input.is_charge_overridden, false);
  const calculatedChargeRate = calculateChargeFromPay(payRate, settings, market.currency);
  const chargeRate = isChargeOverridden
    ? suppliedChargeRate
    : (calculatedChargeRate !== null ? calculatedChargeRate : suppliedChargeRate);

  return {
    id: asNullableString(input.id),
    role_id: asNullableString(input.roleId ?? input.role_id),
    market_id: asNullableString(input.marketId ?? input.market_id) || market.id,
    pay_rate: payRate,
    charge_rate: chargeRate,
    rate_unit: asString(input.rateUnit ?? input.rate_unit) || 'hour',
    is_featured: asBoolean(input.isFeatured ?? input.is_featured, false),
    is_charge_overridden: isChargeOverridden || (calculatedChargeRate !== null && chargeRate !== null && Math.abs(calculatedChargeRate - chargeRate) > 0.009),
    effective_from: asIsoDate(input.effectiveFrom ?? input.effective_from) || asIsoDate(new Date()),
    effective_to: asIsoDate(input.effectiveTo ?? input.effective_to),
    notes: asNullableString(input.notes),
    updated_at: new Date().toISOString(),
    updated_by_email: asNullableString(user?.email || input.updatedByEmail || input.updated_by_email),
  };
}

async function ensureUniqueRoleSlug(supabase, desiredSlug, currentId) {
  const baseSlug = normaliseRoleSlug(desiredSlug, '');
  let candidate = baseSlug;

  for (let index = 0; index < 50; index += 1) {
    const { data, error } = await supabase
      .from(RATE_BOOK_ROLE_TABLE)
      .select('id')
      .eq('slug', candidate)
      .limit(5);

    if (error) throw error;

    const conflict = Array.isArray(data)
      && data.some((row) => asString(row.id) && asString(row.id) !== asString(currentId));

    if (!conflict) return candidate;

    const suffix = `-${index + 2}`;
    candidate = `${baseSlug.slice(0, Math.max(1, MAX_SLUG_LENGTH - suffix.length))}${suffix}`;
  }

  throw validationError('Unable to generate a unique slug for this rate-book role.');
}

async function insertRateBookAuditLog(supabase, payload = {}) {
  if (!supabase || typeof supabase.from !== 'function') return;
  const row = {
    entity_type: asString(payload.entityType),
    entity_id: asNullableString(payload.entityId),
    action: asString(payload.action) || 'updated',
    before_json: payload.beforeJson ?? null,
    after_json: payload.afterJson ?? null,
    changed_by: asNullableString(payload.changedBy),
    changed_at: new Date().toISOString(),
  };
  try {
    await supabase.from(RATE_BOOK_AUDIT_TABLE).insert(row);
  } catch (error) {
    console.warn('[rate-book-audit] unable to write audit row:', error?.message || error);
  }
}

module.exports = {
  RATE_BOOK_ROLE_TABLE,
  RATE_BOOK_MARKET_TABLE,
  RATE_BOOK_RATE_TABLE,
  RATE_BOOK_SETTINGS_TABLE,
  RATE_BOOK_AUDIT_TABLE,
  DEFAULT_RATE_BOOK_SETTINGS,
  DEFAULT_RATE_BOOK_MARKETS,
  getRateBookSeed,
  asString,
  asNullableString,
  asBoolean,
  asInteger,
  asNumber,
  asIsoTimestamp,
  asIsoDate,
  asArray,
  sanitiseUrl,
  normaliseRoleSlug,
  validationError,
  determineDiscipline,
  determineSeniority,
  determineSectors,
  settingsFromRow,
  calculateChargeFromPay,
  marketFromRow,
  roleFromRow,
  rateFromRow,
  sortRateBookRoles,
  sortRateBookMarkets,
  pickCurrentRates,
  hydrateRateBook,
  toPublicRateBook,
  toPublicRateBookRole,
  normaliseSettingsInput,
  normaliseRoleInput,
  normaliseRateInput,
  ensureUniqueRoleSlug,
  insertRateBookAuditLog,
  isMissingTableError,
};
