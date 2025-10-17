// netlify/functions/timesheets-history.js
const { supabase, getContext } = require('./_timesheet-helpers');

exports.handler = async (event, context) => {
  try {
    const { assignment } = await getContext(context);

    const { data: list, error } = await supabase
      .from('timesheets')
      .select('id,week_ending,status')
      .eq('assignment_id', assignment.id)
      .order('week_ending', { ascending: false })
      .limit(10);
    if (error) throw error;

    const out = [];
    for (const ts of (list || [])) {
      const { data: rows, error: e2 } = await supabase
        .from('timesheet_entries')
        .select('hours_std,hours_ot')
        .eq('timesheet_id', ts.id);
      if (e2) throw e2;
      const total = (rows || []).reduce((a, r) => a + Number(r.hours_std || 0) + Number(r.hours_ot || 0), 0);
      out.push({
        week_ending: ts.week_ending,
        project_name: assignment.project_name,
        total_hours: total,
        status: ts.status
      });
    }

    return { statusCode: 200, body: JSON.stringify(out) };
  } catch (e) {
    return { statusCode: 400, body: e.message || 'Failed to load history' };
  }
};
