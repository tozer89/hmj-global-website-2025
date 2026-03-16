'use strict';

const DEFAULT_BASE_URL = 'https://gb3.api.timesheetportal.com';
const DEFAULT_TOKEN_PATH = '/oauth/token';
const DEFAULT_CANDIDATE_PATHS = [
  '/recruitment/candidates',
  '/contractors',
  '/recruitment/contractors',
  '/api/recruitment/contractors',
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

function readTimesheetPortalConfig() {
  const baseUrl = normalizeBaseUrl(process.env.TIMESHEET_PORTAL_BASE_URL || DEFAULT_BASE_URL);
  const resourceBaseUrl = normalizeBaseUrl(process.env.TIMESHEET_PORTAL_RESOURCE_BASE_URL_OVERRIDE || baseUrl);
  const clientId = trimString(process.env.TIMESHEET_PORTAL_CLIENT_ID, 4000);
  const clientSecret = trimString(process.env.TIMESHEET_PORTAL_CLIENT_SECRET, 4000);
  const apiToken = trimString(process.env.TIMESHEET_PORTAL_API_TOKEN, 4000);
  const tokenPath = trimString(process.env.TIMESHEET_PORTAL_TOKEN_PATH, 240) || DEFAULT_TOKEN_PATH;
  const scope = trimString(process.env.TIMESHEET_PORTAL_SCOPE, 240);
  const configuredPaths = [
    trimString(process.env.TIMESHEET_PORTAL_CANDIDATE_PATH_OVERRIDE, 240),
    trimString(process.env.TIMESHEET_PORTAL_CANDIDATE_PATH, 240),
  ].filter(Boolean);
  const candidatePaths = configuredPaths.length ? configuredPaths : DEFAULT_CANDIDATE_PATHS;
  const enabled = truthyEnv(process.env.TIMESHEET_PORTAL_ENABLED) || !!apiToken || (!!clientId && !!clientSecret);

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
  };
}

function bearerHeaders(token) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  };
}

async function getBearerToken(config) {
  if (config.apiToken) return config.apiToken;
  if (!config.clientId || !config.clientSecret) {
    const error = new Error('Timesheet Portal credentials are not configured.');
    error.code = 'timesheet_portal_not_configured';
    throw error;
  }
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

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
    value: trimString(data.access_token, 8000),
    expiresAt: Date.now() + ((expiresIn - 60) * 1000),
  };
  return cachedToken.value;
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    method: 'GET',
    headers: bearerHeaders(token),
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

async function discoverCandidatePath(config, token) {
  const attempts = [];
  for (const path of config.candidatePaths) {
    const cleanPath = trimString(path, 240);
    if (!cleanPath) continue;
    const queryPath = cleanPath.includes('?') ? cleanPath : `${cleanPath}?take=5`;
    const url = joinUrl(config.resourceBaseUrl, queryPath);
    const result = await fetchJson(url, token);
    attempts.push({
      path: cleanPath,
      status: result.response.status,
    });
    if (result.response.ok) {
      return { candidatePath: cleanPath, attempts };
    }
  }
  const error = new Error('Timesheet Portal candidates endpoint could not be discovered.');
  error.code = 'timesheet_portal_candidate_path_missing';
  error.attempts = attempts;
  throw error;
}

async function listTimesheetPortalContractors(config, options = {}) {
  if (!config.enabled || !config.configured) {
    const error = new Error('Timesheet Portal is not configured.');
    error.code = 'timesheet_portal_not_configured';
    throw error;
  }

  const token = await getBearerToken(config);
  const discovery = await discoverCandidatePath(config, token);
  const take = Math.max(1, Math.min(1000, Number(options.take) || 500));
  const separator = discovery.candidatePath.includes('?') ? '&' : '?';
  const url = joinUrl(config.resourceBaseUrl, `${discovery.candidatePath}${separator}take=${take}`);
  const result = await fetchJson(url, token);

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
  listTimesheetPortalContractors,
  readTimesheetPortalConfig,
};
