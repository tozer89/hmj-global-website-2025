// netlify/functions/admin-timesheets-edit.js
const { supabase, getContext } = require('./_timesheet-helpers');
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

exports.handler = async (event, context) => {
  try {
    const { user } = await getContext(context);
    const roles = user?.app_metadata?.roles || user?.roles || [];
    if (!roles.includes('admin')) throw Object.assign(new Error('Forbidden'), { code: 401 });

    const { id, entries = {}, keep_status = true } = JSON.parse(event.body || '{}');
    if (!id) throw new Error('Missing id');

    const { data: before } = await supabase.from('timesheet_entries').select('day,hours_std,hours_ot,note').eq('timesheet_id', id);

    for (const d of DAYS) {
      const row = entries[d] || {};
      const { error } = await supabase.rpc('upsert_timesheet_entry', {
        p_timesheet_id: id,
        p_day: d,
        p_std: Number(row.std || 0),
        p_ot: Number(row.ot || 0),
        p_note: row.note || ''
      });
      if (error) throw error;
    }

    // If an approved sheet is edited, we mark it as 'approved' but flagged as amended
    let patch = {};
    if (keep_status) patch = { amended_at: new Date().toISOString() };

    if (Object.keys(patch).length) {
      const { error: uErr } = await supabase.from('timesheets').update(patch).eq('id', id);
      if (uErr) throw uErr;
    }

    await supabase.from('admin_audit_logs').insert({
      actor_email: user.email,
      actor_id: user.id,
      action: 'edit_timesheet',
      target_type: 'timesheet',
      target_id: String(id),
      meta: { before, after: entries }
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
