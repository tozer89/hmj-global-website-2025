// netlify/functions/admin-timesheets-export.js
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_timesheet-helpers.js');

const baseHandler = async (event, context) => {
  try {
    const { supabase } = await getContext(context, { requireAdmin: true });
    const body = JSON.parse(event.body || '{}');
    const { status = '', client_id = null, week = null, q = '' } = body;

    let query = supabase.from('v_timesheets_admin')
      .select('*')
      .order('week_ending', { ascending: false });

    if (status) query = query.eq('status', status);
    if (client_id) query = query.eq('client_id', client_id);
    if (week) query = query.eq('week_ending', week);
    if (q) query = query.or(`contractor_name.ilike.%${q}%,project_name.ilike.%${q}%,client_name.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) throw error;

    const head = ['Timesheet ID','Week Ending','Status','Contractor','Email','Client','Project','Hours'];
    const rows = data.map(r => [r.id, r.week_ending, r.status, r.contractor_name, r.contractor_email, r.client_name, r.project_name, r.total_hours]);
    const csv = [head, ...rows].map(a => a.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');

    return { statusCode: 200, body: JSON.stringify({ csv }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};

exports.handler = withAdminCors(baseHandler);
