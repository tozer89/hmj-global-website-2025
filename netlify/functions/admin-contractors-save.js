// netlify/functions/admin-contractors-save.js
const { withAdminCors } = require('./_http.js');
const { supabase } = require('./_supabase.js');
const { getContext, coded } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');

const baseHandler = async (event, context) => {
  try {
    const { user } = await getContext(event, context, { requireAdmin: true });
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

    await recordAudit({
      actor: user,
      action: payload.id ? 'update' : 'create',
      targetType: 'contractor',
      targetId: res.data.id,
      meta: row,
    });

    return { statusCode: 200, body: JSON.stringify(res.data) };
  } catch (e) {
    const status = e.code === 401 || e.code === 403 ? e.code : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};

exports.handler = withAdminCors(baseHandler);
