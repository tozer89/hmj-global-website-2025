// netlify/functions/admin-reports-reconcile.js
// Compare Supabase data volumes with bundled static datasets so admins can
// understand when previews are running from fallback data.

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { hasSupabase, getSupabase, supabaseStatus } = require('./_supabase.js');
const { loadStaticJobs } = require('./_jobs-helpers.js');
const { loadStaticCandidates } = require('./_candidates-helpers.js');
const { loadStaticClients } = require('./_clients-helpers.js');
const { loadStaticAssignments } = require('./_assignments-helpers.js');
const { loadStaticTimesheets } = require('./_timesheets-helpers.js');
const { fetchSettings, DEFAULT_SETTINGS } = require('./_settings-helpers.js');

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

const ok = (body) => ({ statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(body) });
const fail = (status, message, extra = {}) => ({
  statusCode: status,
  headers: JSON_HEADERS,
  body: JSON.stringify({ error: message, ...extra }),
});

async function countTable(supabase, table) {
  const { error, count } = await supabase.from(table).select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    const status = 403;
    return fail(status, err?.message || 'Unauthorized');
  }

  const generatedAt = new Date().toISOString();
  const { settings } = await fetchSettings(event, ['fiscal_week1_ending']);
  const baseWeek = settings?.fiscal_week1_ending || DEFAULT_SETTINGS.fiscal_week1_ending;

  const staticJobs = loadStaticJobs();
  const staticCandidates = loadStaticCandidates();
  const staticClients = loadStaticClients();
  const staticAssignments = loadStaticAssignments();
  const staticTimesheets = loadStaticTimesheets(baseWeek);

  const staticCounts = {
    jobs: staticJobs.length,
    candidates: staticCandidates.length,
    clients: staticClients.length,
    assignments: staticAssignments.length,
    timesheets: staticTimesheets.length,
    unpaidTimesheets: staticTimesheets.filter((ts) => String(ts.payroll_status || '').toLowerCase() !== 'paid').length,
  };

  const datasets = [
    { key: 'jobs', label: 'Jobs', static: staticCounts.jobs, supabase: null, delta: null, notes: [] },
    { key: 'candidates', label: 'Candidates', static: staticCounts.candidates, supabase: null, delta: null, notes: [] },
    { key: 'clients', label: 'Clients', static: staticCounts.clients, supabase: null, delta: null, notes: [] },
    { key: 'assignments', label: 'Assignments', static: staticCounts.assignments, supabase: null, delta: null, notes: [] },
    { key: 'timesheets', label: 'Timesheets', static: staticCounts.timesheets, supabase: null, delta: null, notes: [] },
    { key: 'timesheets_unpaid', label: 'Unpaid timesheets', static: staticCounts.unpaidTimesheets, supabase: null, delta: null, notes: [] },
  ];

  let supabaseCounts = null;
  let errorMessage = null;
  let schemaIssues = [];

  if (hasSupabase()) {
    try {
      const supabase = getSupabase(event);
      const [jobs, candidates, clients, assignments, timesheets] = await Promise.all([
        countTable(supabase, 'jobs'),
        countTable(supabase, 'candidates'),
        countTable(supabase, 'clients'),
        countTable(supabase, 'assignments'),
        countTable(supabase, 'timesheets'),
      ]);

      const { data: unpaidRows, error: unpaidErr } = await supabase
        .from('timesheets')
        .select('id', { count: 'exact', head: true })
        .not('payroll_status', 'eq', 'paid');
      if (unpaidErr && unpaidErr?.code !== 'PGRST116') throw unpaidErr; // ignore filter-not-supported

      supabaseCounts = {
        jobs,
        candidates,
        clients,
        assignments,
        timesheets,
        unpaidTimesheets: unpaidErr ? null : (unpaidRows?.length || unpaidRows?.count || 0),
      };
    } catch (err) {
      errorMessage = err?.message || String(err);
      if (err?.code === '42P01' || /relation\s.+does not exist/i.test(errorMessage)) {
        schemaIssues.push(errorMessage);
      }
    }
  } else {
    errorMessage = supabaseStatus().error || 'Supabase client unavailable';
  }

  if (supabaseCounts) {
    datasets.forEach((entry) => {
      const supaValue = supabaseCounts[entry.key] ?? null;
      entry.supabase = supaValue;
      if (typeof supaValue === 'number') {
        entry.delta = supaValue - entry.static;
        if (entry.delta === 0) entry.notes.push('Counts aligned');
        else if (entry.delta > 0) entry.notes.push(`Supabase has ${entry.delta} more records`);
        else entry.notes.push(`${Math.abs(entry.delta)} records only exist in preview data`);
      } else {
        entry.notes.push('Supabase count unavailable — check permissions or schema');
      }
    });
  } else {
    datasets.forEach((entry) => {
      entry.supabase = null;
      entry.delta = null;
      entry.notes.push('Using static fallback dataset');
    });
  }

  return ok({
    ok: true,
    generatedAt,
    supabase: supabaseStatus(),
    fallback: !supabaseCounts,
    error: errorMessage,
    schemaIssues,
    datasets,
    staticCounts,
  });
};

exports.handler = withAdminCors(baseHandler);
