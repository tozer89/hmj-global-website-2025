// netlify/functions/admin-timesheets-create.js
const { supabase, getContext, ensureTimesheet } = require('./_timesheet-helpers');

exports.handler = async (event, context) => {
  try {
    const { user } = await getContext(context);
    const roles = user?.app_metadata?.roles || user?.roles || [];
    if (!roles.includes('admin')) throw Object.assign(new Error('Forbidden'), { code: 401 });

    const { assignment_id, week_ending } = JSON.parse(event.body || '{}');
    if (!assignment_id || !week_ending) throw new Error('assignment_id and week_ending required');

    const ts = await ensureTimesheet(assignment_id, week_ending);

    await supabase.from('admin_audit_logs').insert({
      actor_email: user.email, actor_id: user.id, action: 'create_timesheet',
      target_type: 'timesheet', target_id: String(ts.id), meta: { assignment_id, week_ending }
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, id: ts.id }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
