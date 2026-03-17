'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  listTimesheetPortalContractors,
  readTimesheetPortalConfig,
} = require('./_timesheet-portal.js');
const {
  buildCandidateRedirects,
  ensureCandidateFromAuthUser,
  resolvePortalAuthUser,
  syncPortalAuthUserFromCandidate,
} = require('./_candidate-account-admin.js');
const {
  buildTimesheetPortalContractorLookups,
  buildWebsiteCandidateLookups,
  candidateDisplayName,
  matchTimesheetPortalContractorForCandidate,
  matchWebsiteCandidateForTimesheetPortalContractor,
  mergeTimesheetPortalCandidate,
  trimString,
} = require('./_candidate-timesheet-sync.js');

async function loadWebsiteCandidates(supabase) {
  const rows = [];
  let from = 0;
  const pageSize = 1000;
  while (from < 10000) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('candidates')
      .select('id,auth_user_id,ref,payroll_ref,email,first_name,last_name,full_name,phone,location,country,headline_role,current_job_title,primary_specialism,status,updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .range(from, to);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function persistCandidatePayloads(supabase, payloads = []) {
  const cleanPayloads = (Array.isArray(payloads) ? payloads : []).map((payload) => {
    const copy = { ...payload };
    Object.keys(copy).forEach((key) => {
      if (copy[key] === undefined) delete copy[key];
    });
    return copy;
  });

  const updates = cleanPayloads.filter((payload) => payload.id);
  const inserts = cleanPayloads.filter((payload) => !payload.id);
  const out = [];

  if (updates.length) {
    const { data, error } = await supabase
      .from('candidates')
      .upsert(updates)
      .select('id,auth_user_id,ref,payroll_ref,email,first_name,last_name,full_name,phone,location,country,headline_role,current_job_title,primary_specialism,status,updated_at');
    if (error) throw error;
    out.push(...(Array.isArray(data) ? data : []));
  }

  if (inserts.length) {
    const { data, error } = await supabase
      .from('candidates')
      .insert(inserts)
      .select('id,auth_user_id,ref,payroll_ref,email,first_name,last_name,full_name,phone,location,country,headline_role,current_job_title,primary_specialism,status,updated_at');
    if (error) throw error;
    out.push(...(Array.isArray(data) ? data : []));
  }

  return out;
}

async function syncPortalAccounts(supabase, event, candidates = [], { provisionPortalAccounts = false } = {}) {
  const redirects = buildCandidateRedirects(event);
  let linked = 0;
  let invited = 0;

  for (const candidate of candidates) {
    if (!trimString(candidate?.email, 320)) continue;
    let authUser = await resolvePortalAuthUser(supabase, candidate, candidate.email);
    if (!authUser && provisionPortalAccounts) {
      const invite = await supabase.auth.admin.inviteUserByEmail(candidate.email, {
        redirectTo: redirects.emailRedirectUrl,
        data: {
          full_name: trimString(candidate.full_name, 240) || candidateDisplayName(candidate),
          first_name: trimString(candidate.first_name, 120) || null,
          last_name: trimString(candidate.last_name, 120) || null,
        },
      });
      if (invite?.error) throw invite.error;
      authUser = invite?.data?.user || null;
      if (authUser) invited += 1;
    }
    if (!authUser) continue;
    const ensured = await ensureCandidateFromAuthUser(supabase, authUser, candidate);
    const syncedCandidate = ensured?.candidate || candidate;
    await syncPortalAuthUserFromCandidate(supabase, syncedCandidate, authUser, { syncEmail: false }).catch(() => null);
    linked += 1;
  }

  return { linked, invited };
}

const baseHandler = async (event, context) => {
  const { supabase } = await getContext(event, context, { requireAdmin: true });
  if ((event.httpMethod || '').toUpperCase() !== 'POST') throw coded(405, 'Method Not Allowed');
  if (!supabase || typeof supabase.from !== 'function') throw coded(503, 'Supabase unavailable.');

  const config = readTimesheetPortalConfig();
  if (!config.enabled || !config.configured) {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        ok: true,
        configured: false,
        message: 'Timesheet Portal is not configured for this environment.',
      }),
    };
  }

  const body = JSON.parse(event.body || '{}');
  const candidateIds = Array.isArray(body.candidateIds)
    ? body.candidateIds.map((value) => String(value))
    : [];
  const provisionPortalAccounts = body.provisionPortalAccounts === true;

  try {
    const tspData = await listTimesheetPortalContractors(config, { take: 1000 });
    const websiteCandidates = await loadWebsiteCandidates(supabase);
    const now = new Date().toISOString();
    const payloads = [];
    const preview = [];
    let matchedExisting = 0;
    let skipped = 0;

    if (candidateIds.length) {
      const contractorLookups = buildTimesheetPortalContractorLookups(tspData.contractors || []);
      websiteCandidates
        .filter((candidate) => candidateIds.includes(String(candidate.id)))
        .forEach((candidate) => {
          const { contractor, matchedBy } = matchTimesheetPortalContractorForCandidate(candidate, contractorLookups);
          if (!contractor) {
            skipped += 1;
            return;
          }
          matchedExisting += 1;
          const payload = mergeTimesheetPortalCandidate({ contractor, existing: candidate, now });
          payloads.push(payload);
          if (preview.length < 15) {
            preview.push({
              id: payload.id || null,
              ref: payload.ref || payload.payroll_ref || null,
              email: payload.email || null,
              name: payload.full_name || candidateDisplayName(payload),
              matched_by: matchedBy,
            });
          }
        });
    } else {
      const lookups = buildWebsiteCandidateLookups(websiteCandidates);
      const seen = new Set();
      (tspData.contractors || []).forEach((contractor) => {
        const { candidate, matchedBy } = matchWebsiteCandidateForTimesheetPortalContractor(contractor, lookups);
        if (candidate) matchedExisting += 1;
        const payload = mergeTimesheetPortalCandidate({ contractor, existing: candidate, now });
        const dedupeKey = payload.id
          ? `id:${payload.id}`
          : `identity:${payload.email || payload.payroll_ref || payload.ref || payload.full_name || contractor.id}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        payloads.push(payload);
        if (preview.length < 15) {
          preview.push({
            id: payload.id || null,
            ref: payload.ref || payload.payroll_ref || null,
            email: payload.email || null,
            name: payload.full_name || candidateDisplayName(payload),
            matched_by: matchedBy,
          });
        }
      });
    }

    const persisted = await persistCandidatePayloads(supabase, payloads);
    const portalSync = await syncPortalAccounts(supabase, event, persisted, { provisionPortalAccounts });
    const inserted = payloads.filter((payload) => !payload.id).length;
    const updated = payloads.filter((payload) => !!payload.id).length;

    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        ok: true,
        configured: true,
        syncedAt: now,
        candidatePath: tspData.discovery.candidatePath,
        attempts: tspData.discovery.attempts,
        fetched: Array.isArray(tspData.contractors) ? tspData.contractors.length : 0,
        upserted: persisted.length,
        inserted,
        updated,
        matchedExisting,
        skipped,
        linkedPortalAccounts: portalSync.linked,
        invitedPortalAccounts: portalSync.invited,
        rows: preview,
        message: provisionPortalAccounts
          ? `Synced ${persisted.length} candidate record${persisted.length === 1 ? '' : 's'} from Timesheet Portal and invited ${portalSync.invited} portal account${portalSync.invited === 1 ? '' : 's'}.`
          : `Synced ${persisted.length} candidate record${persisted.length === 1 ? '' : 's'} from Timesheet Portal.`,
      }),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({
        ok: false,
        configured: true,
        code: error?.code || 'timesheet_portal_candidate_sync_failed',
        message: error?.message || 'Timesheet Portal candidate sync failed.',
        attempts: Array.isArray(error?.attempts) ? error.attempts : [],
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
