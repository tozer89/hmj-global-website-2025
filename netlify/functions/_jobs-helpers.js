// netlify/functions/_jobs-helpers.js
const path = require('path');
const fs = require('fs');

// Canonical jobs helpers for the active HMJ jobs runtime.
// The main public/admin jobs flow should use Supabase through Netlify Functions
// and rely on this module only for normalization and mapping.
//
// Legacy static dataset helpers are retained below only for deferred secondary
// paths such as share/spec compatibility. They are no longer part of the main
// public jobs board or admin jobs editor runtime flow.

const SECTION_PRESETS = new Map([
  ['commercial', 'Commercial'],
  ['dc', 'Data Centre Delivery'],
  ['data-centre-delivery', 'Data Centre Delivery'],
  ['substations', 'Substations & Energy'],
  ['substations-energy', 'Substations & Energy'],
  ['pharma', 'Life Sciences & Pharma'],
  ['life-sciences', 'Life Sciences & Pharma'],
  ['ict', 'ICT & Commissioning'],
  ['ict-commissioning', 'ICT & Commissioning'],
]);

const PAY_TYPE_SET = new Set([
  'day_rate',
  'salary_range',
  'hourly_range',
  'competitive',
  'negotiable',
]);

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[jobs] dataset read failed (%s): %s', filePath, err?.message || err);
    return null;
  }
}

function extractJobs(source) {
  if (!source) return [];
  if (Array.isArray(source?.jobs)) return source.jobs;
  if (Array.isArray(source)) return source;
  return [];
}

function readJobsDataset(filePath) {
  const parsed = readJsonSafe(filePath);
  if (parsed === null) return null;
  return extractJobs(parsed);
}

const SEED_PATH = path.join(__dirname, '_data', 'jobs.seed.json');
const LOCAL_PATH = path.join(__dirname, '..', '..', 'data', 'jobs.json');

let EMBEDDED_DATA = null;
try {
  // Require at build time so the JSON ships with the bundle even if fs access fails at runtime.
  EMBEDDED_DATA = require('./_data/jobs.seed.json');
} catch (err) {
  console.warn('[jobs] failed to preload embedded dataset', err?.message || err);
}

let STATIC_JOBS = [];
let STATIC_LOOKUP = null;

// Legacy static snapshot loader retained for deferred share/spec compatibility.
function ensureStaticJobs() {
  if (STATIC_JOBS.length) return STATIC_JOBS;

  let local = null;
  // In the Netlify bundle the data/ directory may sit outside __dirname, so fall back to cwd.
  const localPaths = [LOCAL_PATH, path.join(process.cwd(), 'data', 'jobs.json')];
  for (const candidate of localPaths) {
    if (local !== null) break;
    const dataset = readJobsDataset(candidate);
    if (dataset !== null) {
      local = dataset;
    }
  }

  let embedded = EMBEDDED_DATA !== null ? extractJobs(EMBEDDED_DATA) : null;
  if (embedded === null) {
    embedded = readJobsDataset(SEED_PATH);
  }

  const selected = local !== null ? local : embedded;
  const datasetFound = local !== null || embedded !== null;
  const fallback = Array.isArray(selected) ? selected.slice() : [];

  if (!datasetFound) {
    console.warn('[jobs] no static datasets found — using hard-coded seed');
    // Minimal inline seed so previews never break entirely.
    fallback.push({
      id: 'hmj-demo-role',
      title: 'Construction Manager — Data Centre',
      status: 'live',
      section: 'Data Centre Delivery',
      location_text: 'London, UK',
      overview: 'Preview data is active because Supabase could not be reached.',
      requirements: [
        '10+ years delivering hyperscale data centres',
        'Tier 1 contractor or consultancy background',
      ],
      responsibilities: [
        'Lead site teams across civils, MEP and commissioning',
        'Interface with client PMO and suppliers',
      ],
      keywords: 'data centre,construction manager,preview',
      apply_url: '/contact.html?role=Construction%20Manager',
      published: true,
      sort_order: 999,
    });
  }

  STATIC_JOBS = fallback;
  STATIC_LOOKUP = null; // reset memoised map so helpers rebuild with latest dataset
  return STATIC_JOBS;
}

function isSchemaError(err) {
  if (!err) return false;
  const code = err.code || err.status || err.statusCode;
  if (code === '42P01' || code === '42703') return true;
  const msg = String(err.message || err).toLowerCase();
  return (
    (msg.includes('relation') && msg.includes('does not exist')) ||
    (msg.includes('column') && msg.includes('does not exist')) ||
      msg.includes('undefined column')
  );
}

function isMissingTableError(err, tableName = '') {
  if (!err) return false;
  const code = String(err.code || err.status || err.statusCode || '').toUpperCase();
  const table = String(tableName || '')
    .replace(/^public\./i, '')
    .replace(/"/g, '')
    .toLowerCase();
  const sources = [
    String(err.message || '').toLowerCase(),
    String(err.details || '').toLowerCase(),
    String(err.hint || '').toLowerCase(),
  ].filter(Boolean);
  const mentionsTable = !table || sources.some((source) => (
    source.includes(`public.${table}`) ||
    source.includes(`'public.${table}'`) ||
    source.includes(`"${table}"`) ||
    source.includes(`'${table}'`) ||
    source.includes(table)
  ));

  if ((code === '42P01' || code === 'PGRST205') && mentionsTable) {
    return true;
  }

  return sources.some((source) => (
    source.includes('relation') &&
    source.includes('does not exist') &&
    mentionsTable
  )) || (
    mentionsTable &&
    sources.some((source) => (
      source.includes('schema cache') &&
      source.includes('could not find the table')
    ))
  );
}

function slugify(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function startCase(value = '') {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function resolveSection(raw) {
  const input = String(raw || '').trim();
  if (!input) {
    return { key: 'general', label: 'General' };
  }
  const preset = SECTION_PRESETS.get(input.toLowerCase());
  if (preset) {
    return { key: slugify(input) || input.toLowerCase(), label: preset };
  }
  const key = slugify(input) || input.toLowerCase() || 'general';
  const label = startCase(input) || 'General';
  return { key, label };
}

function cleanArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|\u2022|,/) // support bullets and comma lists
      .map((v) => v.replace(/^[-*\s]+/, '').trim())
      .filter(Boolean);
  }
  return [];
}

function asString(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normaliseCurrency(value, fallback = '') {
  const raw = asString(value).toUpperCase();
  if (!raw) return fallback;
  if (raw === '£') return 'GBP';
  if (raw === '€') return 'EUR';
  if (raw === '$') return 'USD';
  return raw;
}

function normalisePayType(value) {
  const raw = asString(value).toLowerCase();
  if (!raw || raw === 'unspecified' || raw === 'not_specified') return '';
  return PAY_TYPE_SET.has(raw) ? raw : '';
}

function inferPayType(row = {}) {
  const explicit = normalisePayType(row.pay_type || row.payType);
  if (explicit) return explicit;
  if (asNumber(row.day_rate_min || row.dayRateMin) !== null || asNumber(row.day_rate_max || row.dayRateMax) !== null) {
    return 'day_rate';
  }
  if (asNumber(row.salary_min || row.salaryMin) !== null || asNumber(row.salary_max || row.salaryMax) !== null) {
    return 'salary_range';
  }
  if (asNumber(row.hourly_min || row.hourlyMin) !== null || asNumber(row.hourly_max || row.hourlyMax) !== null) {
    return 'hourly_range';
  }
  return '';
}

function formatMoney(value, currency, options = {}) {
  const amount = asNumber(value);
  if (amount === null) return '';
  const currencyCode = normaliseCurrency(currency, 'GBP');
  const minFractionDigits = Number.isFinite(options.minFractionDigits) ? Number(options.minFractionDigits) : 0;
  const maxFractionDigits = Number.isFinite(options.maxFractionDigits) ? Number(options.maxFractionDigits) : 0;
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: minFractionDigits,
      maximumFractionDigits: maxFractionDigits,
    }).format(amount);
  } catch (err) {
    return `${currencyCode} ${amount.toLocaleString('en-GB', {
      minimumFractionDigits: minFractionDigits,
      maximumFractionDigits: maxFractionDigits,
    })}`;
  }
}

function formatPayRange(min, max, currency, suffix, options = {}) {
  const lower = asNumber(min);
  const upper = asNumber(max);
  if (lower === null && upper === null) return '';

  const moneyOptions = {
    minFractionDigits: Number.isFinite(options.minFractionDigits) ? Number(options.minFractionDigits) : 0,
    maxFractionDigits: Number.isFinite(options.maxFractionDigits) ? Number(options.maxFractionDigits) : 0,
  };

  const lowerText = lower === null ? '' : formatMoney(lower, currency, moneyOptions);
  const upperText = upper === null ? '' : formatMoney(upper, currency, moneyOptions);

  if (lower !== null && upper !== null) {
    if (lower === upper) return `${lowerText} ${suffix}`.trim();
    return `${lowerText} - ${upperText} ${suffix}`.trim();
  }
  if (lower !== null) return `From ${lowerText} ${suffix}`.trim();
  return `Up to ${upperText} ${suffix}`.trim();
}

function buildPayText(row = {}) {
  const payType = inferPayType(row);
  const currency = normaliseCurrency(row.currency, 'GBP');

  if (payType === 'day_rate') {
    return formatPayRange(row.day_rate_min || row.dayRateMin, row.day_rate_max || row.dayRateMax, currency, 'per day', {
      maxFractionDigits: 2,
    });
  }
  if (payType === 'salary_range') {
    return formatPayRange(row.salary_min || row.salaryMin, row.salary_max || row.salaryMax, currency, 'per year');
  }
  if (payType === 'hourly_range') {
    return formatPayRange(row.hourly_min || row.hourlyMin, row.hourly_max || row.hourlyMax, currency, 'per hour', {
      maxFractionDigits: 2,
    });
  }
  if (payType === 'competitive') return 'Competitive';
  if (payType === 'negotiable') return 'Negotiable';
  return '';
}

function parseTags(row = {}) {
  if (Array.isArray(row.tags)) {
    return row.tags.map((v) => asString(v)).filter(Boolean);
  }
  if (Array.isArray(row.keywords)) {
    return row.keywords.map((v) => asString(v)).filter(Boolean);
  }
  return cleanArray(row.keywords || row.tags || '');
}

function tagsToString(tags) {
  if (!tags) return '';
  if (Array.isArray(tags)) return tags.map((v) => asString(v)).filter(Boolean).join(', ');
  return asString(tags);
}

function toJob(row = {}) {
  const sectionSource = row.section || row.sectionLabel;
  const sectionInfo = resolveSection(sectionSource);
  const payType = inferPayType(row);
  const currency = normaliseCurrency(row.currency);
  return {
    id: asString(row.id),
    title: asString(row.title),
    status: asString(row.status) || 'live',
    section: asString(sectionSource) || sectionInfo.label,
    sectionLabel: sectionInfo.label,
    sectionKey: sectionInfo.key,
    discipline: asString(row.discipline),
    type: asString(row.type) || 'permanent',
    locationText: asString(row.location_text || row.locationText),
    locationCode: asString(row.location_code || row.locationCode),
    overview: asString(row.overview),
    responsibilities: cleanArray(row.responsibilities),
    requirements: cleanArray(row.requirements),
    keywords: asString(row.keywords),
    tags: parseTags(row),
    clientName: asString(row.client_name || row.clientName),
    customer: asString(row.customer),
    benefits: cleanArray(row.benefits),
    payType,
    dayRateMin: asNumber(row.day_rate_min || row.dayRateMin),
    dayRateMax: asNumber(row.day_rate_max || row.dayRateMax),
    salaryMin: asNumber(row.salary_min || row.salaryMin),
    salaryMax: asNumber(row.salary_max || row.salaryMax),
    hourlyMin: asNumber(row.hourly_min || row.hourlyMin),
    hourlyMax: asNumber(row.hourly_max || row.hourlyMax),
    currency,
    payText: buildPayText({ ...row, pay_type: payType, currency }),
    applyUrl: asString(row.apply_url || row.applyUrl),
    published: !!row.published,
    sortOrder: Number.isFinite(row.sort_order)
      ? Number(row.sort_order)
      : Number.isFinite(row.sortOrder)
        ? Number(row.sortOrder)
        : null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function toPublicJob(row = {}) {
  const job = toJob(row);
  return {
    id: job.id,
    title: job.title,
    status: job.status,
    section: job.section,
    sectionLabel: job.sectionLabel,
    sectionKey: job.sectionKey,
    discipline: job.discipline,
    type: job.type,
    locationText: job.locationText,
    locationCode: job.locationCode,
    overview: job.overview,
    responsibilities: job.responsibilities,
    requirements: job.requirements,
    keywords: job.keywords,
    tags: job.tags,
    customer: job.customer,
    benefits: job.benefits,
    payType: job.payType,
    dayRateMin: job.dayRateMin,
    dayRateMax: job.dayRateMax,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    hourlyMin: job.hourlyMin,
    hourlyMax: job.hourlyMax,
    currency: job.currency,
    payText: job.payText,
    applyUrl: job.applyUrl,
    published: job.published,
    sortOrder: job.sortOrder,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function toDbPayload(job = {}) {
  const j = toJob(job);
  const sectionSource = job.sectionLabel || job.section || job.sectionKey || j.sectionLabel;
  const tags = Array.isArray(job.tags) ? job.tags : j.tags;
  const payType = normalisePayType(job.payType || job.pay_type || j.payType);
  const currency = normaliseCurrency(job.currency || j.currency);
  const payload = {
    id: asString(j.id),
    title: asString(j.title),
    status: asString(j.status) || 'live',
    section: asString(sectionSource) || 'General',
    discipline: asString(j.discipline),
    type: asString(j.type) || 'permanent',
    location_text: asString(j.locationText),
    location_code: asString(j.locationCode),
    overview: asString(j.overview),
    responsibilities: cleanArray(job.responsibilities || job.responsibilitiesText || j.responsibilities),
    requirements: cleanArray(job.requirements || job.requirementsText || j.requirements),
    keywords: tagsToString(job.keywords || tags || j.keywords),
    benefits: cleanArray(job.benefits || j.benefits),
    client_name: asString(job.clientName || job.client_name || j.clientName) || null,
    customer: asString(job.customer || j.customer) || null,
    pay_type: payType || null,
    day_rate_min: null,
    day_rate_max: null,
    salary_min: null,
    salary_max: null,
    hourly_min: null,
    hourly_max: null,
    currency: (payType === 'day_rate' || /_range$/.test(payType)) ? (currency || null) : null,
    apply_url: asString(j.applyUrl),
    published: !!job.published,
    sort_order: Number.isFinite(job.sortOrder)
      ? Number(job.sortOrder)
      : Number.isFinite(job.sort_order)
        ? Number(job.sort_order)
        : Number.isFinite(j.sortOrder)
          ? Number(j.sortOrder)
          : null,
  };

  if (payType === 'day_rate') {
    payload.day_rate_min = asNumber(job.dayRateMin ?? job.day_rate_min ?? j.dayRateMin);
    payload.day_rate_max = asNumber(job.dayRateMax ?? job.day_rate_max ?? j.dayRateMax);
  } else if (payType === 'salary_range') {
    payload.salary_min = asNumber(job.salaryMin ?? job.salary_min ?? j.salaryMin);
    payload.salary_max = asNumber(job.salaryMax ?? job.salary_max ?? j.salaryMax);
  } else if (payType === 'hourly_range') {
    payload.hourly_min = asNumber(job.hourlyMin ?? job.hourly_min ?? j.hourlyMin);
    payload.hourly_max = asNumber(job.hourlyMax ?? job.hourly_max ?? j.hourlyMax);
  }

  return payload;
}

function loadStaticJobs() {
  const jobs = ensureStaticJobs();
  return jobs.length ? jobs.map(toJob) : [];
}

function buildLookup() {
  if (STATIC_LOOKUP) return STATIC_LOOKUP;
  const map = new Map();
  const jobs = ensureStaticJobs();
  jobs.forEach((row) => {
    const job = toJob(row);
    if (!job.id) return;
    const key = job.id.toLowerCase();
    map.set(key, job);
    const slug = slugify(job.title || job.id || '');
    if (slug) map.set(slug.toLowerCase(), job);
  });
  STATIC_LOOKUP = map;
  return STATIC_LOOKUP;
}

function findStaticJob(identifier) {
  if (!identifier) return null;
  const lookup = buildLookup();
  const key = String(identifier).toLowerCase();
  if (lookup.has(key)) {
    return toJob(lookup.get(key));
  }
  return null;
}

module.exports = {
  toJob,
  toPublicJob,
  toDbPayload,
  cleanArray,
  buildPayText,
  slugify,
  resolveSection,
  loadStaticJobs,
  ensureStaticJobs,
  findStaticJob,
  isSchemaError,
  isMissingTableError,
};
