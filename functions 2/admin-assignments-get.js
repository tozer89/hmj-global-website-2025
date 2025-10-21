// netlify/functions/admin-assignments-get.js
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    await getContext(context, { requireAdmin: true });
    const { id } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };

    const { data, error } = await supabase
      .from('assignments')
      .select('id, contractor_id, project_id, rate_std, rate_ot, charge_std, charge_ot, start_date, end_date')
      .eq('id', id)
      .single();

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
