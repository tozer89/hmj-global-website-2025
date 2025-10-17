// netlify/functions/admin-timesheets-list.js
const { getContext } = require('./_timesheet-helpers');

exports.handler = async (event, context) => {
  try {
    const { supabase } = await getContext(context, { requireAdmin: true });

    const { status = '', client_id = null, week = null, q = '' } =
      JSON.parse(event.body || '{}');

    let qy = supabase.from('v_timesheets_admin')
      .select('*')
      .order('week_ending', { ascending: false })
      .order('contractor_name');

    if (status) qy = qy.eq('status', status);
    if (client_id) qy = qy.eq('client_id', client_id);
    if (week) qy = qy.eq('week_ending', week);
    if (q) qy = qy.or(
      `contractor_name.ilike.%${q}%,project_name.ilike.%${q}%,client_name.ilike.%${q}%`
    );

    const { data, error } = await qy;
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
