'use strict';

const APPLICATION_STATUS_VALUES = Object.freeze([
  'submitted',
  'in_progress',
  'interview',
  'reject',
]);

const APPLICATION_STATUS_LABELS = Object.freeze({
  submitted: 'Submitted',
  in_progress: 'In Progress',
  interview: 'Interview',
  reject: 'Reject',
});

const APPLICATION_STATUS_TONES = Object.freeze({
  submitted: 'blue',
  in_progress: 'amber',
  interview: 'purple',
  reject: 'red',
});

const APPLICATION_SOURCE_LABELS = Object.freeze({
  candidate_portal: 'Website portal',
  contact_form: 'Website form',
  'jobs-board': 'Jobs board',
  'job-public-detail': 'Job detail page',
  'job-share': 'Shared job link',
});

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return null;
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function normalizeJobApplicationStatus(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return 'submitted';

  if (['submitted', 'applied'].includes(raw)) return 'submitted';
  if (['interview', 'interviewing'].includes(raw)) return 'interview';
  if (['reject', 'rejected', 'declined', 'decline'].includes(raw)) return 'reject';
  if (
    [
      'in_progress',
      'in progress',
      'reviewing',
      'under review',
      'shortlisted',
      'on_hold',
      'on hold',
      'offered',
      'hired',
      'placed',
    ].includes(raw)
  ) {
    return 'in_progress';
  }

  return 'submitted';
}

function getJobApplicationStatusLabel(value) {
  const normalized = normalizeJobApplicationStatus(value);
  return APPLICATION_STATUS_LABELS[normalized] || APPLICATION_STATUS_LABELS.submitted;
}

function getJobApplicationStatusTone(value) {
  const normalized = normalizeJobApplicationStatus(value);
  return APPLICATION_STATUS_TONES[normalized] || APPLICATION_STATUS_TONES.submitted;
}

function normaliseApplicationRow(row = {}, candidateMap = new Map(), jobMap = new Map()) {
  const candidateId = trimString(row.candidate_id, 120);
  const jobId = trimString(row.job_id, 120);
  const candidate = candidateId ? candidateMap.get(candidateId) : null;
  const job = jobId ? jobMap.get(jobId) : null;
  const status = normalizeJobApplicationStatus(row.status);
  const candidateName = trimString(
    candidate?.full_name
      || [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ')
      || row.candidate_name,
    240
  ) || 'Unknown candidate';
  const jobTitle = trimString(row.job_title, 240)
    || trimString(job?.title, 240)
    || 'Unknown role';
  const jobLocation = trimString(row.job_location, 240)
    || trimString(job?.location_text || job?.locationText || job?.location, 240);
  const source = trimString(row.source, 120) || 'website';
  const appliedAt = row.applied_at || row.created_at || null;

  return {
    id: trimString(row.id, 120),
    candidateId,
    jobId,
    candidateName,
    candidateEmail: trimString(candidate?.email, 320),
    candidateLocation: trimString(candidate?.location, 240),
    jobTitle,
    jobLocation,
    jobStatus: trimString(job?.status, 80),
    jobPublished: typeof job?.published === 'boolean' ? job.published : null,
    status,
    statusLabel: getJobApplicationStatusLabel(status),
    statusTone: getJobApplicationStatusTone(status),
    appliedAt,
    updatedAt: row.updated_at || null,
    notes: trimString(row.notes, 4000),
    source,
    sourceLabel: APPLICATION_SOURCE_LABELS[source] || source,
    shareCode: trimString(row.share_code, 120),
    sourceSubmissionId: trimString(row.source_submission_id, 160),
    jobType: trimString(row.job_type, 120),
    jobPay: trimString(row.job_pay, 160),
    hasCandidate: !!candidateId,
    hasJob: !!jobId,
  };
}

function buildApplicationSearchText(row = {}) {
  return [
    row.id,
    row.candidateId,
    row.candidateName,
    row.candidateEmail,
    row.jobId,
    row.jobTitle,
    row.jobLocation,
    row.statusLabel,
    row.sourceLabel,
    row.notes,
    row.shareCode,
    row.sourceSubmissionId,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(' ');
}

function filterJobApplications(rows = [], filters = {}) {
  const q = String(filters.q || '').trim().toLowerCase();
  const status = String(filters.status || 'all').trim().toLowerCase();
  const source = String(filters.source || 'all').trim().toLowerCase();

  return rows.filter((row) => {
    if (status !== 'all' && normalizeJobApplicationStatus(row.status) !== status) return false;
    if (source !== 'all' && String(row.source || '').trim().toLowerCase() !== source) return false;
    if (q && !buildApplicationSearchText(row).includes(q)) return false;
    return true;
  });
}

function sortJobApplications(rows = [], sort = {}) {
  const key = String(sort.key || 'applied_at');
  const descending = String(sort.dir || 'desc').toLowerCase() !== 'asc';
  const factor = descending ? -1 : 1;

  const normaliseValue = (row) => {
    switch (key) {
      case 'candidate_name':
        return String(row.candidateName || '').toLowerCase();
      case 'job_title':
        return String(row.jobTitle || '').toLowerCase();
      case 'status':
        return String(row.status || '').toLowerCase();
      case 'updated_at':
        return row.updatedAt || '';
      case 'applied_at':
      default:
        return row.appliedAt || '';
    }
  };

  return [...rows].sort((left, right) => {
    const a = normaliseValue(left);
    const b = normaliseValue(right);
    if (a === b) return 0;
    return a > b ? factor : -factor;
  });
}

function summariseJobApplications(rows = []) {
  const summary = {
    total: rows.length,
    submitted: 0,
    in_progress: 0,
    interview: 0,
    reject: 0,
  };

  rows.forEach((row) => {
    const key = normalizeJobApplicationStatus(row.status);
    if (!Object.prototype.hasOwnProperty.call(summary, key)) return;
    summary[key] += 1;
  });

  return summary;
}

module.exports = {
  APPLICATION_SOURCE_LABELS,
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_TONES,
  APPLICATION_STATUS_VALUES,
  buildApplicationSearchText,
  filterJobApplications,
  getJobApplicationStatusLabel,
  getJobApplicationStatusTone,
  normaliseApplicationRow,
  normalizeJobApplicationStatus,
  sortJobApplications,
  summariseJobApplications,
};
