// netlify/functions/jobs-list.js
const { getSupabase } = require('./_supabase.js');
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

exports.handler = async (event) => {
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
    if (!jobs.length) {
      const fallback = loadStaticJobs();
      if (fallback.length) {
        return { statusCode: 200, body: JSON.stringify({ jobs: fallback, source: 'static' }) };
      }
    }
    return { statusCode: 200, body: JSON.stringify({ jobs }) };
  } catch (e) {
    const fallback = loadStaticJobs();
    if (fallback.length) {
      return { statusCode: 200, body: JSON.stringify({ jobs: fallback, source: 'static', warning: e.message }) };
    }
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Unable to load jobs' }) };
  }
};
