const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const {
  toNumber,
  buildAvailableFilters,
  applyFilters,
  loadTimesheetRows,
} = require('./_timesheets-reporting.js');

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function buildExceptions(rows = []) {
  const exceptions = {
    zero_hours_submitted: {
      label: 'Submitted/Approved with 0 hours',
      rows: [],
    },
    missing_contractor_email: {
      label: 'Missing contractor email',
      rows: [],
    },
    missing_refs: {
      label: 'Missing assignment_ref or ts_ref',
      rows: [],
    },
    margin_anomaly: {
      label: 'Margin anomaly (negative GP or pay > charge)',
      rows: [],
    },
    duplicate_timesheets: {
      label: 'Duplicate contractor + week + assignment',
      rows: [],
    },
  };

  const duplicateMap = new Map();

  rows.forEach((row) => {
    const status = (row.payroll_status || row.status || '').toLowerCase();
    const totalHours = toNumber(row.total_hours);
    const pay = toNumber(row.pay_amount);
    const charge = toNumber(row.charge_amount);
    const gp = toNumber(row.gp_amount);

    if (totalHours <= 0 && ['submitted', 'approved', 'paid'].includes(status)) {
      exceptions.zero_hours_submitted.rows.push(row);
    }

    if (!row.contractor_email) {
      exceptions.missing_contractor_email.rows.push(row);
    }

    if (!row.assignment_ref || !row.ts_ref) {
      exceptions.missing_refs.rows.push(row);
    }

    if (gp < 0 || pay > charge) {
      exceptions.margin_anomaly.rows.push(row);
    }

    const dupKey = `${row.contractor_id || row.contractor_name || row.candidate_name || 'unknown'}|${row.week_ending || 'unknown'}|${row.assignment_id || 'unknown'}`;
    if (duplicateMap.has(dupKey)) {
      duplicateMap.get(dupKey).push(row);
    } else {
      duplicateMap.set(dupKey, [row]);
    }
  });

  duplicateMap.forEach((group) => {
    if (group.length > 1) {
      exceptions.duplicate_timesheets.rows.push(...group);
    }
  });

  const summaryCounts = Object.fromEntries(
    Object.entries(exceptions).map(([key, value]) => [key, value.rows.length])
  );

  return { exceptions, summaryCounts };
}

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });

    const params = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : event.queryStringParameters || {};
    const weekEnding = params.week_ending ? String(params.week_ending) : null;
    const clientFilter = params.client_id ? String(params.client_id) : null;

    const { rows, source, warning, supabase, config } = await loadTimesheetRows(event, { limit: 2000 });
    const available = buildAvailableFilters(rows);
    const filtered = applyFilters(rows, { weekEnding, clientFilter });
    const { exceptions, summaryCounts } = buildExceptions(filtered);

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        filters: {
          week_ending: weekEnding,
          client_id: clientFilter,
        },
        available,
        summary: {
          total_exceptions: Object.values(summaryCounts).reduce((sum, value) => sum + value, 0),
          counts: summaryCounts,
        },
        exceptions,
        source,
        warning,
        supabase,
        config,
      }),
    };
  } catch (err) {
    return {
      statusCode: err.code === 401 ? 403 : err.code === 403 ? 403 : 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: err.message || 'Unexpected error', code: err.code || 'exceptions_error' }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
