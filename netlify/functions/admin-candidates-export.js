// netlify/functions/admin-candidates-export.js
// Generates a CSV export for candidates. Falls back to the static dataset
// when Supabase is unavailable so previews still provide useful output.

const { getContext } = require('./_auth.js');
const { loadStaticCandidates, toCandidate } = require('./_candidates-helpers.js');

const nz = (s) => (s === undefined || s === null || String(s).trim() === '' ? null : s);

function buildOrFilter({ q, emailHas, job }) {
  const parts = [];
  if (q) {
    const like = `%${q}%`;
    parts.push(`first_name.ilike.${like}`);
    parts.push(`last_name.ilike.${like}`);
    parts.push(`email.ilike.${like}`);
    parts.push(`phone.ilike.${like}`);
    parts.push(`job_title.ilike.${like}`);
    parts.push(`address.ilike.${like}`);
  }
  if (emailHas) parts.push(`email.ilike.%${emailHas}%`);
  if (job) parts.push(`job_title.ilike.%${job}%`);
  return parts.join(',');
}

function filterStatic(rows, { q, status, type, ids }) {
  const filterText = (val) => String(val || '').toLowerCase();
  const qNeedle = filterText(q);
  const statusNeedle = filterText(status);
  const typeNeedle = filterText(type);
  const idSet = new Set((ids || []).map((v) => String(v)));

  return rows.filter((row) => {
    if (idSet.size && !idSet.has(String(row.id))) return false;
    const haystack = [
      row.ref,
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.job_title,
      row.client_name,
      row.payroll_ref,
    ]
      .filter(Boolean)
      .map(filterText)
      .join(' ');

    const matchesQ = !qNeedle || haystack.includes(qNeedle);
    const matchesStatus = !statusNeedle || filterText(row.status) === statusNeedle;
    const matchesType = !typeNeedle || filterText(row.pay_type) === typeNeedle;
    return matchesQ && matchesStatus && matchesType;
  });
}

const CSV_COLUMNS = [
  ['id', 'ID'],
  ['ref', 'Reference'],
  ['first_name', 'First name'],
  ['last_name', 'Last name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['status', 'Status'],
  ['job_title', 'Job title'],
  ['client_name', 'Client'],
  ['pay_type', 'Pay type'],
  ['payroll_ref', 'Payroll ref'],
  ['created_at', 'Created'],
  ['updated_at', 'Updated'],
];

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function toCsv(rows) {
  const header = CSV_COLUMNS.map(([, label]) => csvEscape(label)).join(',');
  const lines = rows.map((row) =>
    CSV_COLUMNS.map(([key]) => csvEscape(row[key] ?? '')).join(',')
  );
  return [header, ...lines].join('\n');
}

exports.handler = async (event, context) => {
  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch { payload = {}; }

  const {
    q = '',
    status = '',
    type = '',
    ids = [],
    emailHas = '',
    job = '',
  } = payload;

  let ctx;
  try {
    ctx = await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    return { statusCode: err.code || 401, body: JSON.stringify({ error: err.message || 'Unauthorized' }) };
  }

  const { supabase, supabaseError } = ctx;
  const supabaseAvailable = supabase && typeof supabase.from === 'function';

  const filters = {
    q: nz(q),
    status: nz(status),
    type: nz(type),
    ids: Array.isArray(ids) ? ids : [],
  };

  let rows = [];
  let source = 'static';
  let supaErrorMessage = supabaseError?.message || null;

  if (supabaseAvailable) {
    try {
      let query = supabase.from('candidates').select('*');

      if (filters.ids.length) {
        query = query.in('id', filters.ids);
      } else {
        const orFilter = buildOrFilter({ q: nz(q), emailHas: nz(emailHas), job: nz(job) });
        if (orFilter) query = query.or(orFilter);
        if (filters.status) query = query.eq('status', filters.status);
        if (filters.type) query = query.eq('pay_type', filters.type);
      }

      const { data, error } = await query;
      if (error) throw error;
      rows = (data || []).map(toCandidate);
      source = 'supabase';
      supaErrorMessage = null;
    } catch (err) {
      console.warn('[candidates] export supabase query failed (%s) — using static dataset', err.message || err);
      supaErrorMessage = err.message || 'supabase_error';
    }
  }

  if (source !== 'supabase') {
    rows = filterStatic(loadStaticCandidates().map(toCandidate), filters);
  }

  const csv = toCsv(rows);

  return {
    statusCode: 200,
    body: JSON.stringify({
      csv,
      count: rows.length,
      source,
      readOnly: source !== 'supabase',
      supabase: { ok: source === 'supabase', error: supaErrorMessage },
    }),
  };
};

