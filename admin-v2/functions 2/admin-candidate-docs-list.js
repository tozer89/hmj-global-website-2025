// admin-candidate-docs-list.js
const { getClient } = require('./_supabase');
const { requireRole } = require('./_auth');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    await requireRole(event, 'admin');

    const { id } = JSON.parse(event.body || '{}');
    const candidateId = Number(id || 0);
    if (!candidateId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing candidate id' }) };
    }

    const supabase = getClient();
    const { data, error } = await supabase
      .from('candidate_documents')
      .select('id,label,filename,url,created_at,storage_key')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false });

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    // If you prefer to always return fresh public URLs, uncomment below:
    // const storage = supabase.storage.from('candidate-docs');
    // const rows = (data||[]).map(d => {
    //   const { data: pub } = storage.getPublicUrl(d.storage_key);
    //   return { ...d, url: pub?.publicUrl || d.url || null };
    // });

    return { statusCode: 200, body: JSON.stringify(data || []) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
