// netlify/functions/admin-timesheets-edit.js
const { getContext } = require('./_auth.js');
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

exports.handler = async (event, context) => {
  try {
    const { user, supabase } = await getContext(event, context, { requireAdmin: true });

    const { id, entries = {}, keep_status = true } = JSON.parse(event.body || '{}');
    if (!id) throw new Error('Missing id');

    const { data: before } = await supabase
      .from('timesheet_entries')
      .select('day,hours_std,hours_ot,note')
      .eq('timesheet_id', id);

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

    if (keep_status) {
      const { error: patchErr } = await supabase
        .from('timesheets')
        .update({ amended_at: new Date().toISOString() })
        .eq('id', id);
      if (patchErr) throw patchErr;
    }

    await supabase.from('admin_audit_logs').insert({
      actor_email: user.email, actor_id: user.id,
      action: 'edit_timesheet', target_type: 'timesheet', target_id: String(id),
      meta: { before, after: entries }
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
