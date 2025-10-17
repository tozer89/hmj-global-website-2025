// netlify/functions/admin-clients-list.js
const { supabase } = require('./_supabase.js');
const { getContext, coded } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    await getContext(context, { requireAdmin: true });
    const q = event.body ? JSON.parse(event.body) : {};
    const term = (q.search||'').trim();
    let query = supabase.from('clients')
      .select('id,name,contact_name,contact_email,contact_phone,billing,status')
      .order('name', { ascending: true }).limit(200);
    if (term) query = query.ilike('name', `%${term}%`);
    const { data, error } = await query;
    if (error) throw coded(500, error.message);
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 || e.code === 403 ? e.code : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
