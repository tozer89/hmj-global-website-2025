// netlify/functions/admin-timesheets-delete.js
const { getContext } = require('./_timesheet-helpers');

exports.handler = async (event, context) => {
  try {
    const { user, supabase } = await getContext(context, { requireAdmin: true });

    if (!event.body) return { statusCode: 400, body: JSON.stringify({ error: 'Missing body' }) };
    const { id, force = false } = JSON.parse(event.body || '{}');
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };

    // Load the timesheet first (so we can validate and audit)
    const { data: ts, error: tErr } = await supabase
      .from('timesheets')
      .select('id, assignment_id, week_ending, status')
      .eq('id', id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!ts) return { statusCode: 404, body: JSON.stringify({ error: 'not_found' }) };

    // Guard rails: only delete draft/rejected unless force=true
    if (!force && !['draft', 'rejected'].includes(ts.status)) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: 'cannot_delete_in_status', status: ts.status })
      };
    }

    // Delete entries first (FK constraint)
    const { error: eDel } = await supabase
      .from('timesheet_entries')
      .delete()
      .eq('timesheet_id', id);
    if (eDel) throw eDel;

    // Delete the timesheet
    const { error: tDel } = await supabase
      .from('timesheets')
      .delete()
      .eq('id', id);
    if (tDel) throw tDel;

    // Audit
    await supabase.from('admin_audit_logs').insert({
      actor_email: user.email, actor_id: user.id,
      action: 'delete_timesheet',
      target_type: 'timesheet',
      target_id: String(id),
      meta: { status: ts.status, week_ending: ts.week_ending, assignment_id: ts.assignment_id, force: !!force }
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, id }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
