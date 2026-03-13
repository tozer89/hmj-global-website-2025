// netlify/functions/admin-job-share-create.js
const { withAdminCors } = require('./_http.js');
const { randomUUID } = require('node:crypto');
const { getSupabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob, toPublicJob, findStaticJob, slugify, isSchemaError, isMissingTableError, isPublicJob, buildPublicJobDetailPath } = require('./_jobs-helpers.js');
const { createShareAccessToken, buildTokenizedJobDetailPath } = require('./_job-detail-tokens.js');

function adjustRecordForSchema(record, err) {
  const message = (err?.message || '').toLowerCase();
  let changed = false;
  const next = { ...record };

  const drop = (field) => {
    if (field in next) {
      delete next[field];
      changed = true;
    }
  };

  const rename = (from, to) => {
    if (from in next) {
      if (!(to in next)) {
        next[to] = next[from];
      }
      delete next[from];
      changed = true;
    }
  };

  if (/column\s+"?payload"?/.test(message) && 'payload' in next) {
    rename('payload', 'job_payload');
  }
  if (/column\s+"?job_payload"?/.test(message) && 'job_payload' in next) {
    rename('job_payload', 'payload');
  }
  if (/column\s+"?title"?/.test(message)) {
    drop('title');
  }
  if (/column\s+"?notes"?/.test(message)) {
    drop('notes');
  }
  if (/column\s+"?expires?_at"?/.test(message)) {
    drop('expires_at');
  }
  if (/column\s+"?job_id"?/.test(message) && 'job_id' in next) {
    // Some legacy tables may use `job` instead of `job_id`.
    rename('job_id', 'job');
  }

  return changed ? next : null;
}

function buildSlug(id) {
  const safeId = (id || 'job').toString().replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `${safeId}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
}

function originFromEvent(event) {
  const proto = event?.headers?.['x-forwarded-proto'] || event?.headers?.['X-Forwarded-Proto'] || 'https';
  const host = event?.headers?.host || event?.headers?.Host || '';
  return `${proto}://${host}`.replace(/:\/\/\//, '://');
}

function buildFallbackShareLink({ origin, job, expiresAt }) {
  const jobId = job?.id || '';
  const safeOrigin = origin.replace(/\/$/, '');

  if (jobId) {
    const token = createShareAccessToken({ jobId, expiresAt });
    if (token) {
      return {
        url: `${safeOrigin}${buildTokenizedJobDetailPath({ jobId, token })}`,
        expiresAt: expiresAt || null,
        mode: 'secure_token',
      };
    }
  }

  const publicDetailPath = buildPublicJobDetailPath(job);
  if (publicDetailPath && isPublicJob(job)) {
    return {
      url: `${safeOrigin}${publicDetailPath}`,
      expiresAt: null,
      mode: 'public_detail',
    };
  }

  return null;
}

const baseHandler = async (event, context) => {
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
          if (isSchemaError(jobError) || isMissingTableError(jobError, 'jobs')) {
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

    const sharedJob = toPublicJob(job);
    const slug = supabase ? buildSlug(sharedJob.id) : (sharedJob.id || slugify(sharedJob.title || 'job'));
    const expires = supabase && Number.isFinite(expiresInDays) && expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 86400000)
      : null;

    if (supabase) {
      const baseRecord = {
        slug,
        job_id: sharedJob.id,
        title: sharedJob.title,
        payload: sharedJob,
        notes: notes ? String(notes) : null,
        expires_at: expires ? expires.toISOString() : null,
      };

      let record = { ...baseRecord };
      let schemaAdjusted = false;
      const maxAttempts = 4;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const { data, error } = await supabase
          .from('job_specs')
          .insert(record)
          .select('slug, expires_at')
          .single();
        if (!error) {
          const inserted = data || {};
          const params = new URLSearchParams();
          params.set('slug', inserted.slug || slug);
          if (sharedJob.id) params.set('id', sharedJob.id);
          const url = `${origin}/jobs/spec.html?${params.toString()}`;
          return {
            statusCode: 200,
            body: JSON.stringify({
              slug: inserted.slug || slug,
              url,
              expires_at: inserted.expires_at ?? record.expires_at ?? null,
              schema: schemaAdjusted || undefined,
            }),
          };
        }

        const missingTable = isMissingTableError(error, 'job_specs');
        const schemaIssue = isSchemaError(error) || missingTable;
        if (!schemaIssue || missingTable) {
          if (missingTable) {
            schemaAdjusted = schemaAdjusted || schemaIssue || missingTable;
            break;
          }
          throw error;
        }

        const adjusted = adjustRecordForSchema(record, error);
        if (!adjusted) {
          schemaAdjusted = schemaAdjusted || schemaIssue;
          break;
        }
        record = adjusted;
        schemaAdjusted = true;
      }

      const fallbackLink = buildFallbackShareLink({
        origin,
        job: sharedJob,
        expiresAt: expires ? expires.toISOString() : null,
      });
      if (!fallbackLink) {
        return {
          statusCode: 503,
          body: JSON.stringify({
            error: 'Unable to create a secure fallback share link for this job.',
            code: 'fallback_share_unavailable',
          }),
        };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({
          slug: sharedJob.id || slug,
          url: fallbackLink.url,
          expires_at: fallbackLink.expiresAt,
          fallback: true,
          fallbackMode: fallbackLink.mode,
          schema: true,
        }),
      };
    }

    const fallbackLink = buildFallbackShareLink({
      origin,
      job: sharedJob,
      expiresAt: expires ? expires.toISOString() : null,
    });
    if (!fallbackLink) {
      return {
        statusCode: 503,
        body: JSON.stringify({
          error: 'Unable to create a secure share link while the live jobs service is unavailable.',
          code: 'fallback_share_unavailable',
        }),
      };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({
        slug: sharedJob.id || slug,
        url: fallbackLink.url,
        expires_at: fallbackLink.expiresAt,
        fallback: true,
        fallbackMode: fallbackLink.mode,
        reason: supabaseErr?.code || 'supabase_unavailable',
        schema: isSchemaError(supabaseErr) || undefined,
      }),
    };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Unexpected error' }) };
  }
};

exports.handler = withAdminCors(baseHandler);
