// netlify/functions/admin-jobs-list.js
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob, loadStaticJobs } = require('./_jobs-helpers.js');

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

  try {
    await getContext(event, context, { requireAdmin: true });

    if (!hasSupabase()) {
      if (fallback.length) {
        return {
          statusCode: 200,
          headers: JSON_HEADERS,
          body: JSON.stringify({ jobs: fallback, source: 'static', readOnly: true, supabase: supabaseStatus() }),
        };
      }
      return {
        statusCode: 503,
        headers: JSON_HEADERS,
        body: JSON.stringify({ error: 'Supabase client unavailable', supabase: supabaseStatus() }),
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
        body: JSON.stringify({ jobs: seeded, source: 'static', seeded: true, supabase: supabaseStatus() }),
      };
    }
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ jobs, supabase: supabaseStatus() }) };
  } catch (e) {
    if (fallback.length) {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          jobs: fallback,
          readOnly: true,
          source: 'static',
          error: e.message,
          supabase: supabaseStatus(),
        }),
      };
    }
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return {
      statusCode: status,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: e.message || 'Unexpected error', supabase: supabaseStatus() }),
    };
  }
};
