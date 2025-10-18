// netlify/functions/admin-candidates-lists.js
const { getContext, coded } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const dbg = !!body.debug;

    const { user, roles, supabase } = await getContext(event, context, {
      requireAdmin: true,
      debug: dbg,
    });

    if (dbg) console.log('[cands:list] user:', user.email, 'roles:', roles, 'body:', body);

    const {
      q = '',
      type = '',
      status = '',
      job = '',
      emailHas = '',
      page = 1,
      size = 25,
      sort = { key: 'name', dir: 'asc' },
    } = body;

    const p = Math.max(1, Number(page) || 1);
    const s = Math.min(200, Math.max(1, Number(size) || 25));
    const from = (p - 1) * s;
    const to = from + s - 1;

    // Columns in your "candidates" table (adjust if your names differ)
    const cols = [
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
      'bank_name',
      'bank_sort',
      'bank_account',
      'iban',
      'swift',
      'created_at',
      'updated_at',
    ].join(',');

    let q1 = supabase.from('candidates').select(cols, { count: 'exact' });

    // filters
    if (q?.trim()) {
      // global search (safe OR)
      const like = `%${q.trim()}%`;
      q1 = q1.or(
        [
          `first_name.ilike.${like}`,
          `last_name.ilike.${like}`,
          `email.ilike.${like}`,
          `phone.ilike.${like}`,
        ].join(',')
      );
    }
    if (type)    q1 = q1.eq('pay_type', type);
    if (status)  q1 = q1.eq('status', status);
    if (job)     q1 = q1.ilike('job_title', `%${job}%`);
    if (emailHas) q1 = q1.ilike('email', `%${emailHas}%`);

    // sort
    const key = (sort?.key || 'first_name');
    const dir = (String(sort?.dir || 'asc').toLowerCase() === 'desc') ? false : true;
    q1 = q1.order(key, { ascending: dir, nullsFirst: true });

    // paging
    q1 = q1.range(from, to);

    const { data: rows, error, count } = await q1;
    if (error) throw error;

    const total = count || 0;
    const filtered = total;               // because we asked for count after filters
    const pages = Math.max(1, Math.ceil(filtered / s));

    if (dbg) console.log('[cands:list] rows:', rows?.length || 0, 'total:', total, 'filtered:', filtered, 'pages:', pages);

    return {
      statusCode: 200,
      body: JSON.stringify({ rows: rows || [], total, filtered, pages, page: p }),
    };
  } catch (e) {
    const status = e.code === 401 || e.code === 403 ? e.code : 500;
    console.error('[cands:list] error:', e.message || e);
    return { statusCode: Number(status), body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
