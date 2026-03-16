'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  compareCandidates,
  listTimesheetPortalContractors,
  readTimesheetPortalConfig,
} = require('./_timesheet-portal.js');

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || '');
  if (!message) return false;
  if (columnName) {
    return new RegExp(`column "?${columnName}"? does not exist`, 'i').test(message)
      || new RegExp(`Could not find the '${columnName}' column of`, 'i').test(message);
  }
  return /column "?[a-zA-Z0-9_]+"? does not exist/i.test(message)
    || /Could not find the '[a-zA-Z0-9_]+' column of/i.test(message);
}

async function fetchCandidatePage(supabase, from, to, { includePayrollRef = true } = {}) {
  const columns = [
    'id',
    'email',
    'first_name',
    'last_name',
    'full_name',
    'phone',
    includePayrollRef && 'payroll_ref',
    'status',
    'updated_at',
  ].filter(Boolean).join(',');

  return supabase
    .from('candidates')
    .select(columns)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .range(from, to);
}

async function loadWebsiteCandidates(supabase) {
  const rows = [];
  let from = 0;
  const pageSize = 1000;
  let includePayrollRef = true;
  while (from < 10000) {
    const to = from + pageSize - 1;
    let { data, error } = await fetchCandidatePage(supabase, from, to, { includePayrollRef });
    if (error && includePayrollRef && isMissingColumnError(error, 'payroll_ref')) {
      includePayrollRef = false;
      ({ data, error } = await fetchCandidatePage(supabase, from, to, { includePayrollRef: false }));
      if (!error && Array.isArray(data)) {
        data = data.map((row) => ({ ...row, payroll_ref: null }));
      }
    }
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

const baseHandler = async (event, context) => {
  const { supabase } = await getContext(event, context, { requireAdmin: true });
  if ((event.httpMethod || '').toUpperCase() !== 'POST') throw coded(405, 'Method Not Allowed');
  if (!supabase || typeof supabase.from !== 'function') throw coded(503, 'Supabase unavailable.');

  const config = readTimesheetPortalConfig();
  if (!config.enabled || !config.configured) {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        ok: true,
        configured: false,
        message: 'Timesheet Portal is not configured for this environment.',
      }),
    };
  }

  try {
    const [websiteCandidates, tspData] = await Promise.all([
      loadWebsiteCandidates(supabase),
      listTimesheetPortalContractors(config, { take: 1000 }),
    ]);
    const comparison = compareCandidates(websiteCandidates, tspData.contractors);

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        ok: true,
        configured: true,
        comparedAt: new Date().toISOString(),
        candidatePath: tspData.discovery.candidatePath,
        attempts: tspData.discovery.attempts,
        ...comparison,
      }),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        ok: false,
        configured: true,
        message: error?.message || 'Timesheet Portal comparison failed.',
        code: error?.code || 'timesheet_portal_compare_failed',
        attempts: Array.isArray(error?.attempts) ? error.attempts : [],
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
