// Lists active assignments for admins to raise sheets.
const { getContext } = require('./_timesheet-helpers');

exports.handler = async (event, context) => {
  try {
    const { supabase } = await getContext(context, { requireAdmin: true });
    const { data, error } = await supabase
      .from('assignment_summary')
      .select('id, contractor_name, contractor_email, client_name, project_name, active')
      .eq('active', true)
      .order('contractor_name');
    if (error) throw error;
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};
