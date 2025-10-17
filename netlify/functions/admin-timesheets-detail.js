// netlify/functions/admin-timesheets-detail.js
const { getContext } = require('./_timesheet-helpers');
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

exports.handler = async (event, context) => {
  try {
    const { supabase } = await getContext(context, { requireAdmin: true });
    const { id } = JSON.parse(event.body || '{}');
    if (!id) throw new Error('Missing id');

    const { data: head, error: hErr } = await supabase
      .from('v_timesheets_admin')
      .select('*')
      .eq('id', id)
      .single();
    if (hErr) throw hErr;

    const { data: rows, error: rErr } = await supabase
      .from('timesheet_entries')
      .select('day,hours_std,hours_ot,note')
      .eq('timesheet_id', id);
    if (rErr) throw rErr;

    const entries = {};
    DAYS.forEach(d => entries[d] = { std: 0, ot: 0, note: '' });
    rows.forEach(r => entries[r.day] = { std: r.hours_std||0, ot: r.hours_ot||0, note: r.note||'' });

    return { statusCode: 200, body: JSON.stringify({ ...head, entries }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
