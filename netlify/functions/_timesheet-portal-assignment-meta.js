'use strict';

const {
  listTimesheetPortalAssignments,
  readTimesheetPortalConfig,
} = require('./_timesheet-portal.js');

const CACHE_MS = 90 * 1000;
let cachedMirror = null;

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function normaliseReferenceKey(value) {
  return trimString(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function uniqueList(value, maxLength = 240) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  const out = [];
  source.forEach((entry) => {
    const label = trimString(entry, maxLength);
    if (label && !out.includes(label)) out.push(label);
  });
  return out;
}

function joinList(value) {
  const items = uniqueList(value);
  return items.length ? items.join(', ') : null;
}

function buildAssignmentReferenceLookup(rows = []) {
  const byReference = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    [
      row?.reference,
      row?.as_ref,
      row?.timesheet_portal_reference,
      row?.id,
    ].forEach((value) => {
      const key = normaliseReferenceKey(value);
      if (key && !byReference.has(key)) byReference.set(key, row);
    });
  });
  return { rows: Array.isArray(rows) ? rows : [], byReference };
}

function findTimesheetPortalAssignment(row = {}, lookup = {}) {
  const candidates = [
    row.as_ref,
    row.reference,
    row.timesheet_portal_reference,
    row.po_ref,
    row.po_number,
    row.id,
  ];
  for (const value of candidates) {
    const key = normaliseReferenceKey(value);
    if (key && lookup.byReference?.has(key)) return lookup.byReference.get(key);
  }
  return null;
}

function buildClientCodeMap(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = trimString(row?.client_code, 120);
    const name = trimString(row?.name, 240);
    if (key && name && !map.has(key)) map.set(key, name);
  });
  return map;
}

function decorateAssignmentRowWithTimesheetPortal(row = {}, lookup = {}, clientCodeMap = new Map()) {
  const meta = findTimesheetPortalAssignment(row, lookup);
  const fallbackApprover = trimString(row.approver, 240) || trimString(row.consultant_name, 240);
  const fallbackContractor = trimString(row.assigned_contractors || row.candidate_name, 240);
  if (!meta) {
    return {
      ...row,
      assignment_description: trimString(row.assignment_description || row.job_title, 240) || null,
      branch_name: trimString(row.branch_name || row.client_site, 240) || null,
      cost_centre: trimString(row.cost_centre, 120) || null,
      ir35_status: trimString(row.ir35_status, 80) || null,
      assigned_approvers: trimString(row.assigned_approvers || fallbackApprover, 4000) || null,
      assigned_contractors: trimString(row.assigned_contractors || fallbackContractor, 4000) || null,
      assignment_category: trimString(row.assignment_category, 160) || null,
      timesheet_portal_reference: trimString(row.timesheet_portal_reference || row.as_ref, 160) || null,
      timesheet_portal_active: null,
    };
  }

  const clientCode = trimString(meta.clientCode, 120);
  const clientName = trimString(meta.clientName, 240)
    || (clientCode ? trimString(clientCodeMap.get(clientCode), 240) : '')
    || clientCode;
  const branchName = trimString(meta.branchName || row.branch_name || row.client_site, 240);
  const approvers = uniqueList(meta.assignedApprovers.length ? meta.assignedApprovers : fallbackApprover ? [fallbackApprover] : [], 240);
  const contractors = uniqueList(
    meta.assignedContractors.length
      ? meta.assignedContractors
      : meta.candidateName
      ? [meta.candidateName]
      : fallbackContractor
      ? [fallbackContractor]
      : [],
    240,
  );

  return {
    ...row,
    client_code: clientCode || trimString(row.client_code, 120) || null,
    client_name: trimString(row.client_name || clientName, 240) || null,
    assignment_description: trimString(row.assignment_description || meta.assignmentDescription || row.job_title, 240) || null,
    branch_name: trimString(row.branch_name || branchName || meta.clientSite, 240) || null,
    cost_centre: trimString(row.cost_centre || meta.costCentre, 120) || null,
    ir35_status: trimString(row.ir35_status || meta.ir35Status, 80) || null,
    assigned_approvers: trimString(row.assigned_approvers || joinList(approvers), 4000) || null,
    assigned_contractors: trimString(row.assigned_contractors || joinList(contractors), 4000) || null,
    assignment_category: trimString(row.assignment_category || meta.assignmentCategory, 160) || null,
    timesheet_portal_reference: trimString(meta.reference || row.as_ref || row.timesheet_portal_reference, 160) || null,
    timesheet_portal_assignment_id: trimString(meta.id, 120) || null,
    timesheet_portal_active: meta.active === true,
    last_modified: trimString(row.last_modified || meta.lastModified, 80) || null,
  };
}

async function loadTimesheetPortalAssignmentMirror(options = {}) {
  const force = options.force === true;
  if (!force && cachedMirror && cachedMirror.expiresAt > Date.now()) {
    return cachedMirror.value;
  }
  const config = readTimesheetPortalConfig();
  if (!config.enabled || !config.configured) {
    const empty = {
      configured: false,
      rows: [],
      lookup: buildAssignmentReferenceLookup([]),
      discovery: null,
    };
    cachedMirror = { value: empty, expiresAt: Date.now() + 5_000 };
    return empty;
  }
  const result = await listTimesheetPortalAssignments(config, { take: 500, pageLimit: 20 });
  const value = {
    configured: true,
    rows: Array.isArray(result.assignments) ? result.assignments : [],
    lookup: buildAssignmentReferenceLookup(result.assignments),
    discovery: result.discovery || null,
  };
  cachedMirror = { value, expiresAt: Date.now() + CACHE_MS };
  return value;
}

module.exports = {
  buildAssignmentReferenceLookup,
  buildClientCodeMap,
  decorateAssignmentRowWithTimesheetPortal,
  findTimesheetPortalAssignment,
  loadTimesheetPortalAssignmentMirror,
  normaliseReferenceKey,
};
