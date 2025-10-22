// netlify/functions/admin-jobs-get.js
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
    const { id } = JSON.parse(event.body || '{}');
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'id required' }) };
    }

    try {
      const supabase = getSupabase(event);
      const { data, error } = await supabase
        .from('jobs')
        .select(COLUMNS)
        .eq('id', id)
        .single();

      if (error) throw error;
      if (!data) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
      }

      return { statusCode: 200, body: JSON.stringify({ job: toJob(data) }) };
    } catch (err) {
      const fallback = loadStaticJobs();
      const match = fallback.find((j) => j.id === String(id));
      if (match) {
        return { statusCode: 200, body: JSON.stringify({ job: match, readOnly: true, source: 'static', error: err.message }) };
      }
      const status = err.code === 401 ? 401 : err.code === 403 ? 403 : 500;
      return { statusCode: status, body: JSON.stringify({ error: err.message || 'Unexpected error' }) };
    }
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Unexpected error' }) };
  }
};
