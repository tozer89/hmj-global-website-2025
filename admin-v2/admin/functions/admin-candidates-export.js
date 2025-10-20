// admin-candidates-export.js
// Returns CSV *as a JSON string* (so your existing client download logic still works)
const { supa, ok, err, parseBody } = require('./_lib.js');
const { requireAdmin } = require('./_guard.js');

// CSV columns (must match below mapping order)
const HEADERS = [
  'id',
  'ref',
  'first_name',
  'last_name',
  'full_name',
  'email',
  'phone',
  'status',
  'created_at',
  'updated_at'
];

// Escape CSV field (RFC 4180-ish)
function csvEsc(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(rows) {
  const header = HEADERS.join(',');
  const lines = rows.map(r => HEADERS.map(h => csvEsc(r[h])).join(','));
  return [header, ...lines].join('\n');
}

exports.handler = async (event) => {
  try {
    requireAdmin(event);

    const { q = '', status = '' } = parseBody(event) || {};
    const s = supa();

    let qBuilder = s
      .from('candidates')
      .select('id, ref, first_name, last_name, email, phone, status, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(2000);

    if (status && String(status).trim()) qBuilder = qBuilder.eq('status', status);

    const term = String(q || '').trim();
    if (term) {
      const like = `%${term}%`;
      qBuilder = qBuilder.or(
        [
          `first_name.ilike.${like}`,
          `last_name.ilike.${like}`,
          `email.ilike.${like}`,
          `ref.ilike.${like}`,
        ].join(',')
      );
    }

    const { data, error } = await qBuilder;
    if (error) throw error;

    const rows = (data || []).map(r => ({
      ...r,
      full_name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
    }));

    const csv = toCSV(rows);

    // Important: return CSV inside JSON so your api() helper JSON.parses it to a string
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(csv)
    };
  } catch (e) {
    return err(e.message || e, e.status || 500);
  }
};
