const { supabaseClient } = require('./_supabase');
const { getUser } = require('./_auth');

exports.handler = async (event, context) => {
  try {
    const user = getUser(context);                   // Netlify Identity user
    const email = (user.email || '').toLowerCase();

    const supabase = await supabaseClient();

    // Look up contractor by login email
    const { data: contractor, error: cErr } = await supabase
      .from('contractors')
      .select('id,name,email,phone,payroll_ref')
      .eq('email', email)
      .maybeSingle();

    if (cErr) {
      console.error('contractor query error:', cErr);
      return { statusCode: 500, body: 'DB error (contractors)' };
    }
    if (!contractor) {
      return { statusCode: 404, body: 'Contractor not found' };
    }

    // Active assignment from the view we created
    const { data: assignment, error: aErr } = await supabase
      .from('assignment_summary')
      .select('*')
      .eq('contractor_id', contractor.id)
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    if (aErr) {
      console.error('assignment_summary error:', aErr);
      return { statusCode: 500, body: 'DB error (assignment_summary)' };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ contractor, assignment })
    };
  } catch (e) {
    console.error('contractor-profile exception:', e);
    const msg = e && e.message ? e.message : 'Unauthorized';
    const code = msg === 'Unauthorized' ? 401 : 500;
    return { statusCode: code, body: msg };
  }
};
