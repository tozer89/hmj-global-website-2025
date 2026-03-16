'use strict';

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || '');
  if (!message) return false;
  if (columnName) {
    return new RegExp(`column "?${columnName}"? does not exist`, 'i').test(message)
      || new RegExp(`Could not find the '${columnName}' column of`, 'i').test(message);
  }
  return /column "?[a-zA-Z0-9_]+"? does not exist/i.test(message)
    || /Could not find the '[a-zA-Z0-9_]+' column of/i.test(message);
}

function isNumericIdentifier(value) {
  return /^\d+$/.test(trimString(value, 120));
}

function candidateDisplayName(candidate = {}) {
  return trimString(
    candidate.full_name
      || [candidate.first_name, candidate.last_name].filter(Boolean).join(' ')
      || candidate.email,
    240
  ) || 'Candidate';
}

function normaliseAssignmentSummary(row = {}) {
  return {
    id: row.id != null ? String(row.id) : '',
    as_ref: trimString(row.as_ref || row.assignment_ref, 120) || null,
    job_title: trimString(row.job_title, 240) || null,
    status: trimString(row.status, 80).toLowerCase() || 'draft',
    client_name: trimString(row.client_name, 240) || null,
    client_site: trimString(row.client_site || row.site_name, 240) || null,
    candidate_id: trimString(row.candidate_id, 120) || null,
    candidate_name: trimString(row.candidate_name, 240) || null,
    contractor_id: row.contractor_id == null ? null : String(row.contractor_id),
    start_date: trimString(row.start_date, 40) || null,
    end_date: trimString(row.end_date, 40) || null,
    currency: trimString(row.currency, 12) || 'GBP',
    rate_pay: row.rate_pay == null || row.rate_pay === '' ? null : Number(row.rate_pay),
    rate_std: row.rate_std == null || row.rate_std === '' ? null : Number(row.rate_std),
    active: row.active !== false,
  };
}

function assignmentStatusRank(status) {
  const key = trimString(status, 40).toLowerCase();
  if (key === 'live') return 0;
  if (key === 'pending') return 1;
  if (key === 'draft') return 2;
  if (key === 'complete') return 3;
  return 4;
}

function isOpenAssignmentStatus(status) {
  const key = trimString(status, 40).toLowerCase();
  return key === 'live' || key === 'pending' || key === 'draft' || key === 'complete';
}

function linkedToCandidate(row = {}, candidateId) {
  const candidateKey = trimString(candidateId, 120);
  if (!candidateKey) return false;
  if (trimString(row.candidate_id, 120) === candidateKey) return true;
  if (isNumericIdentifier(candidateKey) && trimString(row.contractor_id, 120) === candidateKey) return true;
  return false;
}

function linkedToAnotherCandidate(row = {}, candidateId) {
  const rowCandidateId = trimString(row.candidate_id, 120);
  const candidateKey = trimString(candidateId, 120);
  return !!rowCandidateId && rowCandidateId !== candidateKey;
}

function sortAssignments(rows = []) {
  return rows.slice().sort((a, b) => {
    const statusDelta = assignmentStatusRank(a.status) - assignmentStatusRank(b.status);
    if (statusDelta) return statusDelta;
    const aStart = trimString(a.start_date, 40);
    const bStart = trimString(b.start_date, 40);
    if (aStart === bStart) return String(b.id || '').localeCompare(String(a.id || ''));
    return aStart < bStart ? 1 : -1;
  });
}

async function fetchAssignments(supabase, queryFactory) {
  const { data, error } = await queryFactory();
  if (!error) {
    return {
      rows: (Array.isArray(data) ? data : []).map(normaliseAssignmentSummary),
      candidateIdSupported: true,
    };
  }
  if (!isMissingColumnError(error, 'candidate_id')) throw error;

  const fallback = await queryFactory({ omitCandidateId: true });
  if (fallback.error) throw fallback.error;
  return {
    rows: (Array.isArray(fallback.data) ? fallback.data : []).map((row) => normaliseAssignmentSummary({ ...row, candidate_id: null })),
    candidateIdSupported: false,
  };
}

async function loadLinkedAssignments(supabase, candidateId) {
  const candidateKey = trimString(candidateId, 120);
  const useLegacy = isNumericIdentifier(candidateKey);

  const result = await fetchAssignments(supabase, ({ omitCandidateId = false } = {}) => {
    const columns = [
      'id',
      !omitCandidateId && 'candidate_id',
      'contractor_id',
      'candidate_name',
      'client_name',
      'client_site',
      'job_title',
      'status',
      'as_ref',
      'start_date',
      'end_date',
      'currency',
      'rate_pay',
      'rate_std',
      'active',
    ].filter(Boolean).join(',');

    let query = supabase
      .from('assignments')
      .select(columns)
      .order('start_date', { ascending: false, nullsFirst: false })
      .limit(40);

    if (!omitCandidateId) {
      const parts = [`candidate_id.eq.${candidateKey}`];
      if (useLegacy) parts.push(`contractor_id.eq.${candidateKey}`);
      query = query.or(parts.join(','));
    } else if (useLegacy) {
      query = query.eq('contractor_id', Number(candidateKey));
    } else {
      query = query.limit(0);
    }

    return query;
  });

  return {
    rows: sortAssignments(result.rows),
    candidateIdSupported: result.candidateIdSupported,
  };
}

async function loadAssignmentOptions(supabase, candidateId, { limit = 80 } = {}) {
  const result = await fetchAssignments(supabase, ({ omitCandidateId = false } = {}) => {
    const columns = [
      'id',
      !omitCandidateId && 'candidate_id',
      'contractor_id',
      'candidate_name',
      'client_name',
      'client_site',
      'job_title',
      'status',
      'as_ref',
      'start_date',
      'end_date',
      'currency',
      'rate_pay',
      'rate_std',
      'active',
    ].filter(Boolean).join(',');

    return supabase
      .from('assignments')
      .select(columns)
      .in('status', ['live', 'pending', 'draft', 'complete'])
      .order('start_date', { ascending: false, nullsFirst: false })
      .limit(limit);
  });

  const options = result.rows.filter((row) => !linkedToAnotherCandidate(row, candidateId) && isOpenAssignmentStatus(row.status));
  return {
    rows: sortAssignments(options),
    candidateIdSupported: result.candidateIdSupported,
  };
}

module.exports = {
  candidateDisplayName,
  isMissingColumnError,
  isNumericIdentifier,
  linkedToCandidate,
  loadAssignmentOptions,
  loadLinkedAssignments,
  normaliseAssignmentSummary,
};
