'use strict';

const { isMissingColumnError, isMissingRelationError } = require('./_candidate-portal.js');
const { paymentDetailsSummary } = require('./_candidate-payment-details.js');
const { summariseCandidatesOnboardingMap } = require('./_candidate-onboarding.js');

function stripSensitiveCandidateFields(candidate = {}) {
  const next = { ...candidate };
  delete next.bank_name;
  delete next.bank_sort;
  delete next.bank_sort_code;
  delete next.bank_account;
  delete next.bank_iban;
  delete next.bank_swift;
  delete next.tax_id;
  return next;
}

async function loadDocumentsByCandidateId(supabase, candidateIds = []) {
  if (!candidateIds.length) return new Map();
  // verification_status and verification_required are required so that
  // normaliseOnboarding() can correctly compute hasRightToWork and
  // pendingVerificationCount.  Without them every document appears as
  // "not verified", inflating the "to verify" count and mis-reporting RTW status.
  const { data, error } = await supabase
    .from('candidate_documents')
    .select('id,candidate_id,document_type,label,filename,original_filename,uploaded_at,created_at,verification_status,verification_required')
    .in('candidate_id', candidateIds.map(String));
  if (error && !isMissingColumnError(error) && !isMissingRelationError(error)) throw error;
  const map = new Map();
  (Array.isArray(data) ? data : []).forEach((row) => {
    const key = String(row.candidate_id);
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  });
  return map;
}

async function loadPaymentsByCandidateId(supabase, candidateIds = [], candidatesById = new Map()) {
  if (!candidateIds.length) return new Map();
  const { data, error } = await supabase
    .from('candidate_payment_details')
    .select('*')
    .in('candidate_id', candidateIds.map(String));
  if (error && !isMissingColumnError(error) && !isMissingRelationError(error)) throw error;
  const map = new Map();
  (Array.isArray(data) ? data : []).forEach((row) => {
    map.set(String(row.candidate_id), paymentDetailsSummary(row, candidatesById.get(String(row.candidate_id)) || {}));
  });
  return map;
}

async function attachOnboardingSummaries(supabase, candidates = []) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!rows.length) return [];
  const candidatesById = new Map(rows.map((row) => [String(row.id), row]));
  const candidateIds = rows.map((row) => String(row.id));
  const [docsByCandidateId, paymentsByCandidateId] = await Promise.all([
    loadDocumentsByCandidateId(supabase, candidateIds),
    loadPaymentsByCandidateId(supabase, candidateIds, candidatesById),
  ]);
  const onboardingByCandidateId = summariseCandidatesOnboardingMap(rows, {
    docsByCandidateId,
    paymentsByCandidateId,
  });

  return rows.map((candidate) => {
    const key = String(candidate.id);
    return {
      ...stripSensitiveCandidateFields(candidate),
      payment_summary: paymentsByCandidateId.get(key) || paymentDetailsSummary(null, candidate),
      onboarding: onboardingByCandidateId.get(key) || null,
    };
  });
}

module.exports = {
  attachOnboardingSummaries,
  stripSensitiveCandidateFields,
};
