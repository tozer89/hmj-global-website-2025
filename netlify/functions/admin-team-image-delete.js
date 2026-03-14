const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const {
  TEAM_BUCKET,
  asString,
} = require('./_team-helpers.js');

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const supabase = getSupabase(event);
    const payload = JSON.parse(event.body || '{}');
    const storageKey = asString(payload?.storageKey);

    if (!storageKey) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Storage key is required.' }),
      };
    }

    const { error } = await supabase.storage.from(TEAM_BUCKET).remove([storageKey]);
    if (error) throw error;

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, storageKey }),
    };
  } catch (error) {
    const message = error?.message || 'Unable to remove image';
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
