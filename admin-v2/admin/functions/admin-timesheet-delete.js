import { ok, err, parseBody, requireAdmin, supa } from './_lib.js';
export async function handler(event, context){
  try{
    requireAdmin(context, event);
    const { ids=[] } = parseBody(event);
    if(!ids.length) return ok({ deleted:0 });
    const { error } = await supa().from('timesheets').delete().in('id', ids);
    if(error) throw error;
    return ok({ deleted: ids.length });
  }catch(e){ return err(e.message||e, e.status||500); }
}
