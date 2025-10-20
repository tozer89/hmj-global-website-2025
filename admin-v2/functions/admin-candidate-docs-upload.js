// admin-candidate-docs-upload.js
const Busboy = require('busboy');
const { v4: uuidv4 } = require('uuid');
const { getClient } = require('./_supabase');
const { requireRole } = require('./_auth'); // requireRole(event,'admin')

exports.handler = async (event, context) => {
  try {
    // Only POST + admin
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    await requireRole(event, 'admin');

    // Parse multipart body with Busboy
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Expected multipart/form-data' }) };
    }

    const busboy = Busboy({ headers: { 'content-type': contentType } });

    let candidateId = null;
    let label = '';
    let fileBuffer = Buffer.alloc(0);
    let filename = '';

    const bbPromise = new Promise((resolve, reject) => {
      busboy.on('field', (name, val) => {
        if (name === 'id') candidateId = Number(val);
        if (name === 'label') label = val;
      });

      busboy.on('file', (name, file, info) => {
        filename = info.filename || 'upload.bin';
        const chunks = [];
        file.on('data', (d) => chunks.push(d));
        file.on('limit', () => reject(new Error('File too large')));
        file.on('end', () => { fileBuffer = Buffer.concat(chunks); });
      });

      busboy.on('error', reject);
      busboy.on('finish', resolve);
    });

    // Busboy requires the raw body as a stream
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body || '');
    busboy.end(body);
    await bbPromise;

    if (!candidateId || !fileBuffer?.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing candidate id or file' }) };
    }

    // Upload to Supabase Storage
    const supabase = getClient();
    const key = `candidate-docs/${candidateId}/${uuidv4()}-${filename}`;
    const { data: upData, error: upErr } = await supabase
      .storage.from('candidate-docs')
      .upload(key, fileBuffer, {
        upsert: false,
        cacheControl: '3600',
        contentType: guessContentType(filename)
      });

    if (upErr) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Upload failed: ' + upErr.message }) };
    }

    // Make/get a public URL
    const { data: pub } = supabase.storage.from('candidate-docs').getPublicUrl(key);
    const url = pub?.publicUrl || null;

    // Insert DB row
    const { data: ins, error: insErr } = await supabase
      .from('candidate_documents')
      .insert({
        candidate_id: candidateId,
        label: label || null,
        filename,
        storage_key: key,
        url
      })
      .select()
      .single();

    if (insErr) {
      // Best-effort rollback storage if DB insert fails
      await supabase.storage.from('candidate-docs').remove([key]).catch(() => {});
      return { statusCode: 500, body: JSON.stringify({ error: 'DB insert failed: ' + insErr.message }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, id: ins.id, url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e.message || e) }) };
  }
};

function guessContentType(name='') {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.doc')) return 'application/msword';
  if (n.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}
