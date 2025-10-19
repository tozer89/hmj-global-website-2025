import { ok, err, parseBody, requireAdmin, supa } from './_lib.js';
export async function handler(event, context){
  try{
    requireAdmin(context, event);
    const { entity='', limit=10 } = parseBody(event);
    let q = supa().from('audit').select('*').order('created_at', { ascending:false }).limit(limit);
    if (entity) q = q.eq('entity', entity);
    const { data, error } = await q;
    if (error) throw error;
    return ok(data);
  }catch(e){ return err(e.message||e, e.status||500); }
}
