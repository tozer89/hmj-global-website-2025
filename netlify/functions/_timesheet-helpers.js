// netlify/functions/_timesheet-helpers.js
const { getContext, coded } = require('./_auth');

function weekEndingSaturdayISO(d = new Date()) {
  const day = d.getDay();        // 0=Sun .. 6=Sat
  const diff = 6 - day;          // days until Saturday
  const sat = new Date(d);
  sat.setDate(d.getDate() + diff);
  sat.setHours(0,0,0,0);
  return sat.toISOString().slice(0,10);
}

async function ensureTimesheet(supabase, assignmentId, weekEndingISO) {
  const { data: found, error: selErr } = await supabase
    .from('timesheets')
    .select('id,status')
    .eq('assignment_id', assignmentId)
    .eq('week_ending', weekEndingISO)
    .maybeSingle();
  if (selErr) throw selErr;

  if (found) return found;

  const { data, error } = await supabase
    .from('timesheets')
    .insert({ assignment_id: assignmentId, week_ending: weekEndingISO, status: 'draft' })
    .select('id,status')
    .single();
  if (error) throw error;
  return data;
}

module.exports = { getContext, coded, weekEndingSaturdayISO, ensureTimesheet };
