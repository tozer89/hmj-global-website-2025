// netlify/functions/_supabase.js
// CommonJS module (Netlify Functions). Robust diagnostics & helpers.

const { createClient } = require('@supabase/supabase-js');
const { withAdminCors } = require('./_http.js');
const { getSupabaseUrl, getSupabaseServiceKey } = require('./_supabase-env.js');

// ---- ENV ----
// Prefer the service role key server-side (RLS bypassed in functions).
const SUPABASE_URL = getSupabaseUrl();

const SERVICE_KEY = getSupabaseServiceKey();

const DEBUG = /^1|true|yes|on|debug$/i.test(process.env.DEBUG_SUPA || '');

// ---- SINGLETON CLIENT ----
let supabase = null;
let supabaseError = null;
try {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    const missing = !SUPABASE_URL && !SERVICE_KEY
      ? 'Supabase URL & service key environment variables missing'
      : !SUPABASE_URL
        ? 'Supabase URL missing (set SUPABASE_URL or VITE_SUPABASE_URL)'
        : 'Supabase service key missing (set SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY)';
    supabaseError = new Error(`${missing} missing`);
    console.error('[supa] Missing env: %s', missing);
  } else {
    supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    if (DEBUG) console.log('[supa] Client created OK');
    if (!process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_ANON_KEY) {
      console.warn('[supa] Using ANON key server-side. Prefer SERVICE key for functions.');
    }
  }
} catch (e) {
  supabaseError = e;
  console.error('[supa] createClient failed:', e?.message || e);
}

function hasSupabase() {
  return !!(supabase && typeof supabase.from === 'function');
}

// ---- TRACE & LOGGING ----
function traceFrom(event) {
  const h = event?.headers || {};
  return (
    h['x-hmj-trace'] ||
    h['X-HMJ-Trace'] ||
    h['x-trace'] ||
    `local-${Date.now()}`
  );
}
function debugLog(event, ...args) {
  if (!DEBUG) return;
  const t = traceFrom(event);
  console.log(`[supa][${t}]`, ...args);
}

// ---- ASSERT / GET ----
function assertSupabase(event) {
  if (!supabase || typeof supabase.from !== 'function') {
    debugLog(event, 'Supabase client missing/invalid');
    const err = new Error('supabase_init_failed');
    err.code = 'supabase_init_failed';
    throw err;
  }
  return supabase;
}
function getSupabase(event) {
  return assertSupabase(event);
}

function supabaseStatus() {
  return {
    ok: hasSupabase(),
    error: supabaseError ? supabaseError.message : null,
  };
}

// ---- JSON HELPERS (classic Netlify return shape) ----
function respond(statusCode, obj) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(obj, null, 2),
  };
}
function jsonOk(obj, statusCode = 200) {
  return respond(statusCode, obj);
}
function jsonError(statusCode, code, message, extra = {}) {
  return respond(statusCode, { ok: false, code, message, ...extra });
}

// ---- HEALTH CHECK (quick query) ----
async function health(event) {
  try {
    const s = getSupabase(event);
    const { error } = await s.from('timesheets').select('id').limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ---- WRAPPER (uniform error handling + trace) ----
function withSupabase(handler) {
  // Usage:
  // module.exports.handler = withSupabase(async ({ event, supabase, trace, debug }) => {
  //   const { data, error } = await supabase.from('clients').select('id,name');
  //   if (error) return jsonError(500, 'query_failed', error.message, { trace });
  //   return jsonOk({ ok: true, items: data, trace });
  // });
  const runner = async (event, context) => {
    const trace = traceFrom(event);
    if (!hasSupabase()) {
      const reason = supabaseError ? supabaseError.message : 'Supabase client unavailable';
      console.warn('[supa][%s] fallback: %s', trace, reason);
      return jsonError(503, 'supabase_unavailable', reason, { trace });
    }
    try {
      const s = getSupabase(event);
      debugLog(event, 'handler start');
      const res = await handler({
        event,
        context,
        supabase: s,
        trace,
        debug: (...a) => debugLog(event, ...a),
      });
      // Allow handler to return already-formed Netlify response or a plain object
      if (res && typeof res.statusCode === 'number' && 'body' in res) return res;
      return jsonOk({ ok: true, trace, ...res });
    } catch (e) {
      const code = e?.code || 'unhandled';
      const message = e?.message || String(e);
      console.error('[supa][%s] ERROR %s: %s', trace, code, message);
      return jsonError(500, code, message, { trace });
    }
  };

  return withAdminCors(runner);
}

module.exports = {
  // Back-compat
  supabase,
  supabaseError,
  // Helpers
  getSupabase,
  assertSupabase,
  withSupabase,
  jsonOk,
  jsonError,
  health,
  debugLog,
  hasSupabase,
  supabaseStatus,
};
