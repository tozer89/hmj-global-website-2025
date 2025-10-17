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
// netlify/functions/timesheets-get-this-week.js
const { supabase, weekEndingSaturdayISO, getContext, ensureTimesheet } = require('./_timesheet-helpers');

exports.handler = async (event, context) => {
  try {
    const { contractor, assignment } = await getContext(context); // throws { code:401, message:'Unauthorized' } when not logged in
    const week_ending = weekEndingSaturdayISO();

    // Ensure a timesheet row exists
    const ts = await ensureTimesheet(assignment.id, week_ending);

    const { data: rows, error } = await supabase
      .from('timesheet_entries')
      .select('day,hours_std,hours_ot,note')
      .eq('timesheet_id', ts.id);

    if (error) throw error;

    const map = {};
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(k => map[k] = { std:0, ot:0, note:'' });
    (rows || []).forEach(r => {
      map[r.day] = { std: Number(r.hours_std||0), ot: Number(r.hours_ot||0), note: r.note || '' };
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        contractor,
        assignment: {
          id: assignment.id,
          project_name: assignment.project_name,
          client_name: assignment.client_name,
          site_name: assignment.site_name,
          rate_std: assignment.rate_std,
          rate_ot: assignment.rate_ot
        },
        week_ending: ts.week_ending,
        status: ts.status,
        entries: map
      })
    };
  } catch (e) {
    console.error('timesheets-get-this-week failed:', e); // shows full error in Netlify logs
    const status = e.code === 401 ? 401 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Unknown error' }) };
  }
};
