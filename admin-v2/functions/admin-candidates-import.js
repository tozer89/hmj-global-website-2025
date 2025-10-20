// admin-candidates-import.js
import { createClient } from '@supabase/supabase-js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-trace',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Tiny CSV parser with quoted-field support
function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { pushField(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { pushField(); pushRow(); i++; continue; }

    field += ch; i++;
  }
  // flush last
  pushField();
  if (row.length > 1 || (row.length === 1 && row[0] !== '')) pushRow();

  return rows;
}

function normaliseHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  // Body
  let csv = '';
  try {
    const b = JSON.parse(event.body || '{}');
    csv = String(b.csv || '');
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  if (!csv.trim()) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'csv is required' }) };
  }

  // Supabase
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE' }),
    };
  }
  const sb = createClient(url, key);

  // Parse CSV
  const table = parseCSV(csv);
  if (table.length === 0) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'CSV appears empty' }) };
  }

  const headers = table[0].map(normaliseHeader);
  const rows = table.slice(1);

  // Accepted columns (others ignored)
  // Add more keys here if your schema has them.
  const allowed = new Set(['id', 'ref', 'full_name', 'email', 'phone', 'status']);

  const records = rows
    .map(r => {
      const obj = {};
      headers.forEach((h, idx) => {
        if (!allowed.has(h)) return;
        const v = r[idx] ?? '';
        if (h === 'id') obj.id = v ? Number(v) : undefined;
        else obj[h] = v || null;
      });
      return obj;
    })
    // Skip completely empty lines
    .filter(o => Object.keys(o).length > 0 && (o.full_name || o.email || o.phone || o.ref || o.id));

  if (!records.length) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'No usable rows found' }) };
  }

  // Split into updates (has id) vs inserts
  const toUpdate = records.filter(r => Number.isFinite(r.id));
  const toInsert = records.filter(r => !Number.isFinite(r.id));

  const result = { inserted: 0, updated: 0, errors: [] };

  // Upserts by id when provided
  if (toUpdate.length) {
    const { data, error } = await sb.from('candidates').upsert(toUpdate, { onConflict: 'id' }).select('id');
    if (error) result.errors.push(`upsert: ${error.message}`);
    else result.updated = data?.length || 0;
  }

  // Plain inserts for new ones
  if (toInsert.length) {
    const { data, error } = await sb.from('candidates').insert(toInsert).select('id');
    if (error) result.errors.push(`insert: ${error.message}`);
    else result.inserted = data?.length || 0;
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
}
