// netlify/functions/admin-candidates-get.js
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { loadAssignmentOptions, loadLinkedAssignments } = require('./_candidate-assignments.js');
const { loadStaticCandidates, toCandidate } = require('./_candidates-helpers.js');
const { attachOnboardingSummaries } = require('./_candidate-onboarding-admin.js');
const { presentCandidateDocuments } = require('./_candidate-docs.js');
const {
  ensureCandidateFromAuthUser,
  resolvePortalAuthUser,
  summarisePortalAuthUser,
} = require('./_candidate-account-admin.js');

function buildLegacyDocs(record) {
  return [
    record?.rtw_url ? { id: `${record.id || 'candidate'}-legacy-rtw`, kind: 'Right to work', url: record.rtw_url } : null,
    record?.contract_url ? { id: `${record.id || 'candidate'}-legacy-contract`, kind: 'Contract', url: record.contract_url } : null,
  ].filter(Boolean);
}

const baseHandler = async (event, context) => {
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const id = body.id || event.queryStringParameters?.id || null;

  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };
  }

  const serveStatic = (reason, auth = null) => {
    const fallback = loadStaticCandidates().map(toCandidate);
    const match = fallback.find((row) => String(row.id) === String(id));
    if (!match) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Candidate not found', readOnly: true, source: 'static', auth }),
      };
    }
    const fullName = match.full_name || `${match.first_name || ''} ${match.last_name || ''}`.trim();
    const record = { ...match, full_name: fullName };
    return {
      statusCode: 200,
      body: JSON.stringify({ ...record, readOnly: true, source: 'static', warning: reason || null, auth }),
    };
  };

  let ctx;
  try {
    ctx = await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    console.warn('[candidates] get auth failed — serving static dataset', err?.message || err);
    return serveStatic(err?.message || 'auth_failed', { ok: false, status: err?.code || 403, error: err?.message || 'Unauthorized' });
  }

  const { supabase, supabaseError } = ctx;

  const shouldFallback = (err) => {
    if (!err) return false;
    const msg = String(err.message || err);
    if (/column .+ does not exist/i.test(msg)) return true;
    if (/Could not find the '.+' column of '.+' in the schema cache/i.test(msg)) return true;
    if (/relation .+ does not exist/i.test(msg)) return true;
    if (/permission denied/i.test(msg)) return true;
    if (/violates row-level security/i.test(msg)) return true;
    return false;
  };

  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return serveStatic(supabaseError?.message || 'supabase_unavailable', { ok: false, error: supabaseError?.message || 'supabase_unavailable' });
    }

    const { data, error } = await supabase
      .from('candidates')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      if (!shouldFallback(error)) {
        console.warn('[candidates] get unexpected error — forcing static fallback', error.message || error);
      }
      return serveStatic(error.message, { ok: false, error: error.message, status: 503 });
    }

    if (!data) {
      return serveStatic('not_found', { ok: false, status: 404, error: 'Candidate not found' });
    }

    let candidateData = data;
    let authUser = null;
    try {
      authUser = await resolvePortalAuthUser(supabase, data, data.email);
      if (authUser && !data.auth_user_id) {
        const repaired = await ensureCandidateFromAuthUser(supabase, authUser, data);
        candidateData = repaired?.candidate || data;
      }
    } catch (authError) {
      console.warn('[candidates] portal auth lookup failed (%s)', authError?.message || authError);
    }

    const full = candidateData.full_name || `${candidateData.first_name || ''} ${candidateData.last_name || ''}`.trim();
    const portalAuth = summarisePortalAuthUser(authUser);
    const record = {
      ...toCandidate(candidateData),
      full_name: full || candidateData.full_name || null,
      source: 'supabase',
      readOnly: false,
      has_portal_account: !!(candidateData.auth_user_id || portalAuth.exists),
      portal_account_state: candidateData.auth_user_id
        ? 'linked'
        : candidateData.portal_account_closed_at
        ? 'closed'
        : portalAuth.exists
        ? 'linked'
        : 'none',
      portal_auth: portalAuth,
      last_portal_login_at: candidateData.last_portal_login_at || portalAuth.last_sign_in_at || null,
    };
    let storedDocs = [];
    let applicationRows = [];
    let activityRows = [];
    let assignmentRows = [];
    let assignmentOptions = [];
    let assignmentLinkingAvailable = true;

    try {
      const { data: docRows, error: docsError } = await supabase
        .from('candidate_documents')
        .select('id,candidate_id,label,filename,url,storage_key,created_at,meta')
        .eq('candidate_id', id)
        .order('created_at', { ascending: false });

      if (docsError) {
        console.warn('[candidates] document lookup failed (%s)', docsError.message || docsError);
      } else {
        storedDocs = await presentCandidateDocuments(supabase, docRows || []);
      }
    } catch (docsError) {
      console.warn('[candidates] document decoration failed (%s)', docsError?.message || docsError);
    }

    try {
      const { data: appRows, error: appError } = await supabase
        .from('job_applications')
        .select('id,job_id,job_title,job_location,job_type,job_pay,status,applied_at')
        .eq('candidate_id', id)
        .order('applied_at', { ascending: false })
        .limit(12);

      if (appError) {
        console.warn('[candidates] application lookup failed (%s)', appError.message || appError);
      } else {
        applicationRows = Array.isArray(appRows) ? appRows : [];
      }
    } catch (appError) {
      console.warn('[candidates] application decoration failed (%s)', appError?.message || appError);
    }

    try {
      const { data: activityData, error: activityError } = await supabase
        .from('candidate_activity')
        .select('id,activity_type,description,created_at,actor_role')
        .eq('candidate_id', id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (activityError) {
        console.warn('[candidates] activity lookup failed (%s)', activityError.message || activityError);
      } else {
        activityRows = Array.isArray(activityData) ? activityData : [];
      }
    } catch (activityError) {
      console.warn('[candidates] activity decoration failed (%s)', activityError?.message || activityError);
    }

    try {
      const linked = await loadLinkedAssignments(supabase, id);
      assignmentRows = Array.isArray(linked?.rows) ? linked.rows : [];
      assignmentLinkingAvailable = linked?.candidateIdSupported !== false;
      const options = await loadAssignmentOptions(supabase, id, { limit: 80 });
      assignmentOptions = Array.isArray(options?.rows) ? options.rows : [];
      assignmentLinkingAvailable = assignmentLinkingAvailable && options?.candidateIdSupported !== false;
    } catch (assignmentError) {
      console.warn('[candidates] assignment lookup failed (%s)', assignmentError?.message || assignmentError);
      assignmentLinkingAvailable = false;
    }

    record.docs = storedDocs.concat(buildLegacyDocs(record));
    record.applications = applicationRows;
    record.audit = activityRows;
    record.assignments = assignmentRows;
    record.assignment_options = assignmentOptions;
    record.assignment_linking_available = assignmentLinkingAvailable;

    const [enriched] = await attachOnboardingSummaries(supabase, [record]);

    return { statusCode: 200, body: JSON.stringify(enriched || record) };
  } catch (e) {
    return serveStatic(e?.message || 'unhandled', { ok: false, status: e?.code || 500, error: e?.message || String(e) });
  }
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
