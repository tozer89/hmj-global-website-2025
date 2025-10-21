// --- FIX: ensure SUPABASE_KEY is defined for assignments only ---
  process.env.SUPABASE_KEY =
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ADMIN_KEY ||
    process.env.SUPABASE_ANON_KEY;


// admin-assignments-import.js
import { sb, ok, bad, pre, bodyOf } from './_lib.js';
export async function handler(event){
  const pf = pre(event); if (pf) return pf;
  const { csv='' } = bodyOf(event);
  try {
    const lines = csv.trim().split(/\r?\n/);
    if (!lines.length) return ok({ inserted: 0 });
    const headers = lines.shift().split(',').map(h=>h.trim());
    const rows = lines.map(line=>{
      const vals = line.split(',');
      const o={}; headers.forEach((h,i)=>{ o[h]=vals[i]??null; }); return o;
    });
    const { data, error } = await sb().from('assignments').upsert(rows).select('id');
    if (error) throw error;
    return ok({ inserted: data?.length || 0 });
  } catch (e) { return bad(e.message); }
}
