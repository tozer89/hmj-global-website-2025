import { requireAdmin } from './_guard.js';

export async function handler(event, context){
  try{
    const user = requireAdmin(context);   // ← guard
    // ...existing code...
  }catch(e){
    return { statusCode: e.status || 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
}



import { ok, err, parseBody, requireAdmin, supa } from './_lib.js';
export async function handler(event, context){
  try{
    requireAdmin(context, event);
    const { id } = parseBody(event);
    const { data, error } = await supa().from('candidates').select('*').eq('id', id).single();
    if (error) throw error;
    return ok(data);
  }catch(e){ return err(e.message||e, e.status||500); }
}
