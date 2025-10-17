// ESM-friendly helper for Netlify Functions (CommonJS file using dynamic import)
let _createClient;

async function supabaseClient() {
  if (!_createClient) {
    ({ createClient: _createClient } = await import('@supabase/supabase-js'));
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  return _createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { 'X-Client-Info': 'hmjg-netlify-fns' } }
  });
}

module.exports = { supabaseClient };
