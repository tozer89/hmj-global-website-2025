import { ok, err, parseBody, requireAdmin, supa } from './_lib.js';
export async function handler(event, context){
  try{
    requireAdmin(context, event);
    const { id, kind, url } = parseBody(event); // kind: 'rtw' | 'contract'
    const fields = kind==='rtw' ? { rtw_url: url } : { contract_url: url };
    const { data, error } = await supa().from('candidates').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return ok(data);
  }catch(e){ return err(e.message||e, e.status||500); }
}
