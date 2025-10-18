// netlify/functions/admin-clients-list.js
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    await getContext(context, { requireAdmin: true });

    const { q } = JSON.parse(event.body || '{}');

    let query = supabase
      .from('clients')
      .select('id,name')
      .order('name', { ascending: true });

    if (q && q.trim()) {
      // ilike on name only (safe). Add more ORs when you add columns.
      query = query.ilike('name', `%${q}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify(data || []) };
  } catch (e) {
    const status = e.code === 401 ? 401 : (e.code === 403 ? 403 : 500);
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
