// netlify/functions/admin-jobs-section-save.js
const { withSupabase, jsonOk, jsonError } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

const clean = (value) => {
  if (value === undefined || value === null) return null;
  const str = typeof value === 'string' ? value.trim() : value;
  if (typeof str === 'string' && !str) return null;
  return str;
};

module.exports.handler = withSupabase(async ({ event, context, supabase, trace }) => {
  try {
    await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    const status = err.code === 401 ? 401 : err.code === 403 ? 403 : 500;
    return jsonError(status, err.code || 'unauthorized', err.message || 'Unauthorized', { trace });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const code = clean(body.code);
  const label = clean(body.label) || code;
  const description = clean(body.description);
  const sort_order = Number.isFinite(body.sort_order) ? Number(body.sort_order) : null;

  if (!code) return jsonError(400, 'code_required', 'Section code is required', { trace });

  const payload = { code, label: label || code, description: description || '' };
  if (sort_order !== null && !Number.isNaN(sort_order)) payload.sort_order = sort_order;

  const { error } = await supabase
    .from('job_sections')
    .upsert(payload, { onConflict: 'code' });

  if (error) {
    return jsonError(500, 'section_save_failed', error.message || 'Failed to save section', { trace });
  }

  return jsonOk({ ok: true, trace, section: payload });
});
