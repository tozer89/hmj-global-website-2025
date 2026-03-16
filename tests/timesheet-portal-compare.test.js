const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareCandidates,
  readTimesheetPortalConfig,
} = require('../netlify/functions/_timesheet-portal.js');

test('compareCandidates reports matched, mismatched, website-only, and tsp-only rows by email', () => {
  const result = compareCandidates(
    [
      {
        id: 'candidate-1',
        email: 'matched@example.com',
        first_name: 'Joseph',
        last_name: 'Tozer',
        phone: '+44 7700 900123',
        payroll_ref: 'TSP-10021',
        status: 'active',
      },
      {
        id: 'candidate-2',
        email: 'website-only@example.com',
        full_name: 'Website Only',
        status: 'active',
      },
    ],
    [
      {
        id: 'contractor-1',
        email: 'matched@example.com',
        firstName: 'Joseph',
        lastName: 'Tozer',
        mobile: '+44 7700 000000',
        reference: 'TSP-10021',
      },
      {
        id: 'contractor-2',
        email: 'tsp-only@example.com',
        firstName: 'TSP',
        lastName: 'Only',
      },
    ],
  );

  assert.equal(result.summary.matched, 1);
  assert.equal(result.summary.websiteOnly, 1);
  assert.equal(result.summary.timesheetPortalOnly, 1);
  assert.equal(result.summary.mismatched, 1);
  assert.equal(result.mismatches[0].email, 'matched@example.com');
  assert.deepEqual(result.mismatches[0].differences, ['phone']);
});

test('readTimesheetPortalConfig prefers explicit overrides and enablement env vars', () => {
  const previous = {
    enabled: process.env.TIMESHEET_PORTAL_ENABLED,
    baseUrl: process.env.TIMESHEET_PORTAL_BASE_URL,
    candidatePathOverride: process.env.TIMESHEET_PORTAL_CANDIDATE_PATH_OVERRIDE,
    apiToken: process.env.TIMESHEET_PORTAL_API_TOKEN,
  };

  process.env.TIMESHEET_PORTAL_ENABLED = 'true';
  process.env.TIMESHEET_PORTAL_BASE_URL = 'https://example.timesheetportal.test/';
  process.env.TIMESHEET_PORTAL_CANDIDATE_PATH_OVERRIDE = '/custom/candidates';
  process.env.TIMESHEET_PORTAL_API_TOKEN = 'test-token';

  try {
    const config = readTimesheetPortalConfig();

    assert.equal(config.enabled, true);
    assert.equal(config.configured, true);
    assert.equal(config.baseUrl, 'https://example.timesheetportal.test');
    assert.deepEqual(config.candidatePaths, ['/custom/candidates']);
    assert.equal(config.apiToken, 'test-token');
  } finally {
    process.env.TIMESHEET_PORTAL_ENABLED = previous.enabled;
    process.env.TIMESHEET_PORTAL_BASE_URL = previous.baseUrl;
    process.env.TIMESHEET_PORTAL_CANDIDATE_PATH_OVERRIDE = previous.candidatePathOverride;
    process.env.TIMESHEET_PORTAL_API_TOKEN = previous.apiToken;
  }
});
