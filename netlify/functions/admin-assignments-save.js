// netlify/functions/admin-assignments-save.js
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');

exports.handler = async (event, context) => {
  try {
    const { user } = await getContext(event, context, { requireAdmin: true });
    const { assignment } = JSON.parse(event.body || '{}');
    if (!assignment) return { statusCode: 400, body: JSON.stringify({ error: 'Missing assignment' }) };

    const active = typeof assignment.active === 'boolean'
      ? assignment.active
      : assignment.active === 'true'
        ? true
        : assignment.active === 'false'
          ? false
          : null;

    const payload = {
      id: assignment.id ?? undefined,
      contractor_id: assignment.contractor_id,
      project_id: assignment.project_id,
      site_id: assignment.site_id ?? null,
      rate_std: assignment.rate_std ?? null,
      rate_ot: assignment.rate_ot ?? null,
      charge_std: assignment.charge_std ?? null,
      charge_ot: assignment.charge_ot ?? null,
      po_number: assignment.po_number ?? null,
      active,
      start_date: assignment.start_date,
      end_date: assignment.end_date ?? null
    };

    if (!payload.contractor_id || !payload.project_id || !payload.start_date) {
      return { statusCode: 400, body: JSON.stringify({ error: 'contractor_id, project_id, start_date are required' }) };
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
