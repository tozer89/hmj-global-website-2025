const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  compareCandidates,
  listTimesheetPortalAssignments,
  listTimesheetPortalContractors,
  normalizeTimesheetPortalAssignment,
  readTimesheetPortalConfig,
} = require('../netlify/functions/_timesheet-portal.js');

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
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
  assert.equal(result.timesheetPortalCandidates.length, 2);
  assert.equal(result.timesheetPortalCandidates[1].email, 'tsp-only@example.com');
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
    assert.equal(config.candidatePaths[0], '/custom/candidates');
    assert.ok(config.candidatePaths.includes('/users'));
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

test('readTimesheetPortalConfig normalises legacy token paths and trims copied OAuth credentials', () => {
  const previous = {
    clientId: process.env.TIMESHEET_PORTAL_CLIENT_ID,
    clientSecret: process.env.TIMESHEET_PORTAL_CLIENT_SECRET,
    tokenPath: process.env.TIMESHEET_PORTAL_TOKEN_PATH,
  };

  process.env.TIMESHEET_PORTAL_CLIENT_ID = 'client-id\n';
  process.env.TIMESHEET_PORTAL_CLIENT_SECRET = 'secret-value\r\n';
  process.env.TIMESHEET_PORTAL_TOKEN_PATH = '/connect/token';

  try {
    const config = readTimesheetPortalConfig();
    assert.equal(config.clientId, 'client-id');
    assert.equal(config.clientSecret, 'secret-value');
    assert.equal(config.tokenPath, '/oauth/token');
  } finally {
    restoreEnv('TIMESHEET_PORTAL_CLIENT_ID', previous.clientId);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_SECRET', previous.clientSecret);
    restoreEnv('TIMESHEET_PORTAL_TOKEN_PATH', previous.tokenPath);
  }
});

test('readTimesheetPortalConfig includes documented /users endpoint in default candidate discovery paths', () => {
  const config = readTimesheetPortalConfig();
  assert.ok(config.candidatePaths.includes('/users'));
  assert.ok(config.assignmentPaths.includes('/jobs'));
});

test('candidate compare endpoint resolves TSP before loading website rows', () => {
  const source = read('netlify/functions/admin-candidates-timesheet-compare.js');
  assert.doesNotMatch(source, /Promise\.all\(/);
  assert.match(source, /const tspData = await listTimesheetPortalContractors/);
  assert.match(source, /const websiteCandidates = await loadWebsiteCandidates/);
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

test('listTimesheetPortalContractors can fall back to a decoded client id when a copied base64 value is rejected', async () => {
  const previous = {
    apiToken: process.env.TIMESHEET_PORTAL_API_TOKEN,
    clientId: process.env.TIMESHEET_PORTAL_CLIENT_ID,
    clientSecret: process.env.TIMESHEET_PORTAL_CLIENT_SECRET,
    baseUrl: process.env.TIMESHEET_PORTAL_BASE_URL,
  };
  const originalFetch = global.fetch;
  const encodedClientId = Buffer.from('client-id-success', 'utf8').toString('base64');

  process.env.TIMESHEET_PORTAL_API_TOKEN = '';
  process.env.TIMESHEET_PORTAL_CLIENT_ID = encodedClientId;
  process.env.TIMESHEET_PORTAL_CLIENT_SECRET = 'client-secret-success';
  process.env.TIMESHEET_PORTAL_BASE_URL = 'https://brightwater.api.timesheetportal.test';

  global.fetch = async (url, options = {}) => {
    if (String(url) === 'https://brightwater.api.timesheetportal.test/oauth/token') {
      const body = new URLSearchParams(String(options.body || ''));
      if (body.get('client_id') === encodedClientId) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error_description: 'Invalid credentials' }),
        };
      }
      assert.equal(body.get('client_id'), 'client-id-success');
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'oauth-access', expires_in: 3600 }),
      };
    }
    if (String(url) === 'https://brightwater.api.timesheetportal.test/users?page=1') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ id: 'u1', firstName: 'Joe', lastName: 'Tozer', email: 'joe@example.com' }]),
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
    assert.equal(result.contractors.length, 1);
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

test('listTimesheetPortalContractors retries against the Brightwater host when the legacy gb3 host rejects candidate discovery', async () => {
  const previous = {
    apiToken: process.env.TIMESHEET_PORTAL_API_TOKEN,
    clientId: process.env.TIMESHEET_PORTAL_CLIENT_ID,
    clientSecret: process.env.TIMESHEET_PORTAL_CLIENT_SECRET,
    baseUrl: process.env.TIMESHEET_PORTAL_BASE_URL,
    candidateOverride: process.env.TSP_CANDIDATE_PATH_OVERRIDE,
  };
  const originalFetch = global.fetch;

  process.env.TIMESHEET_PORTAL_API_TOKEN = '';
  process.env.TIMESHEET_PORTAL_CLIENT_ID = 'client-id-success';
  process.env.TIMESHEET_PORTAL_CLIENT_SECRET = 'client-secret-success';
  process.env.TIMESHEET_PORTAL_BASE_URL = 'https://gb3.api.timesheetportal.test';
  process.env.TSP_CANDIDATE_PATH_OVERRIDE = '/contractors';

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://gb3.api.timesheetportal.test/oauth/token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'legacy-access', expires_in: 3600 }),
      };
    }
    if (value === 'https://gb3.api.timesheetportal.test/contractors?take=5') {
      assert.equal(options.headers.authorization, 'Bearer legacy-access');
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: 'unauthorized' }),
      };
    }
    if (value === 'https://gb3.api.timesheetportal.test/users?page=1') {
      assert.equal(options.headers.authorization, 'Bearer legacy-access');
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: 'unauthorized' }),
      };
    }
    if (value === 'https://gb3.api.timesheetportal.test/recruitment/candidates?take=5') {
      return { ok: false, status: 404, text: async () => '{}' };
    }
    if (value === 'https://gb3.api.timesheetportal.test/recruitment/contractors?take=5') {
      return { ok: false, status: 404, text: async () => '{}' };
    }
    if (value === 'https://gb3.api.timesheetportal.test/api/recruitment/contractors?take=5') {
      return { ok: false, status: 404, text: async () => '{}' };
    }
    if (value === 'https://brightwater.api.timesheetportal.test/oauth/token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'brightwater-access', expires_in: 3600 }),
      };
    }
    if (value === 'https://brightwater.api.timesheetportal.test/contractors?take=5') {
      assert.equal(options.headers.authorization, 'Bearer brightwater-access');
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: 'unauthorized' }),
      };
    }
    if (value === 'https://brightwater.api.timesheetportal.test/users?page=1') {
      assert.equal(options.headers.authorization, 'Bearer brightwater-access');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ id: 'u1', firstName: 'Bright', lastName: 'Water', email: 'bright@example.com' }]),
      };
    }
    if (value === 'https://brightwater.api.timesheetportal.test/users?page=2') {
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
    assert.equal(result.discovery.baseUrl, 'https://brightwater.api.timesheetportal.test');
    assert.equal(result.discovery.candidatePath, '/users');
    assert.equal(result.contractors[0].email, 'bright@example.com');
  } finally {
    global.fetch = originalFetch;
    restoreEnv('TIMESHEET_PORTAL_API_TOKEN', previous.apiToken);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_ID', previous.clientId);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_SECRET', previous.clientSecret);
    restoreEnv('TIMESHEET_PORTAL_BASE_URL', previous.baseUrl);
    restoreEnv('TSP_CANDIDATE_PATH_OVERRIDE', previous.candidateOverride);
  }
});

test('normalizeTimesheetPortalAssignment maps common Brightwater-style fields', () => {
  const record = normalizeTimesheetPortalAssignment({
    id: 'job-77',
    jobCode: 'AS-77',
    description: 'Electrical Supervisor',
    category: 'Contractor',
    status: 'Active',
    contractorId: '5580',
    contractorName: 'Joseph Tozer',
    contractorEmail: 'TOZER89@gmail.com',
    clientCode: 'DATA-1',
    clientName: 'DataCore Holdings',
    branchName: 'London',
    siteAddress: 'LDN-1 Campus',
    costCentreCode: 'DC-LDN-1',
    iR35Status: 2,
    assignedApproverCodes: ['APR-1', 'APR-2'],
    assignedContractorCodes: ['CTR-1'],
    lastModified: '2026-03-17T10:00:00Z',
    startDate: '2026-03-01T00:00:00Z',
    endDate: '2026-06-30T00:00:00Z',
    payCurrencyCode: 'gbp',
    payRate: 42,
    chargeRate: 60,
  });

  assert.equal(record.id, 'job-77');
  assert.equal(record.reference, 'AS-77');
  assert.equal(record.title, 'Electrical Supervisor');
  assert.equal(record.status, 'live');
  assert.equal(record.contractorId, '5580');
  assert.equal(record.candidateName, 'Joseph Tozer');
  assert.equal(record.candidateEmail, 'tozer89@gmail.com');
  assert.equal(record.clientCode, 'DATA-1');
  assert.equal(record.clientName, 'DataCore Holdings');
  assert.equal(record.assignmentCategory, 'Contractor');
  assert.equal(record.branchName, 'London');
  assert.equal(record.clientSite, 'LDN-1 Campus');
  assert.equal(record.costCentre, 'DC-LDN-1');
  assert.equal(record.ir35Status, 'N/A');
  assert.deepEqual(record.assignedApproverCodes, ['APR-1', 'APR-2']);
  assert.deepEqual(record.assignedContractorCodes, ['CTR-1']);
  assert.equal(record.lastModified, '2026-03-17T10:00:00Z');
  assert.equal(record.startDate, '2026-03-01');
  assert.equal(record.endDate, '2026-06-30');
  assert.equal(record.currency, 'GBP');
  assert.equal(record.ratePay, 42);
  assert.equal(record.rateCharge, 60);
});

test('listTimesheetPortalAssignments discovers /jobs and returns normalized rows', async () => {
  const previous = {
    apiToken: process.env.TIMESHEET_PORTAL_API_TOKEN,
    clientId: process.env.TIMESHEET_PORTAL_CLIENT_ID,
    clientSecret: process.env.TIMESHEET_PORTAL_CLIENT_SECRET,
    baseUrl: process.env.TIMESHEET_PORTAL_BASE_URL,
  };
  const originalFetch = global.fetch;

  process.env.TIMESHEET_PORTAL_API_TOKEN = 'raw-token';
  process.env.TIMESHEET_PORTAL_CLIENT_ID = '';
  process.env.TIMESHEET_PORTAL_CLIENT_SECRET = '';
  process.env.TIMESHEET_PORTAL_BASE_URL = 'https://brightwater.api.timesheetportal.test';

  global.fetch = async (url, options = {}) => {
    if (String(url) === 'https://brightwater.api.timesheetportal.test/jobs?take=5') {
      assert.equal(options.headers.authorization, 'raw-token');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ id: 'job-1', jobCode: 'AS-1', description: 'Planner', status: 'Live', contractorName: 'Joe Tozer' }]),
      };
    }
    if (String(url) === 'https://brightwater.api.timesheetportal.test/jobs?take=500') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ id: 'job-1', jobCode: 'AS-1', description: 'Planner', status: 'Live', contractorName: 'Joe Tozer' }]),
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  try {
    const result = await listTimesheetPortalAssignments(readTimesheetPortalConfig(), { take: 500, pageLimit: 1 });
    assert.equal(result.discovery.assignmentPath, '/jobs');
    assert.equal(result.assignments.length, 1);
    assert.equal(result.assignments[0].reference, 'AS-1');
    assert.equal(result.assignments[0].title, 'Planner');
    assert.equal(result.assignments[0].candidateName, 'Joe Tozer');
  } finally {
    global.fetch = originalFetch;
    restoreEnv('TIMESHEET_PORTAL_API_TOKEN', previous.apiToken);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_ID', previous.clientId);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_SECRET', previous.clientSecret);
    restoreEnv('TIMESHEET_PORTAL_BASE_URL', previous.baseUrl);
  }
});
