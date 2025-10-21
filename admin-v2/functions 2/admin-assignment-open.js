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



// admin-assignment-open.js
import { sb, ok, bad, pre, bodyOf } from './_lib.js';
export async function handler(event){
  const pf = pre(event); if (pf) return pf;
  const { id } = bodyOf(event);
  try {
    const { data, error } = await sb().from('assignments').select('*').eq('id', id).single();
    if (error) throw error;
    return ok(data);
  } catch (e) { return bad(e.message); }
}
