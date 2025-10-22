// netlify/functions/admin-assignments-save.js
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');

exports.handler = async (event, context) => {
  try {
    const { user } = await getContext(event, context, { requireAdmin: true });
    const body = JSON.parse(event.body || '{}');
    const assignment = body && typeof body === 'object'
      ? (body.assignment && typeof body.assignment === 'object' ? body.assignment : body)
      : null;
    if (!assignment) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing assignment' }) };
    }

    const asNumber = (value) => {
      if (value === undefined || value === null || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const asBoolean = (value) => {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return null;
    };

    const payload = {
      id: assignment.id != null ? Number(assignment.id) : undefined,
      contractor_id: asNumber(assignment.contractor_id),
      project_id: asNumber(assignment.project_id),
      site_id: asNumber(assignment.site_id),
      job_title: assignment.job_title ?? null,
      status: assignment.status || 'draft',
      candidate_name: assignment.candidate_name ?? null,
      client_name: assignment.client_name ?? null,
      client_site: assignment.client_site ?? null,
      consultant_name: assignment.consultant_name ?? null,
      po_number: assignment.po_number ?? null,
      po_ref: assignment.po_ref ?? null,
      as_ref: assignment.as_ref ?? null,
      start_date: assignment.start_date || null,
      end_date: assignment.end_date || null,
      days_per_week: asNumber(assignment.days_per_week),
      hours_per_day: asNumber(assignment.hours_per_day),
      currency: assignment.currency || null,
      rate_std: asNumber(assignment.rate_std) ?? asNumber(assignment.rate_pay),
      rate_ot: asNumber(assignment.rate_ot),
      charge_std: asNumber(assignment.charge_std),
      charge_ot: asNumber(assignment.charge_ot),
      rate_pay: asNumber(assignment.rate_pay) ?? asNumber(assignment.rate_std),
      rate_charge: asNumber(assignment.rate_charge),
      pay_freq: assignment.pay_freq || null,
      ts_type: assignment.ts_type || null,
      shift_type: assignment.shift_type || null,
      auto_ts: !!assignment.auto_ts,
      approver: assignment.approver || null,
      notes: assignment.notes || null,
      hs_risk: assignment.hs_risk || null,
      rtw_ok: typeof assignment.rtw_ok === 'boolean' ? assignment.rtw_ok : null,
      quals: assignment.quals || null,
      special: assignment.special || null,
      duties: assignment.duties || null,
      equipment: assignment.equipment || null,
      terms_sent: typeof assignment.terms_sent === 'boolean' ? assignment.terms_sent : null,
      sig_ok: typeof assignment.sig_ok === 'boolean' ? assignment.sig_ok : null,
      notice_temp: assignment.notice_temp || null,
      notice_client: assignment.notice_client || null,
      term_reason: assignment.term_reason || null,
      contract_url: assignment.contract_url || null,
    };

    if (payload.id !== undefined && !Number.isFinite(payload.id)) {
      delete payload.id;
    }

    const active = asBoolean(assignment.active);
    if (active !== null) {
      payload.active = active;
    } else if (payload.status === 'live') {
      payload.active = true;
    }

    if (!payload.contractor_id || !payload.project_id || !payload.start_date) {
      return { statusCode: 400, body: JSON.stringify({ error: 'contractor_id, project_id, start_date are required' }) };
    }
    if (payload.rate_std == null) {
      return { statusCode: 400, body: JSON.stringify({ error: 'rate_std is required' }) };
    }

    const { data, error } = await supabase
      .from('assignments')
      .upsert(payload)
      .select()
      .single();

    if (error) throw error;

    await recordAudit({
      actor: user,
      action: payload.id ? 'update' : 'create',
      targetType: 'assignment',
      targetId: data?.id,
      meta: payload,
    });
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
