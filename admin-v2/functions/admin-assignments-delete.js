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



// admin-assignment-delete.js
import { sb, ok, bad, pre, bodyOf } from './_lib.js';
export async function handler(event){
  const pf = pre(event); if (pf) return pf;
  const { ids=[] } = bodyOf(event);
  try {
    const { error } = await sb().from('assignments').delete().in('id', ids);
    if (error) throw error;
    return ok({ deleted: ids.length });
  } catch (e) { return bad(e.message); }
}
