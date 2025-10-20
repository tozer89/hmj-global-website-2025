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
