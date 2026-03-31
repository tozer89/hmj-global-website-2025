'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');
const { attachOnboardingSummaries } = require('./_candidate-onboarding-admin.js');
const {
  buildPaymentWritePayload,
  paymentDetailsSummary,
  presentCandidatePaymentDetails,
  trimString,
} = require('./_candidate-payment-details.js');
const {
  isMissingColumnError,
  isMissingRelationError,
  recordCandidateActivity,
} = require('./_candidate-portal.js');

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch {
    return {};
  }
}

function isMissingSchema(error) {
  return isMissingColumnError(error) || isMissingRelationError(error);
}

async function loadCandidate(supabase, candidateId) {
  const { data, error } = await supabase
    .from('candidates')
    .select('*')
    .eq('id', candidateId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw coded(404, 'Candidate not found.');
  return data;
}

async function loadPaymentRow(supabase, candidateId) {
  const { data, error } = await supabase
    .from('candidate_payment_details')
    .select('*')
    .eq('candidate_id', candidateId)
    .maybeSingle();

  if (error) {
    if (isMissingSchema(error)) {
      throw coded(503, 'Candidate payment details are not available in the live schema yet.');
    }
    throw error;
  }

  return data || null;
}

function buildLegacyPaymentDetails(candidate = {}) {
  const summary = paymentDetailsSummary(null, candidate);
  if (!summary.legacyFallback) return null;
  return {
    ...summary,
    values: {
      sortCode: trimString(candidate.bank_sort_code || candidate.bank_sort, 40) || '',
      accountNumber: trimString(candidate.bank_account, 40) || '',
      iban: trimString(candidate.bank_iban, 80) || '',
      swiftBic: trimString(candidate.bank_swift, 40) || '',
    },
    loadedSensitive: true,
    legacyFallback: true,
  };
}

function legacyPaymentInput(candidate = {}) {
  const sortCode = trimString(candidate.bank_sort_code || candidate.bank_sort, 40) || '';
  const accountNumber = trimString(candidate.bank_account, 40) || '';
  const iban = trimString(candidate.bank_iban, 80) || '';
  const swiftBic = trimString(candidate.bank_swift, 40) || '';
  if (!trimString(candidate.bank_name, 160) || !(sortCode || accountNumber || iban || swiftBic)) {
    return null;
  }
  return {
    account_currency: iban ? 'EUR' : 'GBP',
    payment_method: iban ? 'iban_swift' : 'gbp_local',
    account_holder_name: trimString(candidate.full_name || `${candidate.first_name || ''} ${candidate.last_name || ''}`, 160) || '',
    bank_name: trimString(candidate.bank_name, 160) || '',
    bank_location_or_country: trimString(candidate.country, 160) || 'United Kingdom',
    account_type: null,
    sort_code: sortCode,
    account_number: accountNumber,
    iban,
    swift_bic: swiftBic,
  };
}

async function clearLegacyPaymentFields(supabase, candidateId) {
  const { error } = await supabase
    .from('candidates')
    .update({
      bank_sort: null,
      bank_sort_code: null,
      bank_account: null,
      bank_iban: null,
      bank_swift: null,
      tax_id: null,
    })
    .eq('id', candidateId);
  if (error && !isMissingSchema(error)) throw error;
}

async function migrateLegacyPaymentDetails(supabase, candidate, existing, user) {
  if (existing?.id) return existing;
  const legacyInput = legacyPaymentInput(candidate);
  if (!legacyInput) return null;
  const payload = buildPaymentWritePayload(candidate.id, candidate.auth_user_id || null, legacyInput, {});
  const { data, error } = await supabase
    .from('candidate_payment_details')
    .insert(payload)
    .select('*')
    .single();
  if (error) {
    if (isMissingSchema(error)) {
      throw coded(503, 'Candidate payment details are not available in the live schema yet.');
    }
    throw error;
  }
  await clearLegacyPaymentFields(supabase, candidate.id).catch(() => null);
  await recordCandidateActivity(
    supabase,
    String(candidate.id),
    'payment_details_migrated',
    'Legacy candidate payment details were migrated into encrypted payroll storage.',
    {
      actorRole: 'admin',
      actorIdentifier: user?.email || null,
      meta: {
        source: 'admin_candidate_payment_details',
        migrated_from_legacy_fields: true,
        payment_method: payload.payment_method,
        last_four: payload.last_four,
      },
      now: new Date().toISOString(),
    },
  ).catch(() => null);
  await recordAudit({
    actor: user,
    action: 'candidate_payment_details.migrate_legacy',
    targetType: 'candidate',
    targetId: candidate.id,
    meta: {
      payment_method: payload.payment_method,
      last_four: payload.last_four,
      bank_name: payload.bank_name,
    },
  });
  return data;
}

function presentAdminPaymentDetails(row, candidate, { includeSensitive = false } = {}) {
  if (row) {
    return {
      ...presentCandidatePaymentDetails(row, { includeSensitive }),
      loadedSensitive: includeSensitive,
      legacyFallback: false,
    };
  }

  const legacy = buildLegacyPaymentDetails(candidate);
  if (legacy) return legacy;

  return {
    ...paymentDetailsSummary(null, candidate),
    values: includeSensitive
      ? {
          sortCode: '',
          accountNumber: '',
          iban: '',
          swiftBic: '',
        }
      : undefined,
    loadedSensitive: includeSensitive,
    legacyFallback: false,
  };
}

async function savePaymentDetails(supabase, candidate, existing, input, user) {
  const payload = buildPaymentWritePayload(candidate.id, candidate.auth_user_id || null, input, existing || {});

  const query = existing?.id
    ? supabase.from('candidate_payment_details').update(payload).eq('id', existing.id)
    : supabase.from('candidate_payment_details').insert(payload);

  const { data, error } = await query.select('*').single();
  if (error) {
    if (isMissingSchema(error)) {
      throw coded(503, 'Candidate payment details are not available in the live schema yet.');
    }
    throw error;
  }

  await recordCandidateActivity(
    supabase,
    String(candidate.id),
    'payment_details_saved',
    'Payment details were saved from admin candidates.',
    {
      actorRole: 'admin',
      actorIdentifier: user?.email || null,
      meta: {
        source: 'admin_candidate_payment_details',
        payment_method: payload.payment_method,
        account_currency: payload.account_currency,
        last_four: payload.last_four,
      },
      now: new Date().toISOString(),
    },
  ).catch(() => null);
  await recordAudit({
    actor: user,
    action: existing?.id ? 'candidate_payment_details.update' : 'candidate_payment_details.insert',
    targetType: 'candidate',
    targetId: candidate.id,
    meta: {
      payment_method: payload.payment_method,
      account_currency: payload.account_currency,
      bank_name: payload.bank_name,
      last_four: payload.last_four,
    },
  });

  return data;
}

exports.handler = withAdminCors(async (event, context) => {
  try {
    if ((event.httpMethod || '').toUpperCase() !== 'POST') {
      throw coded(405, 'Method Not Allowed');
    }

    const { supabase, supabaseError, user } = await getContext(event, context, { requireAdmin: true });
    if (!supabase || typeof supabase.from !== 'function') {
      throw coded(503, supabaseError?.message || 'Supabase is not available for this deploy.');
    }

    const body = parseBody(event);
    const candidateId = trimString(body.candidateId || body.id, 120);
    const action = trimString(body.action, 40)?.toLowerCase() || 'get';
    if (!candidateId) throw coded(400, 'candidateId is required.');

    const candidate = await loadCandidate(supabase, candidateId);
    let existing = await loadPaymentRow(supabase, candidateId);
    let migratedLegacy = false;
    if (!existing) {
      const migrated = await migrateLegacyPaymentDetails(supabase, candidate, existing, user);
      if (migrated?.id) {
        existing = migrated;
        migratedLegacy = true;
      }
    }

    if (action === 'get') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          paymentDetails: presentAdminPaymentDetails(existing, candidate, { includeSensitive: true }),
          paymentSummary: existing ? paymentDetailsSummary(existing, candidate) : paymentDetailsSummary(null, candidate),
          migratedLegacy,
          message: migratedLegacy
            ? 'Legacy bank details were moved into secure payroll storage and loaded.'
            : existing
              ? 'Payment details loaded.'
              : 'No secure payment details saved yet.',
        }),
      };
    }

    if (action !== 'save') {
      throw coded(400, 'Unsupported payment action.');
    }

    const saved = await savePaymentDetails(supabase, candidate, existing, body, user);
    const [enriched] = await attachOnboardingSummaries(supabase, [candidate]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        paymentDetails: presentAdminPaymentDetails(saved, candidate, { includeSensitive: true }),
        paymentSummary: enriched?.payment_summary || paymentDetailsSummary(saved, candidate),
        onboarding: enriched?.onboarding || null,
        message: 'Payment details saved.',
      }),
    };
  } catch (error) {
    const statusCode = error?.code === 'candidate_payment_validation_failed'
      ? 400
      : (Number(error?.code) || 500);
    return {
      statusCode,
      body: JSON.stringify({
        ok: false,
        error: error?.message || 'Candidate payment details request failed.',
        details: Array.isArray(error?.details) ? error.details : undefined,
      }),
    };
  }
}, { requireToken: false });
