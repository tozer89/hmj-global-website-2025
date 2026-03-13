const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const {
  NOTICEBOARD_TABLE,
  NOTICEBOARD_BUCKET,
  asString,
  isMissingTableError,
} = require('./_noticeboard-helpers.js');

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const supabase = getSupabase(event);
    const payload = JSON.parse(event.body || '{}');
    const id = asString(payload?.id);

    if (!id) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'Notice id is required.' }),
      };
    }

    const { data: existing, error: fetchError } = await supabase
      .from(NOTICEBOARD_TABLE)
      .select('id,image_storage_key')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    const { error: deleteError } = await supabase
      .from(NOTICEBOARD_TABLE)
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    if (existing?.image_storage_key) {
      const { error: storageError } = await supabase.storage
        .from(NOTICEBOARD_BUCKET)
        .remove([existing.image_storage_key]);
      if (storageError) {
        console.warn('[noticeboard-delete] unable to remove image %s', storageError.message || storageError);
      }
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, id }),
    };
  } catch (error) {
    const schemaIssue = isMissingTableError(error, NOTICEBOARD_TABLE);
    const status = error?.code === 401
      ? 401
      : error?.code === 403
        ? 403
        : schemaIssue
          ? 409
          : 500;
    return {
      statusCode: status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: schemaIssue
          ? 'Noticeboard table is not ready in this environment yet.'
          : (error?.message || 'Notice delete failed'),
        code: schemaIssue ? 'schema_mismatch' : undefined,
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
