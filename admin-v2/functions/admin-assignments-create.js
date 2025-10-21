// admin-assignments-create.js
// Creates a new assignment row for the admin UI.

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
const ok  = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: b ? JSON.stringify(b) : '' });
const err = (s, m, extra={}) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify({ error: m, ...extra }) });

const clean = (v, n=500) => (v == null ? null : String(v).trim().slice(0, n)) || null;
const toDateOrNull = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(+d) ? d.toISOString().slice(0,10) : null;
};

async function findClientIdByName(name) {
  if (!name) return null;
  const { data, error } = await supabase.from('clients').select('id').ilike('name', name).limit(1).maybeSingle();
  if (error) throw error;
  return data?.id || null;
}
async function findCandidateIdByName(name) {
  if (!name) return null;
  const { data, error } = await supabase.from('candidates').select('id').ilike('full_name', name).limit(1).maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

/* -------------------------------- handler ---------------------------------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return ok(204);
    if (event.httpMethod !== 'POST')    return err(405, 'Method Not Allowed');

    await requireRole(event, 'admin');
    if (!process.env.SUPABASE_KEY) return err(400, 'supabaseKey is required.');

    const body = event.body ? JSON.parse(event.body) : {};

    const payload = {
      title: clean(body.title, 200),
      po_number: clean(body.po_number, 120),
      shift: clean(body.shift, 40) || 'Day',
      start_date: toDateOrNull(body.start_date),
      end_date: toDateOrNull(body.end_date),
      client_site: clean(body.client_site, 200),
      estimated_hours: clean(body.estimated_hours, 200),
      notes: clean(body.notes, 4000),

      client_id: Number.isFinite(+body.client_id) ? +body.client_id : null,
      client_name: clean(body.client, 200),
      candidate_id: Number.isFinite(+body.candidate_id) ? +body.candidate_id : null,
      candidate_name: clean(body.candidate, 200),
    };

    if (!payload.title) return err(400, 'title is required');

    try {
      if (!payload.client_id && payload.client_name)
        payload.client_id = await findClientIdByName(payload.client_name);
      if (!payload.candidate_id && payload.candidate_name)
        payload.candidate_id = await findCandidateIdByName(payload.candidate_name);
    } catch { /* non-fatal */ }

    const row = {
      title: payload.title,
      status: 'draft',
      po_number: payload.po_number,
      shift_type: payload.shift,            // matches your schema (shift_type)
      start_date: payload.start_date,
      end_date: payload.end_date,
      estimated_hours: payload.estimated_hours,
      notes: payload.notes,

      client_id: payload.client_id,
      client_name: payload.client_name,
      client_site: payload.client_site,

      candidate_id: payload.candidate_id,
      candidate_name: payload.candidate_name,
    };

    const { data: inserted, error: insErr } = await supabase
      .from('assignments')
      .insert(row)
      .select()
      .single();

    if (insErr) return err(400, `Insert failed: ${insErr.message}`);

    const out = {
      id: inserted.id,
      title: inserted.title,
      status: inserted.status,
      start_date: inserted.start_date,
      end_date: inserted.end_date,
      client_id: inserted.client_id || null,
      client_name: inserted.client_name || payload.client_name || null,
      candidate_id: inserted.candidate_id || null,
      candidate_name: inserted.candidate_name || payload.candidate_name || null,
      shift: inserted.shift_type || 'Day',
      po_number: inserted.po_number || null,
      estimated_hours: inserted.estimated_hours || null,
    };

    return ok(200, { ok: true, assignment: out });
  } catch (e) {
    return err(502, e?.message || String(e));
  }
};
