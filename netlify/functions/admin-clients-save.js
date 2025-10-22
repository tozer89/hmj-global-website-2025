// netlify/functions/admin-clients-save.js
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');

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
      contact_name: client.contact_name || null,
      contact_email: client.contact_email || null,
      contact_phone: client.contact_phone || null,
      terms_days: client.terms_days ?? null,
      status: client.status || 'active',
      address: client.address || null, // optional JSONB
      billing: client.terms_text ? { notes: client.terms_text } : null,
    };

    const { data, error } = await supabase
      .from('clients')
      .upsert(payload)
      .select()
      .single();

    if (error) throw error;

    await recordAudit({
      actor: user,
      action: payload.id ? 'update' : 'create',
      targetType: 'client',
      targetId: data?.id,
      meta: { ...payload, terms_text: client.terms_text || null },
    });
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
