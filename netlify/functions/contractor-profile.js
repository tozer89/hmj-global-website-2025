const { supabase } = require('./_supabase');
const { getUser } = require('./_auth');

exports.handler = async (event, context) => {
  try {
    const user = getUser(context);
    const email = (user.email || '').toLowerCase();

    const { data: contractor, error: cErr } = await supabase
      .from('contractors')
      .select('id,name,email,phone,payroll_ref')
      .eq('email', email)
      .maybeSingle();

    if (cErr) return { statusCode: 500, body: JSON.stringify({ error: cErr.message }) };
    if (!contractor) return { statusCode: 404, body: JSON.stringify({ error: 'Contractor not found for ' + email }) };

    const { data: assignment, error: aErr } = await supabase
      .from('assignment_summary')
      .select('*')
      .eq('contractor_id', contractor.id)
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    if (aErr) return { statusCode: 500, body: JSON.stringify({ error: aErr.message }) };

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contractor, assignment }),
    };
  } catch (e) {
    const status =
        e.code === 401 ? 401 :
        e.code === 404 ? 404 : 500;

    return {
        statusCode: status,
        body: JSON.stringify({ error: e.message })
    };
    }

};
