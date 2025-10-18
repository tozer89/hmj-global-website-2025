// netlify/functions/admin-candidates-lists.js
// Robust list endpoint – auto-detects columns on your 'candidates' table
// and only selects / filters what exists. Supports search, filters, sort, pagination.

const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

// Desired UI columns (will be intersected with actual table columns)
const WANTED_COLS = [
  'id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'job_title',
  'pay_type',
  'status',
  'payroll_ref',
  'address'
];

// Build PostgREST OR filter safely
function applySearch(qb, have, term) {
  if (!term || !term.trim()) return qb;
  const like = `%${term.trim()}%`;
  const orParts = [];

  if (have.has('first_name')) orParts.push(`first_name.ilike.${like}`);
  if (have.has('last_name'))  orParts.push(`last_name.ilike.${like}`);
  if (have.has('email'))      orParts.push(`email.ilike.${like}`);
  if (have.has('phone'))      orParts.push(`phone.ilike.${like}`);

  if (orParts.length) qb = qb.or(orParts.join(','));
  return qb;
}

function applyFilters(qb, have, { type, status, job, emailHas }) {
  if (type && have.has('pay_type')) qb = qb.eq('pay_type', type);
  if (status && have.has('status')) qb = qb.eq('status', status);
  if (job && job.trim() && have.has('job_title')) qb = qb.ilike('job_title', `%${job.trim()}%`);
  if (emailHas && emailHas.trim() && have.has('email')) qb = qb.ilike('email', `%${emailHas.trim()}%`);
  return qb;
}

function applySort(qb, have, sort) {
  const s = sort && sort.key ? sort : { key: 'name', dir: 'asc' };
  const asc = (s.dir || 'asc').toLowerCase() !== 'desc';

  if (s.key === 'name') {
    // sort by last_name, first_name when present; otherwise fall back
    if (have.has('last_name'))  qb = qb.order('last_name',  { ascending: asc, nullsFirst: true });
    if (have.has('first_name')) qb = qb.order('first_name', { ascending: asc, nullsFirst: true });
    if (!have.has('last_name') && !have.has('first_name')) qb = qb.order('id', { ascending: true });
  } else if (have.has(s.key)) {
    qb = qb.order(s.key, { ascending: asc, nullsFirst: true });
  } else {
    qb = qb.order('id', { ascending: true });
  }

  return qb;
}

exports.handler = async (event, context) => {
  try {
    await getContext(context, { requireAdmin: true });

    // Body
    let args = {};
    try { args = JSON.parse(event.body || '{}'); } catch { args = {}; }

    const page = Math.max(1, parseInt(args.page, 10) || 1);
    const size = Math.min(500, Math.max(1, parseInt(args.size, 10) || 25));
    const sort = args.sort || { key: 'name', dir: 'asc' };

    // 1) Discover columns your table actually has
    const { data: colRows, error: colErr } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_schema', 'public')
      .eq('table_name', 'candidates');

    if (colErr) throw colErr;

    const have = new Set((colRows || []).map(r => r.column_name));
    const selectCols = WANTED_COLS.filter(c => have.has(c));
    if (!selectCols.length) selectCols.push('id'); // absolute fallback

    // 2) Counts
    const { count: total, error: totalErr } = await supabase
      .from('candidates')
      .select('id', { count: 'exact', head: true });
    if (totalErr) throw totalErr;

    let countQ = supabase.from('candidates').select('id', { count: 'exact', head: true });
    countQ = applySearch(countQ, have, args.q);
    countQ = applyFilters(countQ, have, args);
    const { count: filtered, error: filteredErr } = await countQ;
    if (filteredErr) throw filteredErr;

    // 3) Data
    let dataQ = supabase.from('candidates').select(selectCols.join(','));
    dataQ = applySearch(dataQ, have, args.q);
    dataQ = applyFilters(dataQ, have, args);
    dataQ = applySort(dataQ, have, sort);

    const from = (page - 1) * size;
    const to = from + size - 1;
    dataQ = dataQ.range(from, to);

    const { data: rows, error: dataErr } = await dataQ;
    if (dataErr) throw dataErr;

    const pages = Math.max(1, Math.ceil((filtered || 0) / size));

    // Optional debug echo to help future troubleshooting (toggle by sending { debug:true })
    const debug = !!args.debug ? {
      wanted: WANTED_COLS,
      have: Array.from(have),
      selected: selectCols,
      sort
    } : undefined;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: rows || [],
        total: total || 0,
        filtered: filtered || 0,
        pages,
        page,
        size,
        sort,
        ...(debug ? { debug } : {})
      })
    };
  } catch (e) {
    const status = e.code === 401 ? 401 : (e.code === 403 ? 403 : 500);
    return {
      statusCode: status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message || String(e) })
    };
  }
};
