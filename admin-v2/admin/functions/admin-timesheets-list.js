import { ok, err, parseBody, requireAdmin, supa, qPaginate } from './_lib.js';
export async function handler(event, context){
  try{
    requireAdmin(context, event);
    const { q='', status='', wk_from='', wk_to='', candidate='', client='', page=1, pageSize=20 } = parseBody(event);
    const db = supa();
    let query = db.from('timesheets').select('*', { count:'exact' }).order('week_start', { ascending:false });

    if(q) query = query.or(`ts_ref.ilike.%${q}%,candidate_name.ilike.%${q}%,client_name.ilike.%${q}%`);
    if(status) query = query.eq('status', status);
    if(wk_from) query = query.gte('week_start', wk_from);
    if(wk_to) query = query.lte('week_start', wk_to);
    if(candidate) query = query.ilike('candidate_name', candidate);
    if(client) query = query.ilike('client_name', client);

    const { from, to } = qPaginate({ page, pageSize });
    const { data, error, count } = await query.range(from, to);
    if(error) throw error;
    return ok({ rows:data, total:count });
  }catch(e){ return err(e.message||e, e.status||500); }
}
