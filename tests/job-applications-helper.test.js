const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  APPLICATION_SOURCE_LABELS,
  APPLICATION_STATUS_VALUES,
  filterJobApplications,
  normaliseApplicationRow,
  normalizeJobApplicationStatus,
  sortJobApplications,
  summariseJobApplications,
} = require('../netlify/functions/_job-applications.js');

const { buildJobApplicationPayload } = require('../netlify/functions/_candidate-portal.js');

test('job application statuses are constrained to the four admin workflow values', () => {
  assert.deepEqual(APPLICATION_STATUS_VALUES, ['submitted', 'in_progress', 'interview', 'reject']);
  assert.equal(normalizeJobApplicationStatus('submitted'), 'submitted');
  assert.equal(normalizeJobApplicationStatus('reviewing'), 'in_progress');
  assert.equal(normalizeJobApplicationStatus('shortlisted'), 'in_progress');
  assert.equal(normalizeJobApplicationStatus('interviewing'), 'interview');
  assert.equal(normalizeJobApplicationStatus('rejected'), 'reject');
  assert.equal(normalizeJobApplicationStatus('offered'), 'in_progress');
  assert.equal(normalizeJobApplicationStatus(''), 'submitted');
});

test('public application payload still defaults to submitted', () => {
  const payload = buildJobApplicationPayload({
    job_id: 'job-42',
    message: 'Available next month.',
  }, 'candidate-7', { now: '2026-03-18T12:00:00.000Z' });

  assert.equal(payload.status, 'submitted');
});

test('job application helper filters and sorts the application workflow view', () => {
  const rows = [
    { id: 'a1', status: 'submitted', source: 'candidate_portal', candidateName: 'Zed', jobTitle: 'Planner', appliedAt: '2026-03-18T09:00:00Z' },
    { id: 'a2', status: 'interview', source: 'contact_form', candidateName: 'Ava', jobTitle: 'Manager', appliedAt: '2026-03-18T08:00:00Z' },
    { id: 'a3', status: 'in_progress', source: 'candidate_portal', candidateName: 'Joe', jobTitle: 'Engineer', appliedAt: '2026-03-18T07:00:00Z' },
  ];

  const filtered = filterJobApplications(rows, { q: 'manager', status: 'all', source: 'all' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'a2');

  const sorted = sortJobApplications(rows, { key: 'candidate_name', dir: 'asc' });
  assert.deepEqual(sorted.map((row) => row.id), ['a2', 'a3', 'a1']);

  assert.deepEqual(summariseJobApplications(rows), {
    total: 3,
    submitted: 1,
    in_progress: 1,
    interview: 1,
    reject: 0,
  });
});

test('job application helper maps live website sources to readable labels without requiring optional schema columns', () => {
  assert.equal(APPLICATION_SOURCE_LABELS['jobs-board'], 'Jobs board');
  assert.equal(APPLICATION_SOURCE_LABELS['job-public-detail'], 'Job detail page');
  assert.equal(APPLICATION_SOURCE_LABELS['job-share'], 'Shared job link');

  const row = normaliseApplicationRow({
    id: 'app-1',
    status: 'submitted',
    source: 'job-public-detail',
    source_submission_id: 'public-123',
    job_title: 'Project Planner',
  });

  assert.equal(row.sourceLabel, 'Job detail page');
  assert.equal(row.sourceSubmissionId, 'public-123');
  assert.equal(row.shareCode, null);
});

test('job applications migration narrows legacy statuses safely', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260318194500_job_application_status_workflow.sql'),
    'utf8'
  );

  assert.match(migration, /alter column status set default 'submitted'/);
  assert.match(migration, /'submitted', 'in_progress', 'interview', 'reject'/);
  assert.match(migration, /when lower\(btrim\(coalesce\(status, ''\)\)\) in \('interview', 'interviewing'\) then 'interview'/);
});
