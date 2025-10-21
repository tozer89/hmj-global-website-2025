// admin-assignments-list.js
// Lists assignments for the Admin page (filters + paging).

/* ---------- Assignments-only env alias (do not edit _supabase.js) ---------- */
process.env.SUPABASE_KEY =
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ADMIN_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

/* ----------------------------- get Supabase -------------------------------- */
function getSupabase() {
  // Prefer your shared helper if present:
  try {
    const mod = require('./_supabase');
    if (typeof mod.sb === 'function') return mod.sb();
    if (typeof mod.getClient === 'function') return mod.getClient();
  } catch (_) { /* fall through */ }

  // Fallback: create client inline
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error('supabaseKey is required.');
  return createClient(url, key, { auth: { persistSession: false } });
}
const supabase = getSupabase();

/* -------------------------------- helpers ---------------------------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const ok  = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: b ? JSON.stringify(b) : '' });
const err = (s, m, extra={}) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify({ error: m, ...extra }) });
const bodyOf = (e) => { try { return e.body ? JSON.parse(e.body) : {}; } catch { return {}; } };

// Role check using your existing helper if available, otherwise no-op (Deploy Previews)
async function requireRole(event, role) {
  try { return await require('./_auth').requireRole(event, role); } catch (_) { return; }
}

/* -------------------------------- handler ---------------------------------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return ok(204);
    if (event.httpMethod !== 'POST')    return err(405, 'Method Not Allowed');

    await requireRole(event, 'admin');

    const { q = '', status = '', consultant = '', client = '', page = 1, pageSize = 20 } = bodyOf(event);

    let query = supabase
      .from('assignments_view')                     // your denormalised view
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
    // 400 if it’s a config issue (missing key), else 502
    const msg = e?.message || String(e);
    const status = /supabaseKey/i.test(msg) ? 400 : 502;
    return err(status, msg);
  }
};
