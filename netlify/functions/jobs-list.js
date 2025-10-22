// netlify/functions/jobs-list.js
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { toJob, loadStaticJobs, ensureStaticJobs, isSchemaError } = require('./_jobs-helpers.js');

const JOB_SELECT = '*';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

exports.handler = async (event) => {
  let fallback = [];
  let fallbackError = null;
  try {
    fallback = loadStaticJobs();
  } catch (err) {
    fallbackError = err;
    console.warn('[jobs] static load failed', err?.message || err);
  }
  const fallbackCount = fallback.length;

  if (!hasSupabase()) {
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jobs: fallback,
        source: fallback.length ? 'static' : 'empty',
        warning: fallback.length
          ? 'Supabase unavailable — showing static jobs.'
          : (fallbackError?.message || 'Supabase client unavailable'),
        supabase: supabaseStatus(),
        fallbackCount,
        schema: false,
      }),
    };
  }

  try {
    const supabase = getSupabase(event);

    let query = supabase
      .from('jobs')
      .select(JOB_SELECT)
      .eq('published', true)
      .order('section', { ascending: true })
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .order('title', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    const jobs = Array.isArray(data) ? data.map(toJob) : [];
    if (!jobs.length && fallback.length) {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          jobs: fallback,
          source: 'static',
          supabase: supabaseStatus(),
          fallbackCount,
          schema: false,
        }),
      };
    }
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jobs,
        source: jobs.length ? 'supabase' : 'empty',
        supabase: supabaseStatus(),
        fallbackCount,
        schema: false,
      }),
    };
  } catch (e) {
    const schemaIssue = isSchemaError(e);
    ensureStaticJobs();
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jobs: fallback,
        source: fallback.length ? 'static' : 'empty',
        warning: e.message || fallbackError?.message || 'Unable to load jobs',
        supabase: supabaseStatus(),
        fallbackCount,
        schema: schemaIssue,
      }),
    };
  }
};
