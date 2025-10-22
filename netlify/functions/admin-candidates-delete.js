// netlify/functions/admin-candidates-delete.js
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');
const { recordAudit } = require('./_audit.js');

exports.handler = async (event, context) => {
  try {
    const { user } = await getContext(event, context, { requireAdmin: true });
    const { id } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };

    const { error } = await supabase.from('contractors').delete().eq('id', id);
    if (error) throw error;

    await recordAudit({
      actor: user,
      action: 'delete',
      targetType: 'contractor',
      targetId: id,
      meta: {},
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
