// --- FIX: ensure SUPABASE_KEY is defined for assignments only ---
  process.env.SUPABASE_KEY =
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ADMIN_KEY ||
    process.env.SUPABASE_ANON_KEY;



// admin-assignment-attach.js
import { sb, ok, bad, pre, bodyOf } from './_lib.js';
export async function handler(event){
  const pf = pre(event); if (pf) return pf;
  const { id, kind, url } = bodyOf(event);
  try{
    const { error } = await sb().from('assignments').update({ contract_url: url }).eq('id', id);
    if (error) throw error;
    return ok({ ok: true });
  }catch(e){ return bad(e.message); }
}
