const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listTimesheetPortalPayroll,
  normalizeTimesheetPortalPayrollRecord,
  readTimesheetPortalConfig,
} = require('../netlify/functions/_timesheet-portal.js');

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('normalizeTimesheetPortalPayrollRecord maps self-billing invoice fields into payroll rows', () => {
  const row = normalizeTimesheetPortalPayrollRecord({
    TimesheetId: 'TS-44',
    TimesheetWeekEnd: '2026-03-14',
    EmployeeName: 'Joseph Tozer',
    EmployeeAccountingReference: '5580',
    CompanyName: 'HMJ Global',
    ChargeCode: 'AS-10',
    ChargeCodeDesc: 'Planner',
    PurchaseOrder: 'PO-77',
    CostCentreCode: 'CC-12',
    EntryQuantity: 42,
    TotalPay: 3150,
    TotalCharge: 4620,
    PayCurrencyIsoSymbol: 'GBP',
    SelfBillingInvoiceNumber: 'SB-1001',
    SelfBillingInvoiceDate: '2026-03-15',
    SelfBillingInvoiceTotalNet: 3150,
    SelfBillingInvoiceTotalTax: 630,
    InvoiceStatus: 'Processing',
    InvoicePaidDate: '',
    InvoiceSelfBilling: true,
  });

  assert.equal(row.id, 'TS-44');
  assert.equal(row.weekEnding, '2026-03-14');
  assert.equal(row.candidateName, 'Joseph Tozer');
  assert.equal(row.payrollRef, '5580');
  assert.equal(row.clientName, 'HMJ Global');
  assert.equal(row.assignmentRef, 'AS-10');
  assert.equal(row.jobTitle, 'Planner');
  assert.equal(row.poNumber, 'PO-77');
  assert.equal(row.costCentre, 'CC-12');
  assert.equal(row.totals.hours, 42);
  assert.equal(row.totals.pay, 3150);
  assert.equal(row.totals.charge, 4620);
  assert.equal(row.selfBillingInvoiceNumber, 'SB-1001');
  assert.equal(row.invoiceSelfBilling, true);
  assert.equal(row.payrollStatus, 'processing');
});

test('listTimesheetPortalPayroll parses matrix report payloads from /reports/timesheets', async () => {
  const previous = {
    apiToken: process.env.TIMESHEET_PORTAL_API_TOKEN,
    clientId: process.env.TIMESHEET_PORTAL_CLIENT_ID,
    clientSecret: process.env.TIMESHEET_PORTAL_CLIENT_SECRET,
    baseUrl: process.env.TIMESHEET_PORTAL_BASE_URL,
  };
  const originalFetch = global.fetch;

  process.env.TIMESHEET_PORTAL_API_TOKEN = '';
  process.env.TIMESHEET_PORTAL_CLIENT_ID = 'payroll-client';
  process.env.TIMESHEET_PORTAL_CLIENT_SECRET = 'payroll-secret';
  process.env.TIMESHEET_PORTAL_BASE_URL = 'https://gb3.api.timesheetportal.test';

  global.fetch = async (url, options = {}) => {
    if (String(url) === 'https://gb3.api.timesheetportal.test/oauth/token') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'oauth-access', expires_in: 3600 }),
      };
    }
    if (String(url) === 'https://gb3.api.timesheetportal.test/reports/timesheets') {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.authorization, 'Bearer oauth-access');
      const payload = JSON.parse(String(options.body || '{}'));
      assert.equal(payload.reportTimeGrouping, 'Timesheet');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          [
            'TimesheetId',
            'TimesheetWeekEnd',
            'EmployeeName',
            'EmployeeAccountingReference',
            'CompanyName',
            'ChargeCode',
            'ChargeCodeDesc',
            'PurchaseOrder',
            'EntryQuantity',
            'TotalPay',
            'TotalCharge',
            'SelfBillingInvoiceNumber',
            'SelfBillingInvoiceDate',
            'InvoiceStatus',
            'InvoiceSelfBilling',
          ],
          [
            'TS-55',
            '2026-03-21',
            'Jordan Smith',
            '8842',
            'BluePeak Pharma',
            'AS-99',
            'Package Manager',
            'PO-99',
            40,
            2800,
            4160,
            'SB-2001',
            '2026-03-22',
            'Ready',
            true,
          ],
        ]),
      };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  try {
    const result = await listTimesheetPortalPayroll(readTimesheetPortalConfig(), {
      fromDate: '2026-03-01',
      toDate: '2026-03-31',
    });

    assert.equal(result.discovery.payrollPath, '/reports/timesheets');
    assert.equal(result.discovery.mode, 'report');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].id, 'TS-55');
    assert.equal(result.rows[0].candidateName, 'Jordan Smith');
    assert.equal(result.rows[0].assignmentRef, 'AS-99');
    assert.equal(result.rows[0].selfBillingInvoiceNumber, 'SB-2001');
    assert.equal(result.rows[0].payrollStatus, 'processing');
  } finally {
    global.fetch = originalFetch;
    restoreEnv('TIMESHEET_PORTAL_API_TOKEN', previous.apiToken);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_ID', previous.clientId);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_SECRET', previous.clientSecret);
    restoreEnv('TIMESHEET_PORTAL_BASE_URL', previous.baseUrl);
  }
});

test('listTimesheetPortalPayroll stops after a successful oauth empty result instead of retrying stale api tokens', async () => {
  const previous = {
    enabled: process.env.TIMESHEET_PORTAL_ENABLED,
    apiToken: process.env.TIMESHEET_PORTAL_API_TOKEN,
    clientId: process.env.TIMESHEET_PORTAL_CLIENT_ID,
    clientSecret: process.env.TIMESHEET_PORTAL_CLIENT_SECRET,
    baseUrl: process.env.TIMESHEET_PORTAL_BASE_URL,
  };
  const originalFetch = global.fetch;
  const calls = [];

  process.env.TIMESHEET_PORTAL_ENABLED = 'true';
  process.env.TIMESHEET_PORTAL_API_TOKEN = 'stale-token';
  process.env.TIMESHEET_PORTAL_CLIENT_ID = 'payroll-client';
  process.env.TIMESHEET_PORTAL_CLIENT_SECRET = 'payroll-secret';
  process.env.TIMESHEET_PORTAL_BASE_URL = 'https://gb3.api.timesheetportal.test';

  global.fetch = async (url, options = {}) => {
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
        ok: true,
        status: 200,
        text: async () => JSON.stringify([['TimesheetId'],]),
      };
    }
    if (value === 'https://gb3.api.timesheetportal.test/timesheets') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      };
    }
    if (value === 'https://gb3.api.timesheetportal.test/v2/rec/timesheets?take=500') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([]),
      };
    }
    throw new Error(`Unexpected fetch ${url} ${options.method || 'GET'}`);
  };

  try {
    const result = await listTimesheetPortalPayroll(readTimesheetPortalConfig(), {});
    assert.equal(result.rows.length, 0);
    assert.equal(calls.filter((value) => value.includes('/reports/timesheets')).length, 1);
    assert.equal(calls.filter((value) => value.includes('/v2/rec/timesheets')).length, 1);
  } finally {
    global.fetch = originalFetch;
    restoreEnv('TIMESHEET_PORTAL_ENABLED', previous.enabled);
    restoreEnv('TIMESHEET_PORTAL_API_TOKEN', previous.apiToken);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_ID', previous.clientId);
    restoreEnv('TIMESHEET_PORTAL_CLIENT_SECRET', previous.clientSecret);
    restoreEnv('TIMESHEET_PORTAL_BASE_URL', previous.baseUrl);
  }
});
