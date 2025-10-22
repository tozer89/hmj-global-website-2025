// netlify/functions/admin-jobs-share.js
const { randomUUID } = require('node:crypto');
const { withSupabase, jsonOk, jsonError } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

const SHARE_TTL_DAYS = 60;

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

const baseUrl = () => {
  return (
    process.env.HMJ_PUBLIC_URL ||
    process.env.SITE_URL ||
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    'https://www.hmj-global.com'
  );
};

module.exports.handler = withSupabase(async ({ event, context, supabase, trace, debug }) => {
  try {
    await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    const status = err.code === 401 ? 401 : err.code === 403 ? 403 : 500;
    return jsonError(status, err.code || 'unauthorized', err.message || 'Unauthorized', { trace });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const id = (body.id || '').trim();
  if (!id) {
    return jsonError(400, 'id_required', 'Job id is required to generate a share link', { trace });
  }

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('
      id, title, status, section, section_label, section_description,
      type, discipline, location_text, location_code,
      overview, responsibilities, requirements,
      apply_url, keywords, published, sort_order,
      match_assignment, is_live, created_at, updated_at
    ')
    .eq('id', id)
    .maybeSingle();

  if (jobErr) {
    return jsonError(500, 'job_lookup_failed', jobErr.message || 'Failed to load job', { trace });
  }

  if (!job) {
    return jsonError(404, 'job_not_found', 'Job not found', { trace });
  }

  const payload = {
    id: job.id,
    title: job.title,
    status: job.status,
    section: job.section,
    section_label: job.section_label,
    section_description: job.section_description,
    type: job.type,
    discipline: job.discipline,
    location_text: job.location_text,
    location_code: job.location_code,
    overview: job.overview,
    responsibilities: ensureArray(job.responsibilities),
    requirements: ensureArray(job.requirements),
    apply_url: job.apply_url,
    keywords: job.keywords,
    match_assignment: job.match_assignment,
    is_live: job.is_live,
    published: job.published,
    generated_at: new Date().toISOString(),
  };

  const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const token = randomUUID();

  try {
    await supabase
      .from('job_shares')
      .upsert({
        token,
        job_id: id,
        payload,
        expires_at: expiresAt,
      }, { onConflict: 'token' });
  } catch (shareErr) {
    debug?.('[admin-jobs-share] Failed to persist share, falling back to static:', shareErr.message || shareErr);
    const staticUrl = `${baseUrl().replace(/\/$/, '')}/jobs/spec.html?id=${encodeURIComponent(id)}`;
    return jsonOk({
      ok: true,
      trace,
      shareUrl: staticUrl,
      expiresAt: null,
      offline: true,
      reason: shareErr.message || 'job_shares table missing',
      job: payload,
    });
  }

  const shareUrl = `${baseUrl().replace(/\/$/, '')}/jobs/spec.html?share=${encodeURIComponent(token)}`;

  return jsonOk({
    ok: true,
    trace,
    shareUrl,
    token,
    expiresAt,
    offline: false,
    job: payload,
  });
});
