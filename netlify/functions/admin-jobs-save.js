// netlify/functions/admin-jobs-save.js
const { withAdminCors } = require('./_http.js');
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

function adjustPayloadForSchema(payload, err) {
  const message = String(err?.message || '').toLowerCase();
  if (!/public_page_config/.test(message) || !('public_page_config' in payload)) {
    return null;
  }
  const next = { ...payload };
  delete next.public_page_config;
  return next;
}

const baseHandler = async (event, context) => {
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

    let schemaAdjusted = false;
    let record = { ...payload };
    let data = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await supabase
        .from('jobs')
        .upsert(record, { onConflict: 'id', ignoreDuplicates: false })
        .select('*')
        .single();

      if (!result.error) {
        data = result.data;
        break;
      }

      if (!isSchemaError(result.error)) {
        throw result.error;
      }

      const adjusted = adjustPayloadForSchema(record, result.error);
      if (!adjusted) {
        return {
          statusCode: 409,
          body: JSON.stringify({
            error: 'Jobs table schema mismatch — update columns or refresh seeds.',
            code: 'schema_mismatch',
          }),
        };
      }
      record = adjusted;
      schemaAdjusted = true;
    }

    if (!data) {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: 'Jobs table schema mismatch — update columns or refresh seeds.',
          code: 'schema_mismatch',
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        job: toJob(data),
        schema: schemaAdjusted || undefined,
      }),
    };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : (e.code === 'schema_mismatch' ? 409 : 500);
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Unexpected error', code: e.code || undefined }) };
  }
};

exports.handler = withAdminCors(baseHandler);
