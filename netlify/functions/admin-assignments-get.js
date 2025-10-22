// netlify/functions/admin-assignments-get.js
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const { id } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };

    const { data, error } = await supabase
      .from('assignments')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
