const { supabase } = require('./_supabase');
const { getUser } = require('./_auth');

exports.handler = async (event, context) => {
  try {
    const user = getUser(context);                       // Netlify Identity user
    const email = (user.email || '').toLowerCase();

    // Find contractor by login email
    const { data: contractor, error: cErr } = await supabase
      .from('contractors')
      .select('id,name,email,phone,payroll_ref')
      .eq('email', email)
      .single();

    if (cErr || !contractor) {
      return { statusCode: 404, body: 'Contractor not found' };
    }

    // Active assignment summary (view we created in SQL)
    const { data: assignment, error: aErr } = await supabase
      .from('assignment_summary')
      .select('*')
      .eq('contractor_id', contractor.id)
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    if (aErr) {
      return { statusCode: 500, body: aErr.message };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ contractor, assignment })
    };
  } catch (e) {
    return { statusCode: 401, body: e.message || 'Unauthorized' };
  }
};
