(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HMJCandidateActiveAssignments = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function trimText(value, maxLength) {
    const text = typeof value === 'string'
      ? value.trim()
      : String(value == null ? '' : value).trim();
    if (!text) return '';
    if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
    return text.slice(0, maxLength);
  }

  function lowerText(value, maxLength) {
    const text = trimText(value, maxLength);
    return text ? text.toLowerCase() : '';
  }

  function normaliseReferenceValue(value) {
    return lowerText(value, 160);
  }

  function parseIsoDate(value) {
    const text = trimText(value, 40);
    if (!text) return null;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function startOfToday(now = new Date()) {
    const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
    if (Number.isNaN(date.getTime())) return new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function referenceTokens(value) {
    const base = normaliseReferenceValue(value);
    if (!base) return [];
    const tokens = new Set([base]);
    base
      .split(/[^a-z0-9]+/i)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
      .forEach((part) => tokens.add(part));
    return Array.from(tokens);
  }

  function assignmentReferenceKeys(assignment = {}) {
    const keys = new Set();
    [
      assignment.as_ref,
      assignment.reference,
      assignment.po_number,
      assignment.po_ref,
      assignment.contractor_id,
      assignment.contractor_code,
    ].forEach((value) => {
      referenceTokens(value).forEach((token) => keys.add(token));
    });
    return Array.from(keys);
  }

  function candidateReferenceKeys(candidate = {}) {
    const keys = new Set();
    [
      candidate.ref,
      candidate.payroll_ref,
      candidate.timesheet_portal_reference,
      candidate.source_record_id,
      candidate.timesheet_portal_match?.reference,
      candidate.timesheet_portal_match?.accountingReference,
    ].forEach((value) => {
      referenceTokens(value).forEach((token) => keys.add(token));
    });
    return Array.from(keys);
  }

  function normaliseAssignmentRow(row = {}) {
    return {
      id: row.id,
      candidate_id: trimText(row.candidate_id, 120) || null,
      contractor_id: trimText(row.contractor_id, 120) || null,
      contractor_code: trimText(row.contractor_code, 120) || null,
      reference: trimText(row.as_ref || row.reference || row.po_number || row.po_ref, 160) || null,
      as_ref: trimText(row.as_ref, 160) || null,
      status: lowerText(row.status, 80) || 'draft',
      active: row.active !== false,
      candidate_name: trimText(row.candidate_name, 240) || null,
      client_name: trimText(row.client_name, 240) || null,
      job_title: trimText(row.job_title, 240) || null,
      start_date: trimText(row.start_date, 40) || null,
      end_date: trimText(row.end_date, 40) || null,
      currency: trimText(row.currency, 12) || 'GBP',
      rate_pay: row.rate_pay == null ? null : Number(row.rate_pay),
      rate_std: row.rate_std == null ? null : Number(row.rate_std),
    };
  }

  function isActiveAssignment(assignment = {}, now = new Date()) {
    const row = normaliseAssignmentRow(assignment);
    if (row.active === false) return false;
    if (['complete', 'completed', 'closed', 'archived', 'inactive', 'ended', 'finished'].includes(row.status)) return false;
    const today = startOfToday(now);
    const endDate = parseIsoDate(row.end_date);
    if (endDate && endDate < today) return false;
    return true;
  }

  function buildAssignmentLookups(assignments = [], now = new Date()) {
    const byCandidateId = new Map();
    const byReference = new Map();
    const activeRows = (Array.isArray(assignments) ? assignments : [])
      .map((row) => normaliseAssignmentRow(row))
      .filter((row) => isActiveAssignment(row, now));

    activeRows.forEach((row) => {
      const candidateId = trimText(row.candidate_id, 120);
      if (candidateId) {
        const bucket = byCandidateId.get(candidateId) || [];
        bucket.push(row);
        byCandidateId.set(candidateId, bucket);
      }
      assignmentReferenceKeys(row).forEach((key) => {
        const bucket = byReference.get(key) || [];
        bucket.push(row);
        byReference.set(key, bucket);
      });
    });

    return { activeRows, byCandidateId, byReference };
  }

  function matchCandidateAssignments(candidate = {}, lookups = {}) {
    const rows = [];
    const seen = new Set();
    const push = (assignment) => {
      if (!assignment) return;
      const key = String(assignment.id || assignment.reference || `${assignment.job_title}|${assignment.start_date}`);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(assignment);
    };

    const candidateId = trimText(candidate.id, 120);
    if (candidateId && lookups.byCandidateId?.has(candidateId)) {
      lookups.byCandidateId.get(candidateId).forEach(push);
    }

    candidateReferenceKeys(candidate).forEach((key) => {
      const bucket = lookups.byReference?.get(key) || [];
      bucket.forEach(push);
    });

    rows.sort((left, right) => {
      const a = parseIsoDate(left.start_date)?.getTime() || 0;
      const b = parseIsoDate(right.start_date)?.getTime() || 0;
      return b - a;
    });
    return rows;
  }

  function summariseCandidateAssignments(candidate = {}, lookups = {}) {
    const assignments = matchCandidateAssignments(candidate, lookups);
    const primary = assignments[0] || null;
    return {
      assignments,
      count: assignments.length,
      primary,
    };
  }

  return {
    assignmentReferenceKeys,
    buildAssignmentLookups,
    candidateReferenceKeys,
    isActiveAssignment,
    matchCandidateAssignments,
    normaliseAssignmentRow,
    normaliseReferenceValue,
    summariseCandidateAssignments,
  };
}));
