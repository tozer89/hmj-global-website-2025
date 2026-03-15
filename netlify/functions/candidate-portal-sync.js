'use strict';

const { buildCors } = require('./_http.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  buildJobApplicationPayload,
  recordCandidateActivity,
  resolveSupabaseAuthUser,
  syncCandidateSkills,
  trimString,
  upsertCandidateProfile,
  insertJobApplication,
} = require('./_candidate-portal.js');

function header(event, name) {
  if (!event?.headers) return '';
  const direct = event.headers[name];
  if (direct) return direct;
  const lower = name.toLowerCase();
  const key = Object.keys(event.headers).find((item) => item.toLowerCase() === lower);
  return key ? event.headers[key] : '';
}

function respond(event, statusCode, body) {
  return {
    statusCode,
    headers: {
      ...buildCors(event),
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch (error) {
    return {};
  }
}

exports.handler = async (event = {}) => {
  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return respond(event, 200, { ok: true });
  }
  if (method !== 'POST') {
    return respond(event, 405, { ok: false, code: 'method_not_allowed' });
  }

  if (!hasSupabase()) {
    return respond(event, 503, {
      ok: false,
      code: 'supabase_unavailable',
      message: supabaseStatus().error || 'Supabase client unavailable',
    });
  }

  try {
    const body = parseBody(event);
    const supabase = getSupabase(event);
    const accessToken = trimString(
      (header(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
      || body.access_token,
      8000
    );
    const authUser = await resolveSupabaseAuthUser(supabase, accessToken);
    const source = trimString(body.source || body.page || 'candidate_portal', 120) || 'candidate_portal';
    const now = new Date().toISOString();
    const profileInput = body.candidate && typeof body.candidate === 'object' ? body.candidate : body;
    const applicationInput = body.application && typeof body.application === 'object' ? body.application : body;

    const candidateResult = await upsertCandidateProfile(supabase, profileInput, {
      authUser,
      now,
      includeNulls: false,
    });
    const candidate = candidateResult?.candidate || candidateResult;
    const candidateCreated = !!candidateResult?.created;

    const candidateId = candidate?.id != null ? String(candidate.id) : null;
    if (
      candidateId
      && (
        profileInput.skills !== undefined
        || profileInput.skill_tags !== undefined
        || profileInput.tags !== undefined
      )
    ) {
      await syncCandidateSkills(
        supabase,
        candidateId,
        profileInput.skills ?? profileInput.skill_tags ?? profileInput.tags
      );
    }

    const applicationPayload = buildJobApplicationPayload(applicationInput, candidateId, { now });
    const applicationResult = applicationPayload
      ? await insertJobApplication(supabase, applicationPayload)
      : null;
    const application = applicationResult?.application || applicationResult || null;
    const applicationCreated = !!applicationResult?.created;

    const activityOptions = {
      actorRole: authUser?.id ? 'candidate' : 'system',
      actorIdentifier: authUser?.id || null,
      meta: {
        source,
        authenticated: !!authUser,
        application_id: application?.id || null,
        job_id: applicationPayload?.job_id || null,
        source_submission_id: applicationPayload?.source_submission_id || null,
      },
      now,
    };

    if (candidateCreated) {
      await recordCandidateActivity(
        supabase,
        candidateId,
        'profile_created',
        `Candidate profile created from ${source}.`,
        activityOptions
      );
    } else if (!applicationCreated) {
      await recordCandidateActivity(
        supabase,
        candidateId,
        'profile_updated',
        `Candidate profile updated from ${source}.`,
        activityOptions
      );
    }

    if (applicationCreated) {
      await recordCandidateActivity(
        supabase,
        candidateId,
        'application_submitted',
        `Application synced from ${source}${applicationPayload?.job_title ? ` for ${applicationPayload.job_title}` : ''}.`,
        activityOptions
      );
    }

    return respond(event, 200, {
      ok: true,
      candidateId,
      applicationId: application?.id || null,
      candidateCreated,
      applicationCreated,
      authenticated: !!authUser,
    });
  } catch (error) {
    console.warn('[candidate-portal-sync] failed', error?.message || error);
    return respond(event, 500, {
      ok: false,
      code: error?.code || 'candidate_portal_sync_failed',
      message: error?.message || 'Candidate portal sync failed',
    });
  }
};
