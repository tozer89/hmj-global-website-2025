// netlify/functions/admin-clients-save.js
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
    const { client } = JSON.parse(event.body || '{}');
    if (!client) return { statusCode: 400, body: JSON.stringify({ error: 'Missing client' }) };

    const payload = {
      id: client.id ?? undefined,
      name: client.name,
      billing_email: client.billing_email || null,
      phone: client.phone || null,
      address: client.address || null // optional JSONB
    };

    const { data, error } = await supabase
      .from('clients')
      .upsert(payload)
      .select()
      .single();

    if (error) throw error;

    await audit(user, payload.id ? 'update' : 'create', 'client', data.id, payload);
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
