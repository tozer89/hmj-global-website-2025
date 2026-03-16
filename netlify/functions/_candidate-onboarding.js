'use strict';

const {
  _resolveCandidatePortalBaseUrl: resolveCandidatePortalBaseUrl,
  _buildRedirectUrl: buildRedirectUrl,
} = require('./candidate-auth-config.js');

const RTW_DOCUMENT_TYPES = new Set(['right_to_work', 'passport', 'visa_permit']);
const ONBOARDING_DOCUMENT_TYPES = new Set([
  'cv',
  'cover_letter',
  'certificate',
  'qualification_certificate',
  'passport',
  'right_to_work',
  'visa_permit',
  'bank_document',
  'other',
]);

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function lowerText(value, maxLength = 240) {
  const text = trimString(value, maxLength);
  return text ? text.toLowerCase() : '';
}

function normaliseDocumentType(value, fallbackLabel = '') {
  const raw = lowerText(value, 80) || lowerText(fallbackLabel, 240);
  if (!raw) return 'other';
  if (raw === 'cv' || raw === 'resume') return 'cv';
  if (raw === 'cover_letter' || raw === 'cover letter') return 'cover_letter';
  if (raw === 'certificate' || raw === 'certification') return 'certificate';
  if (raw === 'qualification_certificate' || raw === 'qualification / certificate') return 'qualification_certificate';
  if (raw === 'passport') return 'passport';
  if (raw === 'right_to_work' || raw === 'right to work') return 'right_to_work';
  if (raw === 'visa_permit' || raw === 'visa / permit' || raw === 'visa' || raw === 'permit') return 'visa_permit';
  if (raw === 'bank_document' || raw === 'bank document') return 'bank_document';

  if (/\b(cv|resume)\b/.test(raw)) return 'cv';
  if (/cover[\s_-]?letter/.test(raw)) return 'cover_letter';
  if (/\b(passport)\b/.test(raw)) return 'passport';
  if (/right[\s_-]?to[\s_-]?work|share[\s_-]?code/.test(raw)) return 'right_to_work';
  if (/\b(visa|permit|brp|residence)\b/.test(raw)) return 'visa_permit';
  if (/\b(cert|certificate|qualification|ticket|card)\b/.test(raw)) return 'qualification_certificate';
  if (/\b(bank|void cheque|void check)\b/.test(raw)) return 'bank_document';
  return 'other';
}

function normaliseDocumentRow(row = {}) {
  const label = trimString(
    row.label
    || row.kind
    || row.original_filename
    || row.filename
    || row.name,
    240,
  );
  return {
    id: trimString(row.id, 120) || null,
    candidate_id: trimString(row.candidate_id, 120) || null,
    document_type: normaliseDocumentType(row.document_type, label),
    label,
    uploaded_at: row.uploaded_at || row.created_at || null,
  };
}

function listDocumentTypes(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normaliseDocumentRow(row).document_type)
    .filter(Boolean);
}

function hasRightToWorkEvidence(candidate = {}, documents = []) {
  const types = new Set(listDocumentTypes(documents));
  if ([...types].some((type) => RTW_DOCUMENT_TYPES.has(type))) return true;
  if (trimString(candidate.rtw_url, 2000)) return true;
  if (candidate.right_to_work === true) return true;
  const status = lowerText(candidate.right_to_work_status, 240);
  if (status && /full right to work|right to work in place|share code provided|passport provided/.test(status)) {
    return true;
  }
  return false;
}

function hasPaymentDetails(paymentDetails = null, candidate = {}) {
  if (paymentDetails?.completion?.complete) return true;
  if (
    trimString(candidate.bank_name, 240)
    && (
      trimString(candidate.bank_account, 120)
      || trimString(candidate.bank_iban, 120)
    )
  ) {
    return true;
  }
  return false;
}

function summariseOnboarding({ candidate = {}, documents = [], paymentDetails = null } = {}) {
  const documentRows = Array.isArray(documents) ? documents : [];
  const hasRightToWork = hasRightToWorkEvidence(candidate, documentRows);
  const hasPayment = hasPaymentDetails(paymentDetails, candidate);
  const documentTypes = Array.from(new Set(listDocumentTypes(documentRows)));
  const missing = [];
  if (!hasRightToWork) missing.push('right_to_work');
  if (!hasPayment) missing.push('payment_details');

  return {
    hasRightToWork: hasRightToWork,
    hasPaymentDetails: hasPayment,
    onboardingComplete: missing.length === 0,
    missing,
    documentTypes,
    hasPassportLikeDocument: documentTypes.includes('passport'),
    hasVisaPermitDocument: documentTypes.includes('visa_permit'),
    hasCertificateDocument: documentTypes.includes('certificate') || documentTypes.includes('qualification_certificate'),
  };
}

function summariseCandidatesOnboardingMap(candidates = [], options = {}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const docsByCandidateId = options.docsByCandidateId instanceof Map ? options.docsByCandidateId : new Map();
  const paymentsByCandidateId = options.paymentsByCandidateId instanceof Map ? options.paymentsByCandidateId : new Map();
  const out = new Map();
  rows.forEach((candidate) => {
    const key = trimString(candidate?.id, 120);
    if (!key) return;
    out.set(
      key,
      summariseOnboarding({
        candidate,
        documents: docsByCandidateId.get(key) || [],
        paymentDetails: paymentsByCandidateId.get(key) || null,
      }),
    );
  });
  return out;
}

function normaliseCandidatePortalTarget(input = {}) {
  const tab = trimString(input.tab, 64).toLowerCase() || 'documents';
  const focus = trimString(input.focus, 80).toLowerCase() || '';
  return {
    tab,
    focus,
  };
}

function buildCandidatePortalDeepLink(event, input = {}) {
  const baseUrl = resolveCandidatePortalBaseUrl(event);
  const target = normaliseCandidatePortalTarget(input);
  const params = new URLSearchParams();
  if (target.tab) params.set('candidate_tab', target.tab);
  if (target.focus) params.set('candidate_focus', target.focus);
  if (input.onboarding === true) params.set('candidate_onboarding', '1');
  const suffix = params.toString();
  return buildRedirectUrl(baseUrl, `/candidates.html${suffix ? `?${suffix}` : ''}`);
}

module.exports = {
  ONBOARDING_DOCUMENT_TYPES,
  RTW_DOCUMENT_TYPES,
  buildCandidatePortalDeepLink,
  hasPaymentDetails,
  hasRightToWorkEvidence,
  normaliseCandidatePortalTarget,
  normaliseDocumentRow,
  normaliseDocumentType,
  summariseCandidatesOnboardingMap,
  summariseOnboarding,
  trimString,
};
