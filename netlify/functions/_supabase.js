// netlify/functions/_supabase.js
const { createClient } = require('@supabase/supabase-js');

// Use the Service key on the server so RLS never blocks server functions.
// (Client-side still uses anon+JWT; this is only for Netlify Functions.)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Supabase env missing: SUPABASE_URL or SUPABASE_SERVICE_KEY');
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false }
});

module.exports = { supabase };
