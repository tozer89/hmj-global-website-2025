// netlify/functions/admin-candidates-save.js
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
    const { user } = await getContext(context, { requireAdmin: true });
    const { contractor } = JSON.parse(event.body || '{}');
    if (!contractor) return { statusCode: 400, body: JSON.stringify({ error: 'Missing contractor' }) };

    // Only pass columns that exist in your table:
    const payload = {
      id: contractor.id ?? undefined,
      name: contractor.name,
      email: contractor.email,
      phone: contractor.phone || null,
      payroll_ref: contractor.payroll_ref || null,
      // Optional JSONB columns if you created them:
      address: contractor.address || null,                   // { line1, city, postcode, ... }
      bank: contractor.bank || null,                         // { sort_code, account_number, iban, swift }
      emergency_contact: contractor.emergency_contact || null, // { name, phone, relation }
      right_to_work: contractor.right_to_work || null,       // { status, doc_type, doc_ref, expiry }
      pay_type: contractor.pay_type || null                  // 'PAYE'|'Ltd Co'|'CIS'|...
    };

    const { data, error } = await supabase
      .from('contractors')
      .upsert(payload)
      .select()
      .single();

    if (error) throw error;

    await audit(user, payload.id ? 'update' : 'create', 'contractor', data.id, payload);
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
