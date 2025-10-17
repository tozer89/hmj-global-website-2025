// netlify/functions/admin-timesheets-detail.js
const { supabase, getContext } = require('./_timesheet-helpers');

exports.handler = async (event, context) => {
  try {
    const { user } = await getContext(context);
    const roles = user?.app_metadata?.roles || user?.roles || [];
    if (!roles.includes('admin')) throw Object.assign(new Error('Forbidden'), { code: 401 });

    const { id } = JSON.parse(event.body || '{}');
    if (!id) throw new Error('Missing id');

    // header info
    const { data: head, error: hErr } = await supabase
      .from('v_timesheets_admin')
      .select('*').eq('id', id).single();
    if (hErr) throw hErr;

    // entries
    const { data: rows, error: eErr } = await supabase
      .from('timesheet_entries')
      .select('day,hours_std,hours_ot,note')
      .eq('timesheet_id', id);
    if (eErr) throw eErr;

    const order = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const map = {}; order.forEach(k => map[k] = { std:0, ot:0, note:'' });
    (rows || []).forEach(r => { map[r.day] = { std: Number(r.hours_std||0), ot: Number(r.hours_ot||0), note: r.note||'' }; });

    return { statusCode: 200, body: JSON.stringify({ ...head, entries: map }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
