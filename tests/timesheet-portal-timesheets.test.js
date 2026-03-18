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
    TimesheetWeekStart: '09/03/2026 00:00:00',
    TimesheetWeekEnd: '15/03/2026 00:00:00',
    EmployeeName: 'Joseph Tozer',
    EmployeeEmailAddress: 'tozer89@gmail.com',
    EmployeeAccountingReference: '5580',
    ChargeCode: 'ACEHULL-4434',
    ChargeCodeDesc: 'Assistant Project Manager',
    CompanyName: 'A+C Electrical Ltd',
    ApproverName: 'Laura Miles',
    StandardHours: 40,
    OvertimeHours: 6,
    Status: 'Submitted',
    SubmitDate: '15/03/2026 09:10:00',
    ApprovalDate: '',
    TimesheetNotes: 'Waiting on approval',
    TimesheetContainsAttachment: true,
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
  assert.equal(row.submittedAt, '2026-03-15');
  assert.equal(row.totals.standardHours, 40);
  assert.equal(row.totals.overtimeHours, 6);
  assert.equal(row.totals.hours, 46);
  assert.equal(row.attachmentCount, 1);
});

test('listTimesheetPortalTimesheets prefers the timesheet report and normalizes rows', async () => {
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

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value === 'https://gb3.api.timesheetportal.test/oauth/token' || value === 'https://brightwater.api.timesheetportal.test/oauth/token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'oauth-access', expires_in: 3600 }),
      };
    }
    if (value === 'https://gb3.api.timesheetportal.test/reports/timesheets' || value === 'https://brightwater.api.timesheetportal.test/reports/timesheets') {
      assert.equal(options.method, 'POST');
      const payload = JSON.parse(String(options.body || '{}'));
      assert.equal(payload.reportTimeGrouping, 'Timesheet');
      assert.deepEqual(payload.reportFields.slice(0, 4), [
        'TimesheetId',
        'TimesheetWeekStart',
        'TimesheetWeekEnd',
        'EmployeeName',
      ]);
      assert.equal(payload.startDate, '2026-03-01');
      assert.equal(payload.endDate, '2026-03-31');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          [
            'TimesheetId',
            'TimesheetWeekStart',
            'TimesheetWeekEnd',
            'EmployeeName',
            'EmployeeAccountingReference',
            'CompanyName',
            'ChargeCode',
            'ChargeCodeDesc',
            'EntryQuantity',
            'Status',
          ],
          [
            'TS-1',
            '2026-03-09',
            '2026-03-15',
            'Jordan Smith',
            '8842',
            'BluePeak Pharma',
            'AS-99',
            'Package Manager',
            40,
            'Approved',
          ],
          [
            'TS-2',
            '2026-03-16',
            '2026-03-22',
            'Clare Singh',
            '9911',
            'BluePeak Pharma',
            'AS-100',
            'Planner',
            38,
            'Submitted',
          ],
        ]),
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  try {
    const result = await listTimesheetPortalTimesheets(readTimesheetPortalConfig(), {
      fromDate: '2026-03-01',
      toDate: '2026-03-31',
    });

    assert.equal(result.discovery.timesheetPath, '/reports/timesheets');
    assert.equal(result.discovery.mode, 'report');
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

test('listTimesheetPortalTimesheets falls back to /v2/rec/timesheets if the report path is unavailable', async () => {
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
    if (value === 'https://gb3.api.timesheetportal.test/reports/timesheets') {
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ Message: 'Not found' }),
      };
    }
    if (value === 'https://gb3.api.timesheetportal.test/v2/rec/timesheets?take=2') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          {
            TimesheetId: 'TS-9',
            TimesheetWeekEnd: '2026-03-29',
            EmployeeName: 'Fallback Person',
            EntryQuantity: 12,
            Status: 'Submitted',
          },
        ]),
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  try {
    const result = await listTimesheetPortalTimesheets(readTimesheetPortalConfig(), {
      take: 2,
      pageLimit: 1,
    });

    assert.equal(result.rows.length, 1);
    assert.equal(result.discovery.timesheetPath, '/v2/rec/timesheets');
    assert.equal(calls.filter((value) => value.includes('/reports/timesheets')).length, 1);
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
