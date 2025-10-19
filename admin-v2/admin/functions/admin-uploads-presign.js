// admin-uploads-presign.js — S3 (or R2) style pre-sign pass-through
// NOTE: replace with your own storage if you're not using S3-compatible buckets.
const { ok, err, parseBody } = require('./_lib.js');
const { requireAdmin } = require('./_guard.js');

// Stub to keep your front-end happy until you wire real storage.
exports.handler = async (event) => {
  try {
    requireAdmin(event);
    const { filename, type } = parseBody(event);
    if (!filename) { const e = new Error('filename required'); e.status = 400; throw e; }

    // TODO: implement real pre-sign here.
    // For now we just echo back a dummy URL so the UI can proceed.
    const fake = {
      url: 'about:blank',
      headers: {},
      public_url: `/uploads/${encodeURIComponent(filename)}`
    };
    return ok(fake);
  } catch (e) {
    return err(e.message || e, e.status || 500);
  }
};
