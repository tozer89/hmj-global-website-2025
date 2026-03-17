const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { supabase, hasSupabase, jsonOk, jsonError, supabaseStatus } = require('./_supabase.js');
const { loadStaticTimesheets } = require('./_timesheets-helpers.js');
const { fetchSettings, DEFAULT_SETTINGS, fiscalWeekNumber } = require('./_settings-helpers.js');
const { isMissingColumnError, isMissingRelationError } = require('./_candidate-portal.js');
const { listTimesheetPortalTimesheets, readTimesheetPortalConfig } = require('./_timesheet-portal.js');

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function normaliseNameKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function statusKey(value) {
  const raw = trimString(value, 80).toLowerCase();
  if (!raw) return 'submitted';
  if (raw.includes('approved') || raw.includes('authorised') || raw.includes('authorized')) return 'approved';
  if (raw.includes('reject') || raw.includes('declin') || raw.includes('return')) return 'rejected';
  if (raw.includes('draft') || raw.includes('open') || raw.includes('new')) return 'draft';
  if (raw.includes('submit') || raw.includes('await') || raw.includes('pending')) return 'submitted';
  return raw;
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

function serialiseSyncError(error) {
  if (!error) return null;
  return {
    code: trimString(error.code || 'sync_failed', 120) || 'sync_failed',
    message: trimString(error.message || 'Timesheet sync failed.', 500) || 'Timesheet sync failed.',
    attempts: Array.isArray(error.attempts) ? error.attempts : [],
  };
}

async function safeSelect(table, columns, options = {}) {
  if (!hasSupabase()) return [];
  let query = supabase.from(table).select(columns);
  if (typeof options.orderBy === 'string') {
    query = query.order(options.orderBy, { ascending: options.ascending !== false });
  }
  if (Number.isFinite(options.limit)) {
    query = query.limit(Number(options.limit));
  }
  const { data, error } = await query;
  if (error) {
    if (options.allowMissing && (isMissingRelationError(error) || isMissingColumnError(error))) return [];
    throw error;
  }
  return Array.isArray(data) ? data : [];
}

function buildCandidateLookups(rows = []) {
  const byPayroll = new Map();
  const byEmail = new Map();
  const byName = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const id = row.id ?? null;
    const email = trimString(row.email, 320).toLowerCase();
    const payrollRef = trimString(row.payroll_ref || row.payrollRef, 120);
    const name = trimString(
      row.full_name
      || row.name
      || [row.first_name || row.firstName, row.last_name || row.lastName].filter(Boolean).join(' '),
      240,
    );
    const candidate = {
      id,
      name,
      email: email || null,
      payrollRef: payrollRef || null,
    };
    if (payrollRef && !byPayroll.has(payrollRef)) byPayroll.set(payrollRef, candidate);
    if (email && !byEmail.has(email)) byEmail.set(email, candidate);
    const nameKey = normaliseNameKey(name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, candidate);
  });

  return { byPayroll, byEmail, byName };
}

function buildAssignmentLookups(rows = []) {
  const byRef = new Map();
  const byTitleClient = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const ref = trimString(row.as_ref || row.ref, 120);
    const titleClientKey = normaliseNameKey(`${row.job_title || ''} ${row.client_name || ''}`);
    if (ref && !byRef.has(ref)) byRef.set(ref, row);
    if (titleClientKey && !byTitleClient.has(titleClientKey)) byTitleClient.set(titleClientKey, row);
  });

  return { byRef, byTitleClient };
}

function matchCandidate(row = {}, lookups = {}) {
  const payrollRef = trimString(row.payrollRef || row.employeeReference, 120);
  if (payrollRef && lookups.byPayroll?.has(payrollRef)) return lookups.byPayroll.get(payrollRef);
  const email = trimString(row.candidateEmail, 320).toLowerCase();
  if (email && lookups.byEmail?.has(email)) return lookups.byEmail.get(email);
  const nameKey = normaliseNameKey(row.candidateName);
  if (nameKey && lookups.byName?.has(nameKey)) return lookups.byName.get(nameKey);
  return null;
}

function matchAssignment(row = {}, lookups = {}) {
  const ref = trimString(row.assignmentRef, 120);
  if (ref && lookups.byRef?.has(ref)) return lookups.byRef.get(ref);
  const titleClientKey = normaliseNameKey(`${row.jobTitle || ''} ${row.clientName || ''}`);
  if (titleClientKey && lookups.byTitleClient?.has(titleClientKey)) return lookups.byTitleClient.get(titleClientKey);
  return null;
}

function mapTimesheetPortalRows(rows = [], options = {}) {
  const {
    candidateLookups = {},
    assignmentLookups = {},
    baseWeekEnding = DEFAULT_SETTINGS.fiscal_week1_ending,
  } = options;

  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const candidate = matchCandidate(row, candidateLookups);
    const assignment = matchAssignment(row, assignmentLookups);
    const weekEnding = toDateOnly(row.weekEnding);
    const status = statusKey(row.status);
    return {
      id: `tsp:${trimString(row.id || row.timesheetId || `row-${index + 1}`, 240)}`,
      externalId: trimString(row.id || row.timesheetId, 240),
      source: 'timesheet_portal',
      readOnly: true,
      readOnlyReason: 'Mirrored from Timesheet Portal timesheet management. Edit approvals and entries in TSP.',
      weekEnding: weekEnding || null,
      weekStart: toDateOnly(row.weekStart) || null,
      weekNo: weekEnding ? fiscalWeekNumber(weekEnding, baseWeekEnding) : null,
      status,
      candidateId: candidate?.id || null,
      candidateName: trimString(row.candidateName || candidate?.name, 240) || 'Unknown worker',
      candidateEmail: trimString(row.candidateEmail || candidate?.email, 320) || null,
      payrollRef: trimString(row.payrollRef || row.employeeReference || candidate?.payrollRef, 120) || null,
      assignmentId: assignment?.id || null,
      assignmentRef: trimString(row.assignmentRef || assignment?.as_ref || assignment?.ref, 120) || null,
      assignmentTitle: trimString(row.jobTitle || assignment?.job_title, 240) || null,
      clientName: trimString(row.clientName || assignment?.client_name, 240) || null,
      siteName: trimString(assignment?.client_site, 240) || null,
      approverName: trimString(row.approverName, 240) || null,
      hours: toNumber(row.totals?.hours),
      standardHours: toNumber(row.totals?.standardHours),
      overtimeHours: toNumber(row.totals?.overtimeHours),
      payAmount: toNumber(row.totals?.pay),
      chargeAmount: toNumber(row.totals?.charge),
      currency: trimString(row.currency || assignment?.currency || 'GBP', 12).toUpperCase() || 'GBP',
      submittedAt: toDateOnly(row.submittedAt) || null,
      approvedAt: toDateOnly(row.approvedAt) || null,
      updatedAt: toDateOnly(row.approvedAt || row.submittedAt || row.weekEnding) || null,
      notes: trimString(row.notes, 2000) || null,
      attachmentCount: toNumber(row.attachmentCount),
      match: {
        candidate: candidate ? { id: candidate.id, name: candidate.name, email: candidate.email || null } : null,
        assignment: assignment ? { id: assignment.id, ref: assignment.as_ref || assignment.ref || null, title: assignment.job_title || null } : null,
      },
      raw: row.raw || row,
    };
  });
}

function mapLegacyRows(rows = [], baseWeekEnding = DEFAULT_SETTINGS.fiscal_week1_ending, source = 'supabase') {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const weekEnding = toDateOnly(row.week_ending || row.weekEnding);
    const std = toNumber(row.std || row.totalStd || row.total_hours || 0) - toNumber(row.ot || row.totalOt || row.ot_hours || 0);
    const overtimeHours = toNumber(row.ot || row.totalOt || row.ot_hours);
    const totalHours = std + overtimeHours;
    return {
      id: `${source}:${row.id ?? row.assignment_id ?? row.assignmentId ?? Math.random().toString(36).slice(2)}`,
      externalId: row.id ?? null,
      source,
      readOnly: true,
      readOnlyReason: 'The admin timesheets workspace is read-only. Update operational timesheets in Timesheet Portal.',
      weekEnding: weekEnding || null,
      weekStart: toDateOnly(row.week_start || row.weekStart) || null,
      weekNo: weekEnding ? fiscalWeekNumber(weekEnding, baseWeekEnding) : null,
      status: statusKey(row.status),
      candidateId: row.candidate_id || null,
      candidateName: trimString(row.candidate_name || row.contractor_name, 240) || 'Unknown worker',
      candidateEmail: trimString(row.contractor_email, 320) || null,
      payrollRef: trimString(row.payroll_ref, 120) || null,
      assignmentId: row.assignment_id || null,
      assignmentRef: trimString(row.assignment_ref, 120) || null,
      assignmentTitle: trimString(row.project_name || row.job_title, 240) || null,
      clientName: trimString(row.client_name, 240) || null,
      siteName: trimString(row.site_name, 240) || null,
      approverName: trimString(row.approved_by || row.approver_email, 240) || null,
      hours: totalHours,
      standardHours: std,
      overtimeHours,
      payAmount: toNumber(row.pay_amount),
      chargeAmount: toNumber(row.charge_amount),
      currency: trimString(row.currency || 'GBP', 12).toUpperCase() || 'GBP',
      submittedAt: toDateOnly(row.submitted_at) || null,
      approvedAt: toDateOnly(row.approved_at) || null,
      updatedAt: toDateOnly(row.updated_at || row.approved_at || row.submitted_at || row.week_ending) || null,
      notes: trimString(row.notes, 2000) || null,
      attachmentCount: 0,
      match: { candidate: null, assignment: null },
      raw: row,
    };
  });
}

function filterRows(rows = [], filters = {}) {
  const searchNeedle = trimString(filters.q || filters.search, 240).toLowerCase();
  const status = statusKey(filters.status || '');
  const candidateNeedle = trimString(filters.candidate || '', 240).toLowerCase();
  const clientNeedle = trimString(filters.client || '', 240).toLowerCase();
  const assignmentNeedle = trimString(filters.assignment_ref || filters.assignmentRef, 120).toLowerCase();
  const weekFrom = toDateOnly(filters.week_from || filters.weekFrom);
  const weekTo = toDateOnly(filters.week_to || filters.weekTo);

  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (status && status !== 'all' && statusKey(row.status) !== status) return false;
    if (candidateNeedle && !String(row.candidateName || '').toLowerCase().includes(candidateNeedle)) return false;
    if (clientNeedle && !String(row.clientName || '').toLowerCase().includes(clientNeedle)) return false;
    if (assignmentNeedle) {
      const hay = `${row.assignmentRef || ''} ${row.assignmentTitle || ''}`.toLowerCase();
      if (!hay.includes(assignmentNeedle)) return false;
    }
    if (weekFrom && (!row.weekEnding || row.weekEnding < weekFrom)) return false;
    if (weekTo && (!row.weekEnding || row.weekEnding > weekTo)) return false;
    if (searchNeedle) {
      const haystack = [
        row.candidateName,
        row.candidateEmail,
        row.clientName,
        row.assignmentRef,
        row.assignmentTitle,
        row.payrollRef,
        row.approverName,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(searchNeedle)) return false;
    }
    return true;
  }).sort((a, b) => {
    const left = String(b.weekEnding || '');
    const right = String(a.weekEnding || '');
    if (left !== right) return left.localeCompare(right);
    return String(a.assignmentRef || '').localeCompare(String(b.assignmentRef || ''));
  });
}

function summariseRows(rows = []) {
  const byStatusMap = new Map();
  let matchedCandidates = 0;
  let matchedAssignments = 0;
  let totalHours = 0;
  let totalStd = 0;
  let totalOt = 0;

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const status = statusKey(row.status);
    byStatusMap.set(status, (byStatusMap.get(status) || 0) + 1);
    if (row.match?.candidate) matchedCandidates += 1;
    if (row.match?.assignment) matchedAssignments += 1;
    totalHours += toNumber(row.hours);
    totalStd += toNumber(row.standardHours);
    totalOt += toNumber(row.overtimeHours);
  });

  return {
    total: rows.length,
    matchedCandidates,
    matchedAssignments,
    totalHours: Number(totalHours.toFixed(2)),
    totalStd: Number(totalStd.toFixed(2)),
    totalOt: Number(totalOt.toFixed(2)),
    byStatus: Array.from(byStatusMap.entries()).map(([status, count]) => ({ status, count })),
  };
}

async function loadTspRows(baseWeekEnding, filters) {
  const config = readTimesheetPortalConfig();
  if (!config.enabled || !config.configured) {
    return { source: 'timesheet_portal', rows: [], sync: { configured: false } };
  }

  const candidateRows = await safeSelect(
    'candidates',
    'id,full_name,first_name,last_name,email,payroll_ref',
    { allowMissing: true, orderBy: 'updated_at', ascending: false, limit: 5000 }
  );
  const contractorRows = await safeSelect(
    'contractors',
    'id,name,email,payroll_ref',
    { allowMissing: true, orderBy: 'id', ascending: false, limit: 5000 }
  );
  const assignmentRows = await safeSelect(
    'assignments',
    'id,job_title,client_name,client_site,as_ref,currency',
    { allowMissing: true, orderBy: 'id', ascending: false, limit: 5000 }
  );

  const tspResult = await listTimesheetPortalTimesheets(config, {
    take: 250,
    pageLimit: 20,
  });

  const rows = mapTimesheetPortalRows(tspResult.rows, {
    candidateLookups: buildCandidateLookups(candidateRows.concat(contractorRows)),
    assignmentLookups: buildAssignmentLookups(assignmentRows),
    baseWeekEnding,
  });
  const filtered = filterRows(rows, filters);
  return {
    source: 'timesheet_portal',
    rows,
    filtered,
    sync: {
      configured: true,
      discovery: tspResult.discovery || null,
      attempts: Array.isArray(tspResult.discovery?.attempts) ? tspResult.discovery.attempts : [],
    },
  };
}

async function loadLegacyRows(baseWeekEnding, filters) {
  if (!hasSupabase()) {
    const rows = mapLegacyRows(loadStaticTimesheets(baseWeekEnding), baseWeekEnding, 'static');
    return { source: 'static', rows, filtered: filterRows(rows, filters) };
  }

  const { data, error } = await supabase
    .from('timesheets')
    .select(`
      id,
      assignment_id,
      candidate_id,
      candidate_name,
      contractor_name,
      contractor_email,
      client_name,
      project_name,
      week_start,
      week_ending,
      status,
      submitted_at,
      approved_at,
      approved_by,
      approver_email,
      assignment_ref,
      pay_amount,
      charge_amount,
      currency,
      total_hours,
      ot_hours
    `)
    .order('week_ending', { ascending: false })
    .order('id', { ascending: false });

  if (error) {
    if (isMissingRelationError(error) || isMissingColumnError(error)) {
      const rows = mapLegacyRows(loadStaticTimesheets(baseWeekEnding), baseWeekEnding, 'static');
      return { source: 'static', rows, filtered: filterRows(rows, filters) };
    }
    throw error;
  }

  const rows = mapLegacyRows(data || [], baseWeekEnding, 'supabase');
  return { source: 'supabase', rows, filtered: filterRows(rows, filters) };
}

const baseHandler = async (event, context) => {
  const trace = `ts-${Date.now()}`;

  try {
    await getContext(event, context, { requireAdmin: true });
  } catch (error) {
    return jsonError(401, 'admin_required', error.message || 'Unauthorized', { trace });
  }

  let body = {};
  if (event.httpMethod === 'POST' && event.body) {
    try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  } else if (event.httpMethod === 'GET' && event.queryStringParameters) {
    body = event.queryStringParameters;
  }

  try {
    const { settings, source: settingsSource } = await fetchSettings(event, ['fiscal_week1_ending']);
    const baseWeekEnding = settings.fiscal_week1_ending || DEFAULT_SETTINGS.fiscal_week1_ending;

    let payload;
    let syncError = null;

    try {
      payload = await loadTspRows(baseWeekEnding, body);
    } catch (error) {
      syncError = serialiseSyncError(error);
      payload = await loadLegacyRows(baseWeekEnding, body);
    }

    const allRows = payload.rows || [];
    const filteredRows = payload.filtered || filterRows(allRows, body);
    const summary = summariseRows(filteredRows);
    const emptyMessage = filteredRows.length
      ? ''
      : payload.source === 'timesheet_portal'
        ? 'Timesheet Portal returned no timesheet rows for this account or date range.'
        : 'No timesheet rows were found in the current fallback source.';

    return jsonOk({
      ok: true,
      rows: filteredRows,
      total: filteredRows.length,
      totalAll: allRows.length,
      summary,
      source: payload.source,
      readOnly: true,
      sync: payload.sync || null,
      syncError,
      emptyMessage,
      supabase: supabaseStatus(),
      config: {
        week1Ending: baseWeekEnding,
        settingsSource,
      },
      trace,
    });
  } catch (error) {
    return jsonError(500, 'timesheets_list_failed', error.message || 'Unexpected error', { trace });
  }
};

exports.handler = withAdminCors(baseHandler);
