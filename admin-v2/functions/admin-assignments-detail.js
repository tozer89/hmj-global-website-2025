// /netlify/functions/admin-assignments-detail.js
// Returns one assignment with friendly, denormalised fields.
//
// Used by admin-v2/admin/assignments.html -> api('admin-assignments-detail', { id })

/* -------------------- SAFE, LOCAL SHIM (assignments-only) ------------------ */
// Do NOT edit _supabase.js. Some envs expose different key names.
// This alias ensures _supabase.js sees SUPABASE_KEY.
process.env.SUPABASE_KEY =
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ADMIN_KEY ||
  process.env.SUPABASE_ANON_KEY;

/* --------------------------- shared helpers -------------------------------- */
const { getClient } = require('./_supabase');
const { requireRole } = require('./_auth');

const supabase = getClient();

/* -------------------------------- CORS ------------------------------------- */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/* --------------------------------- util ------------------------------------ */
const ok = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', ...corsHeaders },
  body: body ? JSON.stringify(body) : '',
});

const err = (status, message, extra = {}) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', ...corsHeaders },
  body: JSON.stringify({ error: message, ...extra }),
});

exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') return ok(204);

    // Only GET/POST are supported
    if (!['GET', 'POST'].includes(event.httpMethod)) {
      return err(405, 'Method Not Allowed');
    }

    // Must be an admin
    await requireRole(event, 'admin');

    // Accept id from query string (?id=) or POST body { id }
    const qs = event.queryStringParameters || {};
    const body = event.httpMethod === 'POST' && event.body ? JSON.parse(event.body) : {};
    const id = Number(qs.id ?? body.id);

    if (!Number.isFinite(id) || id <= 0) {
      return err(400, 'Invalid or missing id');
    }

    // First try: fetch the row + related names via foreign-table select.
    // (Works if FK relationships are configured in Supabase.)
    let { data, error } = await supabase
      .from('assignments')
      .select(`
        id, title, status, po_number, shift, estimated_hours,
        start_date, end_date, client_id, candidate_id,
        client:clients ( name ),
        candidate:candidates ( full_name, first_name, last_name )
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return err(404, 'Assignment not found');

    // Derive display names
    const client_name =
      data.client?.name ?? data.client_name ?? null;

    const candidate_name =
      data.candidate?.full_name
      ?? (data.candidate?.first_name || data.candidate?.last_name
          ? `${data.candidate?.first_name || ''} ${data.candidate?.last_name || ''}`.trim()
          : (data.candidate_name ?? null));

    // If the project doesn’t have foreign-table selects wired up,
    // fetch names in two tiny queries (only if missing).
    let fetchedClientName = client_name;
    let fetchedCandidateName = candidate_name;

    if (!fetchedClientName && data.client_id) {
      const { data: cRow, error: cErr } = await supabase
        .from('clients')
        .select('name')
        .eq('id', data.client_id)
        .maybeSingle();
      if (cErr) throw cErr;
      fetchedClientName = cRow?.name ?? null;
    }

    if (!fetchedCandidateName && data.candidate_id) {
      const { data: pRow, error: pErr } = await supabase
        .from('candidates')
        .select('full_name, first_name, last_name')
        .eq('id', data.candidate_id)
        .maybeSingle();
      if (pErr) throw pErr;
      fetchedCandidateName =
        pRow?.full_name
        ?? (pRow?.first_name || pRow?.last_name
            ? `${pRow?.first_name || ''} ${pRow?.last_name || ''}`.trim()
            : null);
    }

    // Shape exactly what the UI expects
    const out = {
      id: data.id,
      title: data.title,
      status: data.status || 'draft',
      po_number: data.po_number || null,
      shift: data.shift || 'Day',
      estimated_hours: data.estimated_hours || null,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      client_name: fetchedClientName || null,
      candidate_name: fetchedCandidateName || null,
      client_id: data.client_id || null,
      candidate_id: data.candidate_id || null,
    };

    return ok(200, out);
  } catch (e) {
    // Normalise error text for easy console reading
    const message = e?.message || String(e);
    return err(400, message);
  }
};
