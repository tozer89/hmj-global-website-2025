// admin-v2/functions/_lib.js
import { createClient } from '@supabase/supabase-js';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-trace',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export function ok(body)  { return { statusCode: 200, headers: cors, body: JSON.stringify(body ?? {}) }; }
export function bad(err)  { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: String(err) }) }; }
export function noauth()  { return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'unauthorized' }) }; }
export function sb()      { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE); }
export function bodyOf(e) { try { return JSON.parse(e.body || '{}'); } catch { return {}; } }
export function pre(e)    { if (e.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors }; }
