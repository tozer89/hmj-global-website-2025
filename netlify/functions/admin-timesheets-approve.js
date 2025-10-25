// netlify/functions/admin-timesheets-approve.js
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_timesheet-helpers.js');

const baseHandler = async (event, context) => {
  try {
    const { user, supabase } = await getContext(context, { requireAdmin: true });
    const { id } = JSON.parse(event.body || '{}');
    if (!id) throw new Error('Missing id');

    const { error } = await supabase.from('timesheets')
      .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: user.email })
      .eq('id', id);
    if (error) throw error;

    await supabase.from('admin_audit_logs').insert({
      actor_email: user.email, actor_id: user.id,
      action: 'approve_timesheet', target_type: 'timesheet', target_id: String(id)
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};

exports.handler = withAdminCors(baseHandler);
