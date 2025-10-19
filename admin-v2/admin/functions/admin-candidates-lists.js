import { ok, err, parseBody, requireAdmin, supa, qPaginate } from './_lib.js';

export async function handler(event, context) {
  try {
    requireAdmin(context, event);
    const { q='', status='', has='', page=1, pageSize=20 } = parseBody(event);
    const db = supa();
    let query = db.from('candidates').select('*', { count: 'exact' }).order('id', { ascending: false });

    if (q) {
      query = query.or(`ref.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`);
    }
    if (status) query = query.eq('status', status);
    if (has === 'rtw') query = query.not('rtw_url', 'is', null);
    if (has === 'contract') query = query.not('contract_url', 'is', null);
    if (has === 'bank') query = query.not('bank_account', 'is', null);

    const { from, to } = qPaginate({ page, pageSize });
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;
    return ok({ rows: data, total: count });
  } catch (e) { return err(e.message || e, e.status || 500); }
}
