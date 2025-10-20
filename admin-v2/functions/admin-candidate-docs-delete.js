// admin-candidate-docs-delete.js
const { getClient } = require('./_supabase');
const { requireRole } = require('./_auth');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    await requireRole(event, 'admin');

    const { id, doc_id } = JSON.parse(event.body || '{}');
    const candidateId = Number(id || 0);
    const docId = Number(doc_id || 0);
    if (!candidateId || !docId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing candidate id or doc id' }) };
    }

    const supabase = getClient();

    // Fetch row to know the storage key
    const { data: row, error: getErr } = await supabase
      .from('candidate_documents')
      .select('id, candidate_id, storage_key')
      .eq('id', docId)
      .eq('candidate_id', candidateId)
      .single();

    if (getErr || !row) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Document not found' }) };
    }

    // Remove storage object (best-effort)
    if (row.storage_key) {
      await supabase.storage.from('candidate-docs').remove([row.storage_key]).catch(() => {});
    }

    // Delete DB row
    const { error: delErr } = await supabase
      .from('candidate_documents')
      .delete()
      .eq('id', docId)
      .eq('candidate_id', candidateId);

    if (delErr) {
      return { statusCode: 500, body: JSON.stringify({ error: delErr.message }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};
