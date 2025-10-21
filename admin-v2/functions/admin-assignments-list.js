// /netlify/functions/admin-assignments-list.js
// Lists assignments for the Admin page with filters + paging.

/* ---------------- Assignments-only env alias (do NOT edit _supabase.js) --- */
process.env.SUPABASE_KEY =
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ADMIN_KEY ||
  process.env.SUPABASE_ANON_KEY || '';

/* --------------------------------- shared ---------------------------------- */
const { getClient } = require('./_supabase');
const { requireRole } = require('./_auth');

const supabase = getClient();

/* --------------------------------- utils ----------------------------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const ok = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: body ? JSON.stringify(body) : '',
});

const err = (status, message, extra = {}) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify({ error: message, ...extra }),
});

function parseBody(event) {
  if (event.httpMethod === 'POST' && event.body) {
    try { return JSON.parse(event.body); } catch (_) { /* below */ }
    throw new Error('Invalid JSON body');
  }
  return {};
}

function pickNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/* ------------------------------ handler ------------------------------------ */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return ok(204);

    if (!['GET', 'POST'].includes(event.httpMethod)) {
      return err(405, 'Method Not Allowed');
    }

    // Auth: admin only
    await requireRole(event, 'admin');

    // Ensure we actually have a key (otherwise Supabase client 500s later)
    if (!process.env.SUPABASE_KEY) {
      return err(400, 'supabaseKey is required.');
    }

    // Accept filters from GET (?q=&status=&client=&consultant=&page=&pageSize=)
    // or POST body { q, status, client, consultant, page, pageSize }
    const qs = event.queryStringParameters || {};
    const body = parseBody(event);

    const q          = (body.q          ?? qs.q          ?? '').trim();
    const status     = (body.status     ?? qs.status     ?? '').trim();
    const client     = (body.client     ?? qs.client     ?? '').trim();
    const consultant = (body.consultant ?? qs.consultant ?? '').trim();

    const page     = pickNum(body.page     ?? qs.page, 1);
    const pageSize = pickNum(body.pageSize ?? qs.pageSize, 20);

    // Query the *view* so we always have denormalised names available
    let query = supabase
      .from('assignments_view')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (status)     query = query.eq('status', status);
    if (client)     query = query.ilike('client_name', `%${client}%`);
    if (consultant) query = query.ilike('consultant_name', `%${consultant}%`);
    if (q) {
      // broad search across common fields
      query = query.or([
        `title.ilike.%${q}%`,
        `candidate_name.ilike.%${q}%`,
        `client_name.ilike.%${q}%`,
        `as_ref.ilike.%${q}%`,
        `po_number.ilike.%${q}%`
      ].join(','));
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return ok(200, { rows: data || [], total: count ?? (data?.length || 0), page, pageSize });
  } catch (e) {
    // Surface the reason instead of a 502 so the UI can show it.
    console.error('[admin-assignments-list] error:', e?.message || e);
    return err(502, e?.message || String(e));
  }
};
