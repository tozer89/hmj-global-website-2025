const { randomUUID } = require('node:crypto');
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const {
  TEAM_TABLE,
  TEAM_BUCKET,
  asString,
  ensureUniqueSlug,
  toDbPayload,
  toTeamMember,
  isMissingTableError,
} = require('./_team-helpers.js');

function dedupeKeys(keys = [], currentKey = '') {
  const next = new Set();
  keys.forEach((value) => {
    const key = asString(value);
    if (key && key !== currentKey) {
      next.add(key);
    }
  });
  return Array.from(next);
}

const baseHandler = async (event, context) => {
  try {
    const { user } = await getContext(event, context, { requireAdmin: true });
    const supabase = getSupabase(event);
    const payload = JSON.parse(event.body || '{}');
    const memberInput = payload?.member;
    const previousImageStorageKey = asString(payload?.previousImageStorageKey);
    const removedImageKeys = Array.isArray(payload?.removedImageKeys) ? payload.removedImageKeys : [];
    const now = new Date();

    const dbPayload = toDbPayload(memberInput, { now, user });
    const id = asString(dbPayload.id) || randomUUID();
    dbPayload.id = id;
    dbPayload.slug = await ensureUniqueSlug(supabase, dbPayload.slug, id);

    if (!asString(memberInput?.id)) {
      dbPayload.created_at = now.toISOString();
      dbPayload.created_by = user?.id ? String(user.id) : (user?.email || null);
      dbPayload.created_by_email = user?.email || null;
    }

    const { data, error } = await supabase
      .from(TEAM_TABLE)
      .upsert(dbPayload, { onConflict: 'id', ignoreDuplicates: false })
      .select('*')
      .single();

    if (error) throw error;

    const storageKeysToRemove = dedupeKeys(
      previousImageStorageKey ? [previousImageStorageKey, ...removedImageKeys] : removedImageKeys,
      data?.image_storage_key || ''
    );

    if (storageKeysToRemove.length) {
      const { error: storageError } = await supabase.storage
        .from(TEAM_BUCKET)
        .remove(storageKeysToRemove);
      if (storageError) {
        console.warn('[team-save] unable to remove stale image(s): %s', storageError.message || storageError);
      }
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        member: toTeamMember(data),
      }),
    };
  } catch (error) {
    const schemaIssue = isMissingTableError(error, TEAM_TABLE);
    const status = error?.code === 401
      ? 401
      : error?.code === 403
        ? 403
        : error?.code === 400
          ? 400
          : schemaIssue
            ? 409
            : 500;
    return {
      statusCode: status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: schemaIssue
          ? 'Team table is not ready in this environment yet.'
          : (error?.message || 'Team member save failed'),
        code: schemaIssue ? 'schema_mismatch' : undefined,
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
