// netlify/functions/admin-timesheet-reject.js
const { getContext } = require('./_timesheet-helpers.js');

exports.handler = async (event, context) => {
  try {
    const { user, supabase } = await getContext(context, { requireAdmin: true });
    const { id, reason = '' } = JSON.parse(event.body || '{}');
    if (!id) throw new Error('Missing id');

    const { error } = await supabase.from('timesheets')
      .update({ status: 'rejected', rejected_at: new Date().toISOString(), rejection_reason: reason })
      .eq('id', id);
    if (error) throw error;

    await supabase.from('admin_audit_logs').insert({
      actor_email: user.email, actor_id: user.id,
      action: 'reject_timesheet', target_type: 'timesheet', target_id: String(id),
      meta: { reason }
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
