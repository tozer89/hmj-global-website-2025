const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { jsonError } = require('./_supabase.js');
const {
  normaliseTimesheet,
  sortItems,
  buildCsv,
} = require('./_payroll-export.js');

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function parseParams(event) {
  if (event.httpMethod === 'POST') {
    return JSON.parse(event.body || '{}');
  }
  return event.queryStringParameters || {};
}

const baseHandler = async (event, context) => {
  const trace = `payroll-csv-${Date.now()}`;
  try {
    const { supabase, supabaseError } = await getContext(event, context, { requireAdmin: true });
    if (!supabase || typeof supabase.from !== 'function') {
      const message = supabaseError?.message || 'Supabase client unavailable';
      return jsonError(503, 'supabase_unavailable', message, { trace });
    }

    const params = parseParams(event);
    const weekEnding = params.week_ending ? String(params.week_ending) : '';
    const clientFilter = params.client_id ? String(params.client_id) : null;
    const format = String(params.format || 'generic').toLowerCase() === 'brightpay_basic' ? 'brightpay_basic' : 'generic';

    if (!weekEnding) {
      return jsonError(400, 'bad_request', 'week_ending is required', { trace });
    }

    console.log('[payroll-csv] week=%s client=%s format=%s', weekEnding, clientFilter || 'all', format);

    const { data, error } = await supabase
      .from('timesheets')
      .select(
        `id, assignment_id, assignment_ref, candidate_id, candidate_name, contractor_name, contractor_email, contractor_id,
         client_id, client_name, project_id, project_name, status, week_ending, total_hours, ot_hours, rate_pay, rate_charge,
         rate_ot, pay_amount, charge_amount, gp_amount, currency, ts_ref, payroll_status, payroll_meta, payroll_batch, paid_at,
         payment_reference, h_mon, h_tue, h_wed, h_thu, h_fri, h_sat, h_sun,
         assignments:assignment_id (id, contractor_id, contractor_email, contractor_name, client_id, client_name, project_id,
           projects:project_id (id, name, client_id, clients:client_id (id, name))
         )`
      )
      .eq('week_ending', weekEnding);

    if (error) {
      console.error('[payroll-csv] query failed', error.message);
      return jsonError(500, 'query_failed', error.message, { trace });
    }

    const normalized = (data || []).map((row) => normaliseTimesheet(row));
    const filteredByClient = clientFilter
      ? normalized.filter((row) => {
        const idMatch = row.client_id ? String(row.client_id) === clientFilter : false;
        const nameMatch = row.client_name ? String(row.client_name).toLowerCase() === clientFilter.toLowerCase() : false;
        return idMatch || nameMatch;
      })
      : normalized;

    const items = sortItems(filteredByClient);
    const { csv } = buildCsv(items, format);
    const filename = `payroll-export-${weekEnding}-${format}.csv`;

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        csv,
        filename,
        mime: 'text/csv',
        trace,
      }),
    };
  } catch (err) {
    const status = err.code === 401 ? 403 : err.code === 403 ? 403 : 500;
    console.error('[payroll-csv] error', err?.message || err);
    return {
      statusCode: status,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: err.message || 'Unexpected error', code: err.code || 'csv_error', trace }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
