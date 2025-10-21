// --- FIX: ensure SUPABASE_KEY is defined for assignments only ---
  process.env.SUPABASE_KEY =
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ADMIN_KEY ||
    process.env.SUPABASE_ANON_KEY;


// admin-assignments-list.js
import { sb, ok, bad, pre, bodyOf } from './_lib.js';

export async function handler(event){
  const pf = pre(event); if (pf) return pf;
  const { q='', status='', consultant='', client='', page=1, pageSize=20 } = bodyOf(event);
  try {
    const supa = sb();
    let query = supa.from('assignments_view')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page-1)*pageSize, page*pageSize-1);

    if (status)     query = query.eq('status', status);
    if (consultant) query = query.ilike('consultant_name', `%${consultant}%`);
    if (client)     query = query.ilike('client_name', `%${client}%`);
    if (q)          query = query.or(`job_title.ilike.%${q}%,candidate_name.ilike.%${q}%,client_name.ilike.%${q}%,as_ref.ilike.%${q}%`);

    const { data, error, count } = await query;
    if (error) throw error;
    return ok({ rows: data, total: count ?? (data?.length||0) });
  } catch (e) { return bad(e.message); }
}
