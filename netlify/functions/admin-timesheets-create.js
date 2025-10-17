// netlify/functions/admin-timesheets-create.js
const { getContext, weekEndingSaturdayISO, ensureTimesheet } = require('./_timesheet-helpers');

exports.handler = async (event, context) => {
  try {
    const { user, supabase } = await getContext(context, { requireAdmin: true });
    const { assignment_id, week_ending = weekEndingSaturdayISO() } = JSON.parse(event.body || '{}');
    if (!assignment_id) throw new Error('Missing assignment_id');

    const ts = await ensureTimesheet(supabase, assignment_id, week_ending);

    await supabase.from('admin_audit_logs').insert({
      actor_email: user.email, actor_id: user.id,
      action: 'create_timesheet', target_type: 'timesheet', target_id: String(ts.id),
      meta: { assignment_id, week_ending }
    });

    return { statusCode: 200, body: JSON.stringify({ id: ts.id, week_ending: week_ending, status: ts.status }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
