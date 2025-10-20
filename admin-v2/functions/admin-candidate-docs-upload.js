// admin-candidate-docs-upload.js
// Uploads a candidate document to Supabase Storage and records it in DB.
//
// Expects multipart/form-data with fields:
//   - id:            candidate id (number)
//   - label:         optional label for display
//   - file:          file input
//
// Returns: { ok:true, id, url } on success

const Busboy = require('busboy');
const { randomUUID, createHash } = require('crypto');
const { getClient } = require('./_supabase');
const { requireRole } = require('./_auth');

// --- Tunables ----------------------------------------------------------------
const BUCKET = 'candidate-docs';
const PREFIX = 'candidate-docs'; // folder inside bucket (mirrors bucket, change if you wish)
const MAX_SIZE_MB = 20;          // hard cap
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;
const ALLOW_EXT = ['pdf','doc','docx','png','jpg','jpeg','txt'];
const ALLOW_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png', 'image/jpeg', 'text/plain'
];

// ------------------------------------------------------------------------------
exports.handler = async (event) => {
  try {
    // CORS (optional, keeps browsers happy if you call from frontends)
    if (event.httpMethod === 'OPTIONS') {
      return ok(204, null, cors());
    }

    if (event.httpMethod !== 'POST') {
      return err(405, 'Method Not Allowed');
    }

    // Require admin session/JWT
    await requireRole(event, 'admin');

    // Content type must be multipart
    const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return err(400, 'Expected multipart/form-data');
    }

    // Parse multipart with Busboy
    const busboy = Busboy({
      headers: { 'content-type': contentType },
      limits: {
        files: 1,
        fileSize: MAX_SIZE,
        fields: 10
      }
    });

    let candidateId = null;
    let label = '';
    let filename = 'upload.bin';
    let fileBuffer = Buffer.alloc(0);
    let fileMime = 'application/octet-stream';
    let fileSize = 0;
    let fileExt = 'bin';
    let fileHash = '';

    const bbPromise = new Promise((resolve, reject) => {
      busboy.on('field', (name, val) => {
        if (name === 'id') {
          const n = Number(String(val).trim());
          if (!Number.isFinite(n) || n <= 0) return reject(new Error('Invalid candidate id'));
          candidateId = n;
        } else if (name === 'label') {
          label = String(val).trim().slice(0, 256); // keep it sensible
        }
      });

      busboy.on('file', (name, file, info = {}) => {
        filename = sanitizeFilename(info.filename || 'upload.bin');
        fileMime = (info.mimetype || guessContentType(filename)) || 'application/octet-stream';
        fileExt = extOf(filename);

        // Validate early
        if (ALLOW_EXT.length && !ALLOW_EXT.includes(fileExt)) {
          file.resume();
          return reject(new Error(`File type not allowed (.${fileExt})`));
        }
        if (ALLOW_MIME.length && !ALLOW_MIME.includes(fileMime)) {
          file.resume();
          return reject(new Error(`MIME not allowed (${fileMime})`));
        }

        const chunks = [];
        const hash = createHash('sha256');

        file.on('data', (d) => {
          fileSize += d.length;
          chunks.push(d);
          hash.update(d);
        });

        file.on('limit', () => reject(new Error(`File too large (>${MAX_SIZE_MB} MB)`)));

        file.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
          fileHash = hash.digest('hex').slice(0, 16); // short hash for key stability
        });
      });

      busboy.on('error', reject);
      busboy.on('finish', resolve);
    });

    // Feed Busboy the raw body
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '');
    busboy.end(raw);
    await bbPromise;

    if (!candidateId) return err(400, 'Missing candidate id');
    if (!fileBuffer?.length) return err(400, 'Missing file');

    // Build a safe, unique storage key
    const safeBase = baseOf(filename);
    const key = `${PREFIX}/${candidateId}/${timestampNow()}_${fileHash}_${randomUUID()}_${safeBase}.${fileExt}`;

    // Upload to Supabase Storage
    const supabase = getClient();

    const { error: upErr } = await supabase
      .storage
      .from(BUCKET)
      .upload(key, fileBuffer, {
        cacheControl: '3600',
        upsert: false,
        contentType: fileMime,
        contentDisposition: `attachment; filename="${safeBase}.${fileExt}"`
      });

    if (upErr) return err(500, `Upload failed: ${upErr.message}`);

    // Public URL (assuming bucket is public; if not, return storage key only)
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key);
    const url = pub?.publicUrl || null;

    // Insert DB row
    const { data: ins, error: insErr } = await supabase
      .from('candidate_documents')
      .insert({
        candidate_id: candidateId,
        label: label || null,
        filename: `${safeBase}.${fileExt}`,
        storage_key: key,
        url,
        content_type: fileMime,
        size_bytes: fileSize
      })
      .select()
      .single();

    if (insErr) {
      // Best-effort rollback if DB write fails
      try { await supabase.storage.from(BUCKET).remove([key]); } catch {}
      return err(500, `DB insert failed: ${insErr.message}`);
    }

    return ok(200, { ok: true, id: ins.id, url, filename: ins.filename }, cors());
  } catch (e) {
    return err(500, String(e.message || e));
  }
};

// ------------------------------ helpers --------------------------------------
function ok(status, body, headers = {}) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : '' };
}
function err(status, message, extra = {}) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify({ error: message, ...extra }) };
}
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function guessContentType(name = '') {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf'))  return 'application/pdf';
  if (n.endsWith('.doc'))  return 'application/msword';
  if (n.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (n.endsWith('.png'))  return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.txt'))  return 'text/plain';
  return 'application/octet-stream';
}

function sanitizeFilename(name = 'file') {
  // remove path bits and any risky chars; keep spaces and dashes
  const just = String(name).split('/').pop().split('\\').pop();
  return just.replace(/[^\w.\- ()[\]&@#+,]/g, '_').slice(0, 120) || 'file';
}
function baseOf(name = '') {
  const n = sanitizeFilename(name);
  const i = n.lastIndexOf('.');
  return (i > 0 ? n.slice(0, i) : n) || 'file';
}
function extOf(name = '') {
  const n = String(name).toLowerCase();
  const i = n.lastIndexOf('.');
  const ext = (i > -1 ? n.slice(i + 1) : '').replace(/[^a-z0-9]/g, '');
  return ext || 'bin';
}
function timestampNow() {
  // YYYYMMDD-HHMMSS
  const d = new Date();
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
