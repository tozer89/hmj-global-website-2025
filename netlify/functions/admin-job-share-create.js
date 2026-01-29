// netlify/functions/admin-job-share-create.js
const { withAdminCors } = require('./_http.js');
const { randomUUID } = require('node:crypto');
const { getSupabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { toJob, findStaticJob, slugify, isSchemaError } = require('./_jobs-helpers.js');

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
      const baseRecord = {
        slug,
        job_id: job.id,
        title: job.title,
        payload: job,
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
          const url = `${origin}/jobs/spec.html?slug=${encodeURIComponent(inserted.slug || slug)}`;
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

        const missingTable = error?.code === '42P01' || /relation\s+"?job_specs"?/i.test(error?.message || '');
        const schemaIssue = isSchemaError(error);
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

      const fallbackKey = job.id || slug;
      const fallbackUrl = `${origin}/jobs/spec.html?id=${encodeURIComponent(fallbackKey)}`;
      return {
        statusCode: 200,
        body: JSON.stringify({
          slug: fallbackKey,
          url: fallbackUrl,
          expires_at: null,
          fallback: true,
          schema: true,
        }),
      };
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
    const status = e.code === 401 ? 403 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Unexpected error' }) };
  }
};

exports.handler = withAdminCors(baseHandler);
