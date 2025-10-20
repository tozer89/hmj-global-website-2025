// admin-v2/admin/functions/admin-candidates-export.js
// Netlify Function: returns CSV as a JSON string

// --- Supabase project (your URL) ---
const SUPABASE_URL = 'https://uyedmszlnoctmysmydtn.supabase.co';

// Read a server-side key from env (Service Role preferred; anon works if RLS allows read)
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY;

// --- Columns in your public.candidates table ---
const SELECT = [
  'id',
  'ref',
  'first_name',
  'last_name',
  'email',
  'phone',
  'status',
  'created_at',
  'updated_at'
].join(',');

// Escape CSV field (RFC 4180-ish)
function csvEsc(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Escape CSV field (RFC 4180-ish)
function csvEsc(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(rows) {
  const header = SELECT.split(',').join(',');
  const lines = rows.map(r =>
    [
      r.id,
      r.ref,
      r.first_name,
      r.last_name,
      r.email,
      r.phone,
      r.status,
      r.created_at,
      r.updated_at
    ].map(csvEsc).join(',')
  );
  return [header, ...lines].join('\n');
}


exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify('Missing SUPABASE_URL or SERVICE ROLE/ANON key env var')
      };
    }

    const { q = '', status = '' } = JSON.parse(event.body || '{}');

    // Build PostgREST query
    const params = new URLSearchParams();
    params.set('select', SELECT);
    params.set('order', 'created_at.desc');
    params.set('limit', '2000');

    // Text search across a couple of columns using OR
    const term = String(q).trim();
    if (term) {
      // full_name/email/ref contains (case-insensitive)
      params.set(
        'or',
        `(full_name.ilike.*${encodeURIComponent(term)}*,email.ilike.*${encodeURIComponent(term)}*,ref.ilike.*${encodeURIComponent(term)}*)`
      );
    }

    if (status) params.set('status', `eq.${encodeURIComponent(status)}`);

    const url = `${SUPABASE_URL.replace(/\/+$/,'')}/rest/v1/candidates?${params.toString()}`;

    const res = await fetch(url, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Accept': 'application/json',
        'Prefer': 'count=none'
      }
    });

    if (!res.ok) {
      const txt = await res.text();
      return {
        statusCode: res.status,
        body: JSON.stringify(`Supabase error ${res.status}: ${txt}`)
      };
    }

    const rows = await res.json();
    const csv = toCSV(Array.isArray(rows) ? rows : []);

    // IMPORTANT:
    // We return a JSON STRING so your client’s api() JSON.parse() produces a string,
    // which your export code then turns into a Blob. (No client change required.)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // Optional: if you ever hit the URL directly you’ll get a download name
        'Content-Disposition': 'attachment; filename="candidates.csv"'
      },
      body: JSON.stringify(csv)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify(`Export failed: ${err && err.message ? err.message : String(err)}`)
    };
  }
};
