// /.netlify/functions/admin-timesheets-delete
const { withSupabase, jsonOk, jsonError } = require('./_supabase.js');

module.exports.handler = withSupabase(async ({ event, supabase, trace }) => {
  if (event.httpMethod !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'POST required', { trace });
  }

  let id = null;
  try { id = JSON.parse(event.body || '{}').id; } catch {}
  id = Number(id);
  if (!id) return jsonError(400, 'bad_request', 'Missing id', { trace });

  // Delete entries first (FK)
  const delE = await supabase.from('timesheet_entries').delete().eq('timesheet_id', id);
  if (delE.error) return jsonError(500, 'delete_entries_failed', delE.error.message, { trace });

  const delT = await supabase.from('timesheets').delete().eq('id', id).select().single();
  if (delT.error) return jsonError(500, 'delete_timesheet_failed', delT.error.message, { trace });

  // Write audit (best-effort)
  await supabase.from('admin_audit_logs').insert({
    actor_email: (event.clientContext && event.clientContext.user && event.clientContext.user.email) || 'admin',
    action: 'timesheet_delete',
    target_type: 'timesheet',
    target_id: String(id),
    meta: { reason: 'admin_delete' }
  });

  return jsonOk({ ok: true, id, trace });
});
