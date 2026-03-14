const { randomUUID } = require('node:crypto');
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const {
  TEAM_BUCKET,
  asString,
  normaliseSlug,
} = require('./_team-helpers.js');

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MIME_TO_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};
const EXTENSION_TO_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

function decodeBase64(data) {
  try {
    return Buffer.from(data, 'base64');
  } catch {
    return null;
  }
}

function inferExtension(name, contentType) {
  const fromMime = MIME_TO_EXTENSION[contentType] || '';
  if (fromMime) return fromMime;
  const lastSegment = asString(name).split('.').pop().toLowerCase();
  return EXTENSION_TO_MIME[lastSegment] ? lastSegment : '';
}

function inferMimeType(contentType, extension) {
  const direct = MIME_TO_EXTENSION[contentType] ? contentType : '';
  if (direct) return direct;
  return EXTENSION_TO_MIME[extension] || '';
}

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const supabase = getSupabase(event);
    const payload = JSON.parse(event.body || '{}');
    const name = asString(payload?.name);
    const replaceStorageKey = asString(payload?.replaceStorageKey);
    const contentType = asString(payload?.contentType).toLowerCase();
    const data = asString(payload?.data);

    if (!name || !data) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Image name and data are required.' }),
      };
    }

    const buffer = decodeBase64(data);
    if (!buffer || !buffer.length) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Invalid image data.' }),
      };
    }

    if (buffer.length > MAX_IMAGE_BYTES) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Images must be 6MB or smaller.' }),
      };
    }

    const extension = inferExtension(name, contentType);
    const resolvedMimeType = inferMimeType(contentType, extension);
    if (!extension || !resolvedMimeType) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Unsupported image type. Use JPG, PNG, WebP, or AVIF.' }),
      };
    }

    const stem = name.replace(/\.[^.]+$/, '');
    const slug = normaliseSlug(stem, stem, 'team-image');
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `team/${year}/${month}/${Date.now()}-${randomUUID().slice(0, 8)}-${slug}.${extension}`;

    const storage = supabase.storage.from(TEAM_BUCKET);
    const { error: uploadError } = await storage.upload(key, buffer, {
      contentType: resolvedMimeType,
      upsert: false,
      cacheControl: '31536000',
    });

    if (uploadError) throw uploadError;

    if (replaceStorageKey && replaceStorageKey !== key) {
      const { error: replaceError } = await storage.remove([replaceStorageKey]);
      if (replaceError) {
        console.warn('[team-image-upload] unable to replace prior image %s', replaceError.message || replaceError);
      }
    }

    const imageUrl = storage.getPublicUrl(key)?.data?.publicUrl || null;

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        imageUrl,
        imageStorageKey: key,
      }),
    };
  } catch (error) {
    const message = error?.message || 'Image upload failed';
    const bucketMissing = /bucket/i.test(message) && /not found|does not exist/i.test(message);
    const status = error?.code === 401
      ? 401
      : error?.code === 403
        ? 403
        : bucketMissing
          ? 409
          : 500;
    return {
      statusCode: status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: bucketMissing
          ? 'Team image storage is not ready in this environment yet.'
          : message,
        code: bucketMissing ? 'bucket_missing' : undefined,
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
