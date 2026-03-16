'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  compareCandidates,
  listTimesheetPortalContractors,
  readTimesheetPortalConfig,
} = require('./_timesheet-portal.js');

async function loadWebsiteCandidates(supabase) {
  const rows = [];
  let from = 0;
  const pageSize = 1000;
  while (from < 10000) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('candidates')
      .select('id,email,first_name,last_name,full_name,phone,payroll_ref,status,updated_at')
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
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
