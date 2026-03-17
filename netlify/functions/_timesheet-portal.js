'use strict';

const DEFAULT_BASE_URL = 'https://gb3.api.timesheetportal.com';
const DEFAULT_TOKEN_PATH = '/oauth/token';
const DEFAULT_CANDIDATE_PATHS = [
  '/users',
  '/recruitment/candidates',
  '/contractors',
  '/recruitment/contractors',
  '/api/recruitment/contractors',
];
const DEFAULT_ASSIGNMENT_PATHS = [
  '/jobs',
  '/placements',
  '/recruitment/placements',
  '/assignments',
  '/recruitment/assignments',
  '/engagements',
  '/contracts',
  '/bookings',
  '/jobassignments',
  '/roles',
  '/api/recruitment/placements',
  '/api/v1/recruitment/placements',
  '/api/recruitment/assignments',
  '/api/v1/assignments',
  '/api/v1/recruitment/assignments',
];
const DEFAULT_PAYROLL_REPORT_PATHS = [
  '/reports/timesheets',
  '/timesheets',
];
const DEFAULT_TIMESHEET_LIST_PATHS = [
  '/v2/rec/timesheets',
];
const DEFAULT_PAYROLL_REPORT_FIELDS = [
  'TimesheetId',
  'TimesheetWeekEnd',
  'EmployeeName',
  'EmployeeReference',
  'EmployeeAccountingReference',
  'CompanyName',
  'ChargeCode',
  'ChargeCodeDesc',
  'PurchaseOrder',
  'CostCentreCode',
  'EntryQuantity',
  'TotalPay',
  'TotalCharge',
  'PayCurrencyIsoSymbol',
  'ChargeCurrencyIsoSymbol',
  'SelfBillingInvoiceNumber',
  'SelfBillingInvoiceDate',
  'SelfBillingInvoiceTotalNet',
  'SelfBillingInvoiceTotalTax',
  'InvoiceNumberText',
  'InvoiceDate',
  'InvoiceStatus',
  'InvoicePaidDate',
  'InvoiceSelfBilling',
];

let cachedToken = null;

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function lowerEmail(value) {
  const email = trimString(value, 320);
  return email ? email.toLowerCase() : '';
}

function normalizeCredential(value) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, '').trim();
}

function normalizeBaseUrl(value) {
  return trimString(value || DEFAULT_BASE_URL, 2000).replace(/\/+$/, '') || DEFAULT_BASE_URL;
}

function joinUrl(baseUrl, path) {
  const base = normalizeBaseUrl(baseUrl);
  const target = trimString(path, 2000);
  if (!target) return base;
  if (/^https?:\/\//i.test(target)) return target;
  return `${base}${target.startsWith('/') ? '' : '/'}${target}`;
}

function truthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function uniquePaths(...groups) {
  const seen = new Set();
  const out = [];
  groups.flat().forEach((value) => {
    const path = trimString(value, 240);
    if (!path || seen.has(path)) return;
    seen.add(path);
    out.push(path);
  });
  return out;
}

function firstEnv(...values) {
  for (const value of values) {
    const text = normalizeCredential(value).slice(0, 4000);
    if (text) return text;
  }
  return '';
}

function normalizeTokenPath(value) {
  const tokenPath = trimString(value, 240);
  if (!tokenPath || tokenPath === '/connect/token' || tokenPath === '/connect/token/') {
    return DEFAULT_TOKEN_PATH;
  }
  return tokenPath;
}

function readTimesheetPortalConfig() {
  const baseUrl = normalizeBaseUrl(firstEnv(
    process.env.TIMESHEET_PORTAL_BASE_URL,
    process.env.TSP_BASE_URL,
    DEFAULT_BASE_URL,
  ));
  const resourceBaseUrl = normalizeBaseUrl(firstEnv(
    process.env.TIMESHEET_PORTAL_RESOURCE_BASE_URL_OVERRIDE,
    process.env.TSP_RESOURCE_BASE_URL_OVERRIDE,
    baseUrl,
  ));
  const clientId = firstEnv(
    process.env.TIMESHEET_PORTAL_CLIENT_ID,
    process.env.TSP_OAUTH_CLIENT_ID,
  );
  const clientSecret = firstEnv(
    process.env.TIMESHEET_PORTAL_CLIENT_SECRET,
    process.env.TSP_OAUTH_CLIENT_SECRET,
  );
  const apiToken = firstEnv(
    process.env.TIMESHEET_PORTAL_API_TOKEN,
    process.env.TSP_API_KEY,
  );
  const tokenPath = normalizeTokenPath(firstEnv(
    process.env.TIMESHEET_PORTAL_TOKEN_PATH,
    process.env.TSP_TOKEN_URL,
    DEFAULT_TOKEN_PATH,
  )) || DEFAULT_TOKEN_PATH;
  const scope = trimString(firstEnv(
    process.env.TIMESHEET_PORTAL_SCOPE,
    process.env.TSP_SCOPE,
  ), 240);
  const configuredPaths = [
    trimString(firstEnv(process.env.TIMESHEET_PORTAL_CANDIDATE_PATH_OVERRIDE, process.env.TSP_CANDIDATE_PATH_OVERRIDE), 240),
    trimString(firstEnv(process.env.TIMESHEET_PORTAL_CANDIDATE_PATH, process.env.TSP_CANDIDATE_PATH), 240),
  ].filter(Boolean);
  const candidatePaths = configuredPaths.length
    ? uniquePaths(configuredPaths, DEFAULT_CANDIDATE_PATHS)
    : DEFAULT_CANDIDATE_PATHS;
  const configuredAssignmentPaths = [
    trimString(firstEnv(
      process.env.TIMESHEET_PORTAL_ASSIGNMENT_PATH_OVERRIDE,
      process.env.TSP_ASSIGNMENT_PATH_OVERRIDE,
      process.env.TIMESHEET_PORTAL_PLACEMENT_PATH_OVERRIDE,
      process.env.TSP_PLACEMENT_PATH_OVERRIDE,
    ), 240),
    trimString(firstEnv(
      process.env.TIMESHEET_PORTAL_ASSIGNMENT_PATH,
      process.env.TSP_ASSIGNMENT_PATH,
      process.env.TIMESHEET_PORTAL_PLACEMENT_PATH,
      process.env.TSP_PLACEMENT_PATH,
    ), 240),
  ].filter(Boolean);
  const assignmentPaths = configuredAssignmentPaths.length
    ? uniquePaths(configuredAssignmentPaths, DEFAULT_ASSIGNMENT_PATHS)
    : DEFAULT_ASSIGNMENT_PATHS;
  const enabled = truthyEnv(firstEnv(process.env.TIMESHEET_PORTAL_ENABLED, process.env.TSP_ENABLED)) || !!apiToken || (!!clientId && !!clientSecret);

  return {
    enabled,
    configured: !!apiToken || (!!clientId && !!clientSecret),
    baseUrl,
    resourceBaseUrl,
    clientId,
    clientSecret,
    apiToken,
    tokenPath,
    scope,
    candidatePaths,
    assignmentPaths,
  };
}

function authHeaders(auth) {
  const token = trimString(auth?.token, 8000);
  const scheme = trimString(auth?.scheme, 40).toLowerCase();
  return {
    accept: 'application/json',
    authorization: scheme === 'bearer' ? `Bearer ${token}` : token,
  };
}

async function getBearerToken(config) {
  if (!config.clientId || !config.clientSecret) {
    const error = new Error('Timesheet Portal credentials are not configured.');
    error.code = 'timesheet_portal_not_configured';
    throw error;
  }
  const cacheKey = JSON.stringify([config.baseUrl, config.tokenPath, config.clientId, config.clientSecret, config.scope || '']);
  if (cachedToken && cachedToken.key === cacheKey && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  body.set('client_id', config.clientId);
  body.set('client_secret', config.clientSecret);
  if (config.scope) body.set('scope', config.scope);

  const response = await fetch(joinUrl(config.baseUrl, config.tokenPath), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !trimString(data.access_token, 8000)) {
    const error = new Error(data?.error_description || data?.message || `Timesheet Portal token request failed (${response.status})`);
    error.code = 'timesheet_portal_token_failed';
    error.status = response.status;
    throw error;
  }
  const expiresIn = Math.max(120, Number(data.expires_in) || 900);
  cachedToken = {
    key: cacheKey,
    value: trimString(data.access_token, 8000),
    expiresAt: Date.now() + ((expiresIn - 60) * 1000),
  };
  return cachedToken.value;
}

async function getAuthCandidates(config) {
  const auths = [];
  let oauthError = null;

  if (config.clientId && config.clientSecret) {
    try {
      const token = await getBearerToken(config);
      auths.push({ scheme: 'bearer', token, source: 'oauth' });
    } catch (error) {
      oauthError = error;
    }
  }

  if (config.apiToken) {
    auths.push({ scheme: 'token', token: config.apiToken, source: 'api_token' });
    auths.push({ scheme: 'bearer', token: config.apiToken, source: 'api_token_bearer' });
  }

  if (!auths.length && oauthError) throw oauthError;
  return { auths, oauthError };
}

async function fetchJson(url, auth) {
  const response = await fetch(url, {
    method: 'GET',
    headers: authHeaders(auth),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
}

async function postJson(url, auth, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(auth),
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
}

function extractCollection(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const keys = ['items', 'results', 'data', 'candidates', 'contractors', 'value'];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function extractTabularRows(payload) {
  if (Array.isArray(payload) && payload.every((row) => Array.isArray(row))) {
    return payload;
  }
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.rows) && payload.rows.every((row) => Array.isArray(row))) {
      return payload.rows;
    }
    if (Array.isArray(payload.data) && payload.data.every((row) => Array.isArray(row))) {
      return payload.data;
    }
  }
  return [];
}

function tableRowsToRecords(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const header = Array.isArray(rows[0]) ? rows[0] : [];
  const normalizedHeader = header.map((cell, index) => trimString(cell, 120) || `column_${index + 1}`);
  if (!normalizedHeader.length) return [];
  const looksLikeHeader = normalizedHeader.some((cell) => /[a-z]/i.test(cell));
  if (!looksLikeHeader) return [];
  return rows
    .slice(1)
    .filter((row) => Array.isArray(row) && row.some((cell) => trimString(cell, 40)))
    .map((row) => {
      const record = {};
      normalizedHeader.forEach((key, index) => {
        record[key] = row[index] ?? null;
      });
      return record;
    });
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  const raw = trimString(value, 32).toLowerCase();
  if (!raw) return null;
  if (['true', '1', 'yes', 'y'].includes(raw)) return true;
  if (['false', '0', 'no', 'n'].includes(raw)) return false;
  return null;
}

function splitName(value) {
  const full = trimString(value, 240);
  if (!full) return { firstName: '', lastName: '' };
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts.slice(-1).join(' '),
  };
}

function normalizeContractor(record = {}) {
  const name = trimString(record.name || record.fullName, 240);
  const split = splitName(name);
  return {
    id: trimString(record.id || record.guid || record.contractorId || record.candidateId, 120),
    reference: trimString(
      record.reference
      || record.contractorCode
      || record.userCode
      || record.code
      || record.candidateCode,
      120,
    ),
    accountingReference: trimString(record.accountingReference || record.payrollReference, 120),
    firstName: trimString(record.firstName || record.firstname || record.first_name || split.firstName, 120),
    lastName: trimString(record.lastName || record.lastname || record.last_name || record.surname || split.lastName, 120),
    email: lowerEmail(record.email || record.emailAddress || record.contactEmail || record.personalEmail || record.workEmail),
    mobile: trimString(record.mobile || record.mobilePhone || record.phone || record.telephone, 80),
    raw: record,
  };
}

function buildPagedUrl(baseUrl, candidatePath, options = {}) {
  const cleanPath = trimString(candidatePath, 240);
  const queryPath = cleanPath.includes('?') ? cleanPath : cleanPath.startsWith('/users')
    ? `${cleanPath}?page=${Math.max(1, Number(options.page) || 1)}`
    : `${cleanPath}?take=${Math.max(1, Math.min(1000, Number(options.take) || 500))}`;
  return joinUrl(baseUrl, queryPath);
}

function buildCollectionUrl(baseUrl, collectionPath, options = {}) {
  const cleanPath = trimString(collectionPath, 240);
  if (!cleanPath) return joinUrl(baseUrl, '');
  const take = Math.max(1, Math.min(1000, Number(options.take) || 250));
  const page = Math.max(1, Number(options.page) || 1);
  let queryPath = cleanPath;
  if (!/\?/.test(queryPath)) {
    queryPath = `${queryPath}?take=${take}`;
  } else if (!/[?&](take|top|\$top)=/i.test(queryPath)) {
    queryPath = `${queryPath}&take=${take}`;
  }
  if (page > 1 && !/[?&]page=/i.test(queryPath)) {
    queryPath = `${queryPath}&page=${page}`;
  }
  return joinUrl(baseUrl, queryPath);
}

async function discoverCandidatePath(config, authCandidates) {
  const attempts = [];
  for (const auth of authCandidates) {
    for (const path of config.candidatePaths) {
      const cleanPath = trimString(path, 240);
      if (!cleanPath) continue;
      const url = buildPagedUrl(config.resourceBaseUrl, cleanPath, { take: 5, page: 1 });
      const result = await fetchJson(url, auth);
      attempts.push({
        path: cleanPath,
        status: result.response.status,
        authSource: auth.source,
        authScheme: auth.scheme,
      });
      if (result.response.ok) {
        return { candidatePath: cleanPath, auth, attempts };
      }
    }
  }
  const sawUnauthorized = attempts.some((attempt) => Number(attempt.status) === 401 || Number(attempt.status) === 403);
  const error = new Error(sawUnauthorized
    ? 'Timesheet Portal credentials were rejected by the API. Check the Brightwater token/OAuth credentials in Netlify.'
    : 'Timesheet Portal candidate endpoint could not be discovered for this account.');
  error.code = sawUnauthorized ? 'timesheet_portal_auth_failed' : 'timesheet_portal_candidate_path_missing';
  error.attempts = attempts;
  throw error;
}

async function discoverAssignmentPath(config, authCandidates) {
  const attempts = [];
  for (const auth of authCandidates) {
    for (const path of config.assignmentPaths || []) {
      const cleanPath = trimString(path, 240);
      if (!cleanPath) continue;
      const url = buildCollectionUrl(config.resourceBaseUrl, cleanPath, { take: 5, page: 1 });
      const result = await fetchJson(url, auth);
      attempts.push({
        path: cleanPath,
        status: result.response.status,
        authSource: auth.source,
        authScheme: auth.scheme,
      });
      if (result.response.ok) {
        return { assignmentPath: cleanPath, auth, attempts };
      }
    }
  }
  const sawUnauthorized = attempts.some((attempt) => Number(attempt.status) === 401 || Number(attempt.status) === 403);
  const error = new Error(sawUnauthorized
    ? 'Timesheet Portal credentials were rejected by the API. Check the Brightwater token/OAuth credentials in Netlify.'
    : 'Timesheet Portal assignment endpoint could not be discovered for this account.');
  error.code = sawUnauthorized ? 'timesheet_portal_auth_failed' : 'timesheet_portal_assignment_path_missing';
  error.attempts = attempts;
  throw error;
}

function readStringKeys(record = {}, keys = [], maxLength = 240) {
  for (const key of keys) {
    const value = trimString(record?.[key], maxLength);
    if (value) return value;
  }
  return '';
}

function readNumberKeys(record = {}, keys = []) {
  for (const key of keys) {
    const value = record?.[key];
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function toDateOnly(value) {
  const text = trimString(value, 80);
  if (!text) return '';
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeAssignmentStatus(value, activeFlag) {
  const raw = trimString(value, 80).toLowerCase();
  if (raw === 'complete' || raw === 'completed' || raw === 'closed' || raw === 'ended' || raw === 'inactive' || raw === 'finished') {
    return 'complete';
  }
  if (raw === 'pending' || raw === 'future' || raw === 'booked' || raw === 'onboarding') {
    return 'pending';
  }
  if (raw === 'draft' || raw === 'new') {
    return 'draft';
  }
  if (raw === 'live' || raw === 'active' || raw === 'current' || raw === 'open') {
    return 'live';
  }
  if (activeFlag === false) return 'complete';
  if (activeFlag === true) return 'live';
  return raw || 'draft';
}

function normalizeTimesheetPortalAssignment(record = {}) {
  const firstName = readStringKeys(record, ['firstName', 'firstname', 'candidateFirstName', 'contractorFirstName'], 120);
  const lastName = readStringKeys(record, ['lastName', 'lastname', 'surname', 'candidateLastName', 'contractorLastName'], 120);
  const fallbackName = [firstName, lastName].filter(Boolean).join(' ');
  const candidateName = readStringKeys(
    record,
    ['candidateName', 'contractorName', 'workerName', 'employeeName', 'name', 'fullName'],
    240,
  ) || fallbackName;
  const currency = trimString(
    readStringKeys(record, ['currency', 'payCurrencyCode', 'chargeCurrencyCode'], 12) || 'GBP',
    12,
  ).toUpperCase() || 'GBP';
  const activeFlag = typeof record.active === 'boolean'
    ? record.active
    : typeof record.isActive === 'boolean'
      ? record.isActive
      : null;
  const contractorId = readStringKeys(record, ['contractorId', 'candidateId', 'workerId', 'employeeId', 'userId'], 120);
  const contractorCode = readStringKeys(record, ['contractorCode', 'candidateCode', 'contractorRef', 'workerCode'], 120);
  const payrollRef = readStringKeys(record, ['payrollReference', 'accountingReference', 'accountingReferenceCode'], 120);

  return {
    id: readStringKeys(record, ['assignmentId', 'placementId', 'jobId', 'guid', 'id'], 120),
    reference: readStringKeys(record, ['assignmentCode', 'jobCode', 'reference', 'ref', 'code', 'jobRef'], 120),
    title: readStringKeys(record, ['jobTitle', 'title', 'description', 'name', 'role'], 240),
    status: normalizeAssignmentStatus(readStringKeys(record, ['status', 'assignmentStatus', 'state'], 80), activeFlag),
    candidateName: candidateName || '',
    candidateEmail: lowerEmail(record.email || record.candidateEmail || record.contractorEmail || record.workerEmail),
    contractorId,
    contractorCode,
    payrollRef,
    clientCode: readStringKeys(record, ['clientCode', 'customerCode', 'clientRef'], 120),
    clientName: readStringKeys(record, ['clientName', 'customerName', 'client', 'customer'], 240),
    clientSite: readStringKeys(record, ['siteAddress', 'siteName', 'site', 'location', 'address'], 240),
    startDate: toDateOnly(record.startDate || record.assignmentStart || record.start || record.fromDate),
    endDate: toDateOnly(record.endDate || record.assignmentEnd || record.end || record.toDate),
    currency,
    ratePay: readNumberKeys(record, ['ratePay', 'payRate', 'rate_std', 'rateStd', 'pay']),
    rateStd: readNumberKeys(record, ['rateStd', 'rate_std', 'payRate', 'ratePay', 'standardRate']),
    rateCharge: readNumberKeys(record, ['rateCharge', 'chargeRate', 'charge_std', 'chargeStd']),
    chargeStd: readNumberKeys(record, ['chargeStd', 'charge_std', 'chargeRate', 'rateCharge']),
    chargeOt: readNumberKeys(record, ['chargeOt', 'charge_ot', 'overtimeChargeRate']),
    consultantName: readStringKeys(record, ['consultantName', 'recruiterName', 'ownerName', 'accountManager'], 240),
    active: activeFlag === null
      ? normalizeAssignmentStatus(readStringKeys(record, ['status', 'assignmentStatus', 'state'], 80), null) !== 'complete'
      : activeFlag,
    raw: record,
  };
}

function normalizeTimesheetPortalPayrollStatus(record = {}) {
  const invoicePaidDate = toDateOnly(record.InvoicePaidDate || record.invoicePaidDate || record.selfBillingInvoicePaidDate);
  if (invoicePaidDate) return 'paid';
  const raw = readStringKeys(record, ['InvoiceStatus', 'invoiceStatus', 'status'], 80).toLowerCase();
  if (raw.includes('paid')) return 'paid';
  if (raw.includes('hold')) return 'hold';
  if (raw.includes('process')) return 'processing';
  if (raw.includes('pending') || raw.includes('draft')) return 'pending';
  const invoiceNumber = readStringKeys(record, ['SelfBillingInvoiceNumber', 'InvoiceNumberText', 'selfBillingInvoiceNumber', 'invoiceNumberText'], 120);
  if (invoiceNumber) return 'processing';
  const totalPay = readNumberKeys(record, ['TotalPay', 'totalPay', 'payAmount', 'total']);
  if (totalPay !== null && totalPay > 0) return 'ready';
  return 'pending';
}

function normalizeTimesheetPortalTimesheetStatus(record = {}) {
  const raw = readStringKeys(
    record,
    ['TimesheetStatus', 'timesheetStatus', 'ApprovalStatus', 'approvalStatus', 'Status', 'status', 'state'],
    80,
  ).toLowerCase();
  if (raw.includes('approved') || raw.includes('authorised') || raw.includes('authorized') || raw.includes('processed')) return 'approved';
  if (raw.includes('reject') || raw.includes('declin') || raw.includes('returned')) return 'rejected';
  if (raw.includes('submit') || raw.includes('await') || raw.includes('pending')) return 'submitted';
  if (raw.includes('draft') || raw.includes('open') || raw.includes('new')) return 'draft';
  return raw || 'submitted';
}

function normalizeTimesheetPortalPayrollRecord(record = {}) {
  const timesheetId = readStringKeys(record, ['TimesheetId', 'timesheetId', 'id'], 120);
  const invoiceNumber = readStringKeys(record, ['SelfBillingInvoiceNumber', 'selfBillingInvoiceNumber', 'InvoiceNumberText', 'invoiceNumberText'], 120);
  const fallbackId = invoiceNumber || readStringKeys(record, ['InvoiceNumber', 'invoiceNumber'], 120);
  const weekEnding = toDateOnly(record.TimesheetWeekEnd || record.timesheetWeekEnd || record.weekEnding || record.weekEndDate);
  const hours = readNumberKeys(record, ['EntryQuantity', 'entryQuantity', 'TotalHours', 'totalHours', 'hours']);
  const pay = readNumberKeys(record, ['TotalPay', 'totalPay', 'payAmount']);
  const charge = readNumberKeys(record, ['TotalCharge', 'totalCharge', 'chargeAmount']);
  const currency = trimString(
    readStringKeys(record, ['PayCurrencyIsoSymbol', 'ChargeCurrencyIsoSymbol', 'currency'], 12) || 'GBP',
    12,
  ).toUpperCase() || 'GBP';
  const candidateName = readStringKeys(
    record,
    ['EmployeeName', 'employeeName', 'candidateName', 'contractorName', 'workerName', 'name'],
    240,
  );
  const payrollRef = readStringKeys(
    record,
    ['EmployeeAccountingReference', 'employeeAccountingReference', 'EmployeeReference', 'employeeReference', 'payrollReference'],
    120,
  );

  return {
    id: timesheetId || fallbackId,
    timesheetId,
    weekEnding,
    candidateName,
    payrollRef,
    employeeReference: readStringKeys(record, ['EmployeeReference', 'employeeReference'], 120),
    clientName: readStringKeys(record, ['CompanyName', 'companyName', 'clientName', 'customerName'], 240),
    assignmentRef: readStringKeys(record, ['ChargeCode', 'chargeCode', 'jobCode', 'assignmentCode', 'reference'], 120),
    jobTitle: readStringKeys(record, ['ChargeCodeDesc', 'chargeCodeDesc', 'jobTitle', 'title', 'description'], 240),
    poNumber: readStringKeys(record, ['PurchaseOrder', 'purchaseOrder', 'poNumber'], 120),
    costCentre: readStringKeys(record, ['CostCentreCode', 'costCentreCode', 'costCentre'], 120),
    totals: {
      hours: hours === null ? 0 : hours,
      pay: pay === null ? 0 : pay,
      charge: charge === null ? 0 : charge,
    },
    currency,
    selfBillingInvoiceNumber: readStringKeys(record, ['SelfBillingInvoiceNumber', 'selfBillingInvoiceNumber'], 120),
    selfBillingInvoiceDate: toDateOnly(record.SelfBillingInvoiceDate || record.selfBillingInvoiceDate),
    selfBillingInvoiceTotalNet: readNumberKeys(record, ['SelfBillingInvoiceTotalNet', 'selfBillingInvoiceTotalNet']),
    selfBillingInvoiceTotalTax: readNumberKeys(record, ['SelfBillingInvoiceTotalTax', 'selfBillingInvoiceTotalTax']),
    invoiceNumberText: readStringKeys(record, ['InvoiceNumberText', 'invoiceNumberText', 'InvoiceNumber', 'invoiceNumber'], 120),
    invoiceDate: toDateOnly(record.InvoiceDate || record.invoiceDate),
    invoiceStatus: readStringKeys(record, ['InvoiceStatus', 'invoiceStatus', 'status'], 80),
    invoicePaidDate: toDateOnly(record.InvoicePaidDate || record.invoicePaidDate),
    invoiceSelfBilling: normalizeBoolean(record.InvoiceSelfBilling ?? record.invoiceSelfBilling),
    payrollStatus: normalizeTimesheetPortalPayrollStatus(record),
    raw: record,
  };
}

function normalizeTimesheetPortalTimesheetRecord(record = {}) {
  const timesheetId = readStringKeys(record, ['TimesheetId', 'timesheetId', 'guid', 'id'], 120);
  const assignmentRef = readStringKeys(
    record,
    ['ChargeCode', 'chargeCode', 'JobCode', 'jobCode', 'assignmentCode', 'reference', 'ref'],
    120,
  );
  const candidateName = readStringKeys(
    record,
    ['EmployeeName', 'employeeName', 'candidateName', 'contractorName', 'workerName', 'name', 'fullName'],
    240,
  );
  const weekEnding = toDateOnly(
    record.TimesheetWeekEnd
    || record.timesheetWeekEnd
    || record.WeekEnding
    || record.weekEnding
    || record.weekEndDate
  );
  const weekStart = toDateOnly(
    record.TimesheetWeekStart
    || record.timesheetWeekStart
    || record.WeekStart
    || record.weekStart
    || record.weekStartDate
  );
  const standardHours = readNumberKeys(
    record,
    ['StandardHours', 'standardHours', 'StdHours', 'stdHours', 'HoursStd', 'hoursStd', 'RegularHours', 'regularHours'],
  );
  const overtimeHours = readNumberKeys(
    record,
    ['OvertimeHours', 'overtimeHours', 'OtHours', 'otHours', 'HoursOt', 'hoursOt', 'ExtraHours', 'extraHours'],
  );
  const totalHours = readNumberKeys(record, ['EntryQuantity', 'entryQuantity', 'TotalHours', 'totalHours', 'hours']);
  const currency = trimString(
    readStringKeys(record, ['CurrencyCode', 'currencyCode', 'PayCurrencyIsoSymbol', 'currency'], 12) || 'GBP',
    12,
  ).toUpperCase() || 'GBP';
  const computedStd = standardHours === null ? 0 : standardHours;
  const computedOt = overtimeHours === null ? 0 : overtimeHours;
  const computedTotal = totalHours === null ? computedStd + computedOt : totalHours;

  return {
    id: timesheetId || [assignmentRef, candidateName, weekEnding].filter(Boolean).join('|'),
    timesheetId,
    weekEnding,
    weekStart,
    candidateName,
    candidateEmail: lowerEmail(
      record.EmployeeEmail
      || record.employeeEmail
      || record.candidateEmail
      || record.contractorEmail
      || record.email,
    ),
    payrollRef: readStringKeys(
      record,
      ['EmployeeAccountingReference', 'employeeAccountingReference', 'EmployeeReference', 'employeeReference', 'payrollReference'],
      120,
    ),
    employeeReference: readStringKeys(record, ['EmployeeReference', 'employeeReference', 'contractorCode', 'candidateCode'], 120),
    assignmentRef,
    jobTitle: readStringKeys(record, ['ChargeCodeDesc', 'chargeCodeDesc', 'jobTitle', 'title', 'description'], 240),
    clientName: readStringKeys(record, ['CompanyName', 'companyName', 'clientName', 'customerName'], 240),
    approverName: readStringKeys(record, ['ApproverName', 'approverName', 'approvedBy', 'authoriserName', 'authorizerName'], 240),
    submittedAt: toDateOnly(record.SubmittedDate || record.submittedDate || record.submittedAt),
    approvedAt: toDateOnly(record.ApprovedDate || record.approvedDate || record.approvedAt || record.authorisedDate || record.authorizedDate),
    status: normalizeTimesheetPortalTimesheetStatus(record),
    totals: {
      hours: computedTotal,
      standardHours: computedStd,
      overtimeHours: computedOt,
      pay: readNumberKeys(record, ['TotalPay', 'totalPay', 'payAmount']) || 0,
      charge: readNumberKeys(record, ['TotalCharge', 'totalCharge', 'chargeAmount']) || 0,
    },
    currency,
    notes: readStringKeys(record, ['Notes', 'notes', 'Comment', 'comment', 'Comments', 'comments'], 2000),
    attachmentCount: readNumberKeys(record, ['AttachmentCount', 'attachmentCount']) || 0,
    raw: record,
  };
}

async function fetchAssignmentsCollection(config, auth, assignmentPath, options = {}) {
  const seenKeys = new Set();
  const rows = [];
  const take = Math.max(1, Math.min(1000, Number(options.take) || 250));
  const pageLimit = Math.max(1, Math.min(50, Number(options.pageLimit) || 20));

  for (let page = 1; page <= pageLimit; page += 1) {
    const url = buildCollectionUrl(config.resourceBaseUrl, assignmentPath, { take, page });
    const result = await fetchJson(url, auth);
    if (!result.response.ok) {
      const error = new Error(`Timesheet Portal assignment list failed (${result.response.status})`);
      error.code = 'timesheet_portal_assignment_list_failed';
      error.status = result.response.status;
      throw error;
    }
    const pageRows = extractCollection(result.json)
      .map(normalizeTimesheetPortalAssignment)
      .filter((row) => row.id || row.reference || row.title || row.clientName);
    if (!pageRows.length) break;
    let added = 0;
    pageRows.forEach((row) => {
      const key = row.id || row.reference || `${row.title}|${row.clientName}|${row.startDate}`;
      if (!key || seenKeys.has(key)) return;
      seenKeys.add(key);
      rows.push(row);
      added += 1;
    });
    if (!added || pageRows.length < take) break;
  }

  return rows;
}

function buildPayrollReportPayload(options = {}) {
  const payload = {
    reportTimeGrouping: 'Timesheet',
    fields: DEFAULT_PAYROLL_REPORT_FIELDS.slice(),
  };
  const fromDate = toDateOnly(options.fromDate);
  const toDate = toDateOnly(options.toDate);
  if (fromDate) payload.fromDate = fromDate;
  if (toDate) payload.toDate = toDate;
  return payload;
}

async function fetchTimesheetPortalPayrollReport(config, auth, reportPath, options = {}) {
  const payload = buildPayrollReportPayload(options);
  const result = await postJson(joinUrl(config.resourceBaseUrl, reportPath), auth, payload);
  if (!result.response.ok) {
    const error = new Error(`Timesheet Portal payroll report failed (${result.response.status})`);
    error.code = 'timesheet_portal_payroll_report_failed';
    error.status = result.response.status;
    throw error;
  }

  const tabularRows = extractTabularRows(result.json);
  const records = tableRowsToRecords(tabularRows);
  return records.map(normalizeTimesheetPortalPayrollRecord).filter((row) => row.id || row.candidateName || row.invoiceNumberText);
}

async function fetchTimesheetPortalTimesheets(config, auth, listPath, options = {}) {
  const take = Math.max(1, Math.min(1000, Number(options.take) || 500));
  const url = buildCollectionUrl(config.resourceBaseUrl, listPath, { take, page: 1 });
  const result = await fetchJson(url, auth);
  if (!result.response.ok) {
    const error = new Error(`Timesheet Portal timesheet list failed (${result.response.status})`);
    error.code = 'timesheet_portal_timesheet_list_failed';
    error.status = result.response.status;
    throw error;
  }
  return extractCollection(result.json)
    .map(normalizeTimesheetPortalPayrollRecord)
    .filter((row) => row.id || row.candidateName || row.invoiceNumberText);
}

async function fetchTimesheetPortalManagementTimesheets(config, auth, listPath, options = {}) {
  const seenKeys = new Set();
  const rows = [];
  const take = Math.max(1, Math.min(1000, Number(options.take) || 250));
  const pageLimit = Math.max(1, Math.min(50, Number(options.pageLimit) || 20));

  for (let page = 1; page <= pageLimit; page += 1) {
    const url = buildCollectionUrl(config.resourceBaseUrl, listPath, { take, page });
    const result = await fetchJson(url, auth);
    if (!result.response.ok) {
      const error = new Error(`Timesheet Portal timesheet list failed (${result.response.status})`);
      error.code = 'timesheet_portal_timesheet_list_failed';
      error.status = result.response.status;
      throw error;
    }
    const pageRows = extractCollection(result.json)
      .map(normalizeTimesheetPortalTimesheetRecord)
      .filter((row) => row.id || row.candidateName || row.assignmentRef || row.weekEnding);
    if (!pageRows.length) break;
    let added = 0;
    pageRows.forEach((row) => {
      const key = row.id || `${row.assignmentRef}|${row.candidateName}|${row.weekEnding}`;
      if (!key || seenKeys.has(key)) return;
      seenKeys.add(key);
      rows.push(row);
      added += 1;
    });
    if (!added || pageRows.length < take) break;
  }

  return rows;
}

async function fetchUsersCollection(config, auth, candidatePath) {
  const seenKeys = new Set();
  const rows = [];
  for (let page = 1; page <= 25; page += 1) {
    const url = buildPagedUrl(config.resourceBaseUrl, candidatePath, { page });
    const result = await fetchJson(url, auth);
    if (!result.response.ok) {
      const error = new Error(`Timesheet Portal candidate list failed (${result.response.status})`);
      error.code = 'timesheet_portal_candidate_list_failed';
      error.status = result.response.status;
      throw error;
    }
    const pageRows = extractCollection(result.json).map(normalizeContractor).filter((row) => row.id || row.email || row.reference);
    if (!pageRows.length) break;
    let added = 0;
    pageRows.forEach((row) => {
      const key = row.id || row.email || row.reference;
      if (!key || seenKeys.has(key)) return;
      seenKeys.add(key);
      rows.push(row);
      added += 1;
    });
    if (!added || pageRows.length < 100) break;
  }
  return rows;
}

async function listTimesheetPortalContractors(config, options = {}) {
  if (!config.enabled || !config.configured) {
    const error = new Error('Timesheet Portal is not configured.');
    error.code = 'timesheet_portal_not_configured';
    throw error;
  }

  const { auths, oauthError } = await getAuthCandidates(config);
  if (!auths.length) {
    if (oauthError) throw oauthError;
    const error = new Error('Timesheet Portal credentials are not configured.');
    error.code = 'timesheet_portal_not_configured';
    throw error;
  }

  const discovery = await discoverCandidatePath(config, auths);
  const take = Math.max(1, Math.min(1000, Number(options.take) || 500));
  const contractors = discovery.candidatePath.startsWith('/users')
    ? await fetchUsersCollection(config, discovery.auth, discovery.candidatePath)
    : (() => null)();
  if (contractors) {
    return {
      discovery,
      contractors,
    };
  }
  const url = buildPagedUrl(config.resourceBaseUrl, discovery.candidatePath, { take });
  const result = await fetchJson(url, discovery.auth);
  if (!result.response.ok) {
    const error = new Error(`Timesheet Portal candidate list failed (${result.response.status})`);
    error.code = 'timesheet_portal_candidate_list_failed';
    error.status = result.response.status;
    throw error;
  }
  return {
    discovery,
    contractors: extractCollection(result.json).map(normalizeContractor).filter((row) => row.id || row.email || row.reference),
  };
}

async function listTimesheetPortalAssignments(config, options = {}) {
  if (!config.enabled || !config.configured) {
    const error = new Error('Timesheet Portal is not configured.');
    error.code = 'timesheet_portal_not_configured';
    throw error;
  }

  const { auths, oauthError } = await getAuthCandidates(config);
  if (!auths.length) {
    if (oauthError) throw oauthError;
    const error = new Error('Timesheet Portal credentials are not configured.');
    error.code = 'timesheet_portal_not_configured';
    throw error;
  }

  const discovery = await discoverAssignmentPath(config, auths);
  const assignments = await fetchAssignmentsCollection(config, discovery.auth, discovery.assignmentPath, options);
  return {
    discovery,
    assignments,
  };
}

async function listTimesheetPortalPayroll(config, options = {}) {
  if (!config.enabled || !config.configured) {
    const error = new Error('Timesheet Portal is not configured.');
    error.code = 'timesheet_portal_not_configured';
    throw error;
  }

  const { auths, oauthError } = await getAuthCandidates(config);
  if (!auths.length) {
    if (oauthError) throw oauthError;
    const error = new Error('Timesheet Portal credentials are not configured.');
    error.code = 'timesheet_portal_not_configured';
    throw error;
  }

  const attempts = [];
  let emptySuccess = null;

  for (const auth of auths) {
    let authHadSuccess = false;
    for (const path of DEFAULT_PAYROLL_REPORT_PATHS) {
      try {
        const rows = await fetchTimesheetPortalPayrollReport(config, auth, path, options);
        authHadSuccess = true;
        attempts.push({
          path,
          mode: 'report',
          status: 200,
          authSource: auth.source,
          authScheme: auth.scheme,
          count: rows.length,
        });
        if (rows.length) {
          return {
            discovery: {
              payrollPath: path,
              mode: 'report',
              auth,
              attempts,
            },
            rows,
          };
        }
        if (!emptySuccess) {
          emptySuccess = {
            discovery: {
              payrollPath: path,
              mode: 'report',
              auth,
              attempts,
            },
            rows: [],
          };
        }
      } catch (error) {
        const status = Number(error?.status) || 500;
        attempts.push({
          path,
          mode: 'report',
          status,
          authSource: auth.source,
          authScheme: auth.scheme,
        });
      }
    }

    for (const path of DEFAULT_TIMESHEET_LIST_PATHS) {
      try {
        const rows = await fetchTimesheetPortalTimesheets(config, auth, path, options);
        authHadSuccess = true;
        attempts.push({
          path,
          mode: 'timesheets',
          status: 200,
          authSource: auth.source,
          authScheme: auth.scheme,
          count: rows.length,
        });
        if (rows.length) {
          return {
            discovery: {
              payrollPath: path,
              mode: 'timesheets',
              auth,
              attempts,
            },
            rows,
          };
        }
        if (!emptySuccess) {
          emptySuccess = {
            discovery: {
              payrollPath: path,
              mode: 'timesheets',
              auth,
              attempts,
            },
            rows: [],
          };
        }
      } catch (error) {
        const status = Number(error?.status) || 500;
        attempts.push({
          path,
          mode: 'timesheets',
          status,
          authSource: auth.source,
          authScheme: auth.scheme,
        });
      }
    }

    if (authHadSuccess && emptySuccess) return emptySuccess;
  }

  if (emptySuccess) return emptySuccess;

  const sawUnauthorized = attempts.some((attempt) => Number(attempt.status) === 401 || Number(attempt.status) === 403);
  const error = new Error(sawUnauthorized
    ? 'Timesheet Portal credentials were rejected by the API. Check the Brightwater token/OAuth credentials in Netlify.'
    : 'Timesheet Portal payroll endpoint could not be discovered for this account.');
  error.code = sawUnauthorized ? 'timesheet_portal_auth_failed' : 'timesheet_portal_payroll_path_missing';
  error.attempts = attempts;
  throw error;
}

async function listTimesheetPortalTimesheets(config, options = {}) {
  if (!config.enabled || !config.configured) {
    const error = new Error('Timesheet Portal is not configured.');
    error.code = 'timesheet_portal_not_configured';
    throw error;
  }

  const { auths, oauthError } = await getAuthCandidates(config);
  if (!auths.length) {
    if (oauthError) throw oauthError;
    const error = new Error('Timesheet Portal credentials are not configured.');
    error.code = 'timesheet_portal_not_configured';
    throw error;
  }

  const attempts = [];
  let emptySuccess = null;

  for (const auth of auths) {
    let authHadSuccess = false;
    for (const path of DEFAULT_TIMESHEET_LIST_PATHS) {
      try {
        const rows = await fetchTimesheetPortalManagementTimesheets(config, auth, path, options);
        authHadSuccess = true;
        attempts.push({
          path,
          mode: 'timesheets',
          status: 200,
          authSource: auth.source,
          authScheme: auth.scheme,
          count: rows.length,
        });
        if (rows.length) {
          return {
            discovery: {
              timesheetPath: path,
              mode: 'timesheets',
              auth,
              attempts,
            },
            rows,
          };
        }
        if (!emptySuccess) {
          emptySuccess = {
            discovery: {
              timesheetPath: path,
              mode: 'timesheets',
              auth,
              attempts,
            },
            rows: [],
          };
        }
      } catch (error) {
        const status = Number(error?.status) || 500;
        attempts.push({
          path,
          mode: 'timesheets',
          status,
          authSource: auth.source,
          authScheme: auth.scheme,
        });
      }
    }

    if (authHadSuccess && emptySuccess) return emptySuccess;
  }

  if (emptySuccess) return emptySuccess;

  const sawUnauthorized = attempts.some((attempt) => Number(attempt.status) === 401 || Number(attempt.status) === 403);
  const error = new Error(sawUnauthorized
    ? 'Timesheet Portal credentials were rejected by the API. Check the Brightwater token/OAuth credentials in Netlify.'
    : 'Timesheet Portal timesheet-management endpoint could not be discovered for this account.');
  error.code = sawUnauthorized ? 'timesheet_portal_auth_failed' : 'timesheet_portal_timesheet_path_missing';
  error.attempts = attempts;
  throw error;
}

function candidateName(candidate = {}) {
  return trimString(
    candidate.full_name
    || [candidate.first_name, candidate.last_name].filter(Boolean).join(' '),
    240,
  ) || 'Candidate';
}

function compareCandidates(websiteCandidates = [], contractors = []) {
  const websiteRows = (Array.isArray(websiteCandidates) ? websiteCandidates : [])
    .filter((candidate) => String(candidate.status || '').toLowerCase() !== 'archived');
  const contractorRows = Array.isArray(contractors) ? contractors : [];
  const timesheetPortalCandidates = contractorRows.map((row) => ({
    id: row.id || '',
    reference: row.reference || '',
    accountingReference: row.accountingReference || '',
    firstName: row.firstName || '',
    lastName: row.lastName || '',
    name: trimString([row.firstName, row.lastName].filter(Boolean).join(' '), 240) || 'Contractor',
    email: row.email || '',
    mobile: row.mobile || '',
  }));

  const websiteByEmail = new Map();
  websiteRows.forEach((candidate) => {
    const email = lowerEmail(candidate.email);
    if (email && !websiteByEmail.has(email)) websiteByEmail.set(email, candidate);
  });

  const contractorByEmail = new Map();
  contractorRows.forEach((row) => {
    if (row.email && !contractorByEmail.has(row.email)) contractorByEmail.set(row.email, row);
  });

  const websiteOnly = [];
  const mismatches = [];
  let matched = 0;

  websiteRows.forEach((candidate) => {
    const email = lowerEmail(candidate.email);
    if (!email) return;
    const contractor = contractorByEmail.get(email);
    if (!contractor) {
      websiteOnly.push({
        id: String(candidate.id),
        email,
        name: candidateName(candidate),
        payrollRef: trimString(candidate.payroll_ref, 120),
      });
      return;
    }
    matched += 1;
    const differences = [];
    if (trimString(candidate.first_name, 120) && trimString(contractor.firstName, 120) && trimString(candidate.first_name, 120).toLowerCase() !== trimString(contractor.firstName, 120).toLowerCase()) {
      differences.push('first_name');
    }
    if (trimString(candidate.last_name, 120) && trimString(contractor.lastName, 120) && trimString(candidate.last_name, 120).toLowerCase() !== trimString(contractor.lastName, 120).toLowerCase()) {
      differences.push('last_name');
    }
    if (trimString(candidate.phone, 80) && trimString(contractor.mobile, 80) && trimString(candidate.phone, 80) !== trimString(contractor.mobile, 80)) {
      differences.push('phone');
    }
    if (trimString(candidate.payroll_ref, 120) && trimString(contractor.reference || contractor.accountingReference, 120) && trimString(candidate.payroll_ref, 120) !== trimString(contractor.reference || contractor.accountingReference, 120)) {
      differences.push('reference');
    }
    if (differences.length) {
      mismatches.push({
        email,
        name: candidateName(candidate),
        website: {
          phone: trimString(candidate.phone, 80),
          payrollRef: trimString(candidate.payroll_ref, 120),
        },
        timesheetPortal: {
          phone: trimString(contractor.mobile, 80),
          reference: trimString(contractor.reference || contractor.accountingReference, 120),
        },
        differences,
      });
    }
  });

  const timesheetPortalOnly = contractorRows
    .filter((row) => row.email && !websiteByEmail.has(row.email))
    .map((row) => ({
      email: row.email,
      name: trimString([row.firstName, row.lastName].filter(Boolean).join(' '), 240) || 'Contractor',
      reference: row.reference || row.accountingReference || '',
    }));

  return {
    summary: {
      websiteTotal: websiteRows.length,
      timesheetPortalTotal: contractorRows.length,
      matched,
      websiteOnly: websiteOnly.length,
      timesheetPortalOnly: timesheetPortalOnly.length,
      mismatched: mismatches.length,
    },
    timesheetPortalCandidates,
    websiteOnly: websiteOnly.slice(0, 25),
    timesheetPortalOnly: timesheetPortalOnly.slice(0, 25),
    mismatches: mismatches.slice(0, 25),
  };
}

module.exports = {
  compareCandidates,
  listTimesheetPortalAssignments,
  listTimesheetPortalContractors,
  listTimesheetPortalPayroll,
  listTimesheetPortalTimesheets,
  normalizeTimesheetPortalPayrollRecord,
  normalizeTimesheetPortalTimesheetRecord,
  normalizeTimesheetPortalAssignment,
  readTimesheetPortalConfig,
};
