// netlify/functions/_candidates-helpers.js
// Lightweight helpers so admin candidate endpoints can fall back to local JSON data
// when Supabase credentials are unavailable (for example on deploy previews).

const fs = require('fs');
const path = require('path');

function normaliseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  const text = String(value).toLowerCase();
  return text === 'true' || text === '1' || text === 'yes';
}

function toCandidate(row = {}) {
  const first = row.first_name || row.firstName || '';
  const last = row.last_name || row.lastName || '';
  const fullName = row.full_name || row.fullName || `${first} ${last}`.trim();
  return {
    id: row.id ?? null,
    ref: row.ref || row.reference || null,
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
    bank_name: row.bank_name || null,
    bank_sort: row.bank_sort || null,
    bank_sort_code: row.bank_sort_code || row.sort_code || null,
    bank_account: row.bank_account || row.account_number || null,
    bank_iban: row.bank_iban || row.iban || null,
    bank_swift: row.bank_swift || row.swift || null,
    emergency_name: row.emergency_name || row.emergencyName || null,
    emergency_phone: row.emergency_phone || row.emergencyPhone || null,
    rtw_url: row.rtw_url || row.right_to_work || null,
    contract_url: row.contract_url || null,
    terms_ok: normaliseBoolean(row.terms_ok),
    role: row.role || row.assignment_role || null,
    start_date: row.start_date || null,
    end_date: row.end_date || null,
    timesheet_status: row.timesheet_status || null,
    tax_id: row.tax_id || null,
    notes: row.notes || null,
    created_at: row.created_at || row.createdAt || null,
    updated_at: row.updated_at || row.updatedAt || null,
  };
}

function findCandidatesFile() {
  const attempts = [
    path.resolve(__dirname, '..', 'data', 'candidates.json'),
    path.resolve(__dirname, '..', '..', 'data', 'candidates.json'),
    path.resolve(process.cwd(), 'data', 'candidates.json'),
  ];
  return attempts.find((filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }) || null;
}

function loadStaticCandidates() {
  const file = findCandidatesFile();
  if (!file) {
    console.warn('[candidates] static candidates.json not found');
    return [];
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    const rows = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    return rows.map(toCandidate);
  } catch (err) {
    console.error('[candidates] failed to read static candidates.json', err?.message || err);
    return [];
  }
}

module.exports = {
  toCandidate,
  loadStaticCandidates,
};
