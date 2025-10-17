// netlify/functions/admin-clients-save.js
const { supabase } = require('./_supabase.js');
const { getContext, coded } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    const { user, roles } = await getContext(context, { requireAdmin: true });
    const p = JSON.parse(event.body || '{}');
    if (!p.name) throw coded(400, 'name required');

    const row = {
      name: p.name,
      contact_name: p.contact_name || null,
      contact_email: p.contact_email || null,
      contact_phone: p.contact_phone || null,
      billing: p.billing || {},
      status: p.status || 'active'
    };

    let res = p.id
      ? await supabase.from('clients').update(row).eq('id', p.id).select().single()
      : await supabase.from('clients').insert(row).select().single();

    if (res.error) throw coded(500, res.error.message);

    await supabase.from('audit_log').insert({
      actor_email: user.email, actor_roles: roles,
      action: p.id ? 'update' : 'create',
      entity: 'client', entity_id: res.data.id, payload: row
    });

    return { statusCode: 200, body: JSON.stringify(res.data) };
  } catch (e) {
    const status = e.code === 401 || e.code === 403 ? e.code : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
