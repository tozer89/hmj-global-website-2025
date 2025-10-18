// netlify/functions/timesheets-get-this-week.js
const { supabase, weekEndingSaturdayISO, getContext, ensureTimesheet } = require('./_timesheet-helpers');

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};
const respond = (status, body) => ({
  statusCode: status,
  headers: HEADERS,
  body: JSON.stringify(body)
});

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'GET') {
      return respond(405, { error: 'method_not_allowed' });
    }

    // ── Identity present? (Netlify Identity injects context.clientContext.user)
    const idUser = context?.clientContext?.user;
    if (!idUser) {
      return respond(401, { error: 'identity_required' });
    }

    // ── Gather contractor & current active assignment (helper enforces RLS/service key)
    const ctx = await getContext(context).catch(err => {
      console.error('getContext error:', err);
      throw new Error('context_failed');
    });

    const contractor = ctx?.contractor || null;
    const assignment = ctx?.assignment || null;

    if (!contractor) {
      // common cause: DB has no contractors row for this Identity email
      return respond(404, { error: 'contractor_not_found_for_email', email: idUser.email });
    }
    if (!assignment?.id) {
      // common cause: no active assignments for this contractor
      return respond(404, { error: 'no_active_assignment' });
    }

    // ── Week end (Sun..Sat model)
    const week_ending = weekEndingSaturdayISO();

    // ── Ensure a timesheet exists for this assignment+week
    const ts = await ensureTimesheet(assignment.id, week_ending).catch(err => {
      console.error('ensureTimesheet error:', err);
      throw new Error('timesheet_create_failed');
    });
    if (!ts?.id) {
      return respond(500, { error: 'timesheet_create_failed' });
    }

    // ── Pull entries for that sheet
    const { data: rows, error } = await supabase
      .from('timesheet_entries')
      .select('day,hours_std,hours_ot,note')
      .eq('timesheet_id', ts.id);

    if (error) {
      console.error('timesheet_entries select error:', error);
      return respond(500, { error: 'db_select_failed_timesheet_entries' });
    }

    // ── Build Sun→Sat map (defensive number coercion)
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

    // ── Minimal assignment payload to the client
    const assignmentOut = {
      id: assignment.id,
      project_name: assignment.project_name,
      client_name: assignment.client_name,
      site_name: assignment.site_name,
      rate_std: Number.isFinite(+assignment.rate_std) ? +assignment.rate_std : 0,
      rate_ot: Number.isFinite(+assignment.rate_ot) ? +assignment.rate_ot : 0
    };

    return respond(200, {
      contractor: {
        id: contractor.id,
        name: contractor.name,
        email: contractor.email
      },
      assignment: assignmentOut,
      week_ending: ts.week_ending,   // ISO date from DB
      status: ts.status,             // 'draft'|'submitted'|'approved'|'rejected'
      entries: map
    });

  } catch (e) {
    const codeMap = {
      Unauthorized: 401,
      identity_required: 401,
      context_failed: 500,
      timesheet_create_failed: 500
    };
    const msg = e?.message || 'unknown_error';
    const status = codeMap[msg] || 400;
    console.error('timesheets-get-this-week error:', e);
    return respond(status, { error: msg });
  }
};
