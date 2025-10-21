// admin-assignments-list.js
// Lists assignments for the admin page with filtering + paging.

/* ---------- Assignments-only env alias (do not edit _supabase.js) ---------- */
process.env.SUPABASE_KEY =
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ADMIN_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

/* --------------------------------- shared ---------------------------------- */
const { sb } = require('./_supabase');   // <-- use sb, not getClient
const { requireRole } = require('./_auth');

const supabase = sb();

/* --------------------------------- utils ----------------------------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const ok  = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', ...CORS }, body: body ? JSON.stringify(body) : '' });
const err = (status, msg, extra={}) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify({ error: msg, ...extra }) });

const bodyOf = (e) => {
  try { return e.body ? JSON.parse(e.body) : {}; } catch { return {}; }
};

/* -------------------------------- handler ---------------------------------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return ok(204);
    if (event.httpMethod !== 'POST')    return err(405, 'Method Not Allowed');

    // Must be admin
    await requireRole(event, 'admin');

    // Ensure we actually have a usable key (after the alias above)
    if (!process.env.SUPABASE_KEY) return err(400, 'supabaseKey is required.');

    const { q = '', status = '', consultant = '', client = '', page = 1, pageSize = 20 } = bodyOf(event);

    let query = supabase
      .from('assignments_view')               // your denormalised view
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (status)     query = query.eq('status', status);
    if (consultant) query = query.ilike('consultant_name', `%${consultant}%`);
    if (client)     query = query.ilike('client_name', `%${client}%`);
    if (q)          query = query.or([
                      `job_title.ilike.%${q}%`,
                      `candidate_name.ilike.%${q}%`,
                      `client_name.ilike.%${q}%`,
                      `as_ref.ilike.%${q}%`
                    ].join(','));

    const { data, error, count } = await query;
    if (error) throw error;

    return ok(200, { rows: data || [], total: count ?? (data?.length || 0) });
  } catch (e) {
    return err(502, e?.message || String(e));
  }
};
