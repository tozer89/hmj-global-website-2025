// netlify/functions/admin-candidate-doc-delete.js
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');

const baseHandler = async (event, context) => {
  try {
    const { supabase } = await getContext(event, context, { requireAdmin: true });
    const { id } = JSON.parse(event.body || '{}');
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'id required' }) };
    }

    const { data, error } = await supabase
      .from('candidate_documents')
      .select('id,storage_key')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
    }

    if (data.storage_key) {
      const removeRes = await supabase.storage.from('candidate-docs').remove([data.storage_key]);
      if (removeRes.error) throw removeRes.error;
    }

    const { error: delError } = await supabase.from('candidate_documents').delete().eq('id', id);
    if (delError) throw delError;

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Delete failed' }) };
  }
};

exports.handler = withAdminCors(baseHandler);
