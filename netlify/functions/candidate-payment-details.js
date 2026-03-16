'use strict';

const { buildCors } = require('./_http.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  isMissingColumnError,
  isMissingRelationError,
  recordCandidateActivity,
  resolveSupabaseAuthUser,
  trimString,
  upsertCandidateProfile,
} = require('./_candidate-portal.js');
const {
  buildPaymentWritePayload,
  paymentDetailsSummary,
  presentCandidatePaymentDetails,
} = require('./_candidate-payment-details.js');
const { summariseOnboarding } = require('./_candidate-onboarding.js');

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
  } catch {
    return {};
  }
}

function coded(statusCode, message, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code || message;
  return error;
}

function header(event, name) {
  if (!event?.headers) return '';
  const direct = event.headers[name];
  if (direct) return direct;
  const lower = String(name || '').toLowerCase();
  const key = Object.keys(event.headers).find((item) => item.toLowerCase() === lower);
  return key ? event.headers[key] : '';
}

function buildAccessToken(event, body = {}) {
  return trimString(
    (header(event, 'authorization') || '').replace(/^Bearer\s+/i, '')
    || body.access_token,
    8000,
  );
}

async function requireCandidateContext(event, body = {}) {
  if (!hasSupabase()) {
    throw coded(503, supabaseStatus().error || 'Payment details are unavailable right now.', 'supabase_unavailable');
  }
  const supabase = getSupabase(event);
  const accessToken = buildAccessToken(event, body);
  const authUser = await resolveSupabaseAuthUser(supabase, accessToken);
  if (!authUser?.id || !authUser?.email) {
    throw coded(401, 'Please sign in to manage payment details.', 'candidate_not_authenticated');
  }
  const candidateResult = await upsertCandidateProfile(
    supabase,
    { email: authUser.email },
    {
      authUser,
      now: new Date().toISOString(),
      includeNulls: false,
      touchPortalLogin: true,
    },
  );
  const candidate = candidateResult?.candidate || candidateResult;
  if (!candidate?.id) {
    throw coded(500, 'Candidate profile could not be linked for payment details.', 'candidate_profile_unavailable');
  }
  return { supabase, authUser, candidate };
}

async function readPaymentRow(supabase, candidateId) {
  const response = await supabase
    .from('candidate_payment_details')
    .select('*')
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (response.error && !isMissingColumnError(response.error) && !isMissingRelationError(response.error)) {
    throw response.error;
  }
  return response.data || null;
}

async function listCandidateDocuments(supabase, candidateId) {
  const response = await supabase
    .from('candidate_documents')
    .select('id,candidate_id,document_type,label,filename,original_filename,uploaded_at,created_at')
    .eq('candidate_id', String(candidateId));
  if (response.error && !isMissingColumnError(response.error) && !isMissingRelationError(response.error)) {
    throw response.error;
  }
  return Array.isArray(response.data) ? response.data : [];
}

async function handler(event) {
  if ((event.httpMethod || '').toUpperCase() === 'OPTIONS') {
    return respond(event, 200, { ok: true });
  }
  if ((event.httpMethod || '').toUpperCase() !== 'POST') {
    return respond(event, 405, { ok: false, error: 'Method Not Allowed' });
  }

  const body = parseBody(event);

  try {
    const ctx = await requireCandidateContext(event, body);
    const action = trimString(body.action, 40).toLowerCase() || 'get';

    if (action === 'get') {
      const [paymentRow, documents] = await Promise.all([
        readPaymentRow(ctx.supabase, ctx.candidate.id),
        listCandidateDocuments(ctx.supabase, ctx.candidate.id),
      ]);
      const paymentDetails = paymentDetailsSummary(paymentRow, ctx.candidate);
      const onboarding = summariseOnboarding({
        candidate: ctx.candidate,
        documents,
        paymentDetails,
      });
      return respond(event, 200, {
        ok: true,
        paymentDetails,
        onboarding,
      });
    }

    if (action === 'save') {
      const existing = await readPaymentRow(ctx.supabase, ctx.candidate.id);
      const payload = buildPaymentWritePayload(
        ctx.candidate.id,
        ctx.authUser.id,
        body.paymentDetails || body,
        existing || {},
      );

      const { data, error } = await ctx.supabase
        .from('candidate_payment_details')
        .upsert(payload, {
          onConflict: 'candidate_id',
        })
        .select('*')
        .single();

      if (error) throw error;

      await recordCandidateActivity(
        ctx.supabase,
        String(ctx.candidate.id),
        'payment_details_updated',
        'Payment details updated from the candidate dashboard.',
        {
          actorRole: 'candidate',
          actorIdentifier: ctx.authUser.id,
          meta: {
            source: 'candidate_dashboard',
            payment_method: payload.payment_method,
            account_currency: payload.account_currency,
          },
        },
      ).catch(() => null);

      const [documents] = await Promise.all([
        listCandidateDocuments(ctx.supabase, ctx.candidate.id),
      ]);
      const paymentDetails = presentCandidatePaymentDetails(data, { includeSensitive: false });
      const onboarding = summariseOnboarding({
        candidate: ctx.candidate,
        documents,
        paymentDetails,
      });

      return respond(event, 200, {
        ok: true,
        paymentDetails,
        onboarding,
      });
    }

    throw coded(400, 'Unknown payment details action.', 'candidate_payment_action_invalid');
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return respond(event, statusCode, {
      ok: false,
      error: error.message || 'Payment details request failed.',
      code: error.code || null,
      details: Array.isArray(error.details) ? error.details : undefined,
    });
  }
}

exports.handler = handler;
