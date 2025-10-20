// admin-candidates-import.js
// Body: { csv: "<entire CSV text>" }
const { supa, ok, err, parseBody } = require('./_lib.js');
const { requireAdmin } = require('./_guard.js');

const ALLOWED = new Set([
  'id', 'ref', 'first_name', 'last_name', 'full_name', 'name',
  'email', 'phone', 'status', 'created_at', 'updated_at'
]);

// normalize header names
function normHeader(h) {
  const k = String(h || '').trim().toLowerCase();
  if (k === 'name') return 'full_name';
  return k;
}

// split "First Last" → { first_name, last_name }
function splitName(full) {
  const t = String(full || '').trim();
  if (!t) return { first_name: null, last_name: null };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts.slice(-1).join(' ') };
}

// minimal CSV parser (quotes, commas, CRLF)
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
        if (s[i] === '"') { cell += '"'; i++; } else { inQ = false; }
      } else cell += ch;
    } else {
      if (ch === ',') pushCell();
      else if (ch === '\n') { pushCell(); pushRow(); }
      else if (ch === '\r') { if (s[i] === '\n') i++; pushCell(); pushRow(); }
      else if (ch === '"') inQ = true;
      else cell += ch;
    }
  }
  pushCell();
  if (row.length > 1 || (row.length === 1 && row[0] !== '')) pushRow();
  return rows;
}

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
      const key = headers[c];
      obj[key] = (rowArr[c] ?? '').toString().trim();
    });
    rows.push(obj);
  }
  return { headers, rows };
}

exports.handler = async (event) => {
  try {
    requireAdmin(event);
    const { csv } = parseBody(event) || {};
    if (!csv || typeof csv !== 'string') {
      const e = new Error('csv (string) required'); e.status = 400; throw e;
    }

    const { rows } = csvToObjects(csv);
    if (!rows.length) return ok({ inserted: 0, skipped: 0, errors: [] });

    const cleaned = [];
    const errors = [];
    let skipped = 0;

    rows.forEach((r, idx) => {
      // prefer explicit first/last; fall back to full_name/name
      let first_name = (r.first_name || '').trim();
      let last_name  = (r.last_name || '').trim();

      if ((!first_name || !last_name) && (r.full_name || r.name)) {
        const { first_name: f, last_name: l } = splitName(r.full_name || r.name);
        if (!first_name) first_name = f || '';
        if (!last_name)  last_name  = l || '';
      }

      const hasNameOrEmail = (first_name || last_name || r.email);
      if (!hasNameOrEmail) {
        skipped++;
        errors.push({ line: idx + 2, error: 'Missing name/email' });
        return;
      }

      const row = {
        ref: r.ref || null,
        first_name: first_name || null,
        last_name:  last_name  || null,
        email: r.email || null,
        phone: r.phone || null,
        status: (r.status || 'active').toLowerCase(),
      };
      cleaned.push(row);
    });

    if (!cleaned.length) return ok({ inserted: 0, skipped, errors });

    // Insert (ignoreDuplicates relies on your unique constraints; if none, all will insert)
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
