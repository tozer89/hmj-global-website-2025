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

function firstEnv(...values) {
  for (const value of values) {
    const text = trimString(value, 4000);
    if (text) return text;
  }
  return '';
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
  const tokenPath = trimString(firstEnv(
    process.env.TIMESHEET_PORTAL_TOKEN_PATH,
    process.env.TSP_TOKEN_URL,
    DEFAULT_TOKEN_PATH,
  ), 240) || DEFAULT_TOKEN_PATH;
  const scope = trimString(firstEnv(
    process.env.TIMESHEET_PORTAL_SCOPE,
    process.env.TSP_SCOPE,
  ), 240);
  const configuredPaths = [
    trimString(firstEnv(process.env.TIMESHEET_PORTAL_CANDIDATE_PATH_OVERRIDE, process.env.TSP_CANDIDATE_PATH_OVERRIDE), 240),
    trimString(firstEnv(process.env.TIMESHEET_PORTAL_CANDIDATE_PATH, process.env.TSP_CANDIDATE_PATH), 240),
  ].filter(Boolean);
  const candidatePaths = configuredPaths.length ? configuredPaths : DEFAULT_CANDIDATE_PATHS;
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
  const assignmentPaths = configuredAssignmentPaths.length ? configuredAssignmentPaths : DEFAULT_ASSIGNMENT_PATHS;
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

function extractCollection(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const keys = ['items', 'results', 'data', 'candidates', 'contractors', 'value'];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
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
    websiteOnly: websiteOnly.slice(0, 25),
    timesheetPortalOnly: timesheetPortalOnly.slice(0, 25),
    mismatches: mismatches.slice(0, 25),
  };
}

module.exports = {
  compareCandidates,
  listTimesheetPortalAssignments,
  listTimesheetPortalContractors,
  normalizeTimesheetPortalAssignment,
  readTimesheetPortalConfig,
};
