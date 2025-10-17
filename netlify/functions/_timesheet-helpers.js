// netlify/functions/_timesheet-helpers.js
const { supabase } = require('./_supabase');
const { getUser } = require('./_auth');

/** Return ISO YYYY-MM-DD for the coming Saturday (week runs Sun→Sat). */
function weekEndingSaturdayISO(d = new Date()) {
  const day = d.getDay();               // 0 Sun .. 6 Sat
  const toSat = (6 - day + 7) % 7;      // days to add to reach Sat
  const sat = new Date(d);
  sat.setDate(d.getDate() + toSat);
  return sat.toISOString().slice(0, 10);
}

/**
 * Resolve Identity user -> contractor -> active assignment.
 * Throws helpful errors if any step is missing.
 */
async function getContext(context) {
  const user = getUser(context);
  const email = String(user?.email || '').toLowerCase();
  if (!email) throw new Error('Unauthorized');

  // 1) Contractor (case-insensitive match, prefer the oldest id if duplicates)
  const { data: contractor, error: cErr } = await supabase
    .from('contractors')
    .select('id,name,email')
    .ilike('email', email)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (cErr) throw new Error(cErr.message);
  if (!contractor) throw new Error('Contractor not found');

  // 2) Active assignment from the view
  const { data: assignment, error: aErr } = await supabase
    .from('assignment_summary')
    .select('*')
    .eq('contractor_id', contractor.id)
    .eq('active', true)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (aErr) throw new Error(aErr.message);
  if (!assignment) throw new Error('No active assignment');

  return { contractor, assignment };
}

/**
 * Ensure a timesheet row exists for (assignment_id, week_ending).
 * Returns the existing/new timesheet row.
 */
async function ensureTimesheet(assignment_id, week_ending) {
  // Try fetch first
  const { data: ts, error: findErr } = await supabase
    .from('timesheets')
    .select('id,status,week_ending')
    .eq('assignment_id', assignment_id)
    .eq('week_ending', week_ending)
    .maybeSingle();

  if (findErr) throw new Error(findErr.message);
  if (ts) return ts;

  // Create if missing
  const { data: created, error: insErr } = await supabase
    .from('timesheets')
    .insert({ assignment_id, week_ending, status: 'draft' })
    .select('id,status,week_ending')
    .single();

  if (insErr) throw new Error(insErr.message);
  return created;
}

module.exports = {
  weekEndingSaturdayISO,
  getContext,
  ensureTimesheet,
  supabase
};
