// netlify/functions/admin-candidates-list.js
// Lists candidates with strong debugging so we can see why it's empty.

const { getContext } = require('./_auth.js');
const { loadStaticCandidates, toCandidate } = require('./_candidates-helpers.js');

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

exports.handler = async (event, context) => {
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

  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(250, Math.max(1, Number(size) || 25));
  const from = (pageNum - 1) * pageSize;
  const to = from + pageSize - 1;

  const identityMeta = { email: null, roles: [] };
  let supabaseErrorMessage = null;

  const baseHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  function serveStatic(reason, extra = {}) {
    const staticRows = loadStaticCandidates();
    const normalised = staticRows.map(toCandidate);
    const filterText = (val) => String(val || '').toLowerCase();
    const qNeedle = filterText(nz(q));
    const statusNeedle = filterText(nz(status));
    const typeNeedle = filterText(nz(type));

    let filteredRows = normalised.filter((row) => {
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

    filteredRows.sort((a, b) => {
      const key = sort?.key || 'id';
      const dir = String(sort?.dir || '').toLowerCase() === 'asc' ? 1 : -1;
      const valueOf = (row) => {
        if (key === 'name') return `${row.first_name || ''} ${row.last_name || ''}`.trim().toLowerCase();
        return (row[key] || '').toString().toLowerCase();
      };
      const av = valueOf(a);
      const bv = valueOf(b);
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });

    const total = filteredRows.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const pageRows = filteredRows.slice(from, from + pageSize);

    const response = {
      rows: pageRows,
      total,
      filtered: total,
      pages,
      readOnly: true,
      source: 'static',
      supabase: { ok: false, error: reason || supabaseErrorMessage || null },
      auth: extra.auth || null,
    };

    if (debug) {
      response.debug = {
        took_ms: Date.now() - started,
        mode: 'static',
        usingServiceKey: false,
        supabaseError: reason || supabaseErrorMessage || null,
        who: identityMeta,
        auth: extra.auth || null,
      };
    }

    return {
      statusCode: extra.statusCode || 200,
      headers: { ...baseHeaders, ...(extra.headers || {}) },
      body: JSON.stringify(response),
    };
  }

  let ctx;
  try {
    ctx = await getContext(event, context, { requireAdmin: true, debug: true });
  } catch (e) {
    console.warn('[candidates] auth failed — serving static dataset', e?.message || e);
    return serveStatic(e?.message || 'auth_failed', {
      auth: { ok: false, status: e?.code || 403, error: e?.message || 'Unauthorized' },
      statusCode: 200,
    });
  }

  const { supabase, supabaseError, roles, user } = ctx;
  identityMeta.email = user?.email || null;
  identityMeta.roles = Array.isArray(roles) ? roles : [];
  supabaseErrorMessage = supabaseError?.message || null;
  const usingServiceKey = !!supabase;

  const supabaseUnavailable = !supabase || typeof supabase.from !== 'function';
  const shouldFallback = (err) => {
    if (!err) return false;
    const msg = String(err.message || err);
    if (/column .+ does not exist/i.test(msg)) return true;
    if (/relation .+ does not exist/i.test(msg)) return true;
    if (/permission denied/i.test(msg)) return true;
    if (/violates row-level security/i.test(msg)) return true;
    return false;
  };

  // Quick diag endpoint (still requires admin)
  if (isGET && (event.queryStringParameters?.diag === '1')) {
    if (supabaseUnavailable) {
      return {
        statusCode: 200,
        headers: baseHeaders,
        body: JSON.stringify({
          ok: false,
          error: supabaseError?.message || 'supabase_unavailable',
          who: { email: user?.email, roles },
          usingServiceKey,
          note: 'Supabase client missing — serving static data only.'
        })
      };
    }

    // Try a cheap HEAD count to see if the table is even visible
    const headCount = await supabase
      .from('candidates')
      .select('*', { count: 'exact', head: true });

    return {
      statusCode: headCount.error ? 500 : 200,
      headers: baseHeaders,
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

  if (supabaseUnavailable) {
    return serveStatic(supabaseError?.message || 'supabase_unavailable');
  }

  let query = supabase
    .from('candidates')
    .select('*', { count: 'exact' });

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
    console.warn('[candidates] supabase query failed — falling back to static data', error.message || error);
    if (!shouldFallback(error)) {
      console.warn('[candidates] forcing fallback for unexpected error');
    }
    return serveStatic(error.message);
  }

  // Compute meta
  const total = count ?? 0;       // Supabase returns total after filters with count:'exact'
  const filtered = total;         // We requested count against the filtered selection
  const pages = Math.max(1, Math.ceil(filtered / pageSize));

  const normalisedRows = (rows || []).map(toCandidate);

  const response = {
    rows: normalisedRows,
    total,
    filtered,
    pages,
    source: 'supabase',
    supabase: { ok: true },
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

  return { statusCode: 200, headers: baseHeaders, body: JSON.stringify(response) };
};
