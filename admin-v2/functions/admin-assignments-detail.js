// admin-assignments-detail.js
// Returns a single assignment, normalised for the Admin UI.

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
  try {
    const mod = require('./_supabase');
    if (typeof mod.sb === 'function') return mod.sb();
    if (typeof mod.getClient === 'function') return mod.getClient();
  } catch (_) {}
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
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const ok  = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: b ? JSON.stringify(b) : '' });
const err = (s, m, extra={}) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify({ error: m, ...extra }) });

function getId(event) {
  const qs   = event.queryStringParameters || {};
  const body = event.httpMethod === 'POST' && event.body ? JSON.parse(event.body) : {};
  const id   = Number(qs.id ?? body.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}
async function requireRole(event, role) {
  try { return await require('./_auth').requireRole(event, role); } catch (_) { return; }
}

/* -------------------------------- handler ---------------------------------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return ok(204);
    if (!['GET', 'POST'].includes(event.httpMethod)) return err(405, 'Method Not Allowed');

    await requireRole(event, 'admin');

    const id = getId(event);
    if (!id) return err(400, 'Invalid or missing id');

    // Use denormalised columns; try related names if FKs exist.
    let { data, error } = await supabase
      .from('assignments')
      .select(`
        id, title, status, po_number, shift_type, estimated_hours,
        start_date, end_date, client_id, candidate_id,
        client_name, candidate_name,
        clients!assignments_client_id_fkey ( name ),
        candidates!assignments_candidate_id_fkey ( full_name, first_name, last_name )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data)  return err(404, 'Assignment not found');

    const resolvedClient =
      data.clients?.name ?? data.client_name ?? null;

    const resolvedCandidate =
      data.candidates?.full_name ??
      ((data.candidates?.first_name || data.candidates?.last_name)
        ? `${data.candidates?.first_name || ''} ${data.candidates?.last_name || ''}`.trim()
        : null) ??
      data.candidate_name ?? null;

    const out = {
      id: data.id,
      title: data.title || null,
      status: data.status || 'draft',
      po_number: data.po_number || null,
      shift: data.shift_type || 'Day',
      estimated_hours: data.estimated_hours || null,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      client_id: data.client_id || null,
      client_name: resolvedClient,
      candidate_id: data.candidate_id || null,
      candidate_name: resolvedCandidate
    };

    return ok(200, out);
  } catch (e) {
    const msg = e?.message || String(e);
    const status = /supabaseKey/i.test(msg) ? 400 : 502;
    return err(status, msg);
  }
};
