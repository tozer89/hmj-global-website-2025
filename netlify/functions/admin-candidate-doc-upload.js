// netlify/functions/admin-candidate-doc-upload.js
const { randomUUID } = require('node:crypto');
const { getContext } = require('./_auth.js');
const { slugify } = require('./_jobs-helpers.js');

function ensureBuffer(base64) {
  try {
    return Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
}

exports.handler = async (event, context) => {
  try {
    const { supabase, user } = await getContext(event, context, { requireAdmin: true });
    const { candidateId, name, contentType, data, label } = JSON.parse(event.body || '{}');

    if (!candidateId || !data || !name) {
      return { statusCode: 400, body: JSON.stringify({ error: 'candidateId, name, data required' }) };
    }

    const buffer = ensureBuffer(data);
    if (!buffer || !buffer.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'invalid file data' }) };
    }

    const safeName = slugify(name.replace(/\.[^.]+$/, '')) || 'cv';
    const ext = (name.includes('.') ? name.split('.').pop() : 'dat') || 'dat';
    const key = `candidate-${candidateId}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}.${ext}`;

    const storage = supabase.storage.from('candidate-docs');
    const uploadRes = await storage.upload(key, buffer, {
      contentType: contentType || 'application/octet-stream',
      upsert: false,
    });
    if (uploadRes.error) throw uploadRes.error;

    const publicUrl = storage.getPublicUrl(key)?.data?.publicUrl || null;

    const { data: record, error } = await supabase
      .from('candidate_documents')
      .insert({
        candidate_id: candidateId,
        label: label || name,
        filename: name,
        storage_key: key,
        url: publicUrl,
      })
      .select('id,label,filename,url,storage_key,created_at')
      .single();

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ document: record }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Upload failed' }) };
  }
};
