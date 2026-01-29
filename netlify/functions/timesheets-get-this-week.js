// netlify/functions/timesheets-get-this-week.js
const { supabase, weekEndingSaturdayISO, getContext, ensureTimesheet } = require('./_timesheet-helpers.js');

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'GET') return respond(405, { error: 'method_not_allowed' });

    // Resolve contractor + active assignment
    let contractor, assignment;
    try {
      const ctx = await getContext(context);
      contractor = ctx?.contractor || null;
      assignment = ctx?.assignment || null;
    } catch (err) {
      console.error('[get-this-week] getContext error:', err);
      return respond(500, { error: 'context_failed' });
    }

    if (!contractor || !assignment?.id) {
      const week_ending = weekEndingSaturdayISO();
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const map = Object.fromEntries(days.map(d => [d, { std: 0, ot: 0, note: '' }]));
      return respond(200, {
        contractor: contractor ? { id: contractor.id, name: contractor.name, email: contractor.email } : null,
        assignment: assignment ? {
          id: assignment.id,
          project_name: assignment.project_name,
          client_name: assignment.client_name,
          site_name: assignment.site_name,
          rate_std: Number.isFinite(+assignment.rate_std) ? +assignment.rate_std : 0,
          rate_ot: Number.isFinite(+assignment.rate_ot) ? +assignment.rate_ot : 0
        } : null,
        week_ending,
        status: 'draft',
        entries: map,
        readOnly: true,
        error: contractor ? 'no_active_assignment' : 'contractor_not_found_for_email'
      });
    }

    // Compute target week (Sun..Sat; week ends Saturday)
    const week_ending = weekEndingSaturdayISO();

    // Ensure a timesheet exists for (assignment, week)
    let ts;
    try {
      ts = await ensureTimesheet(assignment.id, week_ending);
    } catch (err) {
      console.error('[get-this-week] ensureTimesheet error:', err);
      return respond(500, { error: 'timesheet_create_failed' });
    }
    if (!ts?.id) return respond(500, { error: 'timesheet_create_failed' });

    // Load day entries
    const { data: rows, error } = await supabase
      .from('timesheet_entries')
      .select('day,hours_std,hours_ot,note')
      .eq('timesheet_id', ts.id);

    if (error) {
      console.error('[get-this-week] select timesheet_entries error:', error);
      return respond(500, { error: 'db_select_failed_timesheet_entries' });
    }

    // Sun→Sat map
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const map = Object.fromEntries(days.map(d => [d, { std: 0, ot: 0, note: '' }]));
    (rows || []).forEach(r => {
      if (!r?.day || !map[r.day]) return;
      map[r.day] = {
        std: Number.isFinite(+r.hours_std) ? +r.hours_std : 0,
        ot:  Number.isFinite(+r.hours_ot)  ? +r.hours_ot  : 0,
        note: r.note || ''
      };
    });

    // Tidy assignment payload
    const assignmentOut = {
      id: assignment.id,
      project_name: assignment.project_name,
      client_name:  assignment.client_name,
      site_name:    assignment.site_name,
      rate_std: Number.isFinite(+assignment.rate_std) ? +assignment.rate_std : 0,
      rate_ot:  Number.isFinite(+assignment.rate_ot)  ? +assignment.rate_ot  : 0
    };

    return respond(200, {
      contractor: { id: contractor.id, name: contractor.name, email: contractor.email },
      assignment: assignmentOut,
      week_ending: ts.week_ending,
      status: ts.status,
      entries: map
    });

  } catch (e) {
    const msg = e?.message || 'unknown_error';
    const status =
      msg === 'Unauthorized' || msg === 'identity_required' ? 400 :
      msg.endsWith('_failed') ? 500 : 400;

    console.error('[get-this-week] exception:', e);
    return respond(status, { error: msg });
  }
};
