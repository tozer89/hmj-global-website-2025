// netlify/functions/admin-timesheets-export.js
const { supabase, getContext } = require('./_timesheet-helpers');

exports.handler = async (event, context) => {
  try {
    const { user } = await getContext(context);
    const roles = user?.app_metadata?.roles || user?.roles || [];
    if (!roles.includes('admin')) throw Object.assign(new Error('Forbidden'), { code: 401 });

    const body = JSON.parse(event.body || '{}');
    const { status = '', client_id = null, week = null, q = '' } = body;

    let query = supabase.from('v_timesheets_admin').select('*').order('week_ending', { ascending: false });
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
