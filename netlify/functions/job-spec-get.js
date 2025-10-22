// netlify/functions/job-spec-get.js
const { getSupabase } = require('./_supabase.js');
const { toJob, findStaticJob, isSchemaError } = require('./_jobs-helpers.js');

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const body = JSON.parse(event.body || '{}');
  const slug = params.slug || body.slug || null;
  const jobIdParam = params.id || params.job || body.id || body.job || null;

  let supabase = null;
  try {
    supabase = getSupabase(event);
  } catch (err) {
    supabase = null;
  }

  function respondFallback(job, meta = {}) {
    if (!job) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({
        slug: job.id,
        jobId: job.id,
        title: job.title,
        job,
        expires_at: null,
        created_at: job.updatedAt || job.createdAt || null,
        fallback: true,
        ...meta,
      }),
    };
  }

  async function fetchJobById(id) {
    if (!id) return null;
    if (!supabase) {
      return findStaticJob(id);
    }
    const { data, error } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
    if (error) {
      if (isSchemaError(error)) {
        return findStaticJob(id);
      }
      throw error;
    }
    if (!data) return null;
    return toJob(data);
  }

  try {
    if (!slug && jobIdParam) {
      const result = await fetchJobById(jobIdParam);
      if (!result) {
        const fallback = findStaticJob(jobIdParam);
        return respondFallback(fallback);
      }
      if (!supabase) return respondFallback(result);
      return {
        statusCode: 200,
        body: JSON.stringify({
          slug: result.id,
          jobId: result.id,
          title: result.title,
          job: result,
          expires_at: null,
          created_at: result.updatedAt || result.createdAt || null,
        }),
      };
    }

    if (!slug) {
      return { statusCode: 400, body: JSON.stringify({ error: 'slug required' }) };
    }

    if (!supabase) {
      const fallback = findStaticJob(slug) || findStaticJob(jobIdParam);
      return respondFallback(fallback);
    }

    const nowIso = new Date().toISOString();
    try {
      const { data, error } = await supabase
        .from('job_specs')
        .select('slug,job_id,title,payload,expires_at,created_at')
        .eq('slug', slug)
        .single();

      if (error) {
        if (isSchemaError(error)) {
          const fallback = await fetchJobById(jobIdParam || slug);
          if (fallback) {
            return respondFallback(fallback, { schema: true });
          }
        }
        throw error;
      }
      if (!data) {
        if (jobIdParam) {
          const fallback = await fetchJobById(jobIdParam);
          if (fallback) {
            return {
              statusCode: 200,
              body: JSON.stringify({
                slug: jobIdParam,
                jobId: jobIdParam,
                title: fallback.title,
                job: fallback,
                expires_at: null,
                created_at: fallback.updatedAt || fallback.createdAt || null,
                fallback: !supabase,
              }),
            };
          }
        }
        const staticJob = findStaticJob(slug);
        return respondFallback(staticJob);
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
    } catch (err) {
      const missingTable = err?.code === '42P01' || /relation\s+"?job_specs"?/i.test(err?.message || '');
      const schemaMismatch = isSchemaError(err);
      if (!missingTable) throw err;
        const fallback = await fetchJobById(slug || jobIdParam);
        if (!fallback) {
          return respondFallback(findStaticJob(slug || jobIdParam), { schema: schemaMismatch || undefined });
        }
        return {
          statusCode: 200,
          body: JSON.stringify({
            slug: slug || fallback.id,
            jobId: fallback.id,
            title: fallback.title,
            job: fallback,
            expires_at: null,
            created_at: fallback.updatedAt || fallback.createdAt || null,
            fallback: true,
            schema: schemaMismatch,
          }),
        };
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Unexpected error' }) };
  }
};
