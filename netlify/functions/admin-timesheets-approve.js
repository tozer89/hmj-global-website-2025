// netlify/functions/admin-timesheets-approve.js
const { supabase, getContext } = require('./_timesheet-helpers');

async function audit(actor, action, targetId, meta) {
  await supabase.from('admin_audit_logs').insert({
    actor_email: actor?.email || 'unknown',
    actor_id: actor?.id || null,
    action, target_type: 'timesheet', target_id: String(targetId),
    meta
  });
}

exports.handler = async (event, context) => {
  try {
    const { user } = await getContext(context);
    const roles = user?.app_metadata?.roles || user?.roles || [];
    if (!roles.includes('admin')) throw Object.assign(new Error('Forbidden'), { code: 401 });

    const { id } = JSON.parse(event.body || '{}');
    if (!id) throw new Error('Missing id');

    const { data: prev } = await supabase.from('timesheets').select('id,status').eq('id', id).single();

    const { data, error } = await supabase
      .from('timesheets')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', id)
      .select('id,status,approved_at').single();
    if (error) throw error;

    await audit(user, 'approve', id, { before: prev, after: data });
    return { statusCode: 200, body: JSON.stringify({ ok: true, id, status: data.status }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
