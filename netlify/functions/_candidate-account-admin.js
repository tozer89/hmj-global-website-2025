'use strict';

const {
  buildCandidateWritePayload,
  dropUnknownColumnAndRetry,
  getCandidateByAuthUserId,
  getCandidateByEmail,
  splitName,
  trimString,
} = require('./_candidate-portal.js');
const {
  _resolveCandidatePortalBaseUrl: resolveCandidatePortalBaseUrl,
  _buildRedirectUrl: buildRedirectUrl,
} = require('./candidate-auth-config.js');

function lowerEmail(value) {
  const email = trimString(value, 320);
  return email ? email.toLowerCase() : null;
}

function safeUserMetadata(user) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return {};
  if (!user.user_metadata || typeof user.user_metadata !== 'object' || Array.isArray(user.user_metadata)) return {};
  return user.user_metadata;
}

function buildCandidateRedirects(event = {}) {
  const siteUrl = resolveCandidatePortalBaseUrl(event);
  return {
    siteUrl,
    emailRedirectUrl: buildRedirectUrl(siteUrl, '/candidates.html?candidate_auth=verified'),
    recoveryRedirectUrl: buildRedirectUrl(siteUrl, '/candidates.html?candidate_action=recovery'),
  };
}

async function findAuthUserByEmail(supabase, email, options = {}) {
  const target = lowerEmail(email);
  if (!target) return null;

  const perPage = Math.max(1, Math.min(Number(options.perPage) || 100, 1000));
  const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 25, 50));

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = Array.isArray(data?.users) ? data.users : [];
    const match = users.find((user) => lowerEmail(user?.email) === target);
    if (match) return match;
    const total = Number(data?.total || 0);
    if (!users.length || (total && page * perPage >= total)) break;
  }

  return null;
}

async function resolvePortalAuthUser(supabase, candidate = null, email = null) {
  const authUserId = trimString(candidate?.auth_user_id, 120);
  if (authUserId) {
    const byId = await supabase.auth.admin.getUserById(authUserId);
    if (byId?.error) throw byId.error;
    if (byId?.data?.user) return byId.data.user;
  }

  const targetEmail = lowerEmail(email || candidate?.email);
  if (!targetEmail) return null;
  return findAuthUserByEmail(supabase, targetEmail);
}

function summarisePortalAuthUser(user) {
  if (!user) {
    return {
      exists: false,
      email: null,
      email_confirmed_at: null,
      last_sign_in_at: null,
      created_at: null,
      updated_at: null,
      user_id: null,
      full_name: null,
    };
  }

  const meta = safeUserMetadata(user);
  return {
    exists: true,
    user_id: trimString(user.id, 120),
    email: lowerEmail(user.email),
    email_confirmed_at: user.email_confirmed_at || null,
    last_sign_in_at: user.last_sign_in_at || null,
    created_at: user.created_at || null,
    updated_at: user.updated_at || null,
    full_name: trimString(meta.full_name, 240) || null,
    first_name: trimString(meta.first_name, 120) || null,
    last_name: trimString(meta.last_name, 120) || null,
  };
}

function rewriteAuthActionLink(actionLink, redirectTo) {
  const link = trimString(actionLink, 4000);
  const redirect = trimString(redirectTo, 1000);
  if (!link || !redirect) return link || null;

  try {
    const url = new URL(link);
    url.searchParams.set('redirect_to', redirect);
    return url.toString();
  } catch (error) {
    return link;
  }
}

function managedCandidatePassword(value) {
  const password = String(value == null ? '' : value);
  const hasLength = password.length >= 8;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /\d/.test(password);
  if (!hasLength || !hasLetter || !hasNumber) {
    const error = new Error('Use at least 8 characters, including at least one letter and one number.');
    error.code = 'candidate_password_invalid';
    throw error;
  }
  return password;
}

function buildPortalAuthUserUpdate(candidate = {}, authUser = null, options = {}) {
  const currentMeta = safeUserMetadata(authUser);
  const explicitName = trimString(candidate?.full_name, 240);
  const derivedName = [
    trimString(candidate?.first_name, 120),
    trimString(candidate?.last_name, 120),
  ].filter(Boolean).join(' ');
  const name = splitName(explicitName || derivedName);
  const firstName = trimString(candidate?.first_name, 120) || trimString(name.firstName, 120) || trimString(currentMeta.first_name, 120) || null;
  const lastName = trimString(candidate?.last_name, 120) || trimString(name.lastName, 120) || trimString(currentMeta.last_name, 120) || null;
  const fullName = trimString(explicitName || derivedName || currentMeta.full_name, 240)
    || [firstName, lastName].filter(Boolean).join(' ')
    || null;
  const userMetadata = {
    ...currentMeta,
  };

  if (fullName) userMetadata.full_name = fullName;
  if (firstName) userMetadata.first_name = firstName;
  if (lastName) userMetadata.last_name = lastName;

  const payload = {
    user_metadata: userMetadata,
  };
  const nextEmail = lowerEmail(candidate?.email);
  if (options.syncEmail && nextEmail && nextEmail !== lowerEmail(authUser?.email)) {
    payload.email = nextEmail;
  }
  return payload;
}

async function loadCandidateRecord(supabase, candidateId = null, email = null) {
  const id = trimString(candidateId, 120);
  if (id) {
    const { data, error } = await supabase
      .from('candidates')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  const cleanEmail = lowerEmail(email);
  if (!cleanEmail) return null;
  return getCandidateByEmail(supabase, cleanEmail, null);
}

async function ensureCandidateFromAuthUser(supabase, authUser, candidate = null, options = {}) {
  if (!authUser?.id || !authUser?.email) {
    const error = new Error('candidate_auth_user_required');
    error.code = 'candidate_auth_user_required';
    throw error;
  }

  const metadata = safeUserMetadata(authUser);
  const now = options.now || new Date().toISOString();
  const existing = candidate
    || await getCandidateByAuthUserId(supabase, authUser.id)
    || await getCandidateByEmail(supabase, authUser.email, authUser.id);

  const payload = buildCandidateWritePayload({
    email: authUser.email,
    full_name: metadata.full_name,
    first_name: metadata.first_name,
    last_name: metadata.last_name,
    status: existing?.status || 'active',
  }, {
    authUser,
    authUserId: authUser.id,
    now,
    includeNulls: false,
    isNew: !existing,
  });

  if (authUser.last_sign_in_at) {
    payload.last_portal_login_at = authUser.last_sign_in_at;
  }

  if (existing) {
    const patch = {};
    Object.keys(payload).forEach((key) => {
      const nextValue = payload[key];
      const currentValue = existing[key];
      if (nextValue == null) return;
      if (key === 'auth_user_id' || key === 'last_portal_login_at') {
        patch[key] = nextValue;
        return;
      }
      if (!currentValue) {
        patch[key] = nextValue;
      }
    });

    if (!Object.keys(patch).length) {
      return { candidate: existing, created: false, repaired: false };
    }

    const { data } = await dropUnknownColumnAndRetry(
      (working) => supabase
        .from('candidates')
        .update(working)
        .eq('id', existing.id)
        .select('*')
        .maybeSingle(),
      patch
    );
    return { candidate: data || existing, created: false, repaired: true };
  }

  const { data } = await dropUnknownColumnAndRetry(
    (working) => supabase
      .from('candidates')
      .insert(working)
      .select('*')
      .single(),
    payload
  );

  return { candidate: data, created: true, repaired: true };
}

async function syncPortalAuthUserFromCandidate(supabase, candidate, authUser = null, options = {}) {
  const targetUser = authUser || await resolvePortalAuthUser(supabase, candidate, options.email);
  if (!targetUser?.id) return null;

  const payload = buildPortalAuthUserUpdate(candidate, targetUser, options);
  const nextEmail = lowerEmail(payload.email);
  const currentEmail = lowerEmail(targetUser.email);
  const hasEmailChange = !!nextEmail && nextEmail !== currentEmail;
  const currentMeta = JSON.stringify(safeUserMetadata(targetUser));
  const nextMeta = JSON.stringify(payload.user_metadata || {});
  const hasMetadataChange = currentMeta !== nextMeta;

  if (!hasEmailChange && !hasMetadataChange) {
    return targetUser;
  }

  const { data, error } = await supabase.auth.admin.updateUserById(targetUser.id, payload);
  if (error) throw error;
  return data?.user || targetUser;
}

async function sendCandidatePasswordResetEmail(supabase, email, redirectTo) {
  const cleanEmail = lowerEmail(email);
  if (!cleanEmail) {
    const error = new Error('candidate_email_required');
    error.code = 'candidate_email_required';
    throw error;
  }

  const { data, error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo,
  });
  if (error) throw error;
  return data || {};
}

async function setCandidatePasswordByAdmin(supabase, authUser, password) {
  if (!authUser?.id) {
    const error = new Error('candidate_auth_user_required');
    error.code = 'candidate_auth_user_required';
    throw error;
  }

  const nextPassword = managedCandidatePassword(password);
  const { data, error } = await supabase.auth.admin.updateUserById(authUser.id, {
    password: nextPassword,
  });
  if (error) throw error;
  return data?.user || authUser;
}

async function resendCandidateVerificationEmail(supabase, email, redirectTo) {
  const cleanEmail = lowerEmail(email);
  if (!cleanEmail) {
    const error = new Error('candidate_email_required');
    error.code = 'candidate_email_required';
    throw error;
  }

  const { data, error } = await supabase.auth.resend({
    type: 'signup',
    email: cleanEmail,
    options: {
      emailRedirectTo: redirectTo,
    },
  });
  if (error) throw error;
  return data || {};
}

async function generateCandidatePasswordResetLink(supabase, email, redirectTo) {
  const cleanEmail = lowerEmail(email);
  if (!cleanEmail) {
    const error = new Error('candidate_email_required');
    error.code = 'candidate_email_required';
    throw error;
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email: cleanEmail,
  });
  if (error) throw error;

  const actionLink = rewriteAuthActionLink(data?.properties?.action_link, redirectTo);
  return {
    action_link: actionLink,
    redirect_to: redirectTo,
    email_otp: data?.properties?.email_otp || null,
    hashed_token: data?.properties?.hashed_token || null,
  };
}

async function writeAdminAuditLog(supabase, payload = {}) {
  try {
    const { error } = await supabase.from('admin_audit_logs').insert({
      actor_email: payload.actor_email || null,
      actor_id: payload.actor_id || null,
      action: payload.action || 'candidate.portal.manage',
      target_type: payload.target_type || 'candidate',
      target_id: payload.target_id || null,
      meta: payload.meta && typeof payload.meta === 'object' ? payload.meta : {},
    });
    if (error) throw error;
  } catch (error) {
    // Audit failure should not block admin remediation.
  }
}

async function syncPortalAuthUsersToCandidates(supabase, options = {}) {
  const perPage = Math.max(1, Math.min(Number(options.perPage) || 100, 1000));
  const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 10, 50));
  const synced = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = Array.isArray(data?.users) ? data.users : [];
    if (!users.length) break;

    for (const user of users) {
      if (!user?.email) continue;
      const result = await ensureCandidateFromAuthUser(supabase, user, null, options);
      if (result?.candidate?.id) {
        synced.push({
          id: String(result.candidate.id),
          email: lowerEmail(user.email),
          created: !!result.created,
          repaired: !!result.repaired,
        });
      }
    }

    const total = Number(data?.total || 0);
    if (total && page * perPage >= total) break;
  }

  return synced;
}

module.exports = {
  buildCandidateRedirects,
  buildPortalAuthUserUpdate,
  ensureCandidateFromAuthUser,
  findAuthUserByEmail,
  generateCandidatePasswordResetLink,
  loadCandidateRecord,
  lowerEmail,
  managedCandidatePassword,
  resendCandidateVerificationEmail,
  resolvePortalAuthUser,
  rewriteAuthActionLink,
  sendCandidatePasswordResetEmail,
  setCandidatePasswordByAdmin,
  summarisePortalAuthUser,
  syncPortalAuthUserFromCandidate,
  syncPortalAuthUsersToCandidates,
  writeAdminAuditLog,
};
