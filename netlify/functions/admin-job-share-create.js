// netlify/functions/admin-job-share-create.js
const { randomUUID } = require('node:crypto');
const { getSupabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob } = require('./_jobs-helpers.js');

function buildSlug(id) {
  const safeId = (id || 'job').toString().replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `${safeId}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
}

exports.handler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    let supabase;
    try {
      supabase = getSupabase(event);
    } catch (err) {
      return {
        statusCode: 503,
        body: JSON.stringify({ error: 'Supabase not configured', code: err.code || 'supabase_unavailable' }),
      };
    }

    const { jobId, expiresInDays = 30, notes } = JSON.parse(event.body || '{}');
    if (!jobId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'jobId required' }) };
    }

    const { data: jobRow, error: jobError } = await supabase
      .from('jobs')
      .select(
        `id,title,status,section,discipline,type,location_text,location_code,overview,responsibilities,requirements,keywords,apply_url,published,sort_order,created_at,updated_at`
      )
      .eq('id', jobId)
      .single();

    if (jobError) throw jobError;
    if (!jobRow) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Job not found' }) };
    }

    const job = toJob(jobRow);
    const slug = buildSlug(job.id);
    const expires = Number.isFinite(expiresInDays) && expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 86400000)
      : null;

    const record = {
      slug,
      job_id: job.id,
      title: job.title,
      payload: job,
      notes: notes ? String(notes) : null,
      expires_at: expires ? expires.toISOString() : null,
    };

    const origin = `${event.headers['x-forwarded-proto'] || 'https'}://${event.headers['host'] || event.headers.Host || ''}`;

    try {
      const { error: insertError } = await supabase.from('job_specs').insert(record);
      if (insertError) throw insertError;
      const url = `${origin}/jobs/spec.html?slug=${encodeURIComponent(slug)}`;
      return { statusCode: 200, body: JSON.stringify({ slug, url, expires_at: record.expires_at }) };
    } catch (err) {
      const missingTable = err?.code === '42P01' || /relation\s+"?job_specs"?/i.test(err?.message || '');
      if (!missingTable) throw err;
      const fallbackUrl = `${origin}/jobs/spec.html?id=${encodeURIComponent(job.id)}`;
      return {
        statusCode: 200,
        body: JSON.stringify({ slug: job.id, url: fallbackUrl, expires_at: null, fallback: true }),
      };
    }
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Unexpected error' }) };
  }
};
