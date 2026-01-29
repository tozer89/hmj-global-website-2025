// netlify/functions/timesheets-save.js
const { supabase, weekEndingSaturdayISO, getContext, ensureTimesheet } = require('./_timesheet-helpers.js');

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const isDay = d => DAYS.includes(d);

async function upsertEntry(tsId, day, row) {
  // Try RPC first (if it exists), then fall back to table upsert
  const payload = {
    p_timesheet_id: tsId,
    p_day: day,
    p_std: Number(row.std || 0),
    p_ot: Number(row.ot || 0),
    p_note: row.note || ''
  };

  try {
    const { error } = await supabase.rpc('upsert_timesheet_entry', payload);
    if (!error) return; // RPC succeeded
    throw error;        // RPC exists but failed
  } catch {
    // Fallback to direct upsert (requires unique(timesheet_id, day))
    const { error: upErr } = await supabase
      .from('timesheet_entries')
      .upsert({
        timesheet_id: tsId,
        day,
        hours_std: payload.p_std,
        hours_ot: payload.p_ot,
        note: payload.p_note
      }, { onConflict: 'timesheet_id,day' });

    if (upErr) throw upErr;
  }
}

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') return respond(405, { error: 'Method Not Allowed' });

    let body = {};
    try { body = JSON.parse(event.body || '{}'); }
    catch { return respond(400, { error: 'Invalid JSON' }); }

    const entries = body.entries && typeof body.entries === 'object' ? body.entries : {};

    const { assignment } = await getContext(context);
    if (!assignment?.id) {
      return respond(400, { error: 'no_active_assignment' });
    }
    const week_ending = weekEndingSaturdayISO();
    const ts = await ensureTimesheet(assignment.id, week_ending);

    const tasks = [];
    for (const [day, row] of Object.entries(entries)) {
      if (!isDay(day)) continue;
      const safe = {
        std: Math.max(0, Number(row?.std || 0)),
        ot:  Math.max(0, Number(row?.ot  || 0)),
        note: (row?.note || '').toString().slice(0, 500)
      };
      tasks.push(upsertEntry(ts.id, day, safe));
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
    const msg = e?.message || 'Failed to save draft';
    const status = (e?.code === 404 || msg === 'Not Found') ? 404 : 400;
    console.error('timesheets-save exception:', e);
    return respond(status, { error: msg });
  }
};
