// netlify/functions/admin-assignments-save.js
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

async function audit(actor, action, entity, entity_id, details) {
  await supabase.from('admin_audit_logs').insert({
    actor_email: actor?.email || null,
    action, entity, entity_id,
    details
  });
}

exports.handler = async (event, context) => {
  try {
    const { user } = await getContext(event, context, { requireAdmin: true });
    const { assignment } = JSON.parse(event.body || '{}');
    if (!assignment) return { statusCode: 400, body: JSON.stringify({ error: 'Missing assignment' }) };

    const payload = {
      id: assignment.id ?? undefined,
      contractor_id: assignment.contractor_id,
      project_id: assignment.project_id,
      rate_std: assignment.rate_std ?? null,
      rate_ot: assignment.rate_ot ?? null,
      charge_std: assignment.charge_std ?? null,
      charge_ot: assignment.charge_ot ?? null,
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

    await audit(user, payload.id ? 'update' : 'create', 'assignment', data.id, payload);
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
