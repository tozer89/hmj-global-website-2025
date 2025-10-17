// netlify/functions/admin-timesheets-list.js
const { supabase, getContext } = require('./_timesheet-helpers');

exports.handler = async (event, context) => {
  try {
    const { user } = await getContext(context); // throws 401 if not logged in
    const roles = user?.app_metadata?.roles || user?.roles || [];
    if (!roles.includes('admin')) throw Object.assign(new Error('Forbidden'), { code: 401 });

    const body = JSON.parse(event.body || '{}');
    const { status = '', client_id = null, week = null, q = '', limit = 200, offset = 0 } = body;

    let query = supabase
      .from('v_timesheets_admin')
      .select('*', { count: 'exact' })
      .order('week_ending', { ascending: false })
      .order('contractor_name', { ascending: true })
      .range(offset, offset + Math.min(limit, 500) - 1);

    if (status) query = query.eq('status', status);
    if (client_id) query = query.eq('client_id', client_id);
    if (week) query = query.eq('week_ending', week);
    if (q) {
      // simple text search across names
      query = query.or(`contractor_name.ilike.%${q}%,project_name.ilike.%${q}%,client_name.ilike.%${q}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ rows: data, count }) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
