'use strict';

const { buildCors } = require('./_http.js');
const { getSupabaseUrl, getSupabaseAnonKey } = require('./_supabase-env.js');

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
  if ((event.httpMethod || '').toUpperCase() === 'OPTIONS') {
    return respond(event, 200, { ok: true });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    return respond(event, 503, {
      ok: false,
      code: 'candidate_auth_unavailable',
      message: 'Candidate account tools are not configured for this environment.',
    });
  }

  return respond(event, 200, {
    ok: true,
    supabaseUrl,
    supabaseAnonKey,
    recoveryRedirectPath: '/candidates.html?candidate_action=recovery',
    emailRedirectPath: '/candidates.html?candidate_auth=verified',
  });
};
