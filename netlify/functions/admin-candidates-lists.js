// netlify/functions/admin-candidates-lists.js
const { getContext, coded } = require('./_auth.js');

/**
 * Lists candidates with filters + paging.
 * IMPORTANT: only select columns that exist in your table.
 * Bank fields are NOT selected here (only in the GET endpoint),
 * so missing bank columns won’t break the list view.
 */
exports.handler = async (event, context) => {
  try {
    const debugFlag = (JSON.parse(event.body || '{}').debug === true);
    const { supabase } = await getContext(event, context, {
      requireAdmin: true,
    });

    const body = JSON.parse(event.body || '{}');
    const {
      q = '',
      type = '',
      status = '',
      job = '',
      emailHas = '',
      page = 1,
      size = 25,
      sort = { key: 'name', dir: 'asc' }, // UI sends {key,dir}
    } = body;

    const pageSize = Math.max(1, Math.min(Number(size) || 25, 500));
    const pageNow = Math.max(1, Number(page) || 1);
    const from = (pageNow - 1) * pageSize;
    const to = from + pageSize - 1;

    // --- Build base query against *existing* columns only
    // Adjust this list to match your real schema
    const SELECT = [
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
      'updated_at',
      'created_at',
    ].join(',');

    let query = supabase
      .from('candidates')
      .select(SELECT, { count: 'exact' }); // we’ll read total from count

    // --- Filters (safe)
    if (q && q.trim()) {
      // name/email/phone contains
      query = query.or([
        `first_name.ilike.%${q}%`,
        `last_name.ilike.%${q}%`,
        `email.ilike.%${q}%`,
        `phone.ilike.%${q}%`,
      ].join(','));
    }
    if (type)   query = query.eq('pay_type', type);
    if (status) query = query.eq('status', status);
    if (job)    query = query.ilike('job_title', `%${job}%`);
    if (emailHas) query = query.ilike('email', `%${emailHas}%`);

    // --- Sorting (map name → first/last)
    const sortKey = (sort?.key === 'name') ? 'last_name' : (sort?.key || 'updated_at');
    const sortDir = (String(sort?.dir || 'asc').toLowerCase() === 'desc') ? { ascending: false } : { ascending: true };
    query = query.order(sortKey, sortDir).order('id', { ascending: true });

    // --- Paging
    query = query.range(from, to);

    const { data, count, error } = await query;
    if (error) throw error;

    const total = count ?? (data?.length || 0);
    const pages = Math.max(1, Math.ceil(total / pageSize));

    const payload = {
      rows: data || [],
      total,
      filtered: total, // if you later compute pre-filter totals, change this
      pages,
    };

    // Optional debug echo to help in the browser console
    if (debugFlag) payload.debug = {
      filters: { q, type, status, job, emailHas },
      sort: { key: sortKey, dir: sortDir.ascending ? 'asc' : 'desc' },
      page: { pageNow, pageSize, from, to },
      selected: SELECT.split(','),
    };

    return { statusCode: 200, body: JSON.stringify(payload) };
  } catch (e) {
    const status = e.code === 401 ? 401 : (e.code === 403 ? 403 : 500);
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
