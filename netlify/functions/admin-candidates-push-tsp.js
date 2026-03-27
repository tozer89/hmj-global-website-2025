'use strict';

// admin-candidates-push-tsp.js
// Pushes a new-starter candidate to the Timesheet Portal and saves their
// Bullhorn reference number to the Supabase candidate record.
//
// POST body: { candidateId: string, bullhornRef: string }
//
// Flow:
//  1. Load the candidate from Supabase
//  2. Validate Bullhorn ref (1–6 numeric digits)
//  3. Save bullhorn_ref field to the candidate record
//  4. Authenticate with the Timesheet Portal
//  5. POST the contractor profile to TSP
//  6. Save the TSP contractor reference back to the candidate (payroll_ref)
//  7. Return a structured summary

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const { readTimesheetPortalConfig } = require('./_timesheet-portal.js');

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function normaliseBullhornRef(value) {
  const raw = String(value == null ? '' : value).replace(/\D/g, '').trim();
  if (!raw || raw.length < 1 || raw.length > 6) return '';
  return raw;
}

async function getAuthHeaders(config) {
  // OAuth client credentials flow
  if (config.clientId && config.clientSecret) {
    const clientIds = Array.isArray(config.clientIdVariants) && config.clientIdVariants.length
      ? config.clientIdVariants
      : [config.clientId];
    for (const clientId of clientIds) {
      try {
        const body = new URLSearchParams();
        body.set('grant_type', 'client_credentials');
        body.set('client_id', clientId);
        body.set('client_secret', config.clientSecret);
        if (config.scope) body.set('scope', config.scope);
        const tokenUrl = `${config.baseUrl}${config.tokenPath || '/oauth/token'}`;
        const res = await fetch(tokenUrl, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.access_token) {
          return { authorization: `Bearer ${data.access_token}`, accept: 'application/json' };
        }
      } catch {
        // try next
      }
    }
  }
  // API token fallback
  if (config.apiToken) {
    return { authorization: config.apiToken, accept: 'application/json' };
  }
  throw Object.assign(new Error('Timesheet Portal credentials are not configured or could not authenticate.'), {
    code: 'timesheet_portal_auth_failed',
  });
}

async function tryCreateContractor(config, contractorPayload) {
  const authHeaders = await getAuthHeaders(config);
  const baseUrl = config.resourceBaseUrl || config.baseUrl;

  // Try most-likely POST endpoints for contractor creation
  const createPaths = [
    '/contractors',
    '/recruitment/contractors',
    '/api/recruitment/contractors',
    '/users',
  ];

  for (const path of createPaths) {
    const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(contractorPayload),
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }

      if (res.ok) {
        return {
          ok: true,
          path,
          tspId: json?.id || json?.contractorId || json?.userId || json?.reference || null,
          tspRef: json?.reference || json?.contractorCode || json?.code || null,
          raw: json,
        };
      }
      // 404 means the path doesn't exist — try next
      if (res.status === 404) continue;
      // 405 Method Not Allowed — try next path
      if (res.status === 405) continue;
      // Other errors — surface the message but don't try more
      const errMsg = json?.message || json?.error || json?.title || `TSP responded with HTTP ${res.status}`;
      return { ok: false, path, error: errMsg, status: res.status };
    } catch (err) {
      // Network error on this path — try next
      continue;
    }
  }

  return {
    ok: false,
    error: 'No Timesheet Portal contractor creation endpoint responded successfully. Ensure the TSP API supports contractor creation.',
    code: 'tsp_create_path_not_found',
  };
}

function buildContractorPayload(candidate, bullhornRef) {
  const firstName = trimString(candidate.first_name || '', 80);
  const lastName = trimString(candidate.last_name || '', 80);
  return {
    // Standard TSP contractor fields
    firstName,
    firstname: firstName,
    lastName,
    lastname: lastName,
    surname: lastName,
    name: [firstName, lastName].filter(Boolean).join(' '),
    fullName: [firstName, lastName].filter(Boolean).join(' '),
    email: trimString(candidate.email || '', 320).toLowerCase(),
    emailAddress: trimString(candidate.email || '', 320).toLowerCase(),
    phone: trimString(candidate.phone || '', 40),
    mobile: trimString(candidate.phone || '', 40),
    // Bullhorn reference — stored as an external reference so it flows through
    externalReference: bullhornRef,
    bullhornRef: bullhornRef,
    bullhornId: bullhornRef,
    // National Insurance / payroll reference from existing data
    nationalInsuranceNumber: trimString(candidate.ni_number || '', 20),
    niNumber: trimString(candidate.ni_number || '', 20),
    // Role / specialism
    jobTitle: trimString(candidate.current_job_title || candidate.headline_role || '', 160),
    role: trimString(candidate.current_job_title || candidate.headline_role || '', 160),
    // Address
    address: trimString(candidate.location || '', 240),
    location: trimString(candidate.location || '', 240),
  };
}

const baseHandler = async (event, context) => {
  const { supabase } = await getContext(event, context, { requireAdmin: true });

  if ((event.httpMethod || '').toUpperCase() !== 'POST') {
    throw coded(405, 'Method Not Allowed');
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const candidateId = trimString(body.candidateId, 120);
  const bullhornRef = normaliseBullhornRef(body.bullhornRef);

  if (!candidateId) throw coded(400, 'candidateId is required.');
  if (!bullhornRef) throw coded(400, 'A valid Bullhorn reference (1–6 digits) is required.');
  if (!supabase || typeof supabase.from !== 'function') throw coded(503, 'Supabase unavailable.');

  // 1. Load the candidate
  const { data: rows, error: fetchErr } = await supabase
    .from('candidates')
    .select('id,email,first_name,last_name,phone,location,current_job_title,headline_role,ni_number,payroll_ref')
    .eq('id', candidateId)
    .limit(1);

  if (fetchErr) throw coded(500, fetchErr.message || 'Could not load candidate.');
  const candidate = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!candidate) throw coded(404, 'Candidate not found.');

  // 2. Save Bullhorn ref to the candidate
  const updatePayload = { bullhorn_ref: bullhornRef };
  const { error: updateErr } = await supabase
    .from('candidates')
    .update(updatePayload)
    .eq('id', candidateId);

  if (updateErr) {
    // Non-fatal — the column may not exist yet, log and continue
    console.warn('[push-tsp] Could not save bullhorn_ref to candidate:', updateErr.message || updateErr);
  }

  // 3. Try Timesheet Portal
  const config = readTimesheetPortalConfig();
  if (!config.enabled || !config.configured) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({
        ok: false,
        bullhornRefSaved: !updateErr,
        configured: false,
        error: 'Timesheet Portal is not configured. Bullhorn reference has been saved to the candidate record.',
      }),
    };
  }

  const contractorPayload = buildContractorPayload(candidate, bullhornRef);
  const tspResult = await tryCreateContractor(config, contractorPayload);

  // 4. If TSP creation succeeded, save the TSP reference back
  if (tspResult.ok && (tspResult.tspRef || tspResult.tspId)) {
    const tspRef = tspResult.tspRef || tspResult.tspId;
    const { error: tspRefErr } = await supabase
      .from('candidates')
      .update({ payroll_ref: trimString(String(tspRef), 120) })
      .eq('id', candidateId);
    if (tspRefErr) {
      console.warn('[push-tsp] Could not save TSP ref to candidate:', tspRefErr.message || tspRefErr);
    }
  }

  const fullName = [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || candidate.email;

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify({
      ok: tspResult.ok,
      candidateId,
      candidateName: fullName,
      bullhornRef,
      bullhornRefSaved: !updateErr,
      tspCreated: tspResult.ok,
      tspId: tspResult.ok ? (tspResult.tspId || null) : null,
      tspRef: tspResult.ok ? (tspResult.tspRef || null) : null,
      message: tspResult.ok
        ? `${fullName} has been pushed to Timesheet Portal. Bullhorn ref ${bullhornRef} saved.`
        : (tspResult.error || 'TSP creation failed.'),
      error: tspResult.ok ? undefined : (tspResult.error || 'TSP creation failed.'),
    }),
  };
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
