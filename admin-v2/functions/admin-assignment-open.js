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
