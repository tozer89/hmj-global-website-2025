// netlify/functions/admin-jobs-list.js
const { withAdminCors } = require('./_http.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob, loadStaticJobs, ensureStaticJobs, isSchemaError } = require('./_jobs-helpers.js');

const JOB_SELECT = '*';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function truthy(value) {
  if (typeof value === 'string') {
    return /^(1|true|yes|on)$/i.test(value.trim());
  }
  return !!value;
}

function filterPublishedJobs(list = []) {
  if (!Array.isArray(list)) return [];
  return list.filter((job) => job && job.published !== false);
}

const baseHandler = async (event, context) => {
  let fallback = [];
  let fallbackError = null;
  try {
    fallback = loadStaticJobs();
  } catch (err) {
    fallbackError = err;
    console.warn('[admin-jobs] static load failed', err?.message || err);
  }
  const fallbackCount = fallback.length;

  const queryParams = event?.queryStringParameters || {};
  const headers = event?.headers || {};
  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (err) {
    console.warn('[admin-jobs] unable to parse body JSON', err?.message || err);
  }

  const modeValue = typeof queryParams.mode === 'string' ? queryParams.mode : '';
  const publicFlag =
    truthy(queryParams.public) ||
    modeValue.toLowerCase() === 'public' ||
    truthy(headers['x-hmj-public']) ||
    truthy(body.public);

  const isPublicRequest = !!publicFlag;
  const fallbackJobs = isPublicRequest ? filterPublishedJobs(fallback) : fallback;

  try {
    if (!isPublicRequest) {
      await getContext(event, context, { requireAdmin: true });
    }

    if (!hasSupabase()) {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          jobs: fallbackJobs,
          source: fallbackJobs.length ? 'static' : 'empty',
          readOnly: isPublicRequest ? undefined : true,
          warning: fallback.length
            ? 'Supabase unavailable — showing static jobs.'
            : (fallbackError?.message || 'Supabase client unavailable'),
          supabase: supabaseStatus(),
          fallbackCount,
        }),
      };
    }

    const supabase = getSupabase(event);

    const includeDrafts = !isPublicRequest && body.includeDrafts !== false;

    let query = supabase
      .from('jobs')
      .select(JOB_SELECT)
      .order('section', { ascending: true })
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .order('title', { ascending: true });

    if (!includeDrafts) {
      query = query.eq('published', true);
    }

    const { data, error } = await query;
    if (error) throw error;

    const jobsRaw = Array.isArray(data) ? data.map(toJob) : [];
    const jobs = isPublicRequest ? filterPublishedJobs(jobsRaw) : jobsRaw;
    if (!jobs.length && fallbackJobs.length) {
      const seeded = isPublicRequest
        ? fallbackJobs
        : fallbackJobs.map((job) => ({ ...job, __seed: true }));
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ jobs: seeded, source: 'static', seeded: true, supabase: supabaseStatus(), fallbackCount }),
      };
    }
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ jobs, source: jobs.length ? 'supabase' : 'empty', supabase: supabaseStatus(), fallbackCount }),
    };
  } catch (e) {
    const schemaIssue = isSchemaError(e);
    const status = e.code === 401 ? 403 : e.code === 403 ? 403 : 500;
    const source = fallbackJobs.length ? 'static' : 'empty';
    ensureStaticJobs();
    return {
      statusCode: fallbackJobs.length ? 200 : status,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jobs: fallbackJobs,
        readOnly: isPublicRequest ? undefined : true,
        source,
        error: e.message || fallbackError?.message || (status === 403 ? 'Unauthorized' : 'Unexpected error'),
        schema: schemaIssue,
        warning: schemaIssue
          ? 'Jobs table schema mismatch detected — serving static jobs.'
          : (fallbackError?.message || e.message || undefined),
        supabase: supabaseStatus(),
        fallbackCount,
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
