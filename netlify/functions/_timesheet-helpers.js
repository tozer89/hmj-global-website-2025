const { supabase } = require('./_supabase');

function getUserFromContext(context) {
  const u = context?.clientContext?.user;
  if (!u || !u.email) throw Object.assign(new Error('Unauthorized'), { code: 401 });
  return { sub: u.sub, email: String(u.email).toLowerCase() };
}

async function getContext(context) {
  const { email } = getUserFromContext(context);

  // contractor
  const { data: contractor, error: cErr } = await supabase
    .from('contractors')
    .select('id,name,email')
    .eq('email', email)
    .single();
  if (cErr) throw cErr;
  if (!contractor) throw Object.assign(new Error('No contractor found'), { code: 404 });

  // current assignment (using your view)
  const { data: assignment, error: aErr } = await supabase
    .from('assignment_summary')
    .select('*')
    .eq('contractor_id', contractor.id)
    .eq('active', true)
    .maybeSingle(); // returns null if none
  if (aErr) throw aErr;

  return { contractor, assignment };
}

// week ending = Saturday (ISO date)
function weekEndingSaturdayISO(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay(); // 0..6 (Sun..Sat)
  // distance to Saturday
  const add = (6 - dow + 7) % 7;
  t.setUTCDate(t.getUTCDate() + add);
  return t.toISOString().slice(0, 10);
}

async function ensureTimesheet(assignment_id, week_ending) {
  // upsert one row and return it
  const { data, error } = await supabase
    .from('timesheets')
    .upsert({ assignment_id, week_ending }, { onConflict: 'assignment_id,week_ending' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  supabase,
  getContext,
  weekEndingSaturdayISO,
  ensureTimesheet,
};
