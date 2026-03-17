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

function emailsConflict(left, right) {
  const a = lowerEmail(left);
  const b = lowerEmail(right);
  return !!(a && b && a !== b);
}

function candidateDisplayName(candidate = {}) {
  return trimString(
    candidate.full_name
      || [candidate.first_name, candidate.last_name].filter(Boolean).join(' ')
      || candidate.email,
    240,
  ) || 'Candidate';
}

function timesheetPortalContractorName(contractor = {}) {
  return trimString(
    [contractor.firstName, contractor.lastName].filter(Boolean).join(' '),
    240,
  ) || contractor.email || contractor.reference || 'Contractor';
}

function firstPresentString(record = {}, keys = [], maxLength = 240) {
  for (const key of keys) {
    const value = trimString(record?.[key], maxLength);
    if (value) return value;
  }
  return '';
}

function splitName(value) {
  const full = trimString(value, 240);
  if (!full) return { first_name: '', last_name: '', full_name: '' };
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { first_name: parts[0], last_name: '', full_name: parts[0] };
  }
  return {
    first_name: parts.slice(0, -1).join(' '),
    last_name: parts.slice(-1).join(' '),
    full_name: parts.join(' '),
  };
}

function buildWebsiteCandidateLookups(candidates = []) {
  const byEmail = new Map();
  const byReference = new Map();
  const nameBuckets = new Map();

  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    const email = lowerEmail(candidate.email);
    const refs = [
      trimString(candidate.payroll_ref, 120),
      trimString(candidate.ref, 120),
    ].filter(Boolean);
    const nameKey = normalizeName(candidateDisplayName(candidate));

    if (email && !byEmail.has(email)) byEmail.set(email, candidate);
    refs.forEach((ref) => {
      if (ref && !byReference.has(ref)) byReference.set(ref, candidate);
    });
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

  return { byEmail, byReference, byName };
}

function buildTimesheetPortalContractorLookups(contractors = []) {
  const byEmail = new Map();
  const byReference = new Map();
  const nameBuckets = new Map();

  (Array.isArray(contractors) ? contractors : []).forEach((contractor) => {
    const email = lowerEmail(contractor.email);
    const refs = [
      trimString(contractor.reference, 120),
      trimString(contractor.accountingReference, 120),
      trimString(contractor.id, 120),
    ].filter(Boolean);
    const nameKey = normalizeName(timesheetPortalContractorName(contractor));

    if (email && !byEmail.has(email)) byEmail.set(email, contractor);
    refs.forEach((ref) => {
      if (ref && !byReference.has(ref)) byReference.set(ref, contractor);
    });
    if (nameKey) {
      const bucket = nameBuckets.get(nameKey) || [];
      bucket.push(contractor);
      nameBuckets.set(nameKey, bucket);
    }
  });

  const byName = new Map();
  nameBuckets.forEach((bucket, key) => {
    if (bucket.length === 1) byName.set(key, bucket[0]);
  });

  return { byEmail, byReference, byName };
}

function matchWebsiteCandidateForTimesheetPortalContractor(contractor = {}, lookupsOrCandidates = []) {
  const lookups = Array.isArray(lookupsOrCandidates)
    ? buildWebsiteCandidateLookups(lookupsOrCandidates)
    : (lookupsOrCandidates || {});

  const email = lowerEmail(contractor.email);
  if (email && lookups.byEmail?.has(email)) {
    return { candidate: lookups.byEmail.get(email), matchedBy: 'email' };
  }

  for (const ref of [
    trimString(contractor.reference, 120),
    trimString(contractor.accountingReference, 120),
    trimString(contractor.id, 120),
  ]) {
    if (ref && lookups.byReference?.has(ref)) {
      const candidate = lookups.byReference.get(ref);
      if (emailsConflict(candidate?.email, contractor.email)) continue;
      return { candidate, matchedBy: 'reference' };
    }
  }

  const nameKey = normalizeName(timesheetPortalContractorName(contractor));
  if (nameKey && lookups.byName?.has(nameKey)) {
    return { candidate: lookups.byName.get(nameKey), matchedBy: 'name' };
  }

  return { candidate: null, matchedBy: null };
}

function matchTimesheetPortalContractorForCandidate(candidate = {}, contractorLookups = {}) {
  const email = lowerEmail(candidate.email);
  if (email && contractorLookups.byEmail?.has(email)) {
    return { contractor: contractorLookups.byEmail.get(email), matchedBy: 'email' };
  }

  for (const ref of [
    trimString(candidate.payroll_ref, 120),
    trimString(candidate.ref, 120),
  ]) {
    if (ref && contractorLookups.byReference?.has(ref)) {
      const contractor = contractorLookups.byReference.get(ref);
      if (emailsConflict(candidate?.email, contractor?.email)) continue;
      return { contractor, matchedBy: 'reference' };
    }
  }

  const nameKey = normalizeName(candidateDisplayName(candidate));
  if (nameKey && contractorLookups.byName?.has(nameKey)) {
    return { contractor: contractorLookups.byName.get(nameKey), matchedBy: 'name' };
  }

  return { contractor: null, matchedBy: null };
}

function mergeTimesheetPortalCandidate({ contractor = {}, existing = null, now = new Date().toISOString() }) {
  const current = existing && typeof existing === 'object' ? existing : {};
  const hasExisting = !!current.id;
  const reference = trimString(contractor.reference || contractor.accountingReference, 120) || '';
  const fullName = timesheetPortalContractorName(contractor);
  const split = splitName(fullName);
  const raw = contractor.raw || {};

  const payload = {
    id: current.id || undefined,
    ref: trimString(current.ref, 120) || (hasExisting ? reference : '') || null,
    payroll_ref: reference || trimString(current.payroll_ref, 120) || null,
    email: lowerEmail(contractor.email) || lowerEmail(current.email) || null,
    first_name: trimString(contractor.firstName, 120) || trimString(current.first_name, 120) || split.first_name || null,
    last_name: trimString(contractor.lastName, 120) || trimString(current.last_name, 120) || split.last_name || null,
    full_name: fullName || trimString(current.full_name, 240) || null,
    phone: trimString(contractor.mobile, 80) || trimString(current.phone, 80) || null,
    location: firstPresentString(raw, ['location', 'town', 'city', 'county', 'region', 'addressTown'], 240) || trimString(current.location, 240) || null,
    country: firstPresentString(raw, ['country', 'countryName'], 120) || trimString(current.country, 120) || 'United Kingdom',
    headline_role: firstPresentString(raw, ['jobTitle', 'title', 'trade', 'role', 'discipline'], 240) || trimString(current.headline_role, 240) || null,
    current_job_title: firstPresentString(raw, ['jobTitle', 'title', 'role'], 240) || trimString(current.current_job_title, 240) || null,
    primary_specialism: firstPresentString(raw, ['discipline', 'trade', 'skill'], 240) || trimString(current.primary_specialism, 240) || null,
    status: trimString(current.status, 80) || 'active',
    updated_at: now,
  };

  if (!payload.id) delete payload.id;
  if (!current.id) payload.created_at = now;
  return payload;
}

module.exports = {
  buildTimesheetPortalContractorLookups,
  buildWebsiteCandidateLookups,
  candidateDisplayName,
  emailsConflict,
  matchTimesheetPortalContractorForCandidate,
  matchWebsiteCandidateForTimesheetPortalContractor,
  mergeTimesheetPortalCandidate,
  normalizeName,
  timesheetPortalContractorName,
  trimString,
};
