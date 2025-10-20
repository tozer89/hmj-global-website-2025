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
