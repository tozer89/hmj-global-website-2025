// netlify/functions/_timesheet-helpers.js
const { supabase } = require('./_supabase.js');

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

async function loadNamedEntity(client, table, id, columns = 'id,name,client_id') {
  if (!id) return null;
  const { data, error } = await client
    .from(table)
    .select(columns)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function hydrateAssignmentContext(client, assignment) {
  if (!assignment) return null;

  const [project, site] = await Promise.all([
    loadNamedEntity(client, 'projects', assignment.project_id, 'id,name,client_id'),
    loadNamedEntity(client, 'sites', assignment.site_id, 'id,name,client_id'),
  ]);

  const clientId = project?.client_id || site?.client_id || null;
  const linkedClient = await loadNamedEntity(client, 'clients', clientId, 'id,name');

  return {
    ...assignment,
    project_name: project?.name || null,
    site_name: site?.name || assignment.client_site || null,
    client_name: linkedClient?.name || assignment.client_name || null,
  };
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
    .select('id, contractor_id, project_id, site_id, client_name, client_site, rate_std, rate_ot, start_date, end_date, active')
    .eq('contractor_id', contractor.id)
    .eq('active', true)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (aErr) throw aErr;

  const hydratedAssignment = await hydrateAssignmentContext(supabase, assignment);

  return { contractor, assignment: hydratedAssignment };
}

// Ensure there is a single timesheet row for (assignment_id, week_ending).
// Supports both ensureTimesheet(assignmentId, weekEnding) and
// ensureTimesheet(supabaseClient, assignmentId, weekEnding).
async function ensureTimesheet(arg1, arg2, arg3) {
  const client = arg3 ? arg1 : supabase;
  const assignment_id = arg3 ? arg2 : arg1;
  const week_ending = arg3 ? arg3 : arg2;

  // Try to find one
  const { data: existing, error: sErr } = await client
    .from('timesheets')
    .select('id, week_ending, status')
    .eq('assignment_id', assignment_id)
    .eq('week_ending', week_ending)
    .maybeSingle();

  if (sErr) throw sErr;
  if (existing) return existing;

  // Create one (default draft)
  const { data: created, error: iErr } = await client
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
  getIdentityEmail,
  __test: {
    hydrateAssignmentContext,
  },
};
