'use strict';

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function normalizeClientKey(value) {
  return trimString(value, 240)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStatus(values = []) {
  const statuses = (Array.isArray(values) ? values : [values])
    .map((value) => trimString(value, 80).toLowerCase())
    .filter(Boolean);
  if (statuses.some((value) => value === 'live' || value === 'active' || value === 'open')) return 'active';
  if (statuses.some((value) => value === 'pending' || value === 'draft')) return 'prospect';
  if (statuses.some((value) => value === 'complete' || value === 'closed' || value === 'inactive')) return 'inactive';
  return 'active';
}

function deriveTimesheetPortalClients(assignments = []) {
  const byKey = new Map();
  for (const assignment of Array.isArray(assignments) ? assignments : []) {
    const clientCode = trimString(assignment.clientCode, 120);
    const clientName = trimString(assignment.clientName, 240) || clientCode;
    const key = normalizeClientKey(clientCode || clientName);
    if (!key) continue;
    const current = byKey.get(key) || {
      id: `tsp:${clientCode || clientName}`,
      client_code: clientCode || null,
      name: clientName || 'Timesheet Portal client',
      billing_email: null,
      phone: null,
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      terms_days: null,
      status: 'active',
      notes: null,
      assignment_count: 0,
      source: 'timesheet_portal',
      readOnly: true,
      sync_source: 'timesheet_portal_jobs',
      latest_statuses: [],
    };
    current.assignment_count += 1;
    if (!current.client_code && clientCode) current.client_code = clientCode;
    if ((!current.name || current.name === 'Timesheet Portal client') && clientName) current.name = clientName;
    current.latest_statuses.push(trimString(assignment.status, 80));
    byKey.set(key, current);
  }

  return Array.from(byKey.values())
    .map((row) => ({
      ...row,
      status: normalizeStatus(row.latest_statuses),
      notes: row.client_code
        ? `Timesheet Portal client ${row.client_code}${row.assignment_count ? ` · ${row.assignment_count} assignment(s)` : ''}`
        : `Timesheet Portal derived client${row.assignment_count ? ` · ${row.assignment_count} assignment(s)` : ''}`,
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function mergeTimesheetPortalClient(existing = {}, remote = {}) {
  return {
    id: existing.id != null ? existing.id : undefined,
    name: trimString(existing.name || remote.name, 240) || 'Timesheet Portal client',
    billing_email: trimString(existing.billing_email, 320) || null,
    phone: trimString(existing.phone, 80) || null,
    contact_name: trimString(existing.contact_name, 240) || null,
    contact_email: trimString(existing.contact_email, 320) || null,
    contact_phone: trimString(existing.contact_phone, 80) || null,
    terms_days: existing.terms_days == null || existing.terms_days === '' ? null : Number(existing.terms_days),
    status: trimString(existing.status || remote.status || 'active', 40) || 'active',
    address: existing.address && typeof existing.address === 'object' ? existing.address : null,
    billing: existing.billing && typeof existing.billing === 'object' ? existing.billing : null,
  };
}

module.exports = {
  deriveTimesheetPortalClients,
  mergeTimesheetPortalClient,
  normalizeClientKey,
};
