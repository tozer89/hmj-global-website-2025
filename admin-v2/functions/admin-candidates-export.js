// admin-candidates-export.js
import { createClient } from '@supabase/supabase-js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-trace',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(rows, cols) {
  const head = cols.map(c => csvEscape(c.header)).join(',');
  const body = rows
    .map(r => cols.map(c => csvEscape(r[c.key])).join(','))
    .join('\n');
  return head + '\n' + body + '\n';
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  // Read filters
  let q = '', status = '';
  try {
    const b = JSON.parse(event.body || '{}');
    q = (b.q || '').trim();
    status = (b.status || '').trim();
  } catch {}

  // Supabase (service role)
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    return {
      statusCode: 500,
      headers: cors,
      body: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE',
    };
  }
  const sb = createClient(url, key);

  // Build query
  let query = sb.from('candidates').select(
    `
      id,
      ref,
      full_name,
      email,
      phone,
      status
    `
  ).order('id', { ascending: false });

  if (status) query = query.eq('status', status);

  if (q) {
    // Case-insensitive contains match across a few fields
    const like = `%${q}%`;
    query = query.or(
      [
        `full_name.ilike.${like}`,
        `email.ilike.${like}`,
        `phone.ilike.${like}`,
        `ref.ilike.${like}`,
        `id.eq.${Number(q) || -1}`
      ].join(',')
    );
  }

  const { data, error } = await query;
  if (error) {
    return { statusCode: 500, headers: cors, body: `Query error: ${error.message}` };
  }

  const columns = [
    { header: 'id',        key: 'id' },
    { header: 'ref',       key: 'ref' },
    { header: 'full_name', key: 'full_name' },
    { header: 'email',     key: 'email' },
    { header: 'phone',     key: 'phone' },
    { header: 'status',    key: 'status' },
  ];

  const csv = toCSV(data || [], columns);

  return {
    statusCode: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="candidates.csv"`,
    },
    body: csv,
  };
}
