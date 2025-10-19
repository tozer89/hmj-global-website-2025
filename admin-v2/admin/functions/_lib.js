// _lib.js  — small helpers shared by Netlify Functions (CommonJS)
const { createClient } = require('@supabase/supabase-js');

// Create a Supabase client with the Service Role key (server-side only)
function supa() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE');
  return createClient(url, key, { auth: { persistSession: false } });
}

// Standard HTTP helpers
function ok(data, status = 200) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data ?? null) };
}
function err(message, status = 500) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: String(message) }) };
}

// Body / query parsing
function parseBody(event) {
  try {
    if (!event || !event.body) return {};
    return typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
  } catch (e) { return {}; }
}
function q(event, name, def = '') {
  const p = (event && event.queryStringParameters) || {};
  return name in p ? p[name] : def;
}

// Simple pagination normaliser
function qPaginate(event, defaults = { page: 1, pageSize: 20 }) {
  const page = Math.max(1, parseInt(q(event, 'page', defaults.page), 10) || defaults.page);
  const pageSize = Math.min(200, Math.max(1, parseInt(q(event, 'pageSize', defaults.pageSize), 10) || defaults.pageSize));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return { page, pageSize, from, to };
}

module.exports = { supa, ok, err, parseBody, q, qPaginate };
