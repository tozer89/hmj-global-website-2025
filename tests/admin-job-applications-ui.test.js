const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
const pageSource = fs.readFileSync(path.join(__dirname, '..', 'admin', 'job-applications.html'), 'utf8');
const pageScript = fs.readFileSync(path.join(__dirname, '..', 'admin', 'job-applications.js'), 'utf8');
const jobsSource = fs.readFileSync(path.join(__dirname, '..', 'admin', 'jobs.html'), 'utf8');
const candidatesSource = fs.readFileSync(path.join(__dirname, '..', 'admin', 'candidates.js'), 'utf8');
const updateFunctionSource = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'admin-job-applications-update.js'), 'utf8');
const listFunctionSource = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'admin-job-applications-list.js'), 'utf8');

test('admin dashboard exposes the Job applications module card', () => {
  assert.match(dashboardSource, /href="\/admin\/job-applications\.html"/);
  assert.match(dashboardSource, /<strong>Job applications<\/strong>/);
});

test('job applications page includes workflow cards, filters, and table actions', () => {
  assert.match(pageSource, /<title>Job Applications \| HMJ Global Admin<\/title>/);
  assert.match(pageSource, /id="filterSearch"/);
  assert.match(pageSource, /id="filterStatus"/);
  assert.match(pageSource, /id="applicationRows"/);
  assert.match(pageSource, /Submitted/);
  assert.match(pageSource, /In Progress/);
  assert.match(pageSource, /Interview/);
  assert.match(pageSource, /Reject/);
});

test('job applications script calls the new list and update endpoints', () => {
  assert.match(pageScript, /admin-job-applications-list/);
  assert.match(pageScript, /admin-job-applications-update/);
  assert.match(pageScript, /\/admin\/candidates\.html\?candidate_id=/);
  assert.match(pageScript, /\/admin\/jobs\.html/);
});

test('jobs console accepts q from the URL for role deep-links', () => {
  assert.match(jobsSource, /params\.get\('q'\)/);
  assert.match(jobsSource, /params\.get\('job_title'\)/);
});

test('candidates workspace accepts a candidate_id launch param for deep-links', () => {
  assert.match(candidatesSource, /params\.get\('candidate_id'\)/);
  assert.match(candidatesSource, /openDrawer\(launch\.candidateId\)/);
});

test('job application status updates fall back to legacy stored values if the older check constraint is still live', () => {
  assert.match(updateFunctionSource, /LEGACY_STORAGE_STATUS/);
  assert.match(updateFunctionSource, /isStatusConstraintError/);
  assert.match(updateFunctionSource, /reviewing/);
  assert.match(updateFunctionSource, /interviewing/);
  assert.match(updateFunctionSource, /rejected/);
});

test('job applications list endpoint tolerates optional columns missing from older live schemas', () => {
  assert.match(listFunctionSource, /OPTIONAL_APPLICATION_COLUMNS/);
  assert.match(listFunctionSource, /share_code/);
  assert.match(listFunctionSource, /extractMissingColumnName/);
  assert.match(listFunctionSource, /optionalColumns\.delete\(missingColumn\)/);
});
