import { ok, err, parseBody, requireAdmin, supa, auditLog } from './_lib.js';
export async function handler(event, context){
  try{
    const user = requireAdmin(context, event);
    const payload = parseBody(event);
    const { id, ...fields } = payload;
    const db = supa();
    const q = id ? db.from('candidates').update(fields).eq('id', id).select().single()
                 : db.from('candidates').insert([fields]).select().single();
    const { data, error } = await q;
    if (error) throw error;
    await auditLog({ entity:'candidate', entity_id: data.id, action: id?'update':'create', actor_email: user.email, meta: { fields }});
    return ok(data);
  }catch(e){ return err(e.message||e, e.status||500); }
}
