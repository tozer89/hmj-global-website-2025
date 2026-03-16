'use strict';

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return null;
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function lowerEmail(value) {
  const email = trimString(value, 320);
  return email ? email.toLowerCase() : null;
}

function normaliseSkillList(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value == null ? '' : value)
        .split(/[\n,]/);

  const seen = new Set();
  const out = [];
  raw.forEach((item) => {
    const skill = trimString(item, 80);
    if (!skill) return;
    const key = skill.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(skill);
  });
  return out;
}

function normaliseTextList(value, maxLength = 120) {
  const raw = Array.isArray(value)
    ? value
    : String(value == null ? '' : value)
        .split(/[\n,]/);

  const seen = new Set();
  const out = [];
  raw.forEach((item) => {
    const entry = trimString(item, maxLength);
    if (!entry) return;
    const key = entry.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(entry);
  });
  return out;
}

function splitName(value) {
  const full = trimString(value, 240) || '';
  if (!full) {
    return { firstName: null, lastName: null, fullName: null };
  }

  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: null,
      fullName: parts[0],
    };
  }

  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts.slice(-1).join(' '),
    fullName: parts.join(' '),
  };
}

function normaliseApplicationStatus(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return 'submitted';
  if (raw === 'applied') return 'submitted';
  if (raw === 'under review') return 'reviewing';
  if (raw === 'on hold') return 'on_hold';
  if (raw === 'offered') return 'offered';
  if (raw === 'hired') return 'hired';
  if (raw === 'placed') return 'hired';
  if (raw === 'shortlisted') return 'shortlisted';
  if (raw === 'interviewing') return 'interviewing';
  if (raw === 'rejected') return 'rejected';
  if (raw === 'reviewing') return 'reviewing';
  return 'submitted';
}

function normaliseDocumentType(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return 'other';
  if (raw === 'cv' || raw === 'resume') return 'cv';
  if (raw === 'cover letter' || raw === 'cover_letter') return 'cover_letter';
  if (raw === 'certification' || raw === 'certificate') return 'certificate';
  if (raw === 'qualification_certificate' || raw === 'qualification / certificate') return 'qualification_certificate';
  if (raw === 'passport') return 'passport';
  if (raw === 'right to work' || raw === 'right_to_work') return 'right_to_work';
  if (raw === 'visa / permit' || raw === 'visa_permit' || raw === 'visa' || raw === 'permit') return 'visa_permit';
  if (raw === 'bank document' || raw === 'bank_document') return 'bank_document';
  if (/\bpassport\b/.test(raw)) return 'passport';
  if (/\bvisa\b|\bpermit\b/.test(raw)) return 'visa_permit';
  if (/\bqualification\b|\bcertificate\b|\bcertification\b|\bcard\b|\bticket\b/.test(raw)) return 'qualification_certificate';
  return 'other';
}

function hasOwn(source, key) {
  return !!source && Object.prototype.hasOwnProperty.call(source, key);
}

function pickFirst(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return undefined;
}

function parsePositiveInteger(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function buildCandidateWritePayload(input = {}, options = {}) {
  const includeNulls = !!options.includeNulls;
  const now = options.now || new Date().toISOString();
  const authUser = options.authUser || null;
  const authUserId = trimString(options.authUserId || authUser?.id || input.auth_user_id, 120);
  const email = lowerEmail(pickFirst(input.email, authUser?.email));
  const fullNameSource = pickFirst(
    input.full_name,
    input.name,
    [pickFirst(input.first_name, input.firstName), pickFirst(input.last_name, input.lastName, input.surname)]
      .filter(Boolean)
      .join(' ')
  );
  const name = splitName(fullNameSource);
  const payload = {};

  const assign = (key, value, config = {}) => {
    const treatAsPresent = config.hasValue !== undefined ? config.hasValue : value !== undefined;
    if (!treatAsPresent) return;
    if (value === null) {
      if (includeNulls || config.allowNull) {
        payload[key] = null;
      }
      return;
    }
    payload[key] = value;
  };

  assign('auth_user_id', authUserId, { allowNull: false });
  assign('email', email, { hasValue: email !== null || includeNulls });
  assign(
    'first_name',
    trimString(pickFirst(input.first_name, input.firstName, name.firstName), 120),
    {
      hasValue:
        hasOwn(input, 'first_name')
        || hasOwn(input, 'firstName')
        || (!!name.firstName && !hasOwn(input, 'name') && !hasOwn(input, 'full_name')),
    }
  );
  assign(
    'last_name',
    trimString(pickFirst(input.last_name, input.lastName, input.surname, name.lastName), 120),
    {
      hasValue:
        hasOwn(input, 'last_name')
        || hasOwn(input, 'lastName')
        || hasOwn(input, 'surname')
        || (!!name.lastName && !hasOwn(input, 'name') && !hasOwn(input, 'full_name')),
    }
  );
  assign(
    'full_name',
    trimString(pickFirst(fullNameSource, [name.firstName, name.lastName].filter(Boolean).join(' ')), 240),
    { hasValue: hasOwn(input, 'name') || hasOwn(input, 'full_name') || !!fullNameSource }
  );
  assign('phone', trimString(input.phone, 80), { hasValue: hasOwn(input, 'phone') });
  assign(
    'location',
    trimString(pickFirst(input.location, input.current_location), 240),
    { hasValue: hasOwn(input, 'location') || hasOwn(input, 'current_location') }
  );
  assign(
    'address1',
    trimString(pickFirst(input.address1, input.address_1, input.address_line_1, input.addressLine1), 240),
    { hasValue: hasOwn(input, 'address1') || hasOwn(input, 'address_1') || hasOwn(input, 'address_line_1') || hasOwn(input, 'addressLine1') }
  );
  assign(
    'address2',
    trimString(pickFirst(input.address2, input.address_2, input.address_line_2, input.addressLine2), 240),
    { hasValue: hasOwn(input, 'address2') || hasOwn(input, 'address_2') || hasOwn(input, 'address_line_2') || hasOwn(input, 'addressLine2') }
  );
  assign(
    'town',
    trimString(pickFirst(input.town, input.city), 160),
    { hasValue: hasOwn(input, 'town') || hasOwn(input, 'city') }
  );
  assign(
    'county',
    trimString(pickFirst(input.county, input.region), 160),
    { hasValue: hasOwn(input, 'county') || hasOwn(input, 'region') }
  );
  assign(
    'postcode',
    trimString(pickFirst(input.postcode, input.postal_code), 32),
    { hasValue: hasOwn(input, 'postcode') || hasOwn(input, 'postal_code') }
  );
  assign('country', trimString(input.country, 120), { hasValue: hasOwn(input, 'country') });
  assign('nationality', trimString(input.nationality, 120), { hasValue: hasOwn(input, 'nationality') });
  assign(
    'right_to_work_status',
    trimString(pickFirst(input.right_to_work_status, input.work_authorisation_status), 240),
    { hasValue: hasOwn(input, 'right_to_work_status') || hasOwn(input, 'work_authorisation_status') }
  );
  const rightToWorkRegions = normaliseTextList(
    pickFirst(input.right_to_work_regions, input.right_to_work),
    120
  );
  if (
    rightToWorkRegions.length
    || includeNulls
    || hasOwn(input, 'right_to_work_regions')
    || hasOwn(input, 'right_to_work')
  ) {
    payload.right_to_work_regions = rightToWorkRegions;
  }
  assign(
    'primary_specialism',
    trimString(pickFirst(input.primary_specialism, input.discipline), 240),
    { hasValue: hasOwn(input, 'primary_specialism') || hasOwn(input, 'discipline') }
  );
  assign(
    'secondary_specialism',
    trimString(input.secondary_specialism, 240),
    { hasValue: hasOwn(input, 'secondary_specialism') }
  );
  assign(
    'current_job_title',
    trimString(input.current_job_title, 240),
    { hasValue: hasOwn(input, 'current_job_title') }
  );
  assign(
    'desired_roles',
    trimString(pickFirst(input.desired_roles, input.roles_looking_for), 320),
    { hasValue: hasOwn(input, 'desired_roles') || hasOwn(input, 'roles_looking_for') }
  );
  assign(
    'qualifications',
    trimString(input.qualifications, 4000),
    { hasValue: hasOwn(input, 'qualifications') }
  );
  assign(
    'sector_experience',
    trimString(input.sector_experience, 1000),
    { hasValue: hasOwn(input, 'sector_experience') }
  );
  assign(
    'relocation_preference',
    trimString(pickFirst(input.relocation_preference, input.relocation), 120),
    { hasValue: hasOwn(input, 'relocation_preference') || hasOwn(input, 'relocation') }
  );
  assign(
    'salary_expectation',
    trimString(input.salary_expectation, 160),
    { hasValue: hasOwn(input, 'salary_expectation') }
  );
  assign(
    'experience_years',
    parsePositiveInteger(pickFirst(input.experience_years, input.years_experience)),
    { hasValue: hasOwn(input, 'experience_years') || hasOwn(input, 'years_experience') }
  );
  assign(
    'sector_focus',
    trimString(pickFirst(input.sector_focus, input.sector_experience, input.discipline), 240),
    { hasValue: hasOwn(input, 'sector_focus') || hasOwn(input, 'sector_experience') || hasOwn(input, 'discipline') }
  );

  const skills = normaliseSkillList(
    pickFirst(input.skills, input.skill_tags, input.tags)
  );
  if (skills.length || includeNulls || hasOwn(input, 'skills') || hasOwn(input, 'skill_tags') || hasOwn(input, 'tags')) {
    payload.skills = skills;
  }

  assign(
    'availability',
    trimString(pickFirst(input.availability, input.notice_period), 160),
    { hasValue: hasOwn(input, 'availability') || hasOwn(input, 'notice_period') }
  );
  assign(
    'linkedin_url',
    trimString(pickFirst(input.linkedin_url, input.linkedin), 500),
    { hasValue: hasOwn(input, 'linkedin_url') || hasOwn(input, 'linkedin') }
  );
  assign(
    'summary',
    trimString(pickFirst(input.summary, input.message), 4000),
    { hasValue: hasOwn(input, 'summary') || hasOwn(input, 'message') }
  );
  assign(
    'headline_role',
    trimString(
      pickFirst(
        input.headline_role,
        input.desired_roles,
        input.roles_looking_for,
        input.role,
        input.current_job_title,
        input.job_title,
        input.title
      ),
      240
    ),
    {
      hasValue:
        hasOwn(input, 'headline_role')
        || hasOwn(input, 'desired_roles')
        || hasOwn(input, 'roles_looking_for')
        || hasOwn(input, 'role')
        || hasOwn(input, 'current_job_title')
        || hasOwn(input, 'job_title')
        || hasOwn(input, 'title'),
    }
  );
  assign('updated_at', now, { hasValue: true });
  if (options.touchPortalLogin) {
    assign('last_portal_login_at', now, { hasValue: true });
  }

  if (options.isNew) {
    assign('created_at', now, { hasValue: true });
    assign('status', trimString(input.status, 80) || 'active', { hasValue: true });
  } else if (hasOwn(input, 'status') || includeNulls) {
    assign('status', trimString(input.status, 80), { hasValue: true });
  }

  return payload;
}

function buildJobApplicationPayload(input = {}, candidateId, options = {}) {
  const now = options.now || new Date().toISOString();
  const jobId = trimString(pickFirst(input.job_id, input.jobId), 120);
  if (!candidateId || !jobId) return null;

  return {
    candidate_id: String(candidateId),
    job_id: jobId,
    applied_at: now,
    status: normaliseApplicationStatus(input.status),
    notes: trimString(pickFirst(input.notes, input.message), 4000),
    job_title: trimString(pickFirst(input.job_title, input.title, input.role), 240),
    job_location: trimString(pickFirst(input.job_location, input.locationText), 240),
    job_type: trimString(pickFirst(input.job_type, input.employmentType), 120),
    job_pay: trimString(pickFirst(input.job_pay, input.payText), 160),
    source: trimString(pickFirst(input.job_source, input.source), 120) || 'candidate_portal',
    source_submission_id: trimString(
      pickFirst(input.source_submission_id, input.submission_id, input.submissionId),
      160
    ),
    share_code: trimString(pickFirst(input.job_share_code, input.shareCode), 120),
  };
}

function buildCandidateActivityPayload(candidateId, activityType, description, options = {}) {
  if (!candidateId || !activityType) return null;

  return {
    candidate_id: String(candidateId),
    activity_type: trimString(activityType, 120),
    description: trimString(description, 1000),
    actor_role: trimString(options.actorRole, 40) || 'system',
    actor_identifier: trimString(options.actorIdentifier, 160),
    meta: options.meta && typeof options.meta === 'object' && !Array.isArray(options.meta)
      ? options.meta
      : {},
    created_at: options.now || new Date().toISOString(),
  };
}

function isMissingRelationError(error) {
  const message = String(error?.message || '');
  return /relation .+ does not exist/i.test(message);
}

function isMissingColumnError(error) {
  const message = String(error?.message || '');
  return (
    /column "?[a-zA-Z0-9_]+"? does not exist/i.test(message)
    || /Could not find the '[a-zA-Z0-9_]+' column of '[^']+' in the schema cache/i.test(message)
  );
}

function extractMissingColumnName(error) {
  const message = String(error?.message || '');
  const postgresMatch = /column "?([a-zA-Z0-9_]+)"? does not exist/i.exec(message);
  if (postgresMatch) return postgresMatch[1];
  const schemaCacheMatch = /Could not find the '([a-zA-Z0-9_]+)' column of '[^']+' in the schema cache/i.exec(message);
  return schemaCacheMatch ? schemaCacheMatch[1] : null;
}

async function dropUnknownColumnAndRetry(run, payload) {
  let working = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await run(working);
    if (!error) {
      return { data, payload: working };
    }

    const missingColumn = extractMissingColumnName(error);
    if (!missingColumn) {
      throw error;
    }
    if (!(missingColumn in working)) {
      throw error;
    }

    delete working[missingColumn];
  }

  throw new Error('candidate_portal_column_retry_exhausted');
}

async function getCandidateByAuthUserId(supabase, authUserId) {
  if (!authUserId) return null;

  try {
    const { data, error } = await supabase
      .from('candidates')
      .select('*')
      .eq('auth_user_id', authUserId)
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isMissingColumnError(error) || isMissingRelationError(error)) {
        return null;
      }
      throw error;
    }

    return data || null;
  } catch (error) {
    if (isMissingColumnError(error) || isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }
}

async function getCandidateByEmail(supabase, email, authUserId) {
  if (!email) return null;

  const { data, error } = await supabase
    .from('candidates')
    .select('*')
    .ilike('email', email)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const linkedUserId = trimString(data.auth_user_id, 120);
  if (linkedUserId && authUserId && linkedUserId !== authUserId) {
    const conflict = new Error('candidate_email_already_linked');
    conflict.code = 'candidate_email_already_linked';
    throw conflict;
  }

  return data;
}

async function upsertCandidateProfile(supabase, input = {}, options = {}) {
  const authUserId = trimString(options.authUserId || options.authUser?.id, 120);
  const email = lowerEmail(pickFirst(input.email, options.authUser?.email));

  let existing = await getCandidateByAuthUserId(supabase, authUserId);
  if (!existing) {
    existing = await getCandidateByEmail(supabase, email, authUserId);
  }

  const payload = buildCandidateWritePayload(input, {
    authUser: options.authUser,
    authUserId,
    now: options.now,
    includeNulls: !!options.includeNulls,
    isNew: !existing,
    touchPortalLogin: !!authUserId,
  });

  if (!existing && !payload.email) {
    const error = new Error('candidate_email_required');
    error.code = 'candidate_email_required';
    throw error;
  }

  if (existing) {
    const merged = { ...payload };
    const { data } = await dropUnknownColumnAndRetry(
      (working) => supabase
        .from('candidates')
        .update(working)
        .eq('id', existing.id)
        .select('*')
        .maybeSingle(),
      merged
    );
    return { candidate: data || existing, created: false };
  }

  const { data } = await dropUnknownColumnAndRetry(
    (working) => supabase
      .from('candidates')
      .insert(working)
      .select('*')
      .single(),
    payload
  );

  return { candidate: data, created: true };
}

async function syncCandidateSkills(supabase, candidateId, skills) {
  if (!candidateId) return { ok: false, skipped: true };

  try {
    const deleteResult = await supabase
      .from('candidate_skills')
      .delete()
      .eq('candidate_id', String(candidateId));

    if (deleteResult.error && !isMissingRelationError(deleteResult.error)) {
      throw deleteResult.error;
    }

    const cleanSkills = normaliseSkillList(skills);
    if (!cleanSkills.length) {
      return { ok: true, count: 0 };
    }

    const { error } = await supabase
      .from('candidate_skills')
      .insert(cleanSkills.map((skill) => ({
        candidate_id: String(candidateId),
        skill,
      })));

    if (error && !isMissingRelationError(error)) {
      throw error;
    }

    return { ok: true, count: cleanSkills.length };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return { ok: false, skipped: true };
    }
    throw error;
  }
}

async function recordCandidateActivity(supabase, candidateId, activityType, description, options = {}) {
  const payload = buildCandidateActivityPayload(candidateId, activityType, description, options);
  if (!payload) return null;

  try {
    const { data, error } = await dropUnknownColumnAndRetry(
      (working) => supabase
        .from('candidate_activity')
        .insert(working)
        .select('*')
        .maybeSingle(),
      payload
    );

    if (!error) {
      return data || null;
    }

    if (!isMissingRelationError(error) && !isMissingColumnError(error)) {
      throw error;
    }

    const minimalInsert = await supabase
      .from('candidate_activity')
      .insert({
        candidate_id: payload.candidate_id,
        activity_type: payload.activity_type,
        description: payload.description || null,
        created_at: payload.created_at || new Date().toISOString(),
      })
      .select('*')
      .maybeSingle();

    if (minimalInsert.error && !isMissingRelationError(minimalInsert.error)) {
      throw minimalInsert.error;
    }

    return minimalInsert.data || null;
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

async function insertJobApplication(supabase, applicationPayload) {
  if (!applicationPayload) return null;

  try {
    const { data: existing, error: existingError } = await supabase
      .from('job_applications')
      .select('*')
      .eq('candidate_id', applicationPayload.candidate_id)
      .eq('job_id', applicationPayload.job_id)
      .limit(1)
      .maybeSingle();

    if (existingError && !isMissingRelationError(existingError)) {
      throw existingError;
    }

    if (existing) {
      const patch = {};
      ['job_title', 'job_location', 'job_type', 'job_pay', 'source', 'source_submission_id', 'share_code'].forEach((key) => {
        const nextValue = applicationPayload[key];
        const currentValue = existing[key];
        if (nextValue && !currentValue) {
          patch[key] = nextValue;
        }
      });
      if (!existing.notes && applicationPayload.notes) {
        patch.notes = applicationPayload.notes;
      }

      if (Object.keys(patch).length) {
        patch.updated_at = new Date().toISOString();
        const { data: updated, error: updateError } = await dropUnknownColumnAndRetry(
          (working) => supabase
            .from('job_applications')
            .update(working)
            .eq('id', existing.id)
            .select('*')
            .maybeSingle(),
          patch
        );
        return { application: updated || existing, created: false };
      }

      return { application: existing, created: false };
    }

    const { data } = await dropUnknownColumnAndRetry(
      (working) => supabase
        .from('job_applications')
        .insert(working)
        .select('*')
        .maybeSingle(),
      applicationPayload
    );
    return { application: data || null, created: true };
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

async function resolveSupabaseAuthUser(supabase, token) {
  const accessToken = trimString(token, 8000);
  if (!accessToken) return null;

  try {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data?.user) return null;
    return data.user;
  } catch (error) {
    return null;
  }
}

module.exports = {
  buildCandidateActivityPayload,
  buildCandidateWritePayload,
  buildJobApplicationPayload,
  dropUnknownColumnAndRetry,
  getCandidateByAuthUserId,
  getCandidateByEmail,
  insertJobApplication,
  isMissingColumnError,
  isMissingRelationError,
  lowerEmail,
  normaliseApplicationStatus,
  normaliseDocumentType,
  normaliseSkillList,
  recordCandidateActivity,
  resolveSupabaseAuthUser,
  extractMissingColumnName,
  splitName,
  syncCandidateSkills,
  trimString,
  upsertCandidateProfile,
};
