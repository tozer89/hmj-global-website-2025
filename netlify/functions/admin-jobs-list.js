// netlify/functions/admin-jobs-list.js
const { getSupabase } = require('./_supabase.js');
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

exports.handler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
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
    if (!jobs.length) {
      const fallback = loadStaticJobs();
      if (fallback.length) {
        return { statusCode: 200, body: JSON.stringify({ jobs: fallback, readOnly: true, source: 'static' }) };
      }
    }
    return { statusCode: 200, body: JSON.stringify({ jobs }) };
  } catch (e) {
    const fallback = loadStaticJobs();
    if (fallback.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ jobs: fallback, readOnly: true, source: 'static', error: e.message }),
      };
    }
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Unexpected error' }) };
  }
};
