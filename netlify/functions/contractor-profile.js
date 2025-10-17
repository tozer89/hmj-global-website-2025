// netlify/functions/contractor-profile.js
const { supabase } = require('./_supabase');
const { getUser } = require('./_auth');

exports.handler = async (_event, context) => {
  try {
    // Require a logged-in Netlify Identity user
    const user = getUser(context);
    if (!user?.email) return { statusCode: 401, body: 'Unauthorized' };

    const email = String(user.email).toLowerCase();

    // Find contractor by email (case-insensitive, tolerate accidental duplicates)
    const { data: contractor, error: cErr } = await supabase
      .from('contractors')
      .select('id,name,email,phone,payroll_ref')
      .ilike('email', email)              // ← case-insensitive match
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (cErr) return { statusCode: 500, body: cErr.message };
    if (!contractor) return { statusCode: 404, body: 'Contractor not found' };

    // Try to fetch active assignment (may be null if not yet set up)
    const { data: assignment, error: aErr } = await supabase
      .from('assignment_summary')
      .select('*')
      .eq('contractor_id', contractor.id)
      .eq('active', true)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (aErr) return { statusCode: 500, body: aErr.message };

    return {
      statusCode: 200,
      body: JSON.stringify({ contractor, assignment: assignment || null })
    };
  } catch (e) {
    return { statusCode: 401, body: e?.message || 'Unauthorized' };
  }
};
