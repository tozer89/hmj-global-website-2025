// netlify/functions/admin-jobs-list.js
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob, loadStaticJobs, ensureStaticJobs } = require('./_jobs-helpers.js');

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

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

exports.handler = async (event, context) => {
  const fallback = loadStaticJobs();
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
          warning: fallback.length ? undefined : 'Supabase client unavailable',
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
      .select(COLUMNS)
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
        error: e.message || (status === 401 ? 'Unauthorized' : 'Unexpected error'),
        supabase: supabaseStatus(),
        fallbackCount,
      }),
    };
  }
};
