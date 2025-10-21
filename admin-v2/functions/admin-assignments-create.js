// /netlify/functions/admin-assignments-create.js
// Create a new assignment row. Safe shim for SUPABASE_KEY so other pages
// using _supabase.js remain untouched.

/* ---- IMPORTANT: make sure _supabase.js sees a key at import time ---- */
process.env.SUPABASE_KEY =
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ADMIN_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

const { getClient } = require('./_supabase');
const { requireRole } = require('./_auth');
const supabase = getClient();

/* --------------------------- CORS / helpers --------------------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
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

const clean = (s, max = 500) =>
  (s == null ? null : String(s).trim().slice(0, max)) || null;

const toDateOrNull = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(+d) ? d.toISOString().slice(0, 10) : null; // YYYY-MM-DD
};

async function findClientIdByName(name) {
  if (!name) return null;
  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .ilike('name', `%${name}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

async function findCandidateIdByName(name) {
  if (!name) return null;
  const { data, error } = await supabase
    .from('candidates')
    .select('id')
    .ilike('full_name', `%${name}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

/* -------------------------------- handler ----------------------------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return ok(204);
    if (event.httpMethod !== 'POST') return err(405, 'Method Not Allowed');

    if (!process.env.SUPABASE_KEY) return err(400, 'supabaseKey is required.');

    await requireRole(event, 'admin');

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

    // Best-effort lookups by name if IDs not supplied
    try {
      if (!payload.client_id && payload.client_name) {
        payload.client_id = await findClientIdByName(payload.client_name);
      }
      if (!payload.candidate_id && payload.candidate_name) {
        payload.candidate_id = await findCandidateIdByName(payload.candidate_name);
      }
    } catch (lookupErr) {
      // Non-fatal: keep going with the display names
      console.warn('[assignments-create] lookup warning:', lookupErr?.message || lookupErr);
    }

    // Build the row for insert
    const row = {
      title: payload.title,
      status: 'draft',
      po_number: payload.po_number,
      shift: payload.shift,
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
      shift: inserted.shift || 'Day',
      po_number: inserted.po_number || null,
      estimated_hours: inserted.estimated_hours || null,
    };

    return ok(200, { ok: true, assignment: out });
  } catch (e) {
    return err(400, e?.message || String(e));
  }
};
