import { ok, err, parseBody, requireAdmin, supa, auditLog } from './_lib.js';
export async function handler(event, context){
  try{
    const user = requireAdmin(context, event);
    const { ids=[] } = parseBody(event);
    if(!ids.length) return ok({ deleted: 0 });
    const { error } = await supa().from('candidates').delete().in('id', ids);
    if (error) throw error;
    await auditLog({ entity:'candidate', entity_id: null, action:'delete', actor_email:user.email, meta:{ ids }});
    return ok({ deleted: ids.length });
  }catch(e){ return err(e.message||e, e.status||500); }
}
