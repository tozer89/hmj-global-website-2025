// netlify/functions/admin-contractors-list.js
const { supabase } = require('./_supabase.js');
const { getContext, coded } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const q = event.body ? JSON.parse(event.body) : {};
    const term = (q.search||'').trim().toLowerCase();
    let query = supabase.from('contractors')
      .select('id,name,email,pay_type,address_json,bank,emergency_contact,right_to_work', { count: 'exact' })
      .order('name', { ascending: true })
      .limit(200);

    if (term) query = query.ilike('name', `%${term}%`).or(`email.ilike.%${term}%`);

    const { data, error } = await query;
    if (error) throw coded(500, error.message);
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 || e.code === 403 ? e.code : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
