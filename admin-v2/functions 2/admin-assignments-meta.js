// Inside your handler, before you call sb()
const fallbackKey =
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ADMIN_KEY ||
  process.env.SUPABASE_ANON_KEY || '';

if (!fallbackKey) {
  return bad('supabaseKey is required.');
}

// Make sure _lib / sb() reads from process.env.SUPABASE_KEY:
process.env.SUPABASE_KEY = fallbackKey;


// --- FIX: ensure SUPABASE_KEY is defined for assignments only ---
  process.env.SUPABASE_KEY =
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ADMIN_KEY ||
    process.env.SUPABASE_ANON_KEY;



// admin-assignments-meta.js
import { sb, ok, bad, pre } from './_lib.js';
export async function handler(event){
  const pf = pre(event); if (pf) return pf;
  try {
    const supa = sb();
    const [consultants, clients, candidates] = await Promise.all([
      supa.from('consultants').select('name').order('name'),
      supa.from('clients').select('name').order('name'),
      supa.from('candidates').select('full_name').order('full_name')
    ]);
    if (consultants.error) throw consultants.error;
    if (clients.error) throw clients.error;
    if (candidates.error) throw candidates.error;

    return ok({
      consultants: (consultants.data||[]).map(x=>x.name),
      clients:     (clients.data||[]).map(x=>x.name),
      candidates:  (candidates.data||[]).map(x=>x.full_name)
    });
  } catch (e) { return bad(e.message); }
}
