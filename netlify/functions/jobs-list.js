// netlify/functions/jobs-list.js
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { toPublicJob, isSchemaError, resolvePublicSiteUrl } = require('./_jobs-helpers.js');

const JOB_SELECT = '*';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function isLocalDebugRequest(event) {
  const host = String(event?.headers?.host || '');
  return process.env.NETLIFY_DEV === 'true' || /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
}

function buildLocalDebugPayload(error) {
  if (!error) return null;
  return {
    message: error.message || String(error),
    code: error.code || error.status || error.statusCode || null,
    details: error.details || null,
    hint: error.hint || null,
    stack: error.stack || null,
  };
}

exports.handler = async (event) => {
  const siteUrl = resolvePublicSiteUrl(event);
  if (!hasSupabase()) {
    return {
      statusCode: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: 'Live jobs service unavailable',
        code: 'supabase_unavailable',
        supabase: supabaseStatus(),
        schema: false,
      }),
    };
  }

  try {
    const supabase = getSupabase(event);

    let query = supabase
      .from('jobs')
      .select(JOB_SELECT)
      .order('section', { ascending: true })
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .order('title', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    const jobs = Array.isArray(data)
      ? data.map((row) => toPublicJob(row, { siteUrl })).filter((job) => job && job.published !== false)
      : [];
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jobs,
        source: 'supabase',
        supabase: supabaseStatus(),
        schema: false,
      }),
    };
  } catch (e) {
    const schemaIssue = isSchemaError(e);
    const localDebug = isLocalDebugRequest(event);
    if (localDebug) {
      console.error('[jobs-list][local-debug] query failed', {
        message: e?.message || String(e),
        code: e?.code || e?.status || e?.statusCode || null,
        details: e?.details || null,
        hint: e?.hint || null,
        stack: e?.stack || null,
        supabase: supabaseStatus(),
      });
    }
    return {
      statusCode: schemaIssue ? 409 : 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: schemaIssue
          ? 'Jobs service is unavailable because the jobs table schema does not match the live site.'
          : 'Live jobs service unavailable',
        code: schemaIssue ? 'schema_mismatch' : 'jobs_unavailable',
        supabase: supabaseStatus(),
        schema: schemaIssue,
        ...(localDebug ? { debug: buildLocalDebugPayload(e) } : {}),
      }),
    };
  }
};
