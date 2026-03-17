const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listTimesheetPortalTimesheets,
  normalizeTimesheetPortalTimesheetRecord,
  readTimesheetPortalConfig,
} = require('../netlify/functions/_timesheet-portal.js');

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('normalizeTimesheetPortalTimesheetRecord maps a TSP timesheet-management row into admin shape', () => {
  const row = normalizeTimesheetPortalTimesheetRecord({
    TimesheetId: 'TS-201',
    TimesheetWeekStart: '2026-03-09',
    TimesheetWeekEnd: '2026-03-15',
    EmployeeName: 'Joseph Tozer',
    EmployeeEmail: 'tozer89@gmail.com',
    EmployeeAccountingReference: '5580',
    ChargeCode: 'ACEHULL-4434',
    ChargeCodeDesc: 'Assistant Project Manager',
    CompanyName: 'A+C Electrical Ltd',
    ApproverName: 'Laura Miles',
    StandardHours: 40,
    OvertimeHours: 6,
    Status: 'Submitted',
    Notes: 'Waiting on approval',
    AttachmentCount: 2,
  });

  assert.equal(row.id, 'TS-201');
  assert.equal(row.weekStart, '2026-03-09');
  assert.equal(row.weekEnding, '2026-03-15');
  assert.equal(row.candidateName, 'Joseph Tozer');
  assert.equal(row.candidateEmail, 'tozer89@gmail.com');
  assert.equal(row.payrollRef, '5580');
  assert.equal(row.assignmentRef, 'ACEHULL-4434');
  assert.equal(row.jobTitle, 'Assistant Project Manager');
  assert.equal(row.clientName, 'A+C Electrical Ltd');
  assert.equal(row.approverName, 'Laura Miles');
  assert.equal(row.status, 'submitted');
  assert.equal(row.totals.standardHours, 40);
  assert.equal(row.totals.overtimeHours, 6);
  assert.equal(row.totals.hours, 46);
  assert.equal(row.attachmentCount, 2);
});

test('listTimesheetPortalTimesheets pages through /v2/rec/timesheets and normalizes rows', async () => {
  const previous = {
    clientId: process.env.TIMESHEET_PORTAL_CLIENT_ID,
    clientSecret: process.env.TIMESHEET_PORTAL_CLIENT_SECRET,
    baseUrl: process.env.TIMESHEET_PORTAL_BASE_URL,
    enabled: process.env.TIMESHEET_PORTAL_ENABLED,
    tokenPath: process.env.TIMESHEET_PORTAL_TOKEN_PATH,
  };
  const originalFetch = global.fetch;

  process.env.TIMESHEET_PORTAL_ENABLED = 'true';
  process.env.TIMESHEET_PORTAL_CLIENT_ID = 'timesheet-client';
  process.env.TIMESHEET_PORTAL_CLIENT_SECRET = 'timesheet-secret';
  process.env.TIMESHEET_PORTAL_BASE_URL = 'https://gb3.api.timesheetportal.test';
  process.env.TIMESHEET_PORTAL_TOKEN_PATH = '/oauth/token';

  global.fetch = async (url) => {
    const value = String(url);
    if (value === 'https://gb3.api.timesheetportal.test/oauth/token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'oauth-access', expires_in: 3600 }),
      };
    }
    if (value === 'https://gb3.api.timesheetportal.test/v2/rec/timesheets?take=2') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          {
            TimesheetId: 'TS-1',
            TimesheetWeekEnd: '2026-03-15',
            EmployeeName: 'Jordan Smith',
            EmployeeAccountingReference: '8842',
            ChargeCode: 'AS-99',
            ChargeCodeDesc: 'Package Manager',
            CompanyName: 'BluePeak Pharma',
            EntryQuantity: 40,
            Status: 'Approved',
          },
          {
            TimesheetId: 'TS-2',
            TimesheetWeekEnd: '2026-03-22',
            EmployeeName: 'Clare Singh',
            EmployeeAccountingReference: '9911',
            ChargeCode: 'AS-100',
            ChargeCodeDesc: 'Planner',
            CompanyName: 'BluePeak Pharma',
            EntryQuantity: 38,
            Status: 'Submitted',
          },
        ]),
      };
    }
    if (value === 'https://gb3.api.timesheetportal.test/v2/rec/timesheets?take=2&page=2') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  try {
    const result = await listTimesheetPortalTimesheets(readTimesheetPortalConfig(), {
      take: 2,
      pageLimit: 3,
    });

    assert.equal(result.discovery.timesheetPath, '/v2/rec/timesheets');
    assert.equal(result.discovery.mode, 'timesheets');
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].id, 'TS-1');
    assert.equal(result.rows[0].status, 'approved');
    assert.equal(result.rows[1].status, 'submitted');
  } finally {
    global.fetch = originalFetch;
    restoreEnv('TIMESHEET_PORTAL_CLIENT_ID', previous.clientId);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_SECRET', previous.clientSecret);
    restoreEnv('TIMESHEET_PORTAL_BASE_URL', previous.baseUrl);
    restoreEnv('TIMESHEET_PORTAL_ENABLED', previous.enabled);
    restoreEnv('TIMESHEET_PORTAL_TOKEN_PATH', previous.tokenPath);
  }
});

test('listTimesheetPortalTimesheets stops after a successful oauth empty result instead of retrying stale api tokens', async () => {
  const previous = {
    enabled: process.env.TIMESHEET_PORTAL_ENABLED,
    clientId: process.env.TIMESHEET_PORTAL_CLIENT_ID,
    clientSecret: process.env.TIMESHEET_PORTAL_CLIENT_SECRET,
    apiToken: process.env.TIMESHEET_PORTAL_API_TOKEN,
    baseUrl: process.env.TIMESHEET_PORTAL_BASE_URL,
    tokenPath: process.env.TIMESHEET_PORTAL_TOKEN_PATH,
  };
  const originalFetch = global.fetch;
  const calls = [];

  process.env.TIMESHEET_PORTAL_ENABLED = 'true';
  process.env.TIMESHEET_PORTAL_CLIENT_ID = 'timesheet-client';
  process.env.TIMESHEET_PORTAL_CLIENT_SECRET = 'timesheet-secret';
  process.env.TIMESHEET_PORTAL_API_TOKEN = 'stale-token';
  process.env.TIMESHEET_PORTAL_BASE_URL = 'https://gb3.api.timesheetportal.test';
  process.env.TIMESHEET_PORTAL_TOKEN_PATH = '/oauth/token';

  global.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value === 'https://gb3.api.timesheetportal.test/oauth/token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'oauth-access', expires_in: 3600 }),
      };
    }
    if (value === 'https://gb3.api.timesheetportal.test/v2/rec/timesheets?take=2') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  try {
    const result = await listTimesheetPortalTimesheets(readTimesheetPortalConfig(), {
      take: 2,
      pageLimit: 1,
    });

    assert.equal(result.rows.length, 0);
    assert.equal(calls.filter((value) => value.includes('/v2/rec/timesheets')).length, 1);
  } finally {
    global.fetch = originalFetch;
    restoreEnv('TIMESHEET_PORTAL_ENABLED', previous.enabled);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_ID', previous.clientId);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_SECRET', previous.clientSecret);
    restoreEnv('TIMESHEET_PORTAL_API_TOKEN', previous.apiToken);
    restoreEnv('TIMESHEET_PORTAL_BASE_URL', previous.baseUrl);
    restoreEnv('TIMESHEET_PORTAL_TOKEN_PATH', previous.tokenPath);
  }
});
