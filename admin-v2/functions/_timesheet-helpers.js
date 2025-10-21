// Inside your handler, before you call sb()
const fallbackKey =
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ADMIN_KEY ||
  process.env.SUPABASE_ANON_KEY || '';

if (!fallbackKey) {
  return bad('supabaseKey is required.');
}

// Make sure _lib / sb() reads from process.env.SUPABASE_KEY:
process.env.SUPABASE_KEY = fallbackKey;



// netlify/functions/_timesheet-helpers.js
const { supabase } = require('./_supabase');

// Week ends Saturday, we display Sun..Sat
function weekEndingSaturdayISO(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay(); // 0..6 (Sun..Sat)
  const add = (6 - day + 7) % 7; // days to Saturday
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0,10); // YYYY-MM-DD
}

// Pull identity email from Netlify function context
function getIdentityEmail(context) {
  return context?.clientContext?.user?.email || null;
}

// Load contractor + most recent active assignment (with names & rates)
async function getContext(context) {
  const email = getIdentityEmail(context);
  if (!email) throw new Error('identity_required');

  // Contractor
  const { data: contractor, error: cErr } = await supabase
    .from('contractors')
    .select('id,name,email')
    .eq('email', email)
    .maybeSingle();

  if (cErr) throw cErr;
  if (!contractor) return { contractor: null, assignment: null };

  // Most recent active assignment
  const { data: assignment, error: aErr } = await supabase
    .from('assignments')
    .select(`
      id, contractor_id, rate_std, rate_ot, start_date, end_date, active,
      projects:project_id ( name ),
      sites:site_id ( name ),
      clients:project_id!inner ( clients:client_id ( name ) )
    `)
    .eq('contractor_id', contractor.id)
    .eq('active', true)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (aErr) throw aErr;

  if (assignment) {
    assignment.project_name = assignment.projects?.name || null;
    assignment.site_name    = assignment.sites?.name || null;
    // “clients” comes via the projects join; flatten:
    assignment.client_name  = assignment.clients?.clients?.name || null;
    delete assignment.projects;
    delete assignment.sites;
    delete assignment.clients;
  }

  return { contractor, assignment };
}

// Ensure there is a single timesheet row for (assignment_id, week_ending)
async function ensureTimesheet(assignment_id, week_ending) {
  // Try to find one
  const { data: existing, error: sErr } = await supabase
    .from('timesheets')
    .select('id, week_ending, status')
    .eq('assignment_id', assignment_id)
    .eq('week_ending', week_ending)
    .maybeSingle();

  if (sErr) throw sErr;
  if (existing) return existing;

  // Create one (default draft)
  const { data: created, error: iErr } = await supabase
    .from('timesheets')
    .insert({ assignment_id, week_ending, status: 'draft' })
    .select('id, week_ending, status')
    .single();

  if (iErr) throw iErr;
  return created;
}

module.exports = {
  supabase,
  weekEndingSaturdayISO,
  getContext,
  ensureTimesheet,
  getIdentityEmail
};
