// netlify/functions/admin-jobs-list.js
const { withAdminCors } = require('./_http.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob, isSchemaError } = require('./_jobs-helpers.js');

const JOB_SELECT = '*';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function truthy(value) {
  if (typeof value === 'string') {
    return /^(1|true|yes|on)$/i.test(value.trim());
  }
  return !!value;
}

const baseHandler = async (event, context) => {
  const queryParams = event?.queryStringParameters || {};
  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (err) {
    console.warn('[admin-jobs] unable to parse body JSON', err?.message || err);
  }

  const modeValue = typeof queryParams.mode === 'string' ? queryParams.mode : '';
  const publicFlag = truthy(queryParams.public) || modeValue.toLowerCase() === 'public' || truthy(body.public);

  try {
    if (publicFlag) {
      return {
        statusCode: 410,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: 'Public jobs mode has been removed from this endpoint. Use /.netlify/functions/jobs-list instead.',
          code: 'public_mode_removed',
        }),
      };
    }

    await getContext(event, context, { requireAdmin: true });

    if (!hasSupabase()) {
      return {
        statusCode: 503,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          jobs: [],
          source: 'unavailable',
          readOnly: true,
          error: 'Live jobs system unavailable',
          code: 'supabase_unavailable',
          supabase: supabaseStatus(),
          schema: false,
        }),
      };
    }

    const supabase = getSupabase(event);

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
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jobs,
        source: 'supabase',
        readOnly: false,
        supabase: supabaseStatus(),
        schema: false,
      }),
    };
  } catch (e) {
    const schemaIssue = isSchemaError(e);
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : (schemaIssue ? 409 : 503);
    return {
      statusCode: status,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        jobs: [],
        readOnly: true,
        source: 'unavailable',
        error: schemaIssue
          ? 'Live jobs system unavailable because the jobs table schema does not match this editor.'
          : (e.message || (status === 401 ? 'Unauthorized' : 'Live jobs system unavailable')),
        code: schemaIssue ? 'schema_mismatch' : undefined,
        schema: schemaIssue,
        supabase: supabaseStatus(),
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
