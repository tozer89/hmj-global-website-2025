// netlify/functions/admin-jobs-list.js
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob, loadStaticJobs, ensureStaticJobs, isSchemaError } = require('./_jobs-helpers.js');

const JOB_SELECT = '*';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

exports.handler = async (event, context) => {
  let fallback = [];
  let fallbackError = null;
  try {
    fallback = loadStaticJobs();
  } catch (err) {
    fallbackError = err;
    console.warn('[admin-jobs] static load failed', err?.message || err);
  }
  const fallbackCount = fallback.length;

  try {
    await getContext(event, context, { requireAdmin: true });

    if (!hasSupabase()) {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          jobs: fallback,
          source: fallback.length ? 'static' : 'empty',
          readOnly: true,
          warning: fallback.length
            ? 'Supabase unavailable — showing static jobs.'
            : (fallbackError?.message || 'Supabase client unavailable'),
          supabase: supabaseStatus(),
          fallbackCount,
        }),
      };
    }

    const supabase = getSupabase(event);

    const body = JSON.parse(event.body || '{}');
    const includeDrafts = body.includeDrafts !== false;

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

    const jobs = Array.isArray(data) ? data.map(toJob) : [];
    if (!jobs.length && fallback.length) {
      const seeded = fallback.map((job) => ({ ...job, __seed: true }));
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
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    const source = fallback.length ? 'static' : 'empty';
    ensureStaticJobs();
    return {
      statusCode: fallback.length ? 200 : status,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jobs: fallback,
        readOnly: true,
        source,
        error: e.message || fallbackError?.message || (status === 401 ? 'Unauthorized' : 'Unexpected error'),
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
