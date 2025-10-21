// admin-assignments-detail.js
// Returns one assignment with friendly, denormalised fields for the admin UI.

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
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const ok  = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', ...CORS }, body: body ? JSON.stringify(body) : '' });
const err = (status, msg, extra={}) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify({ error: msg, ...extra }) });

const getId = (event) => {
  const qs   = event.queryStringParameters || {};
  const body = event.httpMethod === 'POST' && event.body ? JSON.parse(event.body) : {};
  const id   = Number(qs.id ?? body.id);
  return Number.isFinite(id) && id > 0 ? id : null;
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return ok(204);
    if (!['GET', 'POST'].includes(event.httpMethod)) return err(405, 'Method Not Allowed');

    await requireRole(event, 'admin');
    if (!process.env.SUPABASE_KEY) return err(400, 'supabaseKey is required.');

    const id = getId(event);
    if (!id) return err(400, 'Invalid or missing id');

    // Try to fetch with related names if relationships are declared
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

    // Normalise display fields
    const nameFromJoins =
      data.clients?.name ||
      data.client_name ||
      null;

    const candidateFromJoins =
      data.candidates?.full_name ||
      (data.candidates?.first_name || data.candidates?.last_name
        ? `${data.candidates?.first_name || ''} ${data.candidates?.last_name || ''}`.trim()
        : null) ||
      data.candidate_name ||
      null;

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
      client_name: nameFromJoins,
      candidate_id: data.candidate_id || null,
      candidate_name: candidateFromJoins
    };

    return ok(200, out);
  } catch (e) {
    return err(502, e?.message || String(e));
  }
};
