// netlify/functions/job-spec-get.js
const { getSupabase } = require('./_supabase.js');
const { toJob } = require('./_jobs-helpers.js');

exports.handler = async (event) => {
  try {
    const supabase = getSupabase(event);
    const slug = event.queryStringParameters?.slug || JSON.parse(event.body || '{}').slug;
    if (!slug) {
      return { statusCode: 400, body: JSON.stringify({ error: 'slug required' }) };
    }

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('job_specs')
      .select('slug,job_id,title,payload,expires_at,created_at')
      .eq('slug', slug)
      .single();

    if (error) throw error;
    if (!data) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
    }

    if (data.expires_at && data.expires_at < nowIso) {
      return { statusCode: 410, body: JSON.stringify({ error: 'Link expired' }) };
    }

    const job = data.payload ? toJob(data.payload) : null;
    return {
      statusCode: 200,
      body: JSON.stringify({
        slug: data.slug,
        jobId: data.job_id,
        title: data.title,
        job,
        expires_at: data.expires_at,
        created_at: data.created_at,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Unexpected error' }) };
  }
};
