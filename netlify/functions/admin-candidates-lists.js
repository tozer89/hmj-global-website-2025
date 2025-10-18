// netlify/functions/admin-candidates-lists.js
// List candidates with search, filters, sorting, and pagination.
// Returns: { rows, total, filtered, pages, page, size }

const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

// columns we expose to the UI
const COLUMNS = [
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
].join(',');

// Apply search & filters to a query
function applyFilters(qb, params) {
  const { q, type, status, job, emailHas } = params;

  // free-text search across name/email/phone (safe ilike)
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    // or() requires a string in the PostgREST filter language:
    // first_name.ilike.%q%,last_name.ilike.%q%,email.ilike.%q%,phone.ilike.%q%
    qb = qb.or(
      [
        `first_name.ilike.${term}`,
        `last_name.ilike.${term}`,
        `email.ilike.${term}`,
        `phone.ilike.${term}`
      ].join(',')
    );
  }

  if (type)   qb = qb.eq('pay_type', type);
  if (status) qb = qb.eq('status', status);
  if (job && job.trim()) qb = qb.ilike('job_title', `%${job.trim()}%`);
  if (emailHas && emailHas.trim()) qb = qb.ilike('email', `%${emailHas.trim()}%`);

  return qb;
}

// Apply sorting
function applySort(qb, sort) {
  // default: sort by name (last_name, first_name)
  const s = sort && sort.key ? sort : { key: 'name', dir: 'asc' };
  const asc = (s.dir || 'asc').toLowerCase() !== 'desc';

  if (s.key === 'name') {
    qb = qb.order('last_name',  { ascending: asc, nullsFirst: true });
    qb = qb.order('first_name', { ascending: asc, nullsFirst: true });
  } else if (['id','email','phone','job_title','pay_type','status','payroll_ref'].includes(s.key)) {
    qb = qb.order(s.key, { ascending: asc, nullsFirst: true });
  } else {
    // fallback
    qb = qb.order('id', { ascending: true });
  }

  return qb;
}

exports.handler = async (event, context) => {
  try {
    await getContext(context, { requireAdmin: true });

    // Parse body safely (tolerate empty/invalid)
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) { body = {}; }

    const page = Math.max(1, parseInt(body.page, 10) || 1);
    const size = Math.min(500, Math.max(1, parseInt(body.size, 10) || 25)); // hard cap
    const sort = body.sort || { key: 'name', dir: 'asc' };

    // --- total count (no filters)
    let totalQ = supabase
      .from('candidates')
      .select('id', { count: 'exact', head: true });

    const { count: totalCount, error: totalErr } = await totalQ;
    if (totalErr) throw totalErr;
    const total = totalCount || 0;

    // --- filtered count (filters only)
    let countQ = supabase
      .from('candidates')
      .select('id', { count: 'exact', head: true });
    countQ = applyFilters(countQ, body);

    const { count: filteredCount, error: filteredErr } = await countQ;
    if (filteredErr) throw filteredErr;
    const filtered = filteredCount || 0;

    // --- data query (filters + sort + page)
    let dataQ = supabase
      .from('candidates')
      .select(COLUMNS);
    dataQ = applyFilters(dataQ, body);
    dataQ = applySort(dataQ, sort);

    // Supabase range is inclusive both ends
    const from = (page - 1) * size;
    const to   = from + size - 1;
    dataQ = dataQ.range(from, to);

    const { data: rows, error: dataErr } = await dataQ;
    if (dataErr) throw dataErr;

    const pages = Math.max(1, Math.ceil(filtered / size));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: rows || [],
        total,
        filtered,
        pages,
        page,
        size,
        sort
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
