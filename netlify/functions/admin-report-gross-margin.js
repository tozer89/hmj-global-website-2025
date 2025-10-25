// netlify/functions/admin-report-gross-margin.js
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { supabaseStatus, hasSupabase, getSupabase } = require('./_supabase.js');
const { loadStaticTimesheets } = require('./_timesheets-helpers.js');
const { loadStaticAssignments } = require('./_assignments-helpers.js');
const { fetchSettings, DEFAULT_SETTINGS, fiscalWeekNumber } = require('./_settings-helpers.js');

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function makeTimesheetRow(ts, assignment, baseWeekEnding) {
  const stdHours = toNumber(ts.total_hours) - toNumber(ts.ot_hours);
  const otHours = toNumber(ts.ot_hours);
  const totalHours = stdHours + otHours;
  const pay = toNumber(ts.pay_amount) || (toNumber(ts.rate_pay) * totalHours);
  const charge = toNumber(ts.charge_amount) || (toNumber(ts.rate_charge) * totalHours);
  const gp = charge - pay;
  const currency = ts.currency || assignment?.currency || 'GBP';
  const weekNo = fiscalWeekNumber(ts.week_ending, baseWeekEnding);

  return {
    id: ts.id,
    assignmentId: ts.assignment_id || assignment?.id || null,
    assignmentRef: ts.assignment_ref || assignment?.as_ref || assignment?.ref || null,
    jobTitle: assignment?.job_title || assignment?.jobTitle || null,
    clientName: ts.client_name || assignment?.client_name || null,
    candidateId: ts.candidate_id || assignment?.contractor_id || null,
    candidateName: ts.candidate_name || assignment?.candidate_name || assignment?.contractor_name || null,
    consultant: assignment?.consultant_name || null,
    weekEnding: ts.week_ending,
    weekNo,
    status: ts.status || 'draft',
    hours: {
      std: stdHours,
      ot: otHours,
      total: totalHours,
    },
    rates: {
      pay: toNumber(ts.rate_pay || assignment?.rate_pay || assignment?.rate_std),
      charge: toNumber(ts.rate_charge || assignment?.rate_charge || assignment?.charge_std),
    },
    totals: {
      pay,
      charge,
      gp,
    },
    currency,
    submittedAt: ts.submitted_at || null,
    approvedAt: ts.approved_at || null,
  };
}

function summarise(rows = []) {
  const byCurrency = new Map();
  const byContractor = new Map();
  const byWeek = new Map();

  rows.forEach((row) => {
    const { currency, totals, candidateId, candidateName, weekNo } = row;
    const curKey = currency || 'GBP';
    const curSum = byCurrency.get(curKey) || { pay: 0, charge: 0, gp: 0 };
    curSum.pay += toNumber(totals.pay);
    curSum.charge += toNumber(totals.charge);
    curSum.gp += toNumber(totals.gp);
    byCurrency.set(curKey, curSum);

    const contractorKey = `${candidateId || candidateName || 'unknown'}|${curKey}`;
    const contractorSum = byContractor.get(contractorKey) || { candidateId, candidateName, currency: curKey, pay: 0, charge: 0, gp: 0, rows: 0 };
    contractorSum.pay += toNumber(totals.pay);
    contractorSum.charge += toNumber(totals.charge);
    contractorSum.gp += toNumber(totals.gp);
    contractorSum.rows += 1;
    byContractor.set(contractorKey, contractorSum);

    if (Number.isFinite(weekNo)) {
      const weekBucket = byWeek.get(weekNo) || { pay: 0, charge: 0, gp: 0, rows: 0, currency: curKey };
      weekBucket.pay += toNumber(totals.pay);
      weekBucket.charge += toNumber(totals.charge);
      weekBucket.gp += toNumber(totals.gp);
      weekBucket.rows += 1;
      byWeek.set(weekNo, weekBucket);
    }
  });

  const contractors = Array.from(byContractor.values()).sort((a, b) => b.gp - a.gp);
  const currencies = Object.fromEntries(Array.from(byCurrency.entries()));
  const weeks = Object.fromEntries(Array.from(byWeek.entries()).sort((a, b) => a[0] - b[0]));

  return { currencies, contractors, weeks };
}

async function loadStatic(baseWeekEnding) {
  const timesheets = loadStaticTimesheets(baseWeekEnding);
  const assignments = loadStaticAssignments();
  const assignmentMap = new Map(assignments.map((a) => [Number(a.id), a]));
  return timesheets.map((ts) => makeTimesheetRow(ts, assignmentMap.get(Number(ts.assignment_id)) || null, baseWeekEnding));
}

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : {};
    const { fromWeek, toWeek, status, currencies, limit = 500 } = body;
    const settings = await fetchSettings(event, ['fiscal_week1_ending']);
    const baseWeekEnding = settings.settings?.fiscal_week1_ending || DEFAULT_SETTINGS.fiscal_week1_ending;

    const filters = {
      fromWeek: fromWeek ? String(fromWeek) : null,
      toWeek: toWeek ? String(toWeek) : null,
      status: status ? String(status).toLowerCase() : null,
      currencies: ensureArray(currencies).map((c) => String(c).toUpperCase()),
    };

    const respond = (rows, source, warning = null) => ({
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        rows,
        summary: summarise(rows),
        filters,
        source,
        warning,
        supabase: supabaseStatus(),
        config: { week1Ending: baseWeekEnding, source: settings.source },
      }),
    });

    if (!hasSupabase()) {
      const rows = loadStatic(baseWeekEnding);
      return respond(rows, 'static', settings.error || 'Supabase unavailable');
    }

    const supabase = getSupabase(event);
    let query = supabase
      .from('timesheets')
      .select(
        `id, assignment_id, assignment_ref, candidate_id, candidate_name, client_name, week_ending, status,
         total_hours, ot_hours, rate_pay, rate_charge, pay_amount, charge_amount, currency, submitted_at, approved_at,
         assignments:assignment_id (id, job_title, client_name, consultant_name, currency, rate_pay, rate_charge, rate_std, charge_std)`
      )
      .order('week_ending', { ascending: false })
      .limit(Math.min(Math.max(Number(limit) || 500, 50), 1000));

    if (filters.fromWeek) query = query.gte('week_ending', filters.fromWeek);
    if (filters.toWeek) query = query.lte('week_ending', filters.toWeek);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) {
      console.warn('[report-gp] supabase query failed — falling back to static', error.message);
      const rows = loadStatic(baseWeekEnding);
      return respond(rows, 'static-error', error.message);
    }

    const rows = (data || []).map((ts) => makeTimesheetRow(ts, ts.assignments || null, baseWeekEnding));
    const filtered = rows.filter((row) => {
      if (filters.currencies.length && !filters.currencies.includes((row.currency || 'GBP').toUpperCase())) return false;
      return true;
    });

    if (!filtered.length) {
      const fallback = loadStatic(baseWeekEnding);
      if (fallback.length) {
        return respond(fallback, 'static-empty', 'No live rows returned; showing fallback data.');
      }
    }

    return respond(filtered, 'supabase');
  } catch (err) {
    return {
      statusCode: err.code === 401 ? 401 : err.code === 403 ? 403 : 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: err.message || 'Unexpected error', code: err.code || 'report_error' }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
