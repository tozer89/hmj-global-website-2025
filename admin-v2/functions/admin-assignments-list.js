// admin-assignments-list.js

process.env.SUPABASE_KEY =
  process.env.SUPABASE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_ADMIN_KEY
  || process.env.SUPABASE_ANON_KEY
  || '';

// 2) Now it's safe to load helpers (they'll see SUPABASE_KEY)
const { sb, ok, bad, pre, bodyOf } = require('./_lib.js');

exports.handler = async (event) => {
  const pf = pre(event); if (pf) return pf;

  if (!process.env.SUPABASE_KEY) {
    return bad('supabaseKey is required.');
  }

  try {
    const {
      q = '',
      status = '',
      consultant = '',
      client = '',
      page = 1,
      pageSize = 20,
    } = bodyOf(event);

    const supa = sb();

    // Use the view you created (assignments_view)
    let query = supa
      .from('assignments_view')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (status)     query = query.eq('status', status);
    if (consultant) query = query.ilike('consultant_name', `%${consultant}%`);
    if (client)     query = query.ilike('client_name', `%${client}%`);
    if (q)          query = query.or(
      [
        `title.ilike.%${q}%`,
        `candidate_name.ilike.%${q}%`,
        `client_name.ilike.%${q}%`,
        `po_number.ilike.%${q}%`,
        `as_ref.ilike.%${q}%`
      ].join(',')
    );

    const { data, error, count } = await query;
    if (error) throw error;

    return ok({ items: data, total: count ?? (data?.length || 0) });
  } catch (e) {
    return bad(String(e.message || e));
  }
};
