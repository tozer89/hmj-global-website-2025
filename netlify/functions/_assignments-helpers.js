let staticAssignments = [];
try {
  const seed = require('../../data/assignments.json');
  if (Array.isArray(seed?.assignments)) staticAssignments = seed.assignments;
  else if (Array.isArray(seed)) staticAssignments = seed;
} catch (err) {
  console.warn('[assignments] unable to pre-load static dataset', err?.message || err);
}

function toAssignment(row = {}) {
  return {
    id: Number(row.id) || row.id || null,
    contractor_id: row.contractor_id || null,
    contractor_name: row.contractor_name || row.candidate_name || null,
    contractor_email: row.contractor_email || row.candidate_email || null,
    project_id: row.project_id || null,
    project_name: row.project_name || null,
    client_id: row.client_id || null,
    client_name: row.client_name || null,
    site_name: row.site_name || row.client_site || null,
    job_title: row.job_title || null,
    status: row.status || 'pending',
    candidate_name: row.candidate_name || row.contractor_name || null,
    candidate_id: row.candidate_id || null,
    as_ref: row.as_ref || row.assignment_ref || null,
    rate_std: Number(row.rate_std || row.rate_pay || 0) || null,
    rate_pay: Number(row.rate_pay || row.rate_std || 0) || null,
    charge_std: Number(row.charge_std || 0) || null,
    charge_ot: Number(row.charge_ot || 0) || null,
    start_date: row.start_date || null,
    end_date: row.end_date || null,
    currency: row.currency || 'GBP',
    po_number: row.po_number || row.po_ref || null,
    consultant_name: row.consultant_name || null,
    active: row.active !== undefined ? !!row.active : true,
    notes: row.notes || null,
  };
}

function loadStaticAssignments() {
  if (!staticAssignments.length) return [];
  return staticAssignments.map(toAssignment);
}

module.exports = {
  loadStaticAssignments,
  toAssignment,
};
