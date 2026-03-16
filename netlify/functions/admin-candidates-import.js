'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  buildExistingCandidateLookup,
  buildTemplateWorkbook,
  findExistingCandidate,
  parseImportFile,
  splitFullName,
} = require('./_candidate-import.js');

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 2000;

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

function parseList(value, maxLength = 120) {
  return String(value == null ? '' : value)
    .split(/[\n,|]/)
    .map((entry) => trimString(entry, maxLength))
    .filter(Boolean);
}

function json(statusCode, payload, headers) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...(headers || {}),
    },
    body: JSON.stringify(payload),
  };
}

function queryParam(event, key) {
  return trimString(event?.queryStringParameters?.[key], 120);
}

function decodeImportFile(body = {}) {
  const fileName = trimString(body.fileName || body.name, 260) || 'candidates-import.csv';
  const base64 = trimString(body.fileData || body.data || body.base64, MAX_IMPORT_FILE_BYTES * 2);
  if (!base64) throw coded(400, 'Choose a CSV or Excel file first.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw coded(400, 'Candidate import file was empty.');
  if (buffer.length > MAX_IMPORT_FILE_BYTES) {
    throw coded(400, 'Candidate import files must be 5 MB or smaller.');
  }
  return { fileName, buffer };
}

async function loadExistingCandidates(supabase) {
  const rows = [];
  let from = 0;
  const pageSize = 1000;
  while (from < 10000) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('candidates')
      .select('id,auth_user_id,ref,email,first_name,last_name,full_name,status,updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .range(from, to);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function displayName(candidate = {}) {
  return trimString(
    candidate.full_name
    || [candidate.first_name, candidate.last_name].filter(Boolean).join(' '),
    240,
  ) || 'Candidate';
}

function addPreviewActions(preview, lookup) {
  const rows = Array.isArray(preview?.rows) ? preview.rows : [];
  const nextRows = rows.slice(0, MAX_IMPORT_ROWS).map((row) => {
    const existing = findExistingCandidate(row, lookup);
    return {
      ...row,
      action: existing ? 'update' : 'insert',
      existing: existing
        ? {
            id: String(existing.id),
            email: trimString(existing.email, 320),
            ref: trimString(existing.ref, 120),
            name: displayName(existing),
            status: trimString(existing.status, 40),
          }
        : null,
    };
  });
  return {
    ...preview,
    rows: nextRows,
    totalRows: nextRows.length,
    validRows: nextRows.filter((row) => !row.errors.length).length,
    errorRows: nextRows.filter((row) => row.errors.length).length,
    updateRows: nextRows.filter((row) => row.action === 'update' && !row.errors.length).length,
    insertRows: nextRows.filter((row) => row.action === 'insert' && !row.errors.length).length,
    truncated: rows.length > nextRows.length,
  };
}

function buildCandidateWritePayload(payload = {}, existing = null) {
  const next = {};
  const assign = (key, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      if (value.length) next[key] = value;
      return;
    }
    const clean = trimString(value, key === 'notes' || key === 'qualifications' ? 4000 : 320);
    if (clean) next[key] = clean;
  };

  if (existing?.id) next.id = String(existing.id);

  assign('ref', payload.ref);
  assign('auth_user_id', payload.auth_user_id);
  assign('email', lowerText(payload.email, 320));
  assign('full_name', payload.full_name);

  let firstName = trimString(payload.first_name, 120);
  let lastName = trimString(payload.last_name, 120);
  if ((!firstName || !lastName) && trimString(payload.full_name, 240)) {
    const split = splitFullName(payload.full_name);
    firstName = firstName || trimString(split.first_name, 120);
    lastName = lastName || trimString(split.last_name, 120);
  }
  if (!firstName) firstName = trimString(existing?.first_name, 120);
  if (!lastName) lastName = trimString(existing?.last_name, 120);
  assign('first_name', firstName);
  assign('last_name', lastName);

  assign('phone', payload.phone);
  assign('status', lowerText(payload.status || existing?.status || 'active', 40));
  assign('job_title', payload.job_title);
  assign('headline_role', payload.headline_role);
  assign('location', payload.location);
  assign('country', payload.country);
  assign('right_to_work_status', payload.right_to_work_status);
  if (payload.right_to_work_regions) {
    const regions = parseList(payload.right_to_work_regions, 120);
    if (regions.length) next.right_to_work_regions = regions;
  }
  if (payload.skills) {
    const skills = parseList(payload.skills, 120);
    if (skills.length) next.skills = skills;
  }
  assign('qualifications', payload.qualifications);
  assign('sector_focus', payload.sector_focus);
  assign('current_job_title', payload.current_job_title);
  assign('desired_roles', Array.isArray(payload.desired_roles) ? payload.desired_roles.join(', ') : payload.desired_roles);
  assign('salary_expectation', payload.salary_expectation);
  assign('payroll_ref', payload.payroll_ref);
  assign('internal_ref', payload.internal_ref);
  assign('pay_type', payload.pay_type);
  assign('notes', payload.notes);

  return next;
}

async function writeCandidateRecord(supabase, payload) {
  const working = { ...payload };
  const id = trimString(working.id, 120);
  delete working.id;
  if (!Object.keys(working).length) {
    throw coded(400, 'No candidate fields were available to import.');
  }

  let attempt = 0;
  let result = null;
  let error = null;

  while (attempt < 40) {
    attempt += 1;
    if (id) {
      ({ data: result, error } = await supabase
        .from('candidates')
        .update({
          ...working,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('id,email,ref,full_name,first_name,last_name,status,updated_at')
        .maybeSingle());
    } else {
      ({ data: result, error } = await supabase
        .from('candidates')
        .insert(working)
        .select('id,email,ref,full_name,first_name,last_name,status,updated_at')
        .single());
    }

    if (!error) return result;

    const match = /column "?([a-zA-Z0-9_]+)"? does not exist/i.exec(error.message || '')
      || /Could not find the '([a-zA-Z0-9_]+)' column of '[^']+' in the schema cache/i.exec(error.message || '');
    if (match && working[match[1]] !== undefined) {
      delete working[match[1]];
      continue;
    }
    throw coded(500, error.message || 'Candidate import failed.');
  }

  throw coded(500, error?.message || 'Candidate import failed.');
}

function handleTemplate(event) {
  const format = lowerText(queryParam(event, 'format') || 'xlsx', 16);
  const files = buildTemplateWorkbook();
  if (format === 'csv') {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="hmj-candidates-import-template.csv"',
        'cache-control': 'no-store',
      },
      body: files.csv,
    };
  }
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="hmj-candidates-import-template.xlsx"',
      'cache-control': 'no-store',
    },
    isBase64Encoded: true,
    body: files.xlsxBuffer.toString('base64'),
  };
}

const baseHandler = async (event, context) => {
  const { supabase } = await getContext(event, context, { requireAdmin: true });
  if (!supabase || typeof supabase.from !== 'function') {
    throw coded(503, 'Supabase unavailable — candidate import is disabled in this environment.');
  }

  const method = String(event.httpMethod || 'GET').toUpperCase();
  if (method === 'GET') {
    const action = lowerText(queryParam(event, 'action') || 'template', 24);
    if (action === 'template') return handleTemplate(event);
    throw coded(405, 'Method Not Allowed');
  }
  if (method !== 'POST') throw coded(405, 'Method Not Allowed');

  const body = JSON.parse(event.body || '{}');
  const action = lowerText(body.action || 'preview', 24);
  const { fileName, buffer } = decodeImportFile(body);
  const preview = parseImportFile({ fileName, buffer });
  const existingRows = await loadExistingCandidates(supabase);
  const lookup = buildExistingCandidateLookup(existingRows);
  const annotatedPreview = addPreviewActions(preview, lookup);

  if (action === 'preview') {
    return json(200, {
      ok: true,
      preview: annotatedPreview,
      fileName,
    });
  }

  if (action !== 'import') {
    throw coded(400, 'Unknown candidate import action.');
  }

  const validRows = annotatedPreview.rows.filter((row) => !row.errors.length);
  if (!validRows.length) {
    throw coded(400, 'No valid candidate rows were found in the import file.');
  }

  let inserted = 0;
  let updated = 0;
  const failures = [];
  const imported = [];

  for (const row of validRows) {
    const existing = row.existing
      ? lookup.byId.get(String(row.existing.id)) || findExistingCandidate(row, lookup)
      : findExistingCandidate(row, lookup);
    try {
      const payload = buildCandidateWritePayload(row.payload, existing);
      const saved = await writeCandidateRecord(supabase, payload);
      imported.push({
        rowNumber: row.rowNumber,
        id: saved?.id || existing?.id || null,
        email: lowerText(saved?.email || row.payload.email, 320),
        action: existing ? 'update' : 'insert',
      });
      if (existing) updated += 1;
      else inserted += 1;
    } catch (error) {
      failures.push({
        rowNumber: row.rowNumber,
        email: lowerText(row.payload.email, 320),
        error: error?.message || 'Import failed',
      });
    }
  }

  return json(failures.length ? 207 : 200, {
    ok: failures.length === 0,
    inserted,
    updated,
    failed: failures.length,
    imported,
    failures,
    message: failures.length
      ? `Imported ${inserted + updated} candidates with ${failures.length} row failure${failures.length === 1 ? '' : 's'}.`
      : `Imported ${inserted + updated} candidate${inserted + updated === 1 ? '' : 's'}.`,
  });
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
