// netlify/functions/admin-candidates-save.js
const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  ensureCandidateFromAuthUser,
  resolvePortalAuthUser,
  summarisePortalAuthUser,
  syncPortalAuthUserFromCandidate,
} = require('./_candidate-account-admin.js');

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

    const hasSkills = Object.prototype.hasOwnProperty.call(body, 'skills');
    const skillsArray = Array.isArray(body.skills)
      ? body.skills.filter((s) => !!s).map((s) => String(s).trim()).filter(Boolean)
      : String(body.skills || '')
          .split(/[\n,]/)
          .map((part) => part.trim())
          .filter(Boolean);

    const rec = {
      id: body.id ?? undefined,
      ref: trim(body.ref),
      user_id: trim(body.user_id),
      first_name: (body.first_name || '').trim(),
      last_name: (body.last_name || '').trim(),
      email: trim(body.email),
      phone: trim(body.phone),
      status: trim(body.status),
      job_title: trim(body.job_title),
      client_name: trim(body.client_name),
      pay_type: trim(body.pay_type),
      payroll_ref: trim(body.payroll_ref),
      internal_ref: trim(body.internal_ref),
      address: trim(body.address),
      address1: trim(body.address1),
      address2: trim(body.address2),
      town: trim(body.town),
      county: trim(body.county),
      postcode: trim(body.postcode),
      country: trim(body.country) || 'United Kingdom',
      address_json: parseJson(body.address_json),
      bank_name: trim(body.bank_name),
      bank_sort: trim(body.bank_sort),
      bank_sort_code: trim(body.bank_sort_code),
      bank_account: trim(body.bank_account),
      bank_iban: trim(body.bank_iban),
      bank_swift: trim(body.bank_swift),
      emergency_name: trim(body.emergency_name),
      emergency_phone: trim(body.emergency_phone),
      rtw_url: trim(body.rtw_url),
      contract_url: trim(body.contract_url),
      terms_ok: !!body.terms_ok,
      right_to_work: toBool(body.right_to_work ?? body.rtw_ok),
      role: trim(body.role),
      availability_date: trim(body.availability_on ?? body.availability_date),
      start_date: trim(body.start_date ?? body.availability_on ?? body.availability_date),
      end_date: trim(body.end_date),
      timesheet_status: trim(body.timesheet_status),
      tax_id: trim(body.tax_id),
      notes: trim(body.notes),
    };

    if (hasSkills) {
      rec.skills = skillsArray.length ? skillsArray : [];
    }

    if (rec.right_to_work === undefined) {
      delete rec.right_to_work;
    }

    if (!Object.prototype.hasOwnProperty.call(body, 'address_json')) {
      delete rec.address_json;
    }

    if (!Object.prototype.hasOwnProperty.call(body, 'terms_ok')) {
      delete rec.terms_ok;
    }

    if (!rec.first_name || !rec.last_name) throw coded(400, 'First & last name are required');

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

    while (attempt < 5) {
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
      meta: { ...working, id: savedCandidate.id },
    });

    const took_ms = Date.now() - t0;
    return {
      statusCode: 200,
      body: JSON.stringify({
        id: savedCandidate.id,
        ok: true,
        took_ms,
        candidate: savedCandidate,
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
