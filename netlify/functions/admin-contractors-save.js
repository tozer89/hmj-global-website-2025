// netlify/functions/admin-contractors-save.js
const { withAdminCors } = require('./_http.js');
const { supabase } = require('./_supabase.js');
const { getContext, coded } = require('./_auth.js');

const baseHandler = async (event, context) => {
  try {
    const { user, roles } = await getContext(event, context, { requireAdmin: true });
    const payload = JSON.parse(event.body || '{}');

    if (!payload.name || !payload.email) throw coded(400, 'name and email required');

    const row = {
      name: payload.name,
      email: payload.email.toLowerCase(),
      phone: payload.phone || null,
      payroll_ref: payload.payroll_ref || null,
      pay_type: payload.pay_type || null,
      address_json: payload.address_json || {},
      bank: payload.bank || {},
      emergency_contact: payload.emergency_contact || {},
      right_to_work: payload.right_to_work || {}
    };

    let res;
    if (payload.id) {
      res = await supabase.from('contractors').update(row).eq('id', payload.id).select().single();
    } else {
      res = await supabase.from('contractors').insert(row).select().single();
    }
    if (res.error) throw coded(500, res.error.message);

    // audit
    await supabase.from('audit_log').insert({
      actor_email: user.email, actor_roles: roles, action: payload.id ? 'update' : 'create',
      entity: 'contractor', entity_id: res.data.id, payload: row
    });

    return { statusCode: 200, body: JSON.stringify(res.data) };
  } catch (e) {
    const status = e.code === 401 || e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};

exports.handler = withAdminCors(baseHandler);
