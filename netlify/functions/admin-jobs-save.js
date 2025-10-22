// netlify/functions/admin-jobs-save.js
const { withSupabase, jsonOk, jsonError } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

const slugify = (value = '') => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .replace(/-{2,}/g, '-')
  .slice(0, 64);

const clean = (value) => {
  if (value === undefined || value === null) return null;
  const str = typeof value === 'string' ? value.trim() : value;
  if (typeof str === 'string' && !str) return null;
  return str;
};

const ensureArray = (value) => {
  if (Array.isArray(value)) return value.filter((v) => (v ?? '').toString().trim());
  if (!value) return [];
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [value].filter(Boolean);
};

module.exports.handler = withSupabase(async ({ event, context, supabase, trace, debug }) => {
  try {
    await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    const status = err.code === 401 ? 401 : err.code === 403 ? 403 : 500;
    return jsonError(status, err.code || 'unauthorized', err.message || 'Unauthorized', { trace });
  }

  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch {}

  const now = new Date().toISOString();

  let jobId = clean(payload.id) || '';
  const isInsert = !jobId;

  if (!clean(payload.title)) {
    return jsonError(400, 'title_required', 'Job title is required', { trace });
  }

  if (!clean(payload.section)) {
    return jsonError(400, 'section_required', 'Section is required', { trace });
  }

  if (!jobId) jobId = slugify(payload.title || 'job');

  let sortOrder = typeof payload.sort_order === 'number' ? payload.sort_order : null;
  if (isInsert || sortOrder === null || Number.isNaN(sortOrder)) {
    const { data: maxRow, error: maxErr } = await supabase
      .from('jobs')
      .select('sort_order')
      .order('sort_order', { ascending: false, nullsLast: true })
      .limit(1)
      .maybeSingle();
    if (!maxErr) {
      sortOrder = ((maxRow?.sort_order ?? 0) || 0) + 1;
    } else {
      debug?.('[admin-jobs-save] failed to fetch max sort_order:', maxErr.message);
      sortOrder = 1;
    }
  }

  const record = {
    id: jobId,
    title: clean(payload.title),
    status: clean(payload.status) || 'draft',
    section: clean(payload.section),
    section_label: clean(payload.section_label),
    section_description: clean(payload.section_description),
    discipline: clean(payload.discipline),
    type: clean(payload.type),
    location_text: clean(payload.location_text),
    location_code: clean(payload.location_code),
    overview: clean(payload.overview),
    responsibilities: ensureArray(payload.responsibilities),
    requirements: ensureArray(payload.requirements),
    apply_url: clean(payload.apply_url),
    keywords: clean(payload.keywords),
    published: payload.published === true || payload.published === 'true',
    sort_order: sortOrder,
    match_assignment: clean(payload.match_assignment),
    is_live: payload.is_live === undefined ? undefined : !!payload.is_live,
    updated_at: now,
  };

  if (isInsert) record.created_at = now;

  // Remove undefined keys (Supabase rejects them)
  Object.keys(record).forEach((key) => {
    if (record[key] === undefined) delete record[key];
  });

  const { data: upserted, error } = await supabase
    .from('jobs')
    .upsert(record, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) {
    return jsonError(500, 'save_failed', error.message || 'Failed to save job', { trace });
  }

  if (record.section_label || record.section_description) {
    try {
      await supabase
        .from('job_sections')
        .upsert({
          code: record.section,
          label: record.section_label || record.section,
          description: record.section_description || '',
        }, { onConflict: 'code' });
    } catch (sectionErr) {
      debug?.('[admin-jobs-save] job_sections upsert failed:', sectionErr.message || sectionErr);
    }
  }

  return jsonOk({
    ok: true,
    trace,
    job: {
      ...upserted,
      responsibilities: ensureArray(upserted?.responsibilities),
      requirements: ensureArray(upserted?.requirements),
    },
  });
});
