// netlify/functions/admin-jobs-list.js
const { withSupabase, jsonOk, jsonError } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [value].filter(Boolean);
}

function uniqueSectionsFromJobs(jobs = []) {
  const seen = new Map();
  for (const job of jobs) {
    const code = (job.section || '').trim();
    if (!code) continue;
    if (!seen.has(code)) {
      seen.set(code, {
        code,
        label: job.section_label || job.section || code,
        description: job.section_description || '',
        sort_order: seen.size + 1,
        derived: true,
      });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}

module.exports.handler = withSupabase(async ({ event, context, supabase, trace, debug }) => {
  try {
    await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    const status = err.code === 401 ? 401 : err.code === 403 ? 403 : 500;
    return jsonError(status, err.code || 'unauthorized', err.message || 'Unauthorized', { trace });
  }

  let body = {};
  if (event.body) {
    try { body = JSON.parse(event.body); } catch {}
  }

  const q = (body.q || '').trim();
  const statusFilter = (body.status || '').trim();
  const sectionFilter = (body.section || '').trim();
  const typeFilter = (body.type || '').trim();
  const includeDrafts = body.includeDrafts !== false;
  const disciplineFilter = (body.discipline || '').trim();
  const locationFilter = (body.location || '').trim();
  const assignmentFilter = (body.assignment || '').trim();

  const selectColumns = [
    'id',
    'title',
    'status',
    'section',
    'section_label',
    'section_description',
    'discipline',
    'type',
    'location_text',
    'location_code',
    'overview',
    'responsibilities',
    'requirements',
    'apply_url',
    'published',
    'keywords',
    'sort_order',
    'created_at',
    'updated_at',
    'match_assignment',
    'is_live',
  ].join(',');

  let query = supabase
    .from('jobs')
    .select(selectColumns)
    .order('sort_order', { ascending: true, nullsFirst: true })
    .order('updated_at', { ascending: false, nullsLast: true });

  if (!includeDrafts) query = query.eq('published', true);
  if (statusFilter) query = query.eq('status', statusFilter);
  if (sectionFilter) query = query.eq('section', sectionFilter);
  if (typeFilter) query = query.eq('type', typeFilter);
  if (disciplineFilter) query = query.ilike('discipline', `%${disciplineFilter}%`);
  if (locationFilter) query = query.ilike('location_code', `%${locationFilter}%`);
  if (assignmentFilter) query = query.ilike('match_assignment', `%${assignmentFilter}%`);

  if (q) {
    const like = `%${q}%`;
    query = query.or([
      `title.ilike.${like}`,
      `location_text.ilike.${like}`,
      `keywords.ilike.${like}`,
      `overview.ilike.${like}`,
      `discipline.ilike.${like}`,
    ].join(','));
  }

  let { data: jobs, error } = await query;

  if (error && /column/i.test(error.message || '')) {
    debug?.('[admin-jobs-list] column error, retrying with *:', error.message);
    const fallback = await supabase
      .from('jobs')
      .select('*')
      .order('sort_order', { ascending: true, nullsFirst: true })
      .order('updated_at', { ascending: false, nullsLast: true });
    if (!fallback.error) {
      jobs = fallback.data;
      error = null;
    } else {
      error = fallback.error;
    }
  }

  if (error) {
    return jsonError(500, 'query_failed', error.message || 'Failed to load jobs', { trace });
  }

  const safeJobs = (jobs || []).map((job, index) => ({
    ...job,
    responsibilities: ensureArray(job.responsibilities),
    requirements: ensureArray(job.requirements),
    sort_order: job.sort_order ?? (index + 1),
  }));

  let sections = [];
  try {
    const { data: sectionRows, error: sectionErr } = await supabase
      .from('job_sections')
      .select('code,label,description,sort_order')
      .order('sort_order', { ascending: true, nullsFirst: true });
    if (sectionErr) {
      if (!/relation/.test(sectionErr.message || '')) debug?.('[admin-jobs-list] job_sections error:', sectionErr.message);
    } else if (sectionRows) {
      sections = sectionRows.map((row, idx) => ({
        code: row.code || row.label || row.id || `section-${idx + 1}`,
        label: row.label || row.code || `Section ${idx + 1}`,
        description: row.description || '',
        sort_order: row.sort_order ?? (idx + 1),
      }));
    }
  } catch (sectionUnexpected) {
    debug?.('[admin-jobs-list] job_sections unexpected error:', sectionUnexpected.message || sectionUnexpected);
  }

  if (!sections.length) sections = uniqueSectionsFromJobs(safeJobs);

  return jsonOk({
    ok: true,
    trace,
    jobs: safeJobs,
    sections,
    filters: { q, status: statusFilter, section: sectionFilter, type: typeFilter, includeDrafts, discipline: disciplineFilter, location: locationFilter, assignment: assignmentFilter },
  });
});
