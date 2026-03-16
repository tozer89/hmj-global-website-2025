const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareCandidates,
  listTimesheetPortalContractors,
  readTimesheetPortalConfig,
} = require('../netlify/functions/_timesheet-portal.js');

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

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
    restoreEnv('TIMESHEET_PORTAL_ENABLED', previous.enabled);
    restoreEnv('TIMESHEET_PORTAL_BASE_URL', previous.baseUrl);
    restoreEnv('TIMESHEET_PORTAL_CANDIDATE_PATH_OVERRIDE', previous.candidatePathOverride);
    restoreEnv('TIMESHEET_PORTAL_API_TOKEN', previous.apiToken);
  }
});

test('readTimesheetPortalConfig accepts legacy TSP_* env aliases used in Netlify', () => {
  const previous = {
    baseUrl: process.env.TSP_BASE_URL,
    apiToken: process.env.TSP_API_KEY,
    clientId: process.env.TSP_OAUTH_CLIENT_ID,
    clientSecret: process.env.TSP_OAUTH_CLIENT_SECRET,
    tokenUrl: process.env.TSP_TOKEN_URL,
  };

  process.env.TSP_BASE_URL = 'https://legacy.timesheetportal.test/';
  process.env.TSP_API_KEY = 'legacy-token';
  process.env.TSP_OAUTH_CLIENT_ID = '';
  process.env.TSP_OAUTH_CLIENT_SECRET = '';
  process.env.TSP_TOKEN_URL = '/oauth/custom-token';

  try {
    const config = readTimesheetPortalConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.configured, true);
    assert.equal(config.baseUrl, 'https://legacy.timesheetportal.test');
    assert.equal(config.apiToken, 'legacy-token');
    assert.equal(config.tokenPath, '/oauth/custom-token');
  } finally {
    restoreEnv('TSP_BASE_URL', previous.baseUrl);
    restoreEnv('TSP_API_KEY', previous.apiToken);
    restoreEnv('TSP_OAUTH_CLIENT_ID', previous.clientId);
    restoreEnv('TSP_OAUTH_CLIENT_SECRET', previous.clientSecret);
    restoreEnv('TSP_TOKEN_URL', previous.tokenUrl);
  }
});

test('readTimesheetPortalConfig includes documented /users endpoint in default candidate discovery paths', () => {
  const config = readTimesheetPortalConfig();
  assert.equal(config.candidatePaths[0], '/users');
});

test('listTimesheetPortalContractors uses oauth bearer auth and /users discovery when available', async () => {
  const previous = {
    apiToken: process.env.TIMESHEET_PORTAL_API_TOKEN,
    clientId: process.env.TIMESHEET_PORTAL_CLIENT_ID,
    clientSecret: process.env.TIMESHEET_PORTAL_CLIENT_SECRET,
    baseUrl: process.env.TIMESHEET_PORTAL_BASE_URL,
  };
  const originalFetch = global.fetch;

  process.env.TIMESHEET_PORTAL_API_TOKEN = '';
  process.env.TIMESHEET_PORTAL_CLIENT_ID = 'client-id-success';
  process.env.TIMESHEET_PORTAL_CLIENT_SECRET = 'client-secret-success';
  process.env.TIMESHEET_PORTAL_BASE_URL = 'https://brightwater.api.timesheetportal.test';

  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://brightwater.api.timesheetportal.test/oauth/token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'oauth-access', expires_in: 3600 }),
      };
    }
    if (String(url) === 'https://brightwater.api.timesheetportal.test/users?page=1') {
      assert.equal(options.headers.authorization, 'Bearer oauth-access');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ id: 'u1', firstName: 'Joe', lastName: 'Tozer', email: 'joe@example.com' }]),
      };
    }
    if (String(url) === 'https://brightwater.api.timesheetportal.test/users?page=2') {
      assert.equal(options.headers.authorization, 'Bearer oauth-access');
      return {
        ok: true,
        status: 200,
        text: async () => '[]',
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  try {
    const result = await listTimesheetPortalContractors(readTimesheetPortalConfig(), { take: 5 });
    assert.equal(result.discovery.candidatePath, '/users');
    assert.equal(result.contractors.length, 1);
    assert.equal(result.contractors[0].email, 'joe@example.com');
    assert.ok(calls.some((call) => call.url.endsWith('/oauth/token')));
  } finally {
    global.fetch = originalFetch;
    restoreEnv('TIMESHEET_PORTAL_API_TOKEN', previous.apiToken);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_ID', previous.clientId);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_SECRET', previous.clientSecret);
    restoreEnv('TIMESHEET_PORTAL_BASE_URL', previous.baseUrl);
  }
});

test('listTimesheetPortalContractors falls back to raw api token auth when oauth fails', async () => {
  const previous = {
    apiToken: process.env.TIMESHEET_PORTAL_API_TOKEN,
    clientId: process.env.TIMESHEET_PORTAL_CLIENT_ID,
    clientSecret: process.env.TIMESHEET_PORTAL_CLIENT_SECRET,
    baseUrl: process.env.TIMESHEET_PORTAL_BASE_URL,
  };
  const originalFetch = global.fetch;

  process.env.TIMESHEET_PORTAL_API_TOKEN = 'raw-token';
  process.env.TIMESHEET_PORTAL_CLIENT_ID = 'client-id-fallback';
  process.env.TIMESHEET_PORTAL_CLIENT_SECRET = 'client-secret-fallback';
  process.env.TIMESHEET_PORTAL_BASE_URL = 'https://brightwater.api.timesheetportal.test';

  global.fetch = async (url, options = {}) => {
    if (String(url) === 'https://brightwater.api.timesheetportal.test/oauth/token') {
      return {
        ok: false,
        status: 401,
        json: async () => ({ error_description: 'Invalid credentials' }),
      };
    }
    if (String(url) === 'https://brightwater.api.timesheetportal.test/users?page=1') {
      const auth = options.headers.authorization;
      if (auth === 'raw-token') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ id: 'u1', firstName: 'Legacy', lastName: 'Token', email: 'legacy@example.com' }]),
        };
      }
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: 'unauthorized' }),
      };
    }
    if (String(url) === 'https://brightwater.api.timesheetportal.test/users?page=2') {
      return {
        ok: true,
        status: 200,
        text: async () => '[]',
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  try {
    const result = await listTimesheetPortalContractors(readTimesheetPortalConfig(), { take: 5 });
    assert.equal(result.discovery.candidatePath, '/users');
    assert.equal(result.discovery.auth.scheme, 'token');
    assert.equal(result.contractors[0].email, 'legacy@example.com');
  } finally {
    global.fetch = originalFetch;
    restoreEnv('TIMESHEET_PORTAL_API_TOKEN', previous.apiToken);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_ID', previous.clientId);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_SECRET', previous.clientSecret);
    restoreEnv('TIMESHEET_PORTAL_BASE_URL', previous.baseUrl);
  }
});
