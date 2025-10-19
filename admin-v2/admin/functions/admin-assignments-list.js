import { ok, err, parseBody, requireAdmin, supa, qPaginate } from './_lib.js';
export async function handler(event, context){
  try{
    requireAdmin(context, event);
    const { q='', status='', consultant='', client='', page=1, pageSize=20 } = parseBody(event);
    const db = supa();
    let query = db.from('assignments').select('*', { count:'exact' }).order('id', { ascending:false });

    if(q) query = query.or(`as_ref.ilike.%${q}%,job_title.ilike.%${q}%,candidate_name.ilike.%${q}%,client_name.ilike.%${q}%`);
    if(status) query = query.eq('status', status);
    if(consultant) query = query.ilike('consultant_name', consultant);
    if(client) query = query.ilike('client_name', client);

    const { from, to } = qPaginate({ page, pageSize });
    const { data, error, count } = await query.range(from,to);
    if(error) throw error;

    // Simple analytics example
    const { count:live } = await db.from('assignments').select('*', { count:'exact', head:true }).eq('status','live');
    const { count:pending } = await db.from('assignments').select('*', { count:'exact', head:true }).eq('status','pending');

    return ok({ rows:data, total:count, analytics:{ live, pending }});
  }catch(e){ return err(e.message||e, e.status||500); }
}
