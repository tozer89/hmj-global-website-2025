'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { toJob } = require('./_jobs-helpers.js');
const { buildFallbackSeoSuggestion, fetchStoredSeoSuggestion } = require('./_job-seo-optimizer.js');

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
    const params = event.queryStringParameters || {};
    const jobId = (body.jobId || body.id || params.jobId || params.id || '').toString().trim();

    let supabase = null;
    try {
      supabase = getSupabase(event);
    } catch (_) {
      supabase = null;
    }

    let job = body.job && typeof body.job === 'object' ? toJob(body.job) : null;
    if (!job && supabase && jobId) {
      job = await loadJob(supabase, jobId);
    }

    if (!job && !jobId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'jobId or job payload required' }),
      };
    }

    let stored = null;
    let missingTable = false;
    if (supabase && (job?.id || jobId)) {
      const storedResult = await fetchStoredSeoSuggestion(supabase, job?.id || jobId);
      stored = storedResult.suggestion;
      missingTable = storedResult.missingTable;
    }

    const suggestion = stored || buildFallbackSeoSuggestion(job || { id: jobId, title: '' });

    return {
      statusCode: 200,
      body: JSON.stringify({
        jobId: job?.id || jobId || null,
        suggestion,
        source: stored ? 'stored' : 'heuristic',
        stored: !!stored,
        schema: missingTable || undefined,
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
