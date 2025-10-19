import { ok, err, parseBody, requireAdmin, supa } from './_lib.js';
export async function handler(event, context){
  try{
    requireAdmin(context, event);
    const { id, url } = parseBody(event);
    const { data, error } = await supa().from('assignments').update({ contract_url:url }).eq('id', id).select().single();
    if(error) throw error;
    return ok(data);
  }catch(e){ return err(e.message||e, e.status||500); }
}
