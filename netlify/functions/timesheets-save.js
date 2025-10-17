// netlify/functions/timesheets-save.js
const { weekEndingSaturdayISO, getContext, ensureTimesheet } = require('./_timesheet-helpers');

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const isDay = d => DAYS.includes(d);

async function upsertEntry(supabase, tsId, day, row) {
  // Try RPC first (if function exists), then fall back to table upsert
  const payload = {
    p_timesheet_id: tsId,
    p_day: day,
    p_std: Number(row.std || 0),
    p_ot: Number(row.ot || 0),
    p_note: row.note || ''
  };

  // 1) RPC
  try {
    const { error } = await supabase.rpc('upsert_timesheet_entry', payload);
    if (!error) return;
    // If function exists but fails for other reason, throw:
    throw error;
  } catch (rpcErr) {
    // 2) Fallback: direct upsert
    const { error: upErr } = await supabase
      .from('timesheet_entries')
      .upsert({
        timesheet_id: tsId,
        day,
        hours_std: payload.p_std,
        hours_ot: payload.p_ot,
        note: payload.p_note
      }, { onConflict: 'timesheet_id,day' }); // requires unique(timesheet_id, day)

    if (upErr) throw upErr;
  }
}

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') return respond(405, { error: 'Method Not Allowed' });

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return respond(400, { error: 'Invalid JSON' });
    }

    const entries = body.entries && typeof body.entries === 'object' ? body.entries : {};
    const { supabase, assignment } = await getContext(context);

    const week_ending = weekEndingSaturdayISO();
    const ts = await ensureTimesheet(supabase, assignment.id, week_ending);

    // Validate keys and coerce numbers
    const tasks = [];
    for (const [day, row] of Object.entries(entries)) {
      if (!isDay(day)) continue;
      const safe = {
        std: Math.max(0, Number(row?.std || 0)),
        ot:  Math.max(0, Number(row?.ot  || 0)),
        note: (row?.note || '').toString().slice(0, 500)
      };
      tasks.push(upsertEntry(supabase, ts.id, day, safe));
    }
    await Promise.all(tasks);

    const upd = await supabase
      .from('timesheets')
      .update({ status: 'draft' })
      .eq('id', ts.id)
      .select('id,status')
      .single();

    if (upd.error) {
      console.error('timesheet status update error:', upd.error);
      return respond(500, { error: 'Database error (timesheets update)' });
    }

    return respond(200, { ok: true, status: upd.data.status });
  } catch (e) {
    const msg = e && e.message ? e.message : 'Failed to save draft';
    const code = msg === 'Unauthorized' ? 401 : 400;
    console.error('timesheets-save exception:', e);
    return respond(code, { error: msg });
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
