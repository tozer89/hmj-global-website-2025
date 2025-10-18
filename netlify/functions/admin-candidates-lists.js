// netlify/functions/admin-candidates-lists.js
const { getContext } = require('./_auth.js');

/** Safety: only allow sorting by these keys */
const SORT_WHITELIST = new Set(['name', 'created_at', 'updated_at', 'status', 'pay_type']);

exports.handler = async (event, context) => {
  try {
    const payload = JSON.parse(event.body || '{}');
    const {
      q = '',
      type = '',
      status = '',
      job = '',
      emailHas = '',
      page = 1,
      size = 25,
      sort = { key: 'name', dir: 'asc' },
      debug = false
    } = payload;

    const ctx = await getContext(event, context, { requireAdmin: true, debug });

    // We’ll use the admin client from getContext()
    const svc = ctx.supabase;

    // Build base select with count
    // Add/rename columns here to match your real schema
    // IMPORTANT: Do not reference non-existent columns.
    let query = svc
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
          // bank fields (read-only for list view; editor can use them)
          'bank_name',
          'bank_sort_code',
          'bank_account',
          'created_at',
          'updated_at'
        ].join(','),
        { count: 'exact' }
      );

    const applied = { filters: {}, order: '', range: '', debug };

    // Global quick search across name/email/phone
    if (q && q.trim()) {
      const s = `%${q.trim()}%`;
      query = query.or(
        [
          `first_name.ilike.${s}`,
          `last_name.ilike.${s}`,
          `email.ilike.${s}`,
          `phone.ilike.${s}`
        ].join(',')
      );
      applied.filters.q = q;
    }

    if (type) { query = query.eq('pay_type', type); applied.filters.type = type; }
    if (status) { query = query.eq('status', status); applied.filters.status = status; }
    if (job) { query = query.ilike('job_title', `%${job}%`); applied.filters.job = job; }
    if (emailHas) { query = query.ilike('email', `%${emailHas}%`); applied.filters.emailHas = emailHas; }

    // Sorting
    const sortKey = SORT_WHITELIST.has((sort?.key || '').toString()) ? sort.key : 'name';
    const asc = (sort?.dir || 'asc').toLowerCase() !== 'desc';

    if (sortKey === 'name') {
      // Order by last_name, then first_name for stable sort
      query = query.order('last_name', { ascending: asc }).order('first_name', { ascending: asc });
      applied.order = `last_name ${asc ? 'ASC' : 'DESC'}, first_name ${asc ? 'ASC' : 'DESC'}`;
    } else {
      query = query.order(sortKey, { ascending: asc });
      applied.order = `${sortKey} ${asc ? 'ASC' : 'DESC'}`;
    }

    // Pagination
    const p = Math.max(1, parseInt(page, 10) || 1);
    const s = Math.min(500, Math.max(1, parseInt(size, 10) || 25)); // cap for safety
    const from = (p - 1) * s;
    const to = from + s - 1;
    query = query.range(from, to);
    applied.range = `${from}-${to}`;

    // Execute
    const { data, error, count } = await query;
    if (error) throw error;

    const total = count || 0;
    const filtered = count || 0;
    const pages = Math.max(1, Math.ceil(filtered / s));

    // Prepare rows; add a computed full_name for convenience (UI can ignore if not needed)
    const rows = (data || []).map(r => ({
      ...r,
      full_name: [r.first_name, r.last_name].filter(Boolean).join(' ')
    }));

    const body = {
      rows,
      total,
      filtered,
      pages,
      page: p,
      size: s
    };

    if (debug) {
      body._debug = {
        email: ctx.user?.email || null,
        isAdmin: ctx.isAdmin === true,
        applied
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(body)
    };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
