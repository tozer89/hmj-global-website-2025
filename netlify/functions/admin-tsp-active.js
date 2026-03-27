'use strict';

// admin-tsp-active.js
// Returns live contractors + assignments from the Timesheet Portal for the
// TSP Active tab in the admin candidates page.  Fetches fresh on every call
// (no caching) so the tab always shows the current state.

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  listTimesheetPortalContractors,
  listTimesheetPortalAssignments,
  readTimesheetPortalConfig,
} = require('./_timesheet-portal.js');

const baseHandler = async (event, context) => {
  await getContext(event, context, { requireAdmin: true });

  if ((event.httpMethod || '').toUpperCase() !== 'GET') {
    throw coded(405, 'Method Not Allowed');
  }

  const config = readTimesheetPortalConfig();

  if (!config.enabled || !config.configured) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({
        ok: false,
        configured: false,
        error: 'Timesheet Portal is not configured for this environment.',
        contractors: [],
        assignments: [],
      }),
    };
  }

  // Fetch contractors and assignments in parallel
  const [contractorsResult, assignmentsResult] = await Promise.allSettled([
    listTimesheetPortalContractors(config, { take: 1000 }),
    listTimesheetPortalAssignments(config, { take: 1000 }),
  ]);

  const contractors = contractorsResult.status === 'fulfilled'
    ? (contractorsResult.value?.contractors || [])
    : [];

  const contractorError = contractorsResult.status === 'rejected'
    ? (contractorsResult.reason?.message || 'Could not load contractors')
    : null;

  const assignments = assignmentsResult.status === 'fulfilled'
    ? (assignmentsResult.value?.assignments || [])
    : [];

  const assignmentError = assignmentsResult.status === 'rejected'
    ? (assignmentsResult.reason?.message || 'Could not load assignments')
    : null;

  // If both failed, return an error
  if (contractorError && assignmentError) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({
        ok: false,
        configured: true,
        error: contractorError,
        contractors: [],
        assignments: [],
      }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify({
      ok: true,
      configured: true,
      fetchedAt: new Date().toISOString(),
      contractors,
      assignments,
      contractorCount: contractors.length,
      assignmentCount: assignments.length,
      ...(contractorError ? { contractorWarning: contractorError } : {}),
      ...(assignmentError ? { assignmentWarning: assignmentError } : {}),
    }),
  };
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
