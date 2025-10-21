// netlify/functions/admin-jobs-save.js
const { getSupabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob, toDbPayload } = require('./_jobs-helpers.js');

const COLUMNS = `
  id,
  title,
  status,
  section,
  discipline,
  type,
  location_text,
  location_code,
  overview,
  responsibilities,
  requirements,
  keywords,
  apply_url,
  published,
  sort_order,
  created_at,
  updated_at
`;

function slugify(text = '') {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `job-${Date.now()}`;
}

exports.handler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const supabase = getSupabase(event);

    const { job } = JSON.parse(event.body || '{}');
    if (!job || typeof job !== 'object') {
      return { statusCode: 400, body: JSON.stringify({ error: 'job payload required' }) };
    }

    const payload = toDbPayload(job);
    if (!payload.title) {
      return { statusCode: 400, body: JSON.stringify({ error: 'title required' }) };
    }

    payload.id = (payload.id || '').trim();
    payload.id = payload.id || slugify(job.title || '');
    if (!payload.id) {
      payload.id = slugify(job.title || '');
    }

    if (!Number.isFinite(payload.sort_order) && payload.sort_order !== 0) {
      payload.sort_order = 1000;
    }

    if (!Array.isArray(payload.responsibilities)) payload.responsibilities = [];
    if (!Array.isArray(payload.requirements)) payload.requirements = [];

    const { data, error } = await supabase
      .from('jobs')
      .upsert(payload, { onConflict: 'id', ignoreDuplicates: false })
      .select(COLUMNS)
      .single();

    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ job: toJob(data) }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Unexpected error' }) };
  }
};
