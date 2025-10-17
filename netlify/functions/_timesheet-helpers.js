const { supabaseClient } = require('./_supabase');
const { getUser } = require('./_auth');

function weekEndingSaturdayISO(d = new Date()) {
  const day = d.getDay();           // 0 Sun..6 Sat
  const toSat = (6 - day + 7) % 7;  // days to add to reach Saturday
  const sat = new Date(d);
  sat.setDate(d.getDate() + toSat);
  return sat.toISOString().slice(0, 10);
}

async function getContext(context) {
  const user = getUser(context);
  const email = (user.email || '').toLowerCase();
  const supabase = await supabaseClient();

  // contractor
  const { data: contractor, error: cErr } = await supabase
    .from('contractors')
    .select('id,name,email')
    .eq('email', email)
    .maybeSingle();

  if (cErr) throw cErr;
  if (!contractor) throw new Error('Contractor not found');

  // active assignment
  const { data: assignment, error: aErr } = await supabase
    .from('assignment_summary')
    .select('*')
    .eq('contractor_id', contractor.id)
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (aErr) throw aErr;
  if (!assignment) throw new Error('No active assignment');

  return { supabase, contractor, assignment };
}

async function ensureTimesheet(supabase, assignment_id, week_ending) {
  const { data: ts, error: qErr } = await supabase
    .from('timesheets')
    .select('id,status,week_ending')
    .eq('assignment_id', assignment_id)
    .eq('week_ending', week_ending)
    .maybeSingle();

  if (qErr) throw qErr;
  if (ts) return ts;

  const ins = await supabase
    .from('timesheets')
    .insert({ assignment_id, week_ending, status: 'draft' })
    .select()
    .single();

  if (ins.error) throw ins.error;
  return ins.data;
}

module.exports = { weekEndingSaturdayISO, getContext, ensureTimesheet };
