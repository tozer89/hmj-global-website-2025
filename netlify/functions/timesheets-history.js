// netlify/functions/timesheets-history.js
const { supabase, getContext } = require('./_timesheet-helpers.js');

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

exports.handler = async (event, context) => {
  try {
    const qs = event.queryStringParameters || {};
    const weekEnding = (qs.week_ending || '').trim(); // detail mode if provided

    // getContext should give us the authenticated contractor + active assignment + friendly names
    const { assignment } = await getContext(context);
    if (!assignment?.id) return respond(404, { error: 'no_active_assignment' });

    // ---------- DETAIL MODE ----------
    if (weekEnding) {
      // Find this assignment's timesheet for the requested week
      const { data: ts, error: eTs } = await supabase
        .from('timesheets')
        .select('id, week_ending, status')
        .eq('assignment_id', assignment.id)
        .eq('week_ending', weekEnding)
        .maybeSingle();

      if (eTs) throw eTs;
      if (!ts) return respond(404, { error: 'timesheet_not_found' });

      // Pull entries for that timesheet
      const { data: rows, error: eRows } = await supabase
        .from('timesheet_entries')
        .select('day, hours_std, hours_ot, note')
        .eq('timesheet_id', ts.id);

      if (eRows) throw eRows;

      // Sort client-side into Sun..Sat order
      const DAY_ORDER = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
      const entries = (rows || []).slice().sort((a,b)=> (DAY_ORDER[a.day]??9) - (DAY_ORDER[b.day]??9));

      const std = entries.reduce((a,r)=>a+Number(r.hours_std||0), 0);
      const ot  = entries.reduce((a,r)=>a+Number(r.hours_ot ||0), 0);

      const rateStd = Number(assignment.rate_std || 0);
      const rateOt  = Number(assignment.rate_ot  || 0);
      const gross = (std * rateStd) + (ot * rateOt);

      return respond(200, {
        detail: {
          id: ts.id,
          week_ending: ts.week_ending,
          status: ts.status,
          assignment: {
            client_name: assignment.client_name || null,
            project_name: assignment.project_name || null,
            site_name: assignment.site_name || null
          },
          rates: { std: rateStd, ot: rateOt },
          entries,
          totals: { std, ot, gross }
        }
      });
    }

    // ---------- LIST MODE ----------
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

      // Optional convenience fields for UI
      items.push({
        id: ts.id,
        week_ending: ts.week_ending,
        status: ts.status,
        std, ot,
        project_name: assignment.project_name || null
      });
    }

    return respond(200, { items });
  } catch (e) {
    console.error('[timesheets-history] exception:', e);
    return respond(400, { error: e.message || 'history_failed' });
  }
};
