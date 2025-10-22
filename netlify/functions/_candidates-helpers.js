// netlify/functions/_candidates-helpers.js
// Lightweight helpers so admin candidate endpoints can fall back to local JSON data
// when Supabase credentials are unavailable (for example on deploy previews).

// Load the static dataset at bundle time so Netlify packages it alongside the
// function. Falling back to fs.readFileSync meant the JSON file was missing in
// the deployed lambda bundle, which left preview environments with empty
// results even though the seed data existed locally.
function safeRequire(path) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path);
  } catch (err) {
    console.warn('[candidates] dataset load failed (%s): %s', path, err?.message || err);
    return null;
  }
}

function extractCandidates(source) {
  if (!source) return [];
  if (Array.isArray(source?.candidates)) return source.candidates;
  if (Array.isArray(source)) return source;
  return [];
}

const LOCAL_DATA = safeRequire('../../data/candidates.json');
const SEEDED_DATA = safeRequire('./_data/candidates.seed.json');
let staticCandidates = extractCandidates(LOCAL_DATA).concat(extractCandidates(SEEDED_DATA));

function preloadCandidates() {
  if (staticCandidates.length) return staticCandidates;
  staticCandidates = extractCandidates(LOCAL_DATA).concat(extractCandidates(SEEDED_DATA));
  return staticCandidates;
}

preloadCandidates();

function normaliseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  const text = String(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function normaliseArray(value) {
  if (!value && value !== 0) return [];
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v).trim())
      .filter(Boolean);
  }
  const text = String(value || '').trim();
  if (!text) return [];
  return text
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function toCandidate(row = {}) {
  const first = row.first_name || row.firstName || '';
  const last = row.last_name || row.lastName || '';
  const fullName = row.full_name || row.fullName || `${first} ${last}`.trim();
  const addressJson = row.address_json || row.addressJson || null;
  return {
    id: row.id ?? null,
    ref: row.ref || row.reference || null,
    user_id: row.user_id || row.userId || null,
    first_name: first,
    last_name: last,
    full_name: fullName || null,
    email: row.email || null,
    phone: row.phone || null,
    status: row.status || 'In progress',
    job_title: row.job_title || row.role || null,
    client_name: row.client_name || row.client || null,
    pay_type: row.pay_type || row.payType || null,
    payroll_ref: row.payroll_ref || row.payrollRef || null,
    internal_ref: row.internal_ref || row.internalRef || null,
    address1: row.address1 || row.address_1 || row.addressLine1 || null,
    address2: row.address2 || row.address_2 || row.addressLine2 || null,
    town: row.town || row.city || null,
    county: row.county || row.region || null,
    postcode: row.postcode || row.postal_code || null,
    country: row.country || 'United Kingdom',
    address: row.address || null,
    address_json: addressJson,
    bank_name: row.bank_name || null,
    bank_sort: row.bank_sort || null,
    bank_sort_code: row.bank_sort_code || row.sort_code || null,
    bank_account: row.bank_account || row.account_number || null,
    bank_iban: row.bank_iban || row.iban || null,
    bank_swift: row.bank_swift || row.swift || null,
    emergency_name: row.emergency_name || row.emergencyName || null,
    emergency_phone: row.emergency_phone || row.emergencyPhone || null,
    rtw_url: row.rtw_url || row.right_to_work || null,
    right_to_work: normaliseBoolean(row.right_to_work ?? row.rtw_ok),
    contract_url: row.contract_url || null,
    terms_ok: normaliseBoolean(row.terms_ok),
    role: row.role || row.assignment_role || null,
    start_date: row.start_date || null,
    end_date: row.end_date || null,
    timesheet_status: row.timesheet_status || null,
    tax_id: row.tax_id || null,
    notes: row.notes || null,
    skills: normaliseArray(row.skills || row.skill_tags || row.tags),
    created_at: row.created_at || row.createdAt || null,
    updated_at: row.updated_at || row.updatedAt || null,
  };
}

function loadStaticCandidates() {
  if (!staticCandidates.length) preloadCandidates();
  if (!staticCandidates.length) return [];
  return staticCandidates.map(toCandidate);
}

module.exports = {
  toCandidate,
  loadStaticCandidates,
};
