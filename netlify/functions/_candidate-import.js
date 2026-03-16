'use strict';

const XLSX = require('xlsx');

const TEMPLATE_COLUMNS = Object.freeze([
  { key: 'email', label: 'Email', required: true, example: 'candidate@example.com', description: 'Primary match key for updates and the preferred candidate contact email.' },
  { key: 'full_name', label: 'Full Name', required: false, example: 'Joseph Tozer', description: 'Use this or First Name + Last Name.' },
  { key: 'first_name', label: 'First Name', required: false, example: 'Joseph', description: 'Optional if Full Name is provided.' },
  { key: 'last_name', label: 'Last Name', required: false, example: 'Tozer', description: 'Optional if Full Name is provided.' },
  { key: 'phone', label: 'Phone', required: false, example: '+44 7700 900123', description: 'Candidate mobile or main contact number.' },
  { key: 'status', label: 'Status', required: false, example: 'active', description: 'Common values: active, in progress, complete, archived, blocked.' },
  { key: 'job_title', label: 'Job Title', required: false, example: 'Electrical Supervisor', description: 'Current or target role title.' },
  { key: 'headline_role', label: 'Headline Role', required: false, example: 'Data Centre Electrical Supervisor', description: 'Optional display role / headline.' },
  { key: 'location', label: 'Location', required: false, example: 'Frankfurt, Germany', description: 'Candidate location or preferred work area.' },
  { key: 'country', label: 'Country', required: false, example: 'Germany', description: 'Used when region / location should be split out.' },
  { key: 'skills', label: 'Skills', required: false, example: 'SAP, HV, Data Centres', description: 'Comma-separated skills or tags.' },
  { key: 'right_to_work_status', label: 'Right To Work Status', required: false, example: 'Full right to work in place', description: 'Text summary of work authorisation.' },
  { key: 'right_to_work_regions', label: 'Right To Work Regions', required: false, example: 'United Kingdom, European Union / EEA', description: 'Comma-separated regions or countries.' },
  { key: 'qualifications', label: 'Qualifications', required: false, example: 'SSSTS, ECS Gold Card, IPAF', description: 'Certificates or qualifications.' },
  { key: 'sector_focus', label: 'Sector Focus', required: false, example: 'Data Centres', description: 'Primary market / sector experience.' },
  { key: 'current_job_title', label: 'Current Job Title', required: false, example: 'Senior Electrician', description: 'Optional current role title.' },
  { key: 'desired_roles', label: 'Desired Roles', required: false, example: 'Supervisor, Lead Electrician', description: 'Comma-separated role interests.' },
  { key: 'salary_expectation', label: 'Salary Expectation', required: false, example: 'EUR 38/hour', description: 'Optional salary or rate expectation.' },
  { key: 'payroll_ref', label: 'Payroll Ref', required: false, example: 'TSP-10021', description: 'Optional payroll or external worker reference.' },
  { key: 'internal_ref', label: 'Internal Ref', required: false, example: 'HMJ-CAND-001', description: 'Optional HMJ internal reference.' },
  { key: 'pay_type', label: 'Pay Type', required: false, example: 'PAYE', description: 'Optional pay type / engagement type.' },
  { key: 'notes', label: 'Notes', required: false, example: 'Requires flights and accommodation support.', description: 'Internal operational notes.' },
]);

const ALLOWED_IMPORT_FIELDS = new Set(TEMPLATE_COLUMNS.map((column) => column.key).concat([
  'id',
  'ref',
  'auth_user_id',
  'role',
  'region',
  'availability_on',
  'availability_date',
  'source',
]));

const HEADER_ALIASES = Object.freeze({
  id: 'id',
  candidate_id: 'id',
  ref: 'ref',
  reference: 'ref',
  candidate_reference: 'ref',
  internal_reference: 'internal_ref',
  internal_ref: 'internal_ref',
  payroll_reference: 'payroll_ref',
  payroll_ref: 'payroll_ref',
  tsp_reference: 'payroll_ref',
  auth_user_id: 'auth_user_id',
  user_id: 'auth_user_id',
  email: 'email',
  email_address: 'email',
  candidate_email: 'email',
  full_name: 'full_name',
  name: 'full_name',
  candidate_name: 'full_name',
  first_name: 'first_name',
  firstname: 'first_name',
  candidate_first_name: 'first_name',
  forename: 'first_name',
  last_name: 'last_name',
  lastname: 'last_name',
  surname: 'last_name',
  candidate_surname: 'last_name',
  family_name: 'last_name',
  phone: 'phone',
  mobile: 'phone',
  mobile_phone: 'phone',
  candidate_mobile: 'phone',
  telephone: 'phone',
  status: 'status',
  candidate_status: 'status',
  job_title: 'job_title',
  role: 'job_title',
  role_title: 'job_title',
  current_role: 'job_title',
  headline_role: 'headline_role',
  location: 'location',
  region: 'location',
  country_region: 'location',
  country: 'country',
  skills: 'skills',
  tags: 'skills',
  skill_tags: 'skills',
  right_to_work_status: 'right_to_work_status',
  work_authorisation_status: 'right_to_work_status',
  right_to_work_regions: 'right_to_work_regions',
  right_to_work: 'right_to_work_regions',
  work_regions: 'right_to_work_regions',
  qualifications: 'qualifications',
  certificates: 'qualifications',
  certifications: 'qualifications',
  sector_focus: 'sector_focus',
  sector: 'sector_focus',
  current_job_title: 'current_job_title',
  desired_roles: 'desired_roles',
  desired_role: 'desired_roles',
  salary_expectation: 'salary_expectation',
  pay_expectation: 'salary_expectation',
  pay_type: 'pay_type',
  engagement_type: 'pay_type',
  notes: 'notes',
});

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function lowerText(value, maxLength) {
  const text = trimString(value, maxLength);
  return text ? text.toLowerCase() : '';
}

function normaliseHeader(value) {
  return lowerText(value, 160)
    .replace(/[\s/\\|()[\]{}.+-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseListValue(value, maxLength = 120) {
  return String(value == null ? '' : value)
    .split(/[\n,|]/)
    .map((item) => trimString(item, maxLength))
    .filter(Boolean)
    .join(', ');
}

function splitFullName(value) {
  const fullName = trimString(value, 240).replace(/\s+/g, ' ');
  if (!fullName) return { first_name: '', last_name: '' };
  const parts = fullName.split(' ');
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return {
    first_name: trimString(parts.shift(), 120),
    last_name: trimString(parts.join(' '), 120),
  };
}

function mapHeaders(headers = []) {
  const mapped = [];
  const unmapped = [];
  headers.forEach((header) => {
    const source = trimString(header, 160);
    const key = HEADER_ALIASES[normaliseHeader(header)] || null;
    const entry = { source, field: key };
    mapped.push(entry);
    if (!key) unmapped.push(source);
  });
  return { mapped, unmapped };
}

function extractSheetRows(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false,
  });
  return Array.isArray(rows) ? rows : [];
}

function isEmptyRow(payload = {}) {
  return !Object.values(payload).some((value) => trimString(value, 4000));
}

function sanitizeImportedPayload(payload = {}) {
  const out = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (!ALLOWED_IMPORT_FIELDS.has(key)) return;
    if (key === 'skills' || key === 'right_to_work_regions' || key === 'desired_roles') {
      const cleanList = parseListValue(value, 120);
      if (cleanList) out[key] = cleanList;
      return;
    }
    const clean = trimString(value, key === 'notes' || key === 'qualifications' ? 4000 : 240);
    if (clean) out[key] = clean;
  });

  if (!out.full_name && (out.first_name || out.last_name)) {
    out.full_name = trimString([out.first_name, out.last_name].filter(Boolean).join(' '), 240);
  }
  if (!out.first_name && !out.last_name && out.full_name) {
    const split = splitFullName(out.full_name);
    if (split.first_name) out.first_name = split.first_name;
    if (split.last_name) out.last_name = split.last_name;
  }
  if (out.email) out.email = lowerText(out.email, 320);
  if (out.status) out.status = lowerText(out.status, 40);
  if (out.country && !out.location) out.location = out.country;
  return out;
}

function buildPreviewRows(rawRows = [], mappedColumns = []) {
  const rows = [];
  rawRows.forEach((rawRow, index) => {
    const mappedPayload = {};
    mappedColumns.forEach((column) => {
      if (!column.field) return;
      mappedPayload[column.field] = rawRow[column.source];
    });
    const payload = sanitizeImportedPayload(mappedPayload);
    if (isEmptyRow(payload)) return;

    const warnings = [];
    const errors = [];
    if (!payload.email) {
      warnings.push('No email supplied. Matching will fall back to id or ref only.');
    }
    if (!payload.full_name && !payload.first_name && !payload.last_name) {
      warnings.push('No name supplied. The record can still import, but the admin UI will show a generic display name.');
    }
    if (!payload.id && !payload.ref && !payload.email) {
      errors.push('No usable match key found. Provide Email, ID, or Ref.');
    }
    rows.push({
      rowNumber: index + 2,
      payload,
      warnings,
      errors,
      identity: {
        email: payload.email || '',
        ref: payload.ref || '',
        id: payload.id || '',
      },
    });
  });
  return rows;
}

function readWorkbook(buffer, fileName) {
  return XLSX.read(buffer, {
    type: 'buffer',
    raw: false,
    dense: false,
    codepage: 65001,
    WTF: false,
    cellDates: false,
    cellNF: false,
    dateNF: 'yyyy-mm-dd',
    PRN: /\.csv$/i.test(String(fileName || '')),
  });
}

function parseImportFile(input = {}) {
  const fileName = trimString(input.fileName, 260) || 'candidates-import.csv';
  const buffer = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer || '');
  if (!buffer.length) {
    throw new Error('Candidate import file is empty.');
  }
  const workbook = readWorkbook(buffer, fileName);
  const firstSheetName = workbook.SheetNames.find((name) => trimString(name, 160)) || workbook.SheetNames[0];
  if (!firstSheetName || !workbook.Sheets[firstSheetName]) {
    throw new Error('Candidate import file did not contain a readable worksheet.');
  }

  const headerRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    header: 1,
    blankrows: false,
    raw: false,
  });
  const headers = Array.isArray(headerRows) && Array.isArray(headerRows[0])
    ? headerRows[0].map((value) => trimString(value, 160)).filter(Boolean)
    : [];
  if (!headers.length) {
    throw new Error('Candidate import file did not contain a header row.');
  }
  const { mapped, unmapped } = mapHeaders(headers);
  const rawRows = extractSheetRows(workbook.Sheets[firstSheetName]);
  const rows = buildPreviewRows(rawRows, mapped);
  return {
    fileName,
    sheetName: firstSheetName,
    headers,
    mappedColumns: mapped,
    unmappedColumns: unmapped,
    rows,
    totalRows: rows.length,
    validRows: rows.filter((row) => !row.errors.length).length,
    errorRows: rows.filter((row) => row.errors.length).length,
  };
}

function buildTemplateWorkbook() {
  const workbook = XLSX.utils.book_new();
  const sampleRow = {};
  TEMPLATE_COLUMNS.forEach((column) => {
    sampleRow[column.label] = column.example;
  });
  const candidateSheet = XLSX.utils.json_to_sheet([sampleRow], {
    header: TEMPLATE_COLUMNS.map((column) => column.label),
  });
  const guideSheet = XLSX.utils.json_to_sheet(TEMPLATE_COLUMNS.map((column) => ({
    Column: column.label,
    Import_Field: column.key,
    Required: column.required ? 'Yes' : 'Optional',
    Description: column.description,
    Example: column.example,
  })));
  XLSX.utils.book_append_sheet(workbook, candidateSheet, 'Candidates');
  XLSX.utils.book_append_sheet(workbook, guideSheet, 'Guide');
  const xlsxBuffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  });
  const csv = XLSX.utils.sheet_to_csv(candidateSheet);
  return { workbook, xlsxBuffer, csv };
}

function findExistingCandidate(row, lookup = {}) {
  const id = trimString(row?.payload?.id, 120);
  const ref = trimString(row?.payload?.ref, 120);
  const authUserId = trimString(row?.payload?.auth_user_id, 120);
  const email = lowerText(row?.payload?.email, 320);
  if (id && lookup.byId?.has(id)) return lookup.byId.get(id);
  if (authUserId && lookup.byAuthUserId?.has(authUserId)) return lookup.byAuthUserId.get(authUserId);
  if (email && lookup.byEmail?.has(email)) return lookup.byEmail.get(email);
  if (ref && lookup.byRef?.has(ref)) return lookup.byRef.get(ref);
  return null;
}

function buildExistingCandidateLookup(rows = []) {
  const byId = new Map();
  const byEmail = new Map();
  const byRef = new Map();
  const byAuthUserId = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = trimString(row?.id, 120);
    const email = lowerText(row?.email, 320);
    const ref = trimString(row?.ref, 120);
    const authUserId = trimString(row?.auth_user_id, 120);
    if (id) byId.set(id, row);
    if (email) byEmail.set(email, row);
    if (ref) byRef.set(ref, row);
    if (authUserId) byAuthUserId.set(authUserId, row);
  });
  return { byId, byEmail, byRef, byAuthUserId };
}

module.exports = {
  ALLOWED_IMPORT_FIELDS,
  HEADER_ALIASES,
  TEMPLATE_COLUMNS,
  buildExistingCandidateLookup,
  buildTemplateWorkbook,
  findExistingCandidate,
  mapHeaders,
  normaliseHeader,
  parseImportFile,
  sanitizeImportedPayload,
  splitFullName,
};
