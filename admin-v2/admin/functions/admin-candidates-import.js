// admin-candidates-import.js
// Import candidates from a CSV string sent in the POST body.
// Body: { csv: "<entire CSV text>" }

const { supa, ok, err, parseBody } = require('./_lib.js');
const { requireAdmin } = require('./_guard.js');

// Accept these columns (case-insensitive). Extra columns are ignored.
const ALLOWED = new Set([
  'id', 'ref', 'full_name', 'name', 'email', 'phone', 'status',
  'created_at', 'updated_at'
]);

// Normalise header names to our schema
function normHeader(h) {
  const k = String(h || '').trim().toLowerCase();
  if (k === 'name') return 'full_name';
  return k;
}

// RFC-ish CSV parser (handles quotes, commas, newlines)
function parseCSV(text) {
  const rows = [];
  let i = 0, s = text || '', len = s.length;
  let row = [], cell = '', inQ = false;

  const pushCell = () => { row.push(cell); cell = ''; };
  const pushRow  = () => { rows.push(row); row = []; };

  while (i < len) {
    const ch = s[i++];
    if (inQ) {
      if (ch === '"') {
        if (s[i] === '"') { cell += '"'; i++; }       // escaped quote
        else { inQ = false; }
      } else {
        cell += ch;
      }
    } else {
      if (ch === ',') pushCell();
      else if (ch === '\n') { pushCell(); pushRow(); }
      else if (ch === '\r') {
        if (s[i] === '\n') i++;
        pushCell(); pushRow();
      } else if (ch === '"') {
        inQ = true;
      } else {
        cell += ch;
      }
    }
  }
  // last cell/row
  pushCell();
  if (row.length > 1 || (row.length === 1 && row[0] !== '')) pushRow();
  return rows;
}

// Convert CSV text → array of objects using first row as headers
function csvToObjects(csv) {
  const raw = parseCSV(csv);
  if (!raw.length) return { headers: [], rows: [] };

  const headers = raw[0].map(normHeader);
  const allowedIdx = headers.map((h, idx) => (ALLOWED.has(h) ? idx : -1));

  const rows = [];
  for (let r = 1; r < raw.length; r++) {
    const rowArr = raw[r];
    const obj = {};
    allowedIdx.forEach((idx, c) => {
      if (idx === -1) return;
      const key = normHeader(raw[0][c]);
      obj[key] = (rowArr[c] ?? '').toString().trim();
    });
    rows.push(obj);
  }
  return { headers, rows };
}

exports.handler = async (event) => {
  try {
    requireAdmin(event);

    if (event.httpMethod !== 'POST') {
      const e = new Error('Method Not Allowed'); e.status = 405; throw e;
    }

    const { csv } = parseBody(event);
    if (!csv || typeof csv !== 'string') {
      const e = new Error('csv (string) required'); e.status = 400; throw e;
    }

    const { rows } = csvToObjects(csv);

    if (!rows.length) return ok({ inserted: 0, skipped: 0, errors: [] });

    // Normalise rows to our schema & defaults
    const cleaned = [];
    const errors = [];
    let skipped = 0;

    rows.forEach((r, idx) => {
      // Minimal viable row: either full_name or email present
      if (!r.full_name && !r.email) {
        skipped++;
        errors.push({ line: idx + 2, error: 'Missing full_name/email' }); // +2 = header + 1-based
        return;
      }
      const row = {
        ref: r.ref || null,
        full_name: r.full_name || null,
        email: r.email || null,
        phone: r.phone || null,
        status: (r.status || 'active').toLowerCase(),
      };
      cleaned.push(row);
    });

    // Insert with ignoreDuplicates (relies on your unique constraints if any)
    const { data, error } = await supa()
      .from('candidates')
      .insert(cleaned, { ignoreDuplicates: true })
      .select('id');

    if (error) throw error;

    const inserted = Array.isArray(data) ? data.length : 0;

    return ok({ inserted, skipped, errors });

  } catch (e) {
    return err(e.message || e, e.status || 500);
  }
};
