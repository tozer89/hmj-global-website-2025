// netlify/functions/admin-contractors-get.js
const { supabase } = require('./_supabase.js');
const { getContext, coded } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const { id, email } = JSON.parse(event.body||'{}');
    if (!id && !email) throw coded(400, 'id or email required');
    const query = id ? supabase.from('contractors').select('*').eq('id', id) 
                     : supabase.from('contractors').select('*').ilike('email', email);
    const { data, error } = await query.single();
    if (error) throw coded(404, error.message);
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 || e.code === 403 ? e.code : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
