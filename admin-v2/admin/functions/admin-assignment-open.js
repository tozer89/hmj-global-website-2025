import { ok, err, parseBody, requireAdmin, supa } from './_lib.js';
export async function handler(event, context){
  try{
    requireAdmin(context, event);
    const { id } = parseBody(event);
    const { data, error } = await supa().from('assignments').select('*').eq('id', id).single();
    if(error) throw error;
    return ok(data);
  }catch(e){ return err(e.message||e, e.status||500); }
}
