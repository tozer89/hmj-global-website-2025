// netlify/functions/jobs-list.js
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
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
  updated_at
`;

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

exports.handler = async (event) => {
  const fallback = loadStaticJobs();

  if (!hasSupabase()) {
    if (fallback.length) {
      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ jobs: fallback, source: 'static', supabase: supabaseStatus() }),
      };
    }
    return {
      statusCode: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'Supabase client unavailable', supabase: supabaseStatus() }),
    };
  }

  try {
    const supabase = getSupabase(event);

    let query = supabase
      .from('jobs')
      .select(COLUMNS)
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
        body: JSON.stringify({ jobs: fallback, source: 'static', supabase: supabaseStatus() }),
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
          source: 'static',
          warning: e.message,
          supabase: supabaseStatus(),
        }),
      };
    }
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: e.message || 'Unable to load jobs', supabase: supabaseStatus() }),
    };
  }
};
