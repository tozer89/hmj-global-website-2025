'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  buildCandidateRedirects,
  ensureCandidateFromAuthUser,
  generateCandidatePasswordResetLink,
  loadCandidateRecord,
  resendCandidateVerificationEmail,
  resolvePortalAuthUser,
  sendCandidatePasswordResetEmail,
  setCandidatePasswordByAdmin,
  summarisePortalAuthUser,
  syncPortalAuthUserFromCandidate,
  writeAdminAuditLog,
} = require('./_candidate-account-admin.js');

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch (error) {
    return {};
  }
}

exports.handler = withAdminCors(async (event, context) => {
  try {
    if ((event.httpMethod || '').toUpperCase() !== 'POST') {
      throw coded(405, 'Method Not Allowed');
    }

    const { user, supabase, supabaseError } = await getContext(event, context, { requireAdmin: true });
    if (!supabase || typeof supabase.from !== 'function') {
      throw coded(503, supabaseError?.message || 'Supabase not configured for this deploy');
    }

    const body = parseBody(event);
    const action = String(body.action || 'inspect').trim().toLowerCase();
    const candidateId = body.candidateId || body.id || null;
    const email = body.email || null;
    const redirects = buildCandidateRedirects(event);

    let candidate = await loadCandidateRecord(supabase, candidateId, email);
    let authUser = await resolvePortalAuthUser(supabase, candidate, email);

    if (action === 'repair_profile') {
      if (!authUser) throw coded(404, 'No Supabase candidate account exists for this email yet.');
      const repaired = await ensureCandidateFromAuthUser(supabase, authUser, candidate);
      candidate = repaired.candidate || candidate;
      await writeAdminAuditLog(supabase, {
        actor_email: user.email,
        actor_id: user.id || user.sub || null,
        action: repaired.created ? 'candidate.portal_profile.create' : 'candidate.portal_profile.repair',
        target_id: candidate?.id ? String(candidate.id) : null,
        meta: {
          auth_user_id: authUser.id,
          candidate_email: authUser.email,
          created: !!repaired.created,
        },
      });
    } else if (!candidate && authUser) {
      const repaired = await ensureCandidateFromAuthUser(supabase, authUser, null);
      candidate = repaired.candidate || candidate;
    }

    if (action === 'set_temporary_password') {
      if (!authUser) throw coded(404, 'No Supabase candidate account exists for this email yet.');
      authUser = await setCandidatePasswordByAdmin(supabase, authUser, body.password || '');
      await writeAdminAuditLog(supabase, {
        actor_email: user.email,
        actor_id: user.id || user.sub || null,
        action: 'candidate.portal_password.set',
        target_id: candidate?.id ? String(candidate.id) : null,
        meta: {
          auth_user_id: authUser.id,
          candidate_email: authUser.email,
        },
      });
    }

    if (action === 'send_password_reset') {
      const targetEmail = authUser?.email || candidate?.email || email;
      if (!targetEmail) throw coded(404, 'No candidate email is available for password recovery.');
      await sendCandidatePasswordResetEmail(supabase, targetEmail, redirects.recoveryRedirectUrl);
      await writeAdminAuditLog(supabase, {
        actor_email: user.email,
        actor_id: user.id || user.sub || null,
        action: 'candidate.portal_reset_email.send',
        target_id: candidate?.id ? String(candidate.id) : null,
        meta: {
          candidate_email: targetEmail,
          redirect_to: redirects.recoveryRedirectUrl,
        },
      });
    }

    if (action === 'copy_password_reset_link') {
      const targetEmail = authUser?.email || candidate?.email || email;
      if (!targetEmail) throw coded(404, 'No candidate email is available for a password reset link.');
      const link = await generateCandidatePasswordResetLink(supabase, targetEmail, redirects.recoveryRedirectUrl);
      await writeAdminAuditLog(supabase, {
        actor_email: user.email,
        actor_id: user.id || user.sub || null,
        action: 'candidate.portal_reset_link.generate',
        target_id: candidate?.id ? String(candidate.id) : null,
        meta: {
          candidate_email: targetEmail,
          redirect_to: redirects.recoveryRedirectUrl,
        },
      });
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          candidate,
          auth: summarisePortalAuthUser(authUser),
          reset_link: link.action_link,
          reset_link_meta: link,
          message: 'Secure password reset link generated.',
        }),
      };
    }

    if (action === 'resend_verification') {
      const targetEmail = authUser?.email || candidate?.email || email;
      if (!targetEmail) throw coded(404, 'No candidate email is available for verification.');
      if (authUser?.email_confirmed_at) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            ok: true,
            candidate,
            auth: summarisePortalAuthUser(authUser),
            message: 'This candidate email is already verified.',
          }),
        };
      }
      await resendCandidateVerificationEmail(supabase, targetEmail, redirects.emailRedirectUrl);
      await writeAdminAuditLog(supabase, {
        actor_email: user.email,
        actor_id: user.id || user.sub || null,
        action: 'candidate.portal_verification_email.resend',
        target_id: candidate?.id ? String(candidate.id) : null,
        meta: {
          candidate_email: targetEmail,
          redirect_to: redirects.emailRedirectUrl,
        },
      });
    }

    authUser = await resolvePortalAuthUser(supabase, candidate, email);
    if (candidate && authUser) {
      authUser = await syncPortalAuthUserFromCandidate(supabase, candidate, authUser, { syncEmail: false });
    }

    const messageMap = {
      inspect: 'Candidate portal account status loaded.',
      repair_profile: candidate?.auth_user_id
        ? 'Candidate profile repaired and linked to the portal account.'
        : 'Candidate profile checked.',
      set_temporary_password: 'Temporary password saved for the portal account.',
      send_password_reset: 'Password reset email sent to the candidate inbox.',
      resend_verification: 'Verification email sent to the candidate inbox.',
    };

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        candidate,
        auth: summarisePortalAuthUser(authUser),
        redirects,
        message: messageMap[action] || 'Candidate portal action complete.',
      }),
    };
  } catch (error) {
    const statusCode = Number(error?.code) || 500;
    return {
      statusCode,
      body: JSON.stringify({
        ok: false,
        error: error?.message || 'Candidate portal admin action failed.',
      }),
    };
  }
});
