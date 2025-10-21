// --- FIX: ensure SUPABASE_KEY is defined for assignments only ---
  process.env.SUPABASE_KEY =
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ADMIN_KEY ||
    process.env.SUPABASE_ANON_KEY;



// admin-assignments-export.js
import { sb, pre, bodyOf, cors } from './_lib.js';
export async function handler(event){
  const pf = pre(event); if (pf) return pf;
  const { q='', status='' } = bodyOf(event);
  const supa = sb();
  let query = supa.from('assignments').select(`
    id, as_ref, status, job_title, consultant_name, candidate_name, client_name,
    start_date, end_date, rate_pay, rate_charge, currency
  `).order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  if (q) query = query.or(`job_title.ilike.%${q}%,candidate_name.ilike.%${q}%,client_name.ilike.%${q}%,as_ref.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return { statusCode: 400, headers: cors, body: error.message };

  const head = Object.keys(data[0]||{id:1}).join(',');
  const rows = data.map(r => Object.values(r).map(v=> (v==null?'':String(v).replaceAll('"','""')) ).join(','));
  const csv = [head, ...rows].join('\n');

  return { statusCode: 200, headers: { ...cors, 'Content-Type': 'text/csv' }, body: csv };
}
