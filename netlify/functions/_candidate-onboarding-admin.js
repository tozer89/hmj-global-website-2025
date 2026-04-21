'use strict';

const {
  normaliseCandidateDocument,
} = require('./_candidate-docs.js');
const {
  isMissingColumnError,
  isMissingRelationError,
  normaliseOnboardingStatus,
  normaliseRightToWorkEvidenceType,
} = require('./_candidate-portal.js');
const { paymentDetailsSummary } = require('./_candidate-payment-details.js');
const { summariseCandidatesOnboardingMap } = require('./_candidate-onboarding.js');

const ONBOARDING_STATUSES = [
  'new',
  'awaiting_documents',
  'awaiting_verification',
  'ready_for_payroll',
  'onboarding_complete',
  'archived',
];

const EMAIL_ACTIVITY_TYPES = new Set([
  'intro_email_sent',
  'intro_reminder_sent',
  'onboarding_confirmation_sent',
  'rtw_reminder_sent',
  'candidate_document_request_sent',
  'onboarding_reminder_sent',
  'onboarding_verification_complete_sent',
]);

function trimString(value, maxLength = 240) {
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

function normaliseArray(value, maxLength = 160) {
  const items = Array.isArray(value)
    ? value
    : String(value == null ? '' : value).split(/[\n,]/);
  const seen = new Set();
  const out = [];
  items.forEach((item) => {
    const entry = trimString(item, maxLength);
    if (!entry) return;
    const key = entry.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  });
  return out;
}

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

function evidenceTypeLabel(value) {
  const type = normaliseRightToWorkEvidenceType(value);
  if (type === 'passport') return 'Passport';
  if (type === 'id_card') return 'ID card';
  if (type === 'visa') return 'Visa';
  if (type === 'brp') return 'BRP';
  if (type === 'share_code') return 'Share code';
  if (type === 'settlement') return 'Settlement';
  if (type === 'other') return 'Other';
  return 'Not set';
}

function onboardingStatusLabel(value) {
  const status = normaliseOnboardingStatus(value);
  if (status === 'awaiting_documents') return 'Awaiting documents';
  if (status === 'awaiting_verification') return 'Awaiting verification';
  if (status === 'ready_for_payroll') return 'Ready for payroll';
  if (status === 'onboarding_complete') return 'Onboarding complete';
  if (status === 'archived') return 'Archived';
  return status === 'new' ? 'New' : 'New';
}

function rightToWorkDocumentRows(documents = []) {
  return (Array.isArray(documents) ? documents : [])
    .map((row) => normaliseCandidateDocument(row))
    .filter((row) => ['passport', 'right_to_work', 'visa_permit'].includes(row.document_type));
}

function resolveRightToWorkEvidenceType(candidate = {}, documentRows = []) {
  const explicit = normaliseRightToWorkEvidenceType(candidate.right_to_work_evidence_type);
  if (explicit) return explicit;
  for (const doc of documentRows) {
    const metaType = normaliseRightToWorkEvidenceType(doc?.meta?.right_to_work_evidence_type || doc?.meta?.evidence_type);
    if (metaType) return metaType;
  }
  if (documentRows.some((row) => row.document_type === 'passport')) return 'passport';
  if (documentRows.some((row) => row.document_type === 'visa_permit')) return 'visa';
  if (documentRows.some((row) => row.document_type === 'right_to_work')) return 'share_code';
  return null;
}

function rightToWorkSummary(candidate = {}, documents = []) {
  const rows = rightToWorkDocumentRows(documents)
    .sort((left, right) => String(right.uploaded_at || right.created_at || '').localeCompare(String(left.uploaded_at || left.created_at || '')));
  const approved = rows.find((row) => lowerText(row.verification_status, 40) === 'verified') || null;
  const rejected = rows.find((row) => lowerText(row.verification_status, 40) === 'rejected') || null;
  const pending = rows.find((row) => row.verification_required && lowerText(row.verification_status, 40) !== 'verified' && lowerText(row.verification_status, 40) !== 'rejected') || null;
  const latest = approved || pending || rejected || rows[0] || null;
  const documentStatus = approved
    ? 'approved'
    : rejected
    ? 'rejected'
    : pending || rows.length
    ? 'present'
    : 'missing';
  const evidenceType = resolveRightToWorkEvidenceType(candidate, rows);
  const referenceRow = approved || rejected || pending || latest;
  return {
    count: rows.length,
    hasUpload: rows.length > 0 || !!trimString(candidate.rtw_url, 2000),
    documentStatus,
    verified: documentStatus === 'approved',
    verifiedBy: trimString(referenceRow?.verified_by || referenceRow?.reviewed_by, 240) || null,
    verifiedAt: referenceRow?.verified_at || referenceRow?.reviewed_at || null,
    verificationNotes: trimString(referenceRow?.verification_notes, 2000) || null,
    documentId: referenceRow?.id || null,
    documentLabel: trimString(referenceRow?.label || referenceRow?.original_filename || referenceRow?.filename, 240) || null,
    evidenceType,
    evidenceTypeLabel: evidenceTypeLabel(evidenceType),
  };
}

function candidateFieldValue(candidate = {}, ...keys) {
  for (const key of keys) {
    const value = candidate?.[key];
    if (Array.isArray(value) && value.length) return value;
    if (value !== null && value !== undefined && String(value).trim()) return value;
  }
  return '';
}

function detectMissing(candidate = {}, baseOnboarding = {}, paymentSummary = {}, documents = []) {
  const rightToWork = rightToWorkSummary(candidate, documents);
  const cvPresent = (Array.isArray(documents) ? documents : [])
    .map((row) => normaliseCandidateDocument(row))
    .some((row) => row.document_type === 'cv');
  const rightToWorkRegions = normaliseArray(candidate.right_to_work_regions || candidate.right_to_work);
  const missingFlags = {
    full_name: !trimString(candidate.full_name || `${candidate.first_name || ''} ${candidate.last_name || ''}`, 240),
    email: !trimString(candidate.email, 320),
    phone: !trimString(candidate.phone, 80),
    address: !(
      trimString(candidate.address1 || candidate.address, 240)
      && trimString(candidate.town, 160)
      && trimString(candidate.postcode, 32)
      && trimString(candidate.country, 120)
    ),
    location: !trimString(candidate.location, 240),
    nationality: !trimString(candidate.nationality, 120),
    discipline: !trimString(candidate.primary_specialism || candidate.sector_focus, 240),
    current_job_title: !trimString(candidate.current_job_title || candidate.job_title || candidate.role, 240),
    assignment_start_date: !trimString(candidate.start_date || candidate.availability_date || candidate.availability, 160),
    right_to_work_regions: rightToWorkRegions.length === 0,
    right_to_work_evidence_type: !rightToWork.evidenceType,
    right_to_work_upload: rightToWork.hasUpload !== true,
    payment_details: paymentSummary?.completion?.complete !== true,
    emergency_contact: !(
      trimString(candidate.emergency_name, 240)
      && trimString(candidate.emergency_phone, 80)
    ),
    consent: candidate.consent_captured !== true,
    cv: !cvPresent,
    qualifications: !trimString(candidate.qualifications, 4000),
    linkedin: !trimString(candidate.linkedin_url, 500),
    summary: !trimString(candidate.summary || candidate.notes, 4000),
  };

  const missingCore = [
    'full_name',
    'email',
    'phone',
    'address',
    'location',
    'current_job_title',
    'assignment_start_date',
    'right_to_work_regions',
    'right_to_work_evidence_type',
    'right_to_work_upload',
    'payment_details',
    'emergency_contact',
    'consent',
  ].filter((key) => missingFlags[key]);

  const missingRecommended = ['nationality', 'discipline', 'qualifications', 'linkedin', 'summary', 'cv']
    .filter((key) => missingFlags[key]);

  return {
    missingFlags,
    missingCore,
    missingRecommended,
    missingCount: missingCore.length + missingRecommended.length,
    rightToWork,
    cvPresent,
    rightToWorkRegions,
    onboardingComplete: baseOnboarding?.onboardingComplete === true
      || (missingCore.length === 0 && rightToWork.documentStatus === 'approved' && paymentSummary?.completion?.complete === true),
  };
}

function latestActivityTimestamp(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => row?.created_at)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;
}

function summariseEmailHistory(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const byType = (activityType) => latestActivityTimestamp(list.filter((row) => row?.activity_type === activityType));
  return {
    introSentAt: byType('intro_email_sent'),
    introReminderSentAt: byType('intro_reminder_sent'),
    onboardingConfirmationSentAt: byType('onboarding_confirmation_sent'),
    onboardingReminderSentAt: byType('onboarding_reminder_sent'),
    rtwReminderSentAt: byType('rtw_reminder_sent'),
    documentRequestSentAt: byType('candidate_document_request_sent'),
    verificationCompleteSentAt: byType('onboarding_verification_complete_sent'),
    lastSentAt: latestActivityTimestamp(list.filter((row) => EMAIL_ACTIVITY_TYPES.has(row?.activity_type))),
    recent: list
      .filter((row) => EMAIL_ACTIVITY_TYPES.has(row?.activity_type))
      .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))
      .slice(0, 8)
      .map((row) => ({
        activity_type: row.activity_type,
        description: row.description || '',
        created_at: row.created_at || null,
        actor_identifier: row.actor_identifier || null,
        meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
      })),
  };
}

function deriveOnboardingStatus(candidate = {}, baseOnboarding = {}, missing = {}) {
  if (String(candidate?.status || '').toLowerCase() === 'archived') return 'archived';
  const stored = normaliseOnboardingStatus(candidate?.onboarding_status);
  if (stored) return stored;
  if (baseOnboarding?.onboardingMode !== true) return null;
  if (String(candidate?.status || '').toLowerCase() === 'cancelled') return 'archived';
  if (
    String(candidate?.status || '').toLowerCase() === 'invited'
    || (!candidate?.created_at && !candidate?.updated_at)
  ) {
    return 'new';
  }
  if (
    missing?.missingFlags?.right_to_work_upload
    || missing?.missingFlags?.payment_details
    || missing?.missingFlags?.consent
    || missing?.missingFlags?.address
    || missing?.missingFlags?.assignment_start_date
    || missing?.missingFlags?.emergency_contact
  ) {
    return 'awaiting_documents';
  }
  if (
    missing?.rightToWork?.documentStatus === 'present'
    || missing?.rightToWork?.documentStatus === 'rejected'
    || Number(baseOnboarding?.pendingVerificationCount || 0) > 0
  ) {
    return 'awaiting_verification';
  }
  if (missing?.onboardingComplete === true || String(candidate?.status || '').toLowerCase() === 'complete') {
    return String(candidate?.status || '').toLowerCase() === 'complete'
      ? 'onboarding_complete'
      : 'ready_for_payroll';
  }
  return 'new';
}

function duplicateSummary(candidate = {}, candidatesByEmail = new Map()) {
  const email = lowerText(candidate.email, 320);
  const matches = email ? (candidatesByEmail.get(email) || []).filter((entry) => String(entry.id) !== String(candidate.id)) : [];
  return {
    duplicateEmailCount: matches.length,
    duplicateEmails: matches.map((entry) => ({
      id: entry.id,
      name: trimString(entry.full_name || `${entry.first_name || ''} ${entry.last_name || ''}`, 240) || trimString(entry.email, 320) || 'Candidate',
      onboarding_mode: entry.onboarding_mode === true,
      onboarding_status: normaliseOnboardingStatus(entry.onboarding_status) || null,
      status: trimString(entry.status, 80) || null,
    })),
  };
}

async function loadDocumentsByCandidateId(supabase, candidateIds = []) {
  if (!candidateIds.length) return new Map();
  const { data, error } = await supabase
    .from('candidate_documents')
    .select('id,candidate_id,document_type,label,filename,original_filename,uploaded_at,created_at,updated_at,meta,verification_status,verification_required')
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

async function loadActivitiesByCandidateId(supabase, candidateIds = []) {
  if (!candidateIds.length) return new Map();
  const { data, error } = await supabase
    .from('candidate_activity')
    .select('candidate_id,activity_type,description,created_at,actor_identifier,meta')
    .in('candidate_id', candidateIds.map(String))
    .in('activity_type', [
      'intro_email_sent',
      'intro_reminder_sent',
      'onboarding_confirmation_sent',
      'rtw_reminder_sent',
      'candidate_document_request_sent',
      'onboarding_reminder_sent',
      'onboarding_verification_complete_sent',
      'candidate_document_verified',
      'candidate_document_rejected',
      'candidate_document_verification_reset',
      'payment_details_saved',
      'payment_details_migrated',
      'onboarding_status_updated',
    ]);
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

async function attachOnboardingSummaries(supabase, candidates = []) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!rows.length) return [];
  const candidatesById = new Map(rows.map((row) => [String(row.id), row]));
  const candidatesByEmail = new Map();
  rows.forEach((row) => {
    const email = lowerText(row?.email, 320);
    if (!email) return;
    const list = candidatesByEmail.get(email) || [];
    list.push(row);
    candidatesByEmail.set(email, list);
  });
  const candidateIds = rows.map((row) => String(row.id));
  const [docsByCandidateId, paymentsByCandidateId, activityByCandidateId] = await Promise.all([
    loadDocumentsByCandidateId(supabase, candidateIds),
    loadPaymentsByCandidateId(supabase, candidateIds, candidatesById),
    loadActivitiesByCandidateId(supabase, candidateIds),
  ]);
  const onboardingByCandidateId = summariseCandidatesOnboardingMap(rows, {
    docsByCandidateId,
    paymentsByCandidateId,
  });

  return rows.map((candidate) => {
    const key = String(candidate.id);
    const documents = docsByCandidateId.get(key) || [];
    const paymentSummary = paymentsByCandidateId.get(key) || paymentDetailsSummary(null, candidate);
    const baseOnboarding = onboardingByCandidateId.get(key) || null;
    const missing = detectMissing(candidate, baseOnboarding, paymentSummary, documents);
    const emailHistory = summariseEmailHistory(activityByCandidateId.get(key) || []);
    const onboardingStatus = deriveOnboardingStatus(candidate, baseOnboarding, missing);
    return {
      ...stripSensitiveCandidateFields(candidate),
      payment_summary: paymentSummary,
      onboarding: {
        ...(baseOnboarding || {}),
        status: onboardingStatus,
        statusLabel: onboardingStatusLabel(onboardingStatus),
        statusUpdatedAt: candidate.onboarding_status_updated_at || null,
        statusUpdatedBy: trimString(candidate.onboarding_status_updated_by, 320) || null,
        missing: missing.missingCore,
        missingCore: missing.missingCore,
        missingRecommended: missing.missingRecommended,
        missingFlags: missing.missingFlags,
        missingCount: missing.missingCount,
        emailHistory,
        rightToWork: missing.rightToWork,
        cvPresent: missing.cvPresent,
        rightToWorkRegions: missing.rightToWorkRegions,
        consentCaptured: candidate.consent_captured === true,
        consentCapturedAt: candidate.consent_captured_at || null,
        duplicate: duplicateSummary(candidate, candidatesByEmail),
      },
    };
  });
}

module.exports = {
  ONBOARDING_STATUSES,
  attachOnboardingSummaries,
  duplicateSummary,
  evidenceTypeLabel,
  onboardingStatusLabel,
  rightToWorkSummary,
  stripSensitiveCandidateFields,
};
