// netlify/functions/timesheets-save.js
const { supabase, weekEndingSaturdayISO, getContext, ensureTimesheet } = require('./_timesheet-helpers');
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

exports.handler = async (event, context) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const entries = body.entries || {};

    const { assignment } = await getContext(context);
    const week_ending = weekEndingSaturdayISO();
    const ts = await ensureTimesheet(assignment.id, week_ending);

    for (const d of DAYS) {
      const row = entries[d] || {};
      const { error } = await supabase.rpc('upsert_timesheet_entry', {
        p_timesheet_id: ts.id,
        p_day: d,
        p_std: Number(row.std || 0),
        p_ot: Number(row.ot || 0),
        p_note: row.note || ''
      });
      if (error) throw error;
    }

    const upd = await supabase
      .from('timesheets')
      .update({ status: 'draft' })
      .eq('id', ts.id)
      .select('id,status')
      .single();
    if (upd.error) throw upd.error;

    return { statusCode: 200, body: JSON.stringify({ ok: true, status: upd.data.status }) };
  } catch (e) {
    return { statusCode: 400, body: e.message || 'Failed to save draft' };
  }
};
