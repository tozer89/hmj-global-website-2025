// netlify/functions/admin-jobs-delete.js
const { withAdminCors } = require('./_http.js');
const { getSupabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    let supabase;
    try {
      supabase = getSupabase(event);
    } catch (err) {
      return {
        statusCode: 503,
        body: JSON.stringify({ error: 'Supabase not configured', code: err.code || 'supabase_unavailable' }),
      };
    }

    const { id } = JSON.parse(event.body || '{}');
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'id required' }) };
    }

    const { error } = await supabase
      .from('jobs')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Unexpected error' }) };
  }
};

exports.handler = withAdminCors(baseHandler);
