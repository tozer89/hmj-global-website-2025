// netlify/functions/job-spec.js
const { withSupabase, jsonOk, jsonError } = require('./_supabase.js');

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [value].filter(Boolean);
};

module.exports.handler = withSupabase(async ({ event, supabase, trace, debug }) => {
  const params = event.queryStringParameters || {};
  const share = (params.share || '').trim();
  const id = (params.id || '').trim();

  if (!share && !id) {
    return jsonError(400, 'missing_parameters', 'Provide either ?share=token or ?id=job_id', { trace });
  }

  if (share) {
    const { data: shareRow, error } = await supabase
      .from('job_shares')
      .select('token, job_id, payload, expires_at')
      .eq('token', share)
      .maybeSingle();

    if (error) return jsonError(500, 'share_lookup_failed', error.message || 'Failed to load share', { trace });
    if (!shareRow) return jsonError(404, 'share_not_found', 'Share link not found', { trace });

    const expired = shareRow.expires_at && new Date(shareRow.expires_at) < new Date();
    if (expired) return jsonError(410, 'share_expired', 'Share link expired', { trace });

    const job = shareRow.payload || {};
    job.responsibilities = ensureArray(job.responsibilities);
    job.requirements = ensureArray(job.requirements);

    return jsonOk({ ok: true, trace, job, share: { token: shareRow.token, expires_at: shareRow.expires_at } });
  }

  const { data: job, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .eq('published', true)
    .maybeSingle();

  if (error) return jsonError(500, 'job_lookup_failed', error.message || 'Failed to load job', { trace });
  if (!job) return jsonError(404, 'job_not_found', 'Job not found', { trace });

  job.responsibilities = ensureArray(job.responsibilities);
  job.requirements = ensureArray(job.requirements);

  return jsonOk({ ok: true, trace, job });
});
