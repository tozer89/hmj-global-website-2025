// netlify/functions/admin-assignments-list.js
const { supabase } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

exports.handler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
    const { contractor_id, client_id, active } = JSON.parse(event.body || '{}');

    let query = supabase
      .from('assignment_summary')
      .select('id, contractor_id, contractor_name, contractor_email, project_id, project_name, client_id, client_name, client_site, site_name, job_title, status, candidate_name, as_ref, rate_std, rate_pay, charge_std, charge_ot, start_date, end_date, currency, po_number, consultant_name, active')
      .order('start_date', { ascending: false });

    if (contractor_id) query = query.eq('contractor_id', contractor_id);
    if (client_id)     query = query.eq('client_id', client_id);
    if (active === true)  query = query.eq('active', true);
    if (active === false) query = query.eq('active', false);

    const { data, error } = await query;
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify(data || []) };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
