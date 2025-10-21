// netlify/functions/admin-clients-list.js
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    // Require admin role
    await getContext(event, context, { requireAdmin: true });

    // Accept optional { q } for search
    const { q } = JSON.parse(event.body || '{}');

    // MINIMAL & SAFE selection — avoids missing column errors
    // Only select columns you're certain exist: id, name.
    let query = supabase
      .from('clients')
      .select('id,name')
      .order('name', { ascending: true });

    // Safe search on name only (also guaranteed to exist)
    if (q) query = query.ilike('name', `%${q}%`);

    const { data, error } = await query;
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify(data || []) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
