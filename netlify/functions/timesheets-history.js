// netlify/functions/timesheets-history.js
const { supabase, getContext } = require('./_timesheet-helpers');

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

exports.handler = async (event, context) => {
  try {
    const { assignment } = await getContext(context);
    if (!assignment?.id) return respond(404, { error: 'no_active_assignment' });

    const { data: list, error } = await supabase
      .from('timesheets')
      .select('id,week_ending,status')
      .eq('assignment_id', assignment.id)
      .order('week_ending', { ascending: false })
      .limit(10);

    if (error) throw error;

    const items = [];
    for (const ts of (list || [])) {
      const { data: rows, error: e2 } = await supabase
        .from('timesheet_entries')
        .select('hours_std,hours_ot')
        .eq('timesheet_id', ts.id);
      if (e2) throw e2;

      const std = (rows || []).reduce((a, r) => a + Number(r.hours_std || 0), 0);
      const ot  = (rows || []).reduce((a, r) => a + Number(r.hours_ot  || 0), 0);

      items.push({
        week_ending: ts.week_ending,
        status: ts.status,
        std, ot,
        project_name: assignment.project_name
      });
    }

    return respond(200, { items });
  } catch (e) {
    console.error('[history] exception:', e);
    return respond(400, { error: e.message || 'history_failed' });
  }
};
