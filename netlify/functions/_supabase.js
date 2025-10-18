// netlify/functions/_supabase.js  (CommonJS)
const { createClient } = require('@supabase/supabase-js');

const url  = process.env.SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_KEY;

// Fail fast if env vars are missing (shows as 500, not 401)
if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
}

const supabase = createClient(url, key, {
  auth: { persistSession: false }
});

module.exports = { supabase };

