const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { jsonError } = require('./_supabase.js');
const { normaliseTimesheet } = require('./_payroll-export.js');

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function parseParams(event) {
  return JSON.parse(event.body || '{}');
}

function requireExportToken(event, payload) {
  const required = process.env.ADMIN_EXPORT_TOKEN;
  if (!required) return null;
  const headerToken = event?.headers?.['x-admin-export-token'] || event?.headers?.['X-Admin-Export-Token'];
  const provided = payload?.admin_export_token || headerToken || '';
  if (String(provided) !== String(required)) {
    return 'Missing or invalid ADMIN_EXPORT_TOKEN';
  }
  return null;
}

function buildPayrollMeta(row = {}, batch, paidAt, reference) {
  const meta = row.payroll_meta && typeof row.payroll_meta === 'object' ? row.payroll_meta : {};
  return {
    ...meta,
    status: 'paid',
    batch,
    paid_at: paidAt,
    reference: reference || meta.reference || null,
  };
}

async function updateTimesheet(supabase, id, payload) {
  let nextPayload = { ...payload };
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await supabase.from('timesheets').update(nextPayload).eq('id', id);
    if (!error) return { ok: true };
    lastError = error;
    const message = error.message || '';
    const match = message.match(/column \"([^\"]+)\" does not exist/i);
    if (match) {
      const column = match[1];
      if (column in nextPayload) {
        delete nextPayload[column];
        continue;
      }
    }
    break;
  }

  return { ok: false, error: lastError };
}

const baseHandler = async (event, context) => {
  const trace = `payroll-paid-${Date.now()}`;
  try {
    if ((event.httpMethod || '').toUpperCase() !== 'POST') {
      return jsonError(405, 'method_not_allowed', 'POST required', { trace });
    }

    const { supabase, supabaseError } = await getContext(event, context, { requireAdmin: true });
    if (!supabase || typeof supabase.from !== 'function') {
      const message = supabaseError?.message || 'Supabase client unavailable';
      return jsonError(503, 'supabase_unavailable', message, { trace });
    }

    const payload = parseParams(event);
    const weekEnding = payload.week_ending ? String(payload.week_ending) : '';
    const clientFilter = payload.client_id ? String(payload.client_id) : null;
    const batch = payload.payroll_batch ? String(payload.payroll_batch) : '';
    const paidAt = payload.paid_at ? String(payload.paid_at) : new Date().toISOString();
    const reference = payload.payment_reference ? String(payload.payment_reference) : null;

    const tokenError = requireExportToken(event, payload);
    if (tokenError) {
      return jsonError(403, 'forbidden', tokenError, { trace });
    }

    if (!weekEnding || !batch) {
      return jsonError(400, 'bad_request', 'week_ending and payroll_batch are required', { trace });
    }

    console.log('[payroll-mark-paid] week=%s client=%s batch=%s', weekEnding, clientFilter || 'all', batch);

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
      console.error('[payroll-mark-paid] query failed', error.message);
      return jsonError(500, 'query_failed', error.message, { trace });
    }

    const normalized = (data || []).map((row) => normaliseTimesheet(row));
    const scopedRows = clientFilter
      ? normalized.filter((row) => {
        const idMatch = row.client_id ? String(row.client_id) === clientFilter : false;
        const nameMatch = row.client_name ? String(row.client_name).toLowerCase() === clientFilter.toLowerCase() : false;
        return idMatch || nameMatch;
      })
      : normalized;

    let updatedCount = 0;
    let alreadyPaidCount = 0;
    let failedCount = 0;
    const failures = [];

    for (const row of scopedRows) {
      const existingBatch = row.payroll_batch || null;
      const alreadyPaid = String(row.payroll_status || '').toLowerCase() === 'paid' || row.paid_at;

      if (alreadyPaid && existingBatch === batch) {
        alreadyPaidCount += 1;
        continue;
      }

      if (alreadyPaid && existingBatch && existingBatch !== batch) {
        alreadyPaidCount += 1;
        continue;
      }

      const payrollMeta = buildPayrollMeta(row, batch, paidAt, reference);
      const payloadUpdate = {
        payroll_status: 'paid',
        paid_at: paidAt,
        payroll_batch: batch,
        payment_reference: reference,
        payroll_meta: payrollMeta,
      };

      const result = await updateTimesheet(supabase, row.id, payloadUpdate);
      if (!result.ok) {
        failedCount += 1;
        failures.push({ id: row.id, error: result.error?.message || 'update_failed' });
        continue;
      }
      updatedCount += 1;
    }

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        updated_count: updatedCount,
        already_paid_count: alreadyPaidCount,
        failed_count: failedCount,
        trace,
        failures,
      }),
    };
  } catch (err) {
    const status = err.code === 401 ? 403 : err.code === 403 ? 403 : 500;
    console.error('[payroll-mark-paid] error', err?.message || err);
    return {
      statusCode: status,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: err.message || 'Unexpected error', code: err.code || 'mark_paid_error', trace }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
