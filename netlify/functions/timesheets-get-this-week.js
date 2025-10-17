// netlify/functions/timesheets-get-this-week.js
const { weekEndingSaturdayISO, getContext, ensureTimesheet } = require('./_timesheet-helpers');

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'GET') return respond(405, { error: 'Method Not Allowed' });

    // Who is this and what are they working on?
    const { supabase, contractor, assignment } = await getContext(context);

    // Our standard: week ends on Saturday (Sun..Sat)
    const week_ending = weekEndingSaturdayISO();

    // Ensure a timesheet row exists for this assignment+week
    const ts = await ensureTimesheet(supabase, assignment.id, week_ending);

    // Pull any saved day entries
    const { data: rows, error } = await supabase
      .from('timesheet_entries')
      .select('day,hours_std,hours_ot,note')
      .eq('timesheet_id', ts.id);

    if (error) {
      console.error('timesheet_entries query error:', error);
      return respond(500, { error: 'Database error (timesheet_entries)' });
    }

    // Build a Sun→Sat map
    const map = {};
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    DAYS.forEach(k => (map[k] = { std: 0, ot: 0, note: '' }));
    (rows || []).forEach(r => {
      map[r.day] = { std: Number(r.hours_std || 0), ot: Number(r.hours_ot || 0), note: r.note || '' };
    });

    return respond(200, {
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
    });
    } catch (e) {
    const status =
      e.code === 401 ? 401 :
      e.code === 404 ? 404 : 500;

    return {
      statusCode: status,
      body: JSON.stringify({ error: e.message || 'Failed to load timesheet' })
    };
  }
};
