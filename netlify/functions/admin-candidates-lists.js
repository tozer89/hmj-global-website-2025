// netlify/functions/admin-candidates-lists.js
// Lists candidates with strong debugging so we can see why it's empty.

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');

// Small helper to coalesce falsy/empty strings to null
const nz = (s) => (s === undefined || s === null || String(s).trim() === '' ? null : s);

// Build a flexible filter for Supabase .or()
function buildOrFilter({ q, emailHas, job }) {
  const parts = [];
  if (q) {
    // try matching across common text fields
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

const baseHandler = async (event, context) => {
  const started = Date.now();
  // Accept POST (normal) and GET with ?diag=1 for a quick diagnostic
  const isGET = (event.httpMethod || '').toUpperCase() === 'GET';

  // Parse body safely
  let payload = {};
  try { payload = isGET ? {} : JSON.parse(event.body || '{}'); } catch { payload = {}; }

  const {
    q = '',
    type = '',
    status = '',
    job = '',
    emailHas = '',
    page = 1,
    size = 25,
    sort = { key: 'id', dir: 'desc' },
    debug = true
  } = payload;

  let ctx;
  try {
    // We always require admin for this endpoint
    ctx = await getContext(event, { requireAdmin: true });
  } catch (e) {
    const code = e.code || 500;
    return {
      statusCode: code,
      body: JSON.stringify({ error: e.message || 'Unauthorized' })
    };
  }

  const { supabase, roles, user } = ctx;
  const usingServiceKey = true; // getContext() uses SERVICE KEY under the hood

  // Quick diag endpoint (still requires admin)
  if (isGET && (event.queryStringParameters?.diag === '1')) {
    // Try a cheap HEAD count to see if the table is even visible
    const headCount = await supabase
      .from('candidates')
      .select('*', { count: 'exact', head: true });

    return {
      statusCode: headCount.error ? 500 : 200,
      body: JSON.stringify({
        ok: !headCount.error,
        count: headCount.count || 0,
        error: headCount.error?.message || null,
        who: { email: user?.email, roles },
        usingServiceKey,
        note: 'If count > 0 here but normal listing is empty, a filter/where is removing rows.'
      })
    };
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(250, Math.max(1, Number(size) || 25));
  const from = (pageNum - 1) * pageSize;
  const to = from + pageSize - 1;

  // Build base query
  let query = supabase
    .from('candidates')
    .select(
      [
        'id',
        'first_name',
        'last_name',
        'email',
        'phone',
        'job_title',
        'pay_type',
        'status',
        'payroll_ref',
        'address',
        'bank_sort_code',
        'bank_account',
        'bank_iban',
        'bank_swift',
        'notes',
        'created_at',
        'updated_at'
      ].join(','),
      { count: 'exact' }
    );

  // Filters
  const orFilter = buildOrFilter({ q: nz(q), emailHas: nz(emailHas), job: nz(job) });
  if (orFilter) query = query.or(orFilter);

  if (nz(type))   query = query.eq('pay_type', type);
  if (nz(status)) query = query.eq('status', status);

  // Sorting
  const sortable = new Set(['id', 'created_at', 'updated_at', 'first_name', 'last_name', 'email', 'status', 'pay_type']);
  const sortKey = sortable.has(sort?.key) ? sort.key : 'id';
  const sortAsc = String(sort?.dir || '').toLowerCase() !== 'desc';
  query = query.order(sortKey, { ascending: sortAsc, nullsFirst: true });

  // Pagination
  query = query.range(from, to);

  // Execute
  const { data: rows, count, error } = await query;

  if (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }

  // Compute meta
  const total = count ?? 0;       // Supabase returns total after filters with count:'exact'
  const filtered = total;         // We requested count against the filtered selection
  const pages = Math.max(1, Math.ceil(filtered / pageSize));

  const response = {
    rows: rows || [],
    total,
    filtered,
    pages
  };

  // Debug block (very helpful now)
  if (debug) {
    response.debug = {
      took_ms: Date.now() - started,
      received: { q, type, status, job, emailHas, page: pageNum, size: pageSize, sort },
      who: { email: user?.email, roles },
      usingServiceKey,
      range: { from, to },
      notes: [
        'If rows is empty but count > 0, your range computed might be out of bounds.',
        'If both rows and count are 0, either table is empty, you are on the wrong project/schema, or RLS/permissions block reads.'
      ]
    };
  }

  return { statusCode: 200, body: JSON.stringify(response) };
};

exports.handler = withAdminCors(baseHandler);
