// netlify/functions/admin-jobs-reorder.js
const { withSupabase, jsonOk, jsonError } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

module.exports.handler = withSupabase(async ({ event, context, supabase, trace }) => {
  try {
    await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    const status = err.code === 401 ? 401 : err.code === 403 ? 403 : 500;
    return jsonError(status, err.code || 'unauthorized', err.message || 'Unauthorized', { trace });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const groups = Array.isArray(body.order) ? body.order : [];
  if (!groups.length) {
    return jsonError(400, 'order_required', 'Reorder payload was empty', { trace });
  }

  const updates = [];
  let position = 1;
  for (const group of groups) {
    const section = (group.section || '').trim() || null;
    const ids = Array.isArray(group.ids) ? group.ids : [];
    for (const id of ids) {
      if (!id) continue;
      updates.push({
        id,
        sort_order: position++,
        ...(section ? { section } : {}),
      });
    }
  }

  if (!updates.length) {
    return jsonError(400, 'no_updates', 'No job IDs supplied', { trace });
  }

  const { error } = await supabase
    .from('jobs')
    .upsert(updates, { onConflict: 'id', ignoreDuplicates: false });

  if (error) {
    return jsonError(500, 'reorder_failed', error.message || 'Failed to save order', { trace });
  }

  return jsonOk({ ok: true, trace, updated: updates.length });
});
