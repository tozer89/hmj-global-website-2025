'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  APPLICATION_STATUS_VALUES,
  getJobApplicationStatusLabel,
  getJobApplicationStatusTone,
  normalizeJobApplicationStatus,
} = require('./_job-applications.js');

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const ACCEPTED_STATUS_INPUTS = new Set([
  'submitted',
  'applied',
  'in_progress',
  'in progress',
  'reviewing',
  'under review',
  'shortlisted',
  'on_hold',
  'on hold',
  'offered',
  'hired',
  'placed',
  'interview',
  'interviewing',
  'reject',
  'rejected',
  'declined',
  'decline',
]);
const LEGACY_STORAGE_STATUS = Object.freeze({
  submitted: 'submitted',
  in_progress: 'reviewing',
  interview: 'interviewing',
  reject: 'rejected',
});

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return null;
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function parseBody(event) {
  if (!event?.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

function isStatusConstraintError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '23514'
    || message.includes('job_applications_status_check')
    || message.includes('violates check constraint');
}

module.exports.handler = withAdminCors(async (event, context) => {
  const { user } = await getContext(event, context, { requireAdmin: true });

  if (!hasSupabase()) {
    return {
      statusCode: 503,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: false,
        error: 'Live applications system unavailable.',
        supabase: supabaseStatus(),
      }),
    };
  }

  const supabase = getSupabase(event);
  const body = parseBody(event);
  const id = trimString(body.id, 120);
  const rawStatus = trimString(body.status, 40);
  const status = normalizeJobApplicationStatus(rawStatus);

  if (!id) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: 'Application id is required.' }),
    };
  }

  if (!rawStatus || !ACCEPTED_STATUS_INPUTS.has(String(rawStatus).trim().toLowerCase()) || !APPLICATION_STATUS_VALUES.includes(status)) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: 'Unsupported application status.' }),
    };
  }

  const changedAt = new Date().toISOString();

  async function persist(nextStoredStatus) {
    return supabase
      .from('job_applications')
      .update({
        status: nextStoredStatus,
        updated_at: changedAt,
      })
      .eq('id', id)
      .select('id,status,updated_at,candidate_id,job_id')
      .maybeSingle();
  }

  let storedStatus = status;
  let { data, error } = await persist(status);

  if (error && isStatusConstraintError(error)) {
    storedStatus = LEGACY_STORAGE_STATUS[status] || status;
    ({ data, error } = await persist(storedStatus));
  }

  if (error) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: error.message || 'Unable to update application status.' }),
    };
  }

  if (!data) {
    return {
      statusCode: 404,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: 'Application not found.' }),
    };
  }

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok: true,
      application: {
        id: data.id,
        candidateId: data.candidate_id ? String(data.candidate_id) : null,
        jobId: data.job_id ? String(data.job_id) : null,
        status,
        storedStatus,
        statusLabel: getJobApplicationStatusLabel(status),
        statusTone: getJobApplicationStatusTone(status),
        updatedAt: data.updated_at || changedAt,
      },
      audit: {
        actorEmail: user?.email || null,
        changedAt,
      },
    }),
  };
});
