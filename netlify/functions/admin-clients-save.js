// netlify/functions/admin-clients-save.js
const { withAdminCors } = require('./_http.js');
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');

function isMissingClientsSchemaError(error) {
  const message = String(error?.message || error || '');
  return /Could not find the table 'public\.clients' in the schema cache/i.test(message)
    || /relation "?clients"? does not exist/i.test(message);
}

const baseHandler = async (event, context) => {
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

    if (error) {
      if (isMissingClientsSchemaError(error)) {
        return {
          statusCode: 409,
          body: JSON.stringify({ error: 'Client storage is not available on this environment yet. Use Timesheet Portal refresh or apply the clients schema patch first.' }),
        };
      }
      throw error;
    }

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

exports.handler = withAdminCors(baseHandler);
