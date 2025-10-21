// /netlify/functions/admin-assignments-detail.js
// Return one assignment in a UI-friendly shape (used by Quick view).

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

function parseId(event) {
  const qs = event.queryStringParameters || {};
  const body = event.httpMethod === 'POST' && event.body ? JSON.parse(event.body) : {};
  const id = Number(qs.id ?? body.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Normalise any row (from base table or view) to the UI shape */
function mapAssignment(row) {
  if (!row) return null;

  const title =
    row.title != null ? row.title :
    row.job_title != null ? row.job_title :
    null;

  const shift =
    row.shift != null ? row.shift :
    row.shift_type != null ? row.shift_type :
    'Day';

  // estimated_hours: accept preformatted string, or build from days_per_week/hours_per_day
  let estimated_hours = null;
  if (row.estimated_hours != null && String(row.estimated_hours).trim() !== '') {
    estimated_hours = row.estimated_hours;
  } else if (row.days_per_week != null && row.hours_per_day != null) {
    estimated_hours = `${row.days_per_week} days/wk, ${row.hours_per_day} h/day`;
  }

  // Client name (view field, denormalised field, or nested foreign table)
  let client_name = null;
  if (row.client_name) client_name = row.client_name;
  else if (row.client && typeof row.client === 'object' && row.client.name) client_name = row.client.name;

  // Candidate name (view field, denormalised field, or nested)
  let candidate_name = null;
  if (row.candidate_name) {
    candidate_name = row.candidate_name;
  } else if (row.candidate && typeof row.candidate === 'object') {
    if (row.candidate.full_name) {
      candidate_name = row.candidate.full_name;
    } else {
      const fn = row.candidate.first_name || '';
      const ln = row.candidate.last_name || '';
      const combined = `${fn} ${ln}`.trim();
      candidate_name = combined || null;
    }
  }

  return {
    id: row.id,
    title,
    status: row.status || 'draft',
    po_number: row.po_number || row.po_ref || null,
    shift,
    estimated_hours,
    start_date: row.start_date || null,
    end_date:   row.end_date   || null,
    client_name,
    candidate_name,
    client_id:    row.client_id    ?? null,
    candidate_id: row.candidate_id ?? null,
  };
}

/* -------------------------------- handler ----------------------------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return ok(204);
    if (!['GET', 'POST'].includes(event.httpMethod)) return err(405, 'Method Not Allowed');

    if (!process.env.SUPABASE_KEY) return err(400, 'supabaseKey is required.');

    await requireRole(event, 'admin');

    const id = parseId(event);
    if (!id) return err(400, 'Invalid or missing id');

    // Prefer the base table; if not found, fall back to the view
    let { data, error } = await supabase
      .from('assignments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      const alt = await supabase
        .from('assignments_view')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (alt.error) throw alt.error;
      data = alt.data;
    }

    if (!data) return err(404, 'Assignment not found');

    const out = mapAssignment(data);
    return ok(200, out);
  } catch (e) {
    return err(400, e?.message || String(e));
  }
};
