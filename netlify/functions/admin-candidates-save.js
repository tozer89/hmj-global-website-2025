// netlify/functions/admin-candidates-save.js
const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  ensureCandidateFromAuthUser,
  resolvePortalAuthUser,
  summarisePortalAuthUser,
  syncPortalAuthUserFromCandidate,
} = require('./_candidate-account-admin.js');
const {
  normaliseOnboardingStatus,
  normaliseRightToWorkEvidenceType,
} = require('./_candidate-portal.js');
const { stripSensitiveCandidateFields } = require('./_candidate-onboarding-admin.js');

function splitFullName(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return { first_name: '', last_name: '' };
  const parts = text.split(' ');
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return {
    first_name: parts.shift() || '',
    last_name: parts.join(' ').trim(),
  };
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function shouldRequireNameValidation(body) {
  return !body?.id || hasOwn(body, 'first_name') || hasOwn(body, 'last_name') || hasOwn(body, 'full_name');
}

function parseTextArray(value, maxLength = 160) {
  const items = Array.isArray(value)
    ? value
    : String(value == null ? '' : value).split(/[\n,]/);
  const seen = new Set();
  const out = [];
  items.forEach((item) => {
    const entry = String(item == null ? '' : item).trim().slice(0, maxLength);
    if (!entry) return;
    const key = entry.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  });
  return out;
}

function parsePositiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const baseHandler = async (event, context) => {
  try {
    // ✅ IMPORTANT: pass (event, context, { requireAdmin:true })
    const { user, roles, supabase, supabaseError } = await getContext(event, context, { requireAdmin: true });

    if (event.httpMethod !== 'POST') throw coded(405, 'Method Not Allowed');

    if (!supabase || typeof supabase.from !== 'function') {
      const reason = supabaseError?.message || 'Supabase not configured for this deploy';
      throw coded(503, reason);
    }

    const body = JSON.parse(event.body || '{}');

    const trim = (value) => {
      if (value === null || value === undefined) return null;
      const text = String(value).trim();
      return text.length ? text : null;
    };

    const toBool = (value) => {
      if (value === null || value === undefined || value === '') return undefined;
      if (typeof value === 'boolean') return value;
      return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
    };

    const parseJson = (value) => {
      if (!value) return null;
      if (typeof value === 'object') return value;
      try {
        return JSON.parse(String(value));
      } catch (err) {
        console.warn('[candidates] address_json parse failed (%s)', err?.message || err);
        return null;
      }
    };

    const hasSkills = hasOwn(body, 'skills');
    const skillsArray = Array.isArray(body.skills)
      ? body.skills.filter((s) => !!s).map((s) => String(s).trim()).filter(Boolean)
      : String(body.skills || '')
          .split(/[\n,]/)
          .map((part) => part.trim())
          .filter(Boolean);

    const rec = { id: body.id ?? undefined };

    const assignTrim = (targetKey, sourceKey = targetKey) => {
      if (!hasOwn(body, sourceKey)) return;
      rec[targetKey] = trim(body[sourceKey]);
    };

    assignTrim('ref');
    assignTrim('user_id');
    assignTrim('full_name');
    if (hasOwn(body, 'first_name')) rec.first_name = String(body.first_name || '').trim();
    if (hasOwn(body, 'last_name')) rec.last_name = String(body.last_name || '').trim();
    assignTrim('email');
    assignTrim('phone');
    assignTrim('status');
    assignTrim('job_title');
    assignTrim('client_name');
    assignTrim('pay_type');
    assignTrim('payroll_ref');
    assignTrim('salary_expectation');
    assignTrim('salary_expectation_unit');
    assignTrim('internal_ref');
    assignTrim('address');
    assignTrim('address1');
    assignTrim('address2');
    assignTrim('town');
    assignTrim('county');
    assignTrim('postcode');
    if (hasOwn(body, 'country')) rec.country = trim(body.country) || 'United Kingdom';
    if (hasOwn(body, 'address_json')) rec.address_json = parseJson(body.address_json);
    assignTrim('location');
    assignTrim('nationality');
    assignTrim('emergency_name');
    assignTrim('emergency_phone');
    if (hasOwn(body, 'onboarding_mode')) rec.onboarding_mode = toBool(body.onboarding_mode);
    if (hasOwn(body, 'onboarding_status')) rec.onboarding_status = normaliseOnboardingStatus(body.onboarding_status);
    if (hasOwn(body, 'onboarding_status_updated_at')) rec.onboarding_status_updated_at = trim(body.onboarding_status_updated_at);
    if (hasOwn(body, 'onboarding_status_updated_by')) rec.onboarding_status_updated_by = trim(body.onboarding_status_updated_by);
    assignTrim('rtw_url');
    assignTrim('contract_url');
    if (hasOwn(body, 'terms_ok')) rec.terms_ok = !!body.terms_ok;
    if (hasOwn(body, 'right_to_work') || hasOwn(body, 'rtw_ok')) rec.right_to_work = toBool(body.right_to_work ?? body.rtw_ok);
    if (hasOwn(body, 'right_to_work_regions')) rec.right_to_work_regions = parseTextArray(body.right_to_work_regions);
    if (hasOwn(body, 'right_to_work_status')) rec.right_to_work_status = trim(body.right_to_work_status);
    if (hasOwn(body, 'right_to_work_evidence_type') || hasOwn(body, 'right_to_work_document_type')) {
      rec.right_to_work_evidence_type = normaliseRightToWorkEvidenceType(
        body.right_to_work_evidence_type ?? body.right_to_work_document_type
      );
    }
    assignTrim('primary_specialism');
    assignTrim('secondary_specialism');
    assignTrim('current_job_title');
    assignTrim('desired_roles');
    assignTrim('qualifications');
    assignTrim('sector_experience');
    assignTrim('sector_focus');
    assignTrim('role');
    if (hasOwn(body, 'availability_on') || hasOwn(body, 'availability_date')) {
      rec.availability_date = trim(body.availability_on ?? body.availability_date);
    }
    if (hasOwn(body, 'availability')) rec.availability = trim(body.availability);
    if (hasOwn(body, 'relocation_preference') || hasOwn(body, 'relocation')) {
      rec.relocation_preference = trim(body.relocation_preference ?? body.relocation);
    }
    if (hasOwn(body, 'salary_expectation')) rec.salary_expectation = trim(body.salary_expectation);
    if (hasOwn(body, 'salary_expectation_unit')) rec.salary_expectation_unit = trim(body.salary_expectation_unit);
    if (hasOwn(body, 'experience_years') || hasOwn(body, 'years_experience')) {
      rec.experience_years = parsePositiveInteger(body.experience_years ?? body.years_experience);
    }
    assignTrim('linkedin_url');
    if (hasOwn(body, 'linkedin') && !hasOwn(body, 'linkedin_url')) rec.linkedin_url = trim(body.linkedin);
    assignTrim('summary');
    if (hasOwn(body, 'message') && !hasOwn(body, 'summary')) rec.summary = trim(body.message);
    if (hasOwn(body, 'start_date') || hasOwn(body, 'availability_on') || hasOwn(body, 'availability_date')) {
      rec.start_date = trim(body.start_date ?? body.availability_on ?? body.availability_date);
    }
    assignTrim('end_date');
    assignTrim('timesheet_status');
    assignTrim('notes');
    if (hasOwn(body, 'consent_captured') || hasOwn(body, 'consent')) {
      rec.consent_captured = toBool(body.consent_captured ?? body.consent);
    }
    if (hasOwn(body, 'consent_captured_at')) {
      rec.consent_captured_at = trim(body.consent_captured_at);
    } else if (rec.consent_captured === true) {
      rec.consent_captured_at = new Date().toISOString();
    }

    if (hasSkills) {
      rec.skills = skillsArray.length ? skillsArray : [];
    }

    if (rec.right_to_work === undefined) {
      delete rec.right_to_work;
    }

    if (!hasOwn(body, 'address_json')) {
      delete rec.address_json;
    }

    if (!hasOwn(body, 'terms_ok')) {
      delete rec.terms_ok;
    }

    if (hasOwn(body, 'onboarding_status') && rec.onboarding_status) {
      rec.onboarding_status_updated_at = rec.onboarding_status_updated_at || new Date().toISOString();
      rec.onboarding_status_updated_by = rec.onboarding_status_updated_by || (user?.email || null);
    }

    const requiresNameValidation = shouldRequireNameValidation(body);

    if (requiresNameValidation && (!rec.first_name || !rec.last_name) && rec.full_name) {
      const parsed = splitFullName(rec.full_name);
      rec.first_name = rec.first_name || parsed.first_name;
      rec.last_name = rec.last_name || parsed.last_name;
    }

    if (requiresNameValidation && (!rec.first_name || !rec.last_name) && rec.id) {
      const { data: existingCandidate } = await supabase
        .from('candidates')
        .select('first_name,last_name,full_name')
        .eq('id', rec.id)
        .maybeSingle();

      if (existingCandidate) {
        rec.first_name = rec.first_name || String(existingCandidate.first_name || '').trim();
        rec.last_name = rec.last_name || String(existingCandidate.last_name || '').trim();
        if ((!rec.first_name || !rec.last_name) && existingCandidate.full_name) {
          const parsedExisting = splitFullName(existingCandidate.full_name);
          rec.first_name = rec.first_name || parsedExisting.first_name;
          rec.last_name = rec.last_name || parsedExisting.last_name;
        }
      }
    }

    if (requiresNameValidation && (!rec.first_name || !rec.last_name)) {
      throw coded(400, 'First & last name are required');
    }

    const t0 = Date.now();

    const doUpsert = async (payload) => {
      const copy = { ...payload };
      const id = copy.id;
      delete copy.id;
      if (id) {
        return supabase
          .from('candidates')
          .update(copy)
          .eq('id', id)
          .select('*')
          .maybeSingle();
      }
      return supabase
        .from('candidates')
        .insert(copy)
        .select('*')
        .single();
    };

    let attempt = 0;
    let result;
    let error;
    const working = { ...rec };
    const dropped = new Set();

    while (attempt < 30) {
      attempt += 1;
      ({ data: result, error } = await doUpsert(working));
      if (!error) break;

      const match = /column "?([a-zA-Z0-9_]+)"? does not exist/i.exec(error.message || '')
        || /Could not find the '([a-zA-Z0-9_]+)' column of '[^']+' in the schema cache/i.exec(error.message || '');
      if (match) {
        const missingColumn = match[1];
        if (missingColumn && missingColumn in working && !dropped.has(missingColumn)) {
          console.warn('[candidates] dropping unknown column %s and retrying', missingColumn);
          delete working[missingColumn];
          dropped.add(missingColumn);
          continue;
        }
      }

      throw coded(500, error.message);
    }

    if (error) throw coded(500, error.message);

    let savedCandidate = result;
    let portalAuth = null;
    let warning = '';

    try {
      let authUser = await resolvePortalAuthUser(supabase, savedCandidate, rec.email);
      if (authUser && !savedCandidate?.auth_user_id) {
        const repaired = await ensureCandidateFromAuthUser(supabase, authUser, savedCandidate);
        savedCandidate = repaired?.candidate || savedCandidate;
      }
      authUser = await resolvePortalAuthUser(supabase, savedCandidate, rec.email);
      if (authUser) {
        authUser = await syncPortalAuthUserFromCandidate(
          supabase,
          savedCandidate,
          authUser,
          { syncEmail: Object.prototype.hasOwnProperty.call(body, 'email') }
        );
        portalAuth = summarisePortalAuthUser(authUser);
      }
    } catch (portalError) {
      warning = portalError?.message || 'Candidate record saved, but the linked portal account could not be updated.';
      console.warn('[candidates] portal auth sync failed (%s)', warning);
    }

    // Optional: audit trail
    await supabase.from('admin_audit_logs').insert({
      actor_email: user.email,
      actor_id: user.sub || user.id || null,
      action: rec.id ? 'candidate.update' : 'candidate.insert',
      target_type: 'candidate',
      target_id: String(savedCandidate.id),
      meta: { ...stripSensitiveCandidateFields(working), id: savedCandidate.id },
    });

    const took_ms = Date.now() - t0;
    return {
      statusCode: 200,
      body: JSON.stringify({
        id: savedCandidate.id,
        ok: true,
        took_ms,
        candidate: stripSensitiveCandidateFields(savedCandidate),
        portal_auth: portalAuth,
        warning: warning || null,
      }),
    };
  } catch (e) {
    const status = e.code || 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message || 'Error', readOnly: status === 503 }) };
  }
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
exports._test = { splitFullName, shouldRequireNameValidation };
