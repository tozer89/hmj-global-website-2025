// netlify/functions/admin-candidate-docs-list.js
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');

const baseHandler = async (event, context) => {
  try {
    const { supabase } = await getContext(event, context, { requireAdmin: true });
    const { candidateId } = JSON.parse(event.body || '{}');
    if (!candidateId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'candidateId required' }) };
    }

    const { data, error } = await supabase
      .from('candidate_documents')
      .select('id,label,filename,url,storage_key,created_at')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ documents: data || [] }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Failed to load documents' }) };
  }
};

exports.handler = withAdminCors(baseHandler);
