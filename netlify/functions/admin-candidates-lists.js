// netlify/functions/admin-candidates-lists.js
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

/*
  Request body:
  {
    q: string,           // search term (name/email/phone)
    type: string,        // pay_type filter (optional)
    status: string,      // status filter (optional)
    job: string,         // job_title contains
    emailHas: string,    // email contains
    page: number,        // 1-based
    size: number,        // rows per page
    sort: { key, dir },  // optional { key: 'first_name'|'created_at'|..., dir: 'asc'|'desc' }
    debug: boolean
  }

  Response shape:
  {
    rows: Candidate[],
    total: number,       // total rows in table (unfiltered)
    filtered: number,    // rows after filters
    pages: number        // Math.ceil(filtered/size)
  }
*/

exports.handler = async (event, context) => {
  try {
    await getContext(context, { requireAdmin: true });

    const body = JSON.parse(event.body || '{}');
    const {
      q = '',
      type = '',
      status = '',
      job = '',
      emailHas = '',
      page = 1,
      size = 25,
      sort = { key: 'id', dir: 'asc' },
      debug = false,
    } = body;

    // Validate paging
    const p = Math.max(1, Number(page) || 1);
    const s = Math.min(500, Math.max(1, Number(size) || 25));
    const from = (p - 1) * s;
    const to = from + s - 1;

    // Base selects
    //  - We select "*" to avoid crashing if optional columns (e.g., address) don’t exist yet.
    //  - We request an exact count for total/filtered numbers.
    let base = supabase
      .from('candidates')
      .select('*', { count: 'exact', head: false });

    // Filters (only on commonly-present columns)
    const orParts = [];
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      // Only use columns that exist in your schema:
      // first_name, last_name, email, phone are typical.
      orParts.push(`first_name.ilike.${like}`);
      orParts.push(`last_name.ilike.${like}`);
      orParts.push(`email.ilike.${like}`);
      orParts.push(`phone.ilike.${like}`);
    }
    if (type) {
      base = base.eq('pay_type', type);
    }
    if (status) {
      base = base.eq('status', status);
    }
    if (job) {
      base = base.ilike('job_title', `%${job}%`);
    }
    if (emailHas) {
      base = base.ilike('email', `%${emailHas}%`);
    }
    if (orParts.length) {
      base = base.or(orParts.join(','));
    }

    // Sorting (fall back safely)
    const sortable = new Set(['id', 'first_name', 'last_name', 'email', 'created_at', 'updated_at', 'status', 'pay_type', 'job_title']);
    const sortKey = sortable.has(String(sort?.key)) ? String(sort.key) : 'id';
    const sortDir = String(sort?.dir).toLowerCase() === 'desc' ? false : true; // ascending if not 'desc'

    base = base.order(sortKey, { ascending: sortDir, nullsFirst: true });

    // Clone for filtered-count: PostgREST returns count together with data, so we’ll just use the returned count
    // and get total separately with a light count-only query (no filters).
    const totalRes = await supabase.from('candidates').select('*', { count: 'exact', head: true });
    if (totalRes.error) throw totalRes.error;

    // Page slice
    const pageRes = await base.range(from, to);
    if (pageRes.error) throw pageRes.error;

    const rows = pageRes.data || [];
    const filtered = pageRes.count ?? rows.length;
    const pages = Math.max(1, Math.ceil(filtered / s));

    if (debug) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          debug: {
            input: body,
            paging: { page: p, size: s, from, to },
            sort: { key: sortKey, asc: sortDir },
            total: totalRes.count ?? null,
            filtered,
          },
          rows,
          total: totalRes.count ?? filtered,
          filtered,
          pages,
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        rows,
        total: totalRes.count ?? filtered,
        filtered,
        pages,
      }),
    };
  } catch (e) {
    const status =
      e?.status || e?.code === 401
        ? 401
        : e?.code === 403
        ? 403
        : 500;

    return {
      statusCode: status,
      body: JSON.stringify({ error: e?.message || 'Server error' }),
    };
  }
};
