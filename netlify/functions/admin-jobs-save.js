// netlify/functions/admin-jobs-save.js
const { getSupabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob, toDbPayload, isSchemaError } = require('./_jobs-helpers.js');

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
    let supabase;
    try {
      supabase = getSupabase(event);
    } catch (err) {
      return {
        statusCode: 503,
        body: JSON.stringify({ error: 'Supabase not configured', code: err.code || 'supabase_unavailable' }),
      };
    }

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

    const working = { ...payload };
    const dropped = new Set();
    let attempt = 0;
    let data;
    let error;

    while (attempt < 5) {
      attempt += 1;
      ({ data, error } = await supabase
        .from('jobs')
        .upsert(working, { onConflict: 'id', ignoreDuplicates: false })
        .select('*')
        .single());

      if (!error) break;

      if (isSchemaError(error)) {
        const message = String(error.message || '').toLowerCase();
        if (message.includes('column')) {
          const match = /column "?([a-z0-9_]+)"? does not exist/i.exec(error.message || '');
          let missing = match ? match[1] : null;
          if (!missing) {
            if (message.includes('location_code')) missing = 'location_code';
            else if (message.includes('requirements')) missing = 'requirements';
            else if (message.includes('responsibilities')) missing = 'responsibilities';
          }
          if (missing && Object.prototype.hasOwnProperty.call(working, missing) && !dropped.has(missing)) {
            console.warn('[jobs] dropping unknown column %s and retrying', missing);
            delete working[missing];
            dropped.add(missing);
            continue;
          }
        }
        return {
          statusCode: 409,
          body: JSON.stringify({
            error: 'Jobs table schema mismatch — update columns or refresh seeds.',
            code: 'schema_mismatch',
          }),
        };
      }

      throw error;
    }

    if (error) {
      throw error;
    }

    return { statusCode: 200, body: JSON.stringify({ job: toJob(data) }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : (e.code === 'schema_mismatch' ? 409 : 500);
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Unexpected error', code: e.code || undefined }) };
  }
};
