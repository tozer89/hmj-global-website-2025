'use strict';

const { buildCors } = require('./_http.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  dropUnknownColumnAndRetry,
  getCandidateByAuthUserId,
  recordCandidateActivity,
  resolveSupabaseAuthUser,
  trimString,
} = require('./_candidate-portal.js');

function header(event, name) {
  if (!event?.headers) return '';
  const direct = event.headers[name];
  if (direct) return direct;
  const lower = name.toLowerCase();
  const key = Object.keys(event.headers).find((item) => item.toLowerCase() === lower);
  return key ? event.headers[key] : '';
}

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch (error) {
    return {};
  }
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
    if (!authUser?.id) {
      return respond(event, 401, { ok: false, code: 'unauthorized' });
    }

    const candidate = await getCandidateByAuthUserId(supabase, authUser.id);
    const candidateId = candidate?.id != null ? String(candidate.id) : null;

    if (candidateId) {
      const now = new Date().toISOString();
      await recordCandidateActivity(
        supabase,
        candidateId,
        'account_archived',
        'Candidate portal account archived and self-service access removed.',
        {
          actorRole: 'candidate',
          actorIdentifier: authUser.id,
          meta: {
            source: 'candidate_account_delete',
            email: authUser.email || null,
          },
          now,
        }
      ).catch(() => null);

      await dropUnknownColumnAndRetry(
        (working) => supabase
          .from('candidates')
          .update(working)
          .eq('id', candidate.id)
          .eq('auth_user_id', authUser.id)
          .select('id')
          .maybeSingle(),
        {
          auth_user_id: null,
          status: 'archived',
          archived_at: now,
          portal_account_closed_at: now,
          updated_at: now,
        }
      );
    }

    const { error: deleteError } = await supabase.auth.admin.deleteUser(authUser.id);
    if (deleteError) {
      throw deleteError;
    }

    return respond(event, 200, { ok: true, candidateId });
  } catch (error) {
    console.warn('[candidate-account-delete] failed', error?.message || error);
    return respond(event, 500, {
      ok: false,
      code: error?.code || 'candidate_account_delete_failed',
      message: error?.message || 'Candidate account deletion failed',
    });
  }
};
