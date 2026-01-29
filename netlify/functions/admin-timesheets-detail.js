// netlify/functions/timesheets-detail.js
const { withAdminCors } = require('./_http.js');
const { supabase, getContext } = require('./_timesheet-helpers.js');

const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const respond = (s, b) => ({ statusCode: s, headers: H, body: JSON.stringify(b) });

const baseHandler = async (event, context) => {
  try {
    const { user } = context.clientContext || {};
    if (!user) return respond(403, { error: 'identity_required' });

    const q = event.queryStringParameters || {};
    const weekStr = q.week_ending;      // preferred
    const idParam = q.id && Number(q.id);

    // Get current assignment for this user (same as your other endpoints)
    const { contractor, assignment } = await getContext(context);
    if (!assignment?.id) return respond(404, { error: 'no_active_assignment' });

    // Find the timesheet row either by id or by week_ending
    let tsQuery = supabase.from('timesheets').select('id,assignment_id,week_ending,status').eq('assignment_id', assignment.id);
    if (idParam) tsQuery = tsQuery.eq('id', idParam);
    else if (weekStr) tsQuery = tsQuery.eq('week_ending', weekStr);
    else return respond(400, { error: 'missing_param', hint: 'pass ?week_ending=YYYY-MM-DD or ?id=123' });

    const { data: list, error: errTs } = await tsQuery.limit(1);
    if (errTs) throw errTs;
    const ts = (list || [])[0];
    if (!ts) return respond(404, { error: 'timesheet_not_found' });

    // Entries (ordered Sun..Sat)
    const { data: rows, error: errE } = await supabase
      .from('timesheet_entries')
      .select('day,hours_std,hours_ot,note')
      .eq('timesheet_id', ts.id);
    if (errE) throw errE;

    const order = { Sun:1, Mon:2, Tue:3, Wed:4, Thu:5, Fri:6, Sat:7 };
    const entries = (rows || [])
      .map(r => ({ day:r.day, std:Number(r.hours_std||0), ot:Number(r.hours_ot||0), note:r.note||'' }))
      .sort((a,b)=> order[a.day]-order[b.day]);

    const totals = entries.reduce((a,r)=>({ std:a.std+r.std, ot:a.ot+r.ot }), { std:0, ot:0 });
    const pay = {
      rate_std: Number(assignment.rate_std||0),
      rate_ot:  Number(assignment.rate_ot||0),
      gross: Number(assignment.rate_std||0)*totals.std + Number(assignment.rate_ot||0)*totals.ot
    };

    const meta = {
      client_name:  assignment.client_name,
      project_name: assignment.project_name,
      site_name:    assignment.site_name
    };

    return respond(200, {
      contractor: { id: contractor.id, name: contractor.name, email: contractor.email },
      timesheet:  { id: ts.id, week_ending: ts.week_ending, status: ts.status },
      assignment: meta,
      rates:      { std: pay.rate_std, ot: pay.rate_ot },
      totals,
      gross: pay.gross,
      entries
    });
  } catch (e) {
    console.error('[timesheets-detail] error:', e);
    return respond(400, { error: e.message || 'detail_failed' });
  }
};

exports.handler = withAdminCors(baseHandler);
