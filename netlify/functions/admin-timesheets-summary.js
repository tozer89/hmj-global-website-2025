const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const {
  toNumber,
  buildAvailableFilters,
  applyFilters,
  loadTimesheetRows,
} = require('./_timesheets-reporting.js');

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function summarise(rows = []) {
  const totals = {
    std_hours: 0,
    ot_hours: 0,
    pay_amount: 0,
    charge_amount: 0,
    gp_amount: 0,
  };

  const statusCounts = rows.reduce((acc, row) => {
    const status = (row.payroll_status || 'unknown').toLowerCase();
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  rows.forEach((row) => {
    totals.std_hours += toNumber(row.std_hours);
    totals.ot_hours += toNumber(row.ot_hours);
    totals.pay_amount += toNumber(row.pay_amount);
    totals.charge_amount += toNumber(row.charge_amount);
    totals.gp_amount += toNumber(row.gp_amount);
  });

  const margin = totals.charge_amount ? (totals.gp_amount / totals.charge_amount) * 100 : 0;

  return {
    ...totals,
    gross_margin_pct: Number.isFinite(margin) ? Number(margin.toFixed(2)) : 0,
    status_counts: statusCounts,
  };
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
    const summary = summarise(filtered);

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
        summary,
        rows: filtered,
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
      body: JSON.stringify({ ok: false, error: err.message || 'Unexpected error', code: err.code || 'summary_error' }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
