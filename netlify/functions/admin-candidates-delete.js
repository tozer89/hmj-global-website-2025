// netlify/functions/admin-candidates-delete.js
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
    const { id } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };

    const { error } = await supabase.from('contractors').delete().eq('id', id);
    if (error) throw error;

    await audit(user, 'delete', 'contractor', id, {});
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
