'use strict';

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function lowerEmail(value) {
  const email = trimString(value, 320);
  return email ? email.toLowerCase() : '';
}

function normalizeName(value) {
  return trimString(value, 240)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function candidateDisplayName(candidate = {}) {
  return trimString(
    candidate.full_name
      || [candidate.first_name, candidate.last_name].filter(Boolean).join(' ')
      || candidate.name
      || candidate.email,
    240,
  ) || 'Candidate';
}

function buildCandidateLookups(candidates = []) {
  const byEmail = new Map();
  const byPayroll = new Map();
  const nameBuckets = new Map();

  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    const email = lowerEmail(candidate.email);
    const payrollRef = trimString(candidate.payroll_ref, 120);
    const nameKey = normalizeName(candidateDisplayName(candidate));

    if (email && !byEmail.has(email)) byEmail.set(email, candidate);
    if (payrollRef && !byPayroll.has(payrollRef)) byPayroll.set(payrollRef, candidate);
    if (nameKey) {
      const bucket = nameBuckets.get(nameKey) || [];
      bucket.push(candidate);
      nameBuckets.set(nameKey, bucket);
    }
  });

  const byName = new Map();
  nameBuckets.forEach((bucket, key) => {
    if (bucket.length === 1) byName.set(key, bucket[0]);
  });

  return { byEmail, byPayroll, byName };
}

function matchCandidateForTimesheetPortalAssignment(assignment = {}, lookupsOrCandidates = []) {
  const lookups = Array.isArray(lookupsOrCandidates)
    ? buildCandidateLookups(lookupsOrCandidates)
    : (lookupsOrCandidates || {});

  const email = lowerEmail(assignment.candidateEmail);
  if (email && lookups.byEmail?.has(email)) {
    return { candidate: lookups.byEmail.get(email), matchedBy: 'email' };
  }

  const payrollCandidates = [
    trimString(assignment.payrollRef, 120),
    trimString(assignment.contractorCode, 120),
    trimString(assignment.contractorId, 120),
  ].filter(Boolean);

  for (const value of payrollCandidates) {
    if (lookups.byPayroll?.has(value)) {
      return { candidate: lookups.byPayroll.get(value), matchedBy: 'payroll_ref' };
    }
  }

  const nameKey = normalizeName(assignment.candidateName);
  if (nameKey && lookups.byName?.has(nameKey)) {
    return { candidate: lookups.byName.get(nameKey), matchedBy: 'name' };
  }

  return { candidate: null, matchedBy: null };
}

function normalizeAssignmentStatus(value, activeFlag) {
  const raw = trimString(value, 80).toLowerCase();
  if (raw === 'complete' || raw === 'completed' || raw === 'closed' || raw === 'ended' || raw === 'inactive' || raw === 'finished') {
    return 'complete';
  }
  if (raw === 'pending' || raw === 'future' || raw === 'booked' || raw === 'onboarding') {
    return 'pending';
  }
  if (raw === 'draft' || raw === 'new') {
    return 'draft';
  }
  if (raw === 'live' || raw === 'active' || raw === 'current' || raw === 'open') {
    return 'live';
  }
  if (activeFlag === false) return 'complete';
  if (activeFlag === true) return 'live';
  return raw || 'draft';
}

function mergeTimesheetPortalAssignment({ assignment = {}, existing = {}, candidate = null, matchedBy = null, syncedAt = new Date().toISOString() }) {
  const status = normalizeAssignmentStatus(assignment.status, assignment.active);
  const active = typeof assignment.active === 'boolean' ? assignment.active : status !== 'complete';
  const contractorId = /^\d+$/.test(trimString(assignment.contractorId, 120))
    ? Number(trimString(assignment.contractorId, 120))
    : toNumberOrNull(existing.contractor_id);
  const candidateId = candidate?.id != null
    ? String(candidate.id)
    : trimString(existing.candidate_id, 120) || null;
  const candidateName = candidate
    ? candidateDisplayName(candidate)
    : trimString(assignment.candidateName || existing.candidate_name, 240) || null;

  const payload = {
    id: existing.id != null ? existing.id : undefined,
    candidate_id: candidateId,
    contractor_id: contractorId,
    project_id: existing.project_id == null ? null : Number(existing.project_id),
    site_id: existing.site_id == null ? null : Number(existing.site_id),
    job_title: trimString(assignment.title || existing.job_title, 240) || null,
    status,
    candidate_name: candidateName,
    client_name: trimString(assignment.clientName || existing.client_name, 240) || null,
    client_site: trimString(assignment.clientSite || existing.client_site, 240) || null,
    consultant_name: trimString(assignment.consultantName || existing.consultant_name, 240) || null,
    po_number: trimString(existing.po_number, 120) || null,
    po_ref: trimString(existing.po_ref, 120) || null,
    as_ref: trimString(assignment.reference || assignment.id || existing.as_ref, 120) || null,
    start_date: trimString(assignment.startDate || existing.start_date, 40) || null,
    end_date: trimString(assignment.endDate || existing.end_date, 40) || null,
    days_per_week: toNumberOrNull(existing.days_per_week),
    hours_per_day: toNumberOrNull(existing.hours_per_day),
    currency: trimString(assignment.currency || existing.currency || 'GBP', 12).toUpperCase() || 'GBP',
    rate_std: assignment.rateStd == null ? toNumberOrNull(existing.rate_std) : Number(assignment.rateStd),
    rate_ot: toNumberOrNull(existing.rate_ot),
    charge_std: assignment.chargeStd == null ? toNumberOrNull(existing.charge_std) : Number(assignment.chargeStd),
    charge_ot: assignment.chargeOt == null ? toNumberOrNull(existing.charge_ot) : Number(assignment.chargeOt),
    rate_pay: assignment.ratePay == null ? toNumberOrNull(existing.rate_pay) : Number(assignment.ratePay),
    rate_charge: assignment.rateCharge == null ? toNumberOrNull(existing.rate_charge) : Number(assignment.rateCharge),
    pay_freq: trimString(existing.pay_freq, 80) || null,
    ts_type: trimString(existing.ts_type, 80) || null,
    shift_type: trimString(existing.shift_type, 80) || null,
    auto_ts: existing.auto_ts === true,
    approver: trimString(existing.approver, 240) || null,
    notes: trimString(existing.notes, 4000) || null,
    hs_risk: trimString(existing.hs_risk, 240) || null,
    rtw_ok: typeof existing.rtw_ok === 'boolean' ? existing.rtw_ok : null,
    quals: trimString(existing.quals, 4000) || null,
    special: trimString(existing.special, 4000) || null,
    duties: trimString(existing.duties, 4000) || null,
    equipment: trimString(existing.equipment, 4000) || null,
    terms_sent: typeof existing.terms_sent === 'boolean' ? existing.terms_sent : null,
    sig_ok: typeof existing.sig_ok === 'boolean' ? existing.sig_ok : null,
    notice_temp: trimString(existing.notice_temp, 240) || null,
    notice_client: trimString(existing.notice_client, 240) || null,
    term_reason: trimString(existing.term_reason, 240) || null,
    contract_url: trimString(existing.contract_url, 2000) || null,
    active,
  };

  if (matchedBy && !payload.notes) {
    payload.notes = `Matched to website candidate via ${matchedBy}.`;
  }

  if (payload.id === undefined) delete payload.id;
  return payload;
}

module.exports = {
  buildCandidateLookups,
  candidateDisplayName,
  matchCandidateForTimesheetPortalAssignment,
  mergeTimesheetPortalAssignment,
  normalizeAssignmentStatus,
  normalizeName,
};
