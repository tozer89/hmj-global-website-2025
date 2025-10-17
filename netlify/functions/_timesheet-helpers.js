const { supabase } = require('./_supabase');
const { getUser } = require('./_auth');

function weekEndingSaturdayISO(d = new Date()) {
  const day = d.getDay(); // 0 Sun..6 Sat
  const toSat = (6 - day + 7) % 7;
  const sat = new Date(d);
  sat.setDate(d.getDate() + toSat);
  return sat.toISOString().slice(0,10);
}

async function getContext(context) {
  const user = getUser(context);
  const email = (user.email || '').toLowerCase();

  // contractor
  const { data: contractor, error: cErr } = await supabase
    .from('contractors').select('id,name,email').eq('email', email).single();
  if (cErr || !contractor) throw new Error('Contractor not found');

  // active assignment
  const { data: assignment, error: aErr } = await supabase
    .from('assignment_summary').select('*')
    .eq('contractor_id', contractor.id).eq('active', true)
    .limit(1).maybeSingle();
  if (aErr) throw aErr;
  if (!assignment) throw new Error('No active assignment');

  return { contractor, assignment };
}

async function ensureTimesheet(assignment_id, week_ending) {
  const { data: ts } = await supabase
    .from('timesheets').select('id,status,week_ending')
    .eq('assignment_id', assignment_id).eq('week_ending', week_ending)
    .maybeSingle();
  if (ts) return ts;

  const ins = await supabase.from('timesheets')
    .insert({ assignment_id, week_ending, status: 'draft' })
    .select().single();
  if (ins.error) throw ins.error;
  return ins.data;
}

module.exports = { weekEndingSaturdayISO, getContext, ensureTimesheet, supabase };
