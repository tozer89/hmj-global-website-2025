// /netlify/functions/admin-assignments-list.js
// List assignments for the Admin UI with paging + filters.

/* ---- Make sure _supabase.js sees a key at import time ---- */
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

/** Parse body safely */
function bodyOf(event) {
  try { return event.body ? JSON.parse(event.body) : {}; }
  catch { return {}; }
}

/** Normalise any row (table or view) to the UI’s list shape */
function mapRow(r) {
  const title =
    r.title != null ? r.title :
    r.job_title != null ? r.job_title : null;

  const shift =
    r.shift != null ? r.shift :
    r.shift_type != null ? r.shift_type : 'Day';

  let estimated_hours = null;
  if (r.estimated_hours != null && String(r.estimated_hours).trim() !== '') {
    estimated_hours = r.estimated_hours;
  } else if (r.days_per_week != null && r.hours_per_day != null) {
    estimated_hours = `${r.days_per_week} days/wk, ${r.hours_per_day} h/day`;
  }

  return {
    id: r.id,
    title,
    client_name: r.client_name ?? (r.client && r.client.name) ?? null,
    candidate_name:
      r.candidate_name ??
      (r.candidate && (r.candidate.full_name ||
        `${r.candidate.first_name || ''} ${r.candidate.last_name || ''}`.trim())) ||
      null,
    start_date: r.start_date || null,
    end_date: r.end_date || null,
    status: r.status || 'draft',
    po_number: r.po_number || r.po_ref || null,
    shift,
    estimated_hours,
  };
}

/* -------------------------------- handler ----------------------------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return ok(204);
    if (event.httpMethod !== 'POST') return err(405, 'Method Not Allowed');

    if (!process.env.SUPABASE_KEY) return err(400, 'supabaseKey is required.');

    // Must be admin
    await requireRole(event, 'admin');

    const {
      q = '',
      status = '',
      consultant = '',
      client = '',
      page = 1,
      pageSize = 20,
    } = bodyOf(event);

    const from = (Number(page) - 1) * Number(pageSize);
    const to = from + Number(pageSize) - 1;

    // Prefer the base table; if it doesn’t exist or errors, fallback to the view.
    const run = async (source) => {
      let query = supabase.from(source)
        .select('*', { count: 'exact' })
        // created_at is on your view; for the base table we coalesce below by end/start dates.
        .order('created_at', { ascending: false, nullsFirst: false })
        .range(from, to);

      if (status)     query = query.eq('status', status);
      if (consultant) query = query.ilike('consultant_name', `%${consultant}%`);
      if (client)     query = query.ilike('client_name', `%${client}%`);
      if (q) {
        // match common list columns
        query = query.or([
          `title.ilike.%${q}%`,
          `job_title.ilike.%${q}%`,
          `candidate_name.ilike.%${q}%`,
          `client_name.ilike.%${q}%`,
          `po_number.ilike.%${q}%`,
          `po_ref.ilike.%${q}%`,
          `as_ref.ilike.%${q}%`,
        ].join(','));
      }
      return query;
    };

    let data, count;

    // Try base table first
    let res = await run('assignments');
    if (res.error) {
      // Fallback to the view (e.g. when created_at exists there)
      res = await run('assignments_view');
      if (res.error) throw res.error;
    }
    data = res.data || [];
    count = res.count ?? data.length;

    // If the base table was used and doesn’t have created_at, emulate a stable order
    if (data.length && !('created_at' in data[0])) {
      data.sort((a, b) => {
        // prefer closed_at/start_date/end_date descending-ish
        const av = new Date(a.closed_at || a.start_date || a.end_date || 0).getTime();
        const bv = new Date(b.closed_at || b.start_date || b.end_date || 0).getTime();
        return bv - av;
      });
    }

    const rows = data.map(mapRow);
    return ok(200, { rows, total: count });
  } catch (e) {
    return err(400, e?.message || String(e));
  }
};
