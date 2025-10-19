import { ok, err, parseBody, requireAdmin, supa } from './_lib.js';
export async function handler(event, context){
  try{
    const user = requireAdmin(context, event);
    const { id, reason='' } = parseBody(event);
    const { data, error } = await supa().from('timesheets')
      .update({ status:'rejected', notes: reason })
      .eq('id', id).select().single();
    if(error) throw error;
    return ok(data);
  }catch(e){ return err(e.message||e, e.status||500); }
}