'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { toJob } = require('./_jobs-helpers.js');
const { optimiseJobSeo, upsertSeoSuggestion } = require('./_job-seo-optimizer.js');

function parseBody(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (_) {
    return {};
  }
}

async function loadJob(supabase, jobId) {
  if (!jobId) return null;
  const result = await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle();
  if (result.error) throw result.error;
  return result.data ? toJob(result.data) : null;
}

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const body = parseBody(event.body);
    const jobId = (body.jobId || body.id || '').toString().trim();
    let job = body.job && typeof body.job === 'object' ? toJob(body.job) : null;
    const requiresSupabase = !job || !!jobId || !!job?.id;

    let supabase = null;
    if (requiresSupabase) {
      try {
        supabase = getSupabase(event);
      } catch (error) {
        if (!job || !job.title) {
          return {
            statusCode: 503,
            body: JSON.stringify({ error: 'Supabase not configured', code: error.code || 'supabase_unavailable' }),
          };
        }
      }
    }

    if (!job && supabase) {
      job = await loadJob(supabase, jobId);
    }

    if (!job || !job.title) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'job payload or valid jobId required' }),
      };
    }

    const result = await optimiseJobSeo(job);
    const suggestion = result.suggestion;
    let storeResult = { stored: false, missingTable: false, suggestion };
    if (suggestion && supabase && job.id) {
      storeResult = await upsertSeoSuggestion(supabase, job.id, suggestion, {
        source: result.source,
        model: result.model,
        lastError: result.source === 'openai' ? '' : result.error || '',
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        jobId: job.id,
        suggestion: storeResult.suggestion || suggestion,
        source: result.source,
        stored: !!storeResult.stored,
        schema: storeResult.missingTable || undefined,
        error: result.source === 'openai' ? undefined : result.error || undefined,
        model: result.model || undefined,
      }),
    };
  } catch (error) {
    const status = error.code === 401 ? 401 : error.code === 403 ? 403 : 500;
    return {
      statusCode: status,
      body: JSON.stringify({ error: error.message || 'Unexpected error', code: error.code || undefined }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
