import { ok, err, requireAdmin, supa } from './_lib.js';
export async function handler(event, context){
  try{
    requireAdmin(context, event);
    const db = supa();
    const [consultants, clients, candidates] = await Promise.all([
      db.from('assignments').select('consultant_name').not('consultant_name','is',null),
      db.from('assignments').select('client_name').not('client_name','is',null),
      db.from('candidates').select('first_name,last_name').not('first_name','is',null)
    ]);
    const uniq = (arr)=>[...new Set(arr.map(x=>Object.values(x)[0] ? (x.consultant_name||x.client_name||`${x.first_name} ${x.last_name}`) : null).filter(Boolean))];
    return ok({
      consultants: uniq(consultants.data||[]),
      clients: uniq(clients.data||[]),
      candidates: (candidates.data||[]).map(c=>`${c.first_name||''} ${c.last_name||''}`.trim()).filter(Boolean)
    });
  }catch(e){ return err(e.message||e, e.status||500); }
}
