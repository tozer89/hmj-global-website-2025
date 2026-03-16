// netlify/functions/job-spec-get.js
const { getSupabase } = require('./_supabase.js');
const { toPublicJob, findStaticJob, isSchemaError, isMissingTableError, isPublicJob } = require('./_jobs-helpers.js');
const { verifyShareAccessToken } = require('./_job-detail-tokens.js');
const { fetchStoredSeoSuggestion } = require('./_job-seo-optimizer.js');

function parseBody(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (_) {
    return {};
  }
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const body = parseBody(event.body);
  const slug = params.slug || body.slug || null;
  const jobIdParam = params.id || params.job || body.id || body.job || null;
  const accessToken = params.token || body.token || null;
  const hasShareAccessToken = verifyShareAccessToken(accessToken, jobIdParam);

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

  async function fetchJobById(id, options = {}) {
    const allowRestrictedShare = options.allowRestrictedShare === true;
    if (!id) return null;
    const guard = (job) => {
      if (!job) return null;
      if (allowRestrictedShare || isPublicJob(job)) {
        return toPublicJob(job);
      }
      return null;
    };
    if (!supabase) {
      return guard(findStaticJob(id));
    }
    const { data, error } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle();
    if (error) {
      if (isSchemaError(error) || isMissingTableError(error, 'jobs')) {
        return guard(findStaticJob(id));
      }
      throw error;
    }
    if (!data) return null;
    return guard(data);
  }

  async function fetchSeo(jobId) {
    if (!supabase || !jobId) {
      return { suggestion: null, missingTable: false };
    }
    return fetchStoredSeoSuggestion(supabase, jobId);
  }

  try {
    if (!slug && jobIdParam) {
      const result = await fetchJobById(jobIdParam, { allowRestrictedShare: hasShareAccessToken });
      if (!result) {
        const fallback = findStaticJob(jobIdParam);
        const tokenFallback = hasShareAccessToken && fallback ? toPublicJob(fallback) : null;
        return respondFallback(tokenFallback);
      }
      if (!supabase) {
        return respondFallback(result, { publicDetail: !hasShareAccessToken });
      }
      const seo = await fetchSeo(result.id);
      return {
        statusCode: 200,
        body: JSON.stringify({
          slug: result.id,
          jobId: result.id,
          title: result.title,
          job: result,
          seo: seo.suggestion,
          expires_at: null,
          created_at: result.updatedAt || result.createdAt || null,
          publicDetail: !hasShareAccessToken,
          schema: seo.missingTable || undefined,
        }),
      };
    }

    if (!slug) {
      return { statusCode: 400, body: JSON.stringify({ error: 'slug required' }) };
    }

    if (!supabase) {
      const fallback = findStaticJob(slug) || findStaticJob(jobIdParam);
      const publicFallback = fallback && isPublicJob(fallback) ? toPublicJob(fallback) : null;
      return respondFallback(publicFallback);
    }

    const nowIso = new Date().toISOString();
    try {
      const { data, error } = await supabase
        .from('job_specs')
        .select('*')
        .eq('slug', slug)
        .single();

      if (error) {
        if (isSchemaError(error) || isMissingTableError(error, 'job_specs')) {
          const fallback = await fetchJobById(jobIdParam || slug, { allowRestrictedShare: hasShareAccessToken });
          if (fallback) {
            return respondFallback(fallback, { schema: true });
          }
        }
        throw error;
      }
      if (!data) {
        if (jobIdParam) {
          const fallback = await fetchJobById(jobIdParam, { allowRestrictedShare: hasShareAccessToken });
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
        const publicFallback = staticJob && isPublicJob(staticJob) ? toPublicJob(staticJob) : null;
        return respondFallback(publicFallback);
      }

      const expiresColumn = data.expires_at ?? data.expiresAt ?? null;
      if (expiresColumn && expiresColumn < nowIso) {
        return { statusCode: 410, body: JSON.stringify({ error: 'Link expired' }) };
      }

      const storedPayload = data.payload ?? data.job_payload ?? data.job ?? null;
      const job = storedPayload ? toPublicJob(storedPayload) : null;
      const expiresAt = expiresColumn;
      const jobId = data.job_id ?? data.job ?? data.jobId ?? (job ? job.id : null);
      const title = data.title ?? job?.title ?? jobId ?? slug;
      const seo = await fetchSeo(jobId);
      return {
        statusCode: 200,
        body: JSON.stringify({
          slug: data.slug,
          jobId,
          title,
          job,
          seo: seo.suggestion,
          expires_at: expiresAt,
          created_at: data.created_at,
          schema: seo.missingTable || undefined,
        }),
      };
    } catch (err) {
      const missingTable = isMissingTableError(err, 'job_specs');
      const schemaMismatch = isSchemaError(err);
      if (!missingTable && !schemaMismatch) throw err;
      const fallback = await fetchJobById(slug || jobIdParam, { allowRestrictedShare: hasShareAccessToken });
      if (!fallback) {
        const staticFallback = findStaticJob(slug || jobIdParam);
        const publicFallback = (staticFallback && (hasShareAccessToken || isPublicJob(staticFallback)))
          ? toPublicJob(staticFallback)
          : null;
        return respondFallback(publicFallback, { schema: schemaMismatch || missingTable || undefined });
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
          schema: schemaMismatch || missingTable || undefined,
        }),
      };
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Unexpected error' }) };
  }
};
