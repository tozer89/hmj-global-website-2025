// netlify/functions/admin-job-share-create.js
const { randomUUID } = require('node:crypto');
const { getSupabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob, findStaticJob, slugify, isSchemaError } = require('./_jobs-helpers.js');

function buildSlug(id) {
  const safeId = (id || 'job').toString().replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `${safeId}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
}

function originFromEvent(event) {
  const proto = event?.headers?.['x-forwarded-proto'] || event?.headers?.['X-Forwarded-Proto'] || 'https';
  const host = event?.headers?.host || event?.headers?.Host || '';
  return `${proto}://${host}`.replace(/:\/\/\//, '://');
}

exports.handler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    let supabase;
    let supabaseErr = null;
    try {
      supabase = getSupabase(event);
    } catch (err) {
      supabaseErr = err;
      supabase = null;
    }

    const { jobId, jobPayload, expiresInDays = 30, notes } = JSON.parse(event.body || '{}');
    if (!jobId && !jobPayload) {
      return { statusCode: 400, body: JSON.stringify({ error: 'jobId required' }) };
    }

    const origin = originFromEvent(event);

    let job = null;

    if (supabase && jobId) {
      try {
        const { data: jobRow, error: jobError } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', jobId)
          .single();

        if (jobError) {
          if (isSchemaError(jobError)) {
            supabaseErr = jobError;
            supabase = null;
          } else if (jobError?.code === '42P01' || /relation\s+"?jobs"?/i.test(jobError?.message || '')) {
            supabaseErr = jobError;
            supabase = null;
          } else {
            throw jobError;
          }
        } else if (jobRow) {
          job = toJob(jobRow);
        }
      } catch (err) {
        if (isSchemaError(err)) {
          supabaseErr = err;
          supabase = null;
        } else {
          throw err;
        }
      }
    }

    if (!job && jobPayload) {
      job = toJob(jobPayload);
    }

    if (!job && jobId) {
      job = findStaticJob(jobId);
    }

    if (!job) {
      const fallbackId = jobPayload?.id || jobId;
      return { statusCode: 404, body: JSON.stringify({ error: 'Job not found', id: fallbackId }) };
    }

    const slug = supabase ? buildSlug(job.id) : (job.id || slugify(job.title || 'job'));
    const expires = supabase && Number.isFinite(expiresInDays) && expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 86400000)
      : null;

    if (supabase) {
      const record = {
        slug,
        job_id: job.id,
        title: job.title,
        payload: job,
        notes: notes ? String(notes) : null,
        expires_at: expires ? expires.toISOString() : null,
      };

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
    }

    const fallbackUrl = `${origin}/jobs/spec.html?id=${encodeURIComponent(job.id || slugify(job.title || 'role'))}`;
    return {
      statusCode: 200,
      body: JSON.stringify({
        slug: job.id || slug,
        url: fallbackUrl,
        expires_at: null,
        fallback: true,
        reason: supabaseErr?.code || 'supabase_unavailable',
        schema: isSchemaError(supabaseErr) || undefined,
      }),
    };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Unexpected error' }) };
  }
};
