// netlify/functions/admin-jobs-reorder.js
const { getSupabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob } = require('./_jobs-helpers.js');

exports.handler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    let supabase;
    try {
      supabase = getSupabase(event);
    } catch (err) {
      return {
        statusCode: 503,
        body: JSON.stringify({ error: 'Supabase not configured', code: err.code || 'supabase_unavailable' }),
      };
    }
    const { updates } = JSON.parse(event.body || '{}');

    if (!Array.isArray(updates) || !updates.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'updates array required' }) };
    }

    const payload = updates
      .map((item) => ({
        id: item?.id ? String(item.id) : null,
        section: item?.section != null ? String(item.section).trim() : undefined,
        sort_order:
          Number.isFinite(item?.sortOrder) || Number(item?.sortOrder) === 0
            ? Number(item.sortOrder)
            : null,
      }))
      .filter((item) => item.id);

    if (!payload.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'no valid ids in updates' }) };
    }

    const { data, error } = await supabase
      .from('jobs')
      .upsert(payload, { onConflict: 'id', ignoreDuplicates: false })
      .select();

    if (error) throw error;

    const jobs = Array.isArray(data) ? data.map(toJob) : [];
    return { statusCode: 200, body: JSON.stringify({ ok: true, jobs }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Unexpected error' }) };
  }
};
