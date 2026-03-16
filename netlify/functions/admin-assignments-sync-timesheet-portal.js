'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  listTimesheetPortalAssignments,
  readTimesheetPortalConfig,
} = require('./_timesheet-portal.js');
const {
  buildCandidateLookups,
  matchCandidateForTimesheetPortalAssignment,
  mergeTimesheetPortalAssignment,
} = require('./_assignments-sync.js');

async function loadWebsiteCandidates(supabase) {
  const rows = [];
  let from = 0;
  const pageSize = 1000;
  while (from < 10000) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('candidates')
      .select('id,email,full_name,first_name,last_name,payroll_ref,status')
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

async function loadExistingAssignments(supabase) {
  const columns = [
    'id',
    'candidate_id',
    'contractor_id',
    'project_id',
    'site_id',
    'job_title',
    'status',
    'candidate_name',
    'client_name',
    'client_site',
    'consultant_name',
    'po_number',
    'po_ref',
    'as_ref',
    'start_date',
    'end_date',
    'days_per_week',
    'hours_per_day',
    'currency',
    'rate_std',
    'rate_ot',
    'charge_std',
    'charge_ot',
    'rate_pay',
    'rate_charge',
    'pay_freq',
    'ts_type',
    'shift_type',
    'auto_ts',
    'approver',
    'notes',
    'hs_risk',
    'rtw_ok',
    'quals',
    'special',
    'duties',
    'equipment',
    'terms_sent',
    'sig_ok',
    'notice_temp',
    'notice_client',
    'term_reason',
    'contract_url',
    'active',
  ];
  const { data, error } = await supabase
    .from('assignments')
    .select(columns.join(','))
    .limit(5000);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
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
    const [tspData, websiteCandidates, existingRows] = await Promise.all([
      listTimesheetPortalAssignments(config, { take: 500, pageLimit: 20 }),
      loadWebsiteCandidates(supabase),
      loadExistingAssignments(supabase),
    ]);

    const lookups = buildCandidateLookups(websiteCandidates);
    const byRef = new Map();
    existingRows.forEach((row) => {
      const ref = String(row.as_ref || '').trim();
      if (ref && !byRef.has(ref)) byRef.set(ref, row);
    });

    const syncedAt = new Date().toISOString();
    const payloads = [];
    const preview = [];
    let matchedCandidates = 0;
    let unmatchedCandidates = 0;
    let skipped = 0;

    for (const assignment of tspData.assignments || []) {
      const reference = String(assignment.reference || assignment.id || '').trim();
      if (!reference) {
        skipped += 1;
        continue;
      }

      const existing = byRef.get(reference) || null;

      const { candidate, matchedBy } = matchCandidateForTimesheetPortalAssignment(assignment, lookups);
      if (candidate) matchedCandidates += 1;
      else unmatchedCandidates += 1;

      const payload = mergeTimesheetPortalAssignment({
        assignment,
        existing,
        candidate,
        matchedBy,
        syncedAt,
      });
      payloads.push(payload);

      if (preview.length < 15) {
        preview.push({
          as_ref: payload.as_ref,
          candidate_id: payload.candidate_id,
          candidate_name: payload.candidate_name,
          matched_by: matchedBy,
          status: payload.status,
        });
      }
    }

    let upsertedRows = [];
    if (payloads.length) {
      const { data, error } = await supabase
        .from('assignments')
        .upsert(payloads)
        .select('id,as_ref,candidate_id,candidate_name,status');
      if (error) throw error;
      upsertedRows = Array.isArray(data) ? data : [];
    }

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        ok: true,
        configured: true,
        syncedAt,
        assignmentPath: tspData.discovery.assignmentPath,
        attempts: tspData.discovery.attempts,
        fetched: Array.isArray(tspData.assignments) ? tspData.assignments.length : 0,
        upserted: upsertedRows.length,
        matchedCandidates,
        unmatchedCandidates,
        skipped,
        rows: preview,
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
        message: error?.message || 'Timesheet Portal assignment sync failed.',
        code: error?.code || 'timesheet_portal_assignment_sync_failed',
        attempts: Array.isArray(error?.attempts) ? error.attempts : [],
      }),
    };
  }
};

module.exports.handler = withAdminCors(baseHandler, { requireToken: false });
