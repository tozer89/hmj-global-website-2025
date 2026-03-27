'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const {
  buildEmailTemplate,
  readCandidateEmailSettings,
  resolveCandidateTimesheetsDashboardUrl,
} = require('./_candidate-email-settings.js');
const { sendTransactionalEmail, lowerEmail, trimString } = require('./_mail-delivery.js');
const { recordAudit } = require('./_audit.js');
const { _buildRedirectUrl: buildRedirectUrl } = require('./candidate-auth-config.js');
const { buildCandidatePortalDeepLink } = require('./_candidate-onboarding.js');
const { loadCandidateRecord, generateCandidateAccessLink } = require('./_candidate-account-admin.js');

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch (error) {
    return {};
  }
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normaliseIntroEmailRequest(input = {}) {
  return {
    firstName: trimString(input.first_name != null ? input.first_name : input.firstName, 120),
    lastName: trimString(input.last_name != null ? input.last_name : input.lastName, 120),
    email: lowerEmail(input.email),
    company: trimString(input.company != null ? input.company : input.client_company, 180),
    phone: trimString(input.phone, 80),
    jobTitle: trimString(input.job_title != null ? input.job_title : input.jobTitle, 180),
    isReminder: !!(input.is_reminder || input.isReminder),
    candidateId: input.candidate_id || input.candidateId || null,
  };
}

function validateIntroEmailRequest(input = {}) {
  if (!trimString(input.firstName, 120)) throw coded(400, 'First name is required.');
  if (!trimString(input.lastName, 120)) throw coded(400, 'Last name is required.');
  if (!lowerEmail(input.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw coded(400, 'Enter a valid email address.');
  if (!trimString(input.company, 180)) throw coded(400, 'Company / client is required.');
}

function buildIntroEmailMessage(settings = {}, request = {}, links = {}) {
  const siteUrl = trimString(settings.siteUrl, 1000) || 'https://hmjg.netlify.app/';
  const registrationUrl = trimString(links.registrationUrl, 4000) || buildRedirectUrl(siteUrl, '/candidates.html');
  const timesheetsUrl = resolveCandidateTimesheetsDashboardUrl();
  const supportEmail = trimString(settings.supportEmail || settings.senderEmail || 'info@hmj-global.com', 320) || 'info@hmj-global.com';
  const senderName = trimString(settings.senderName, 160) || 'HMJ Global';
  const firstName = trimString(request.firstName, 120) || 'there';
  const clientName = trimString(request.company, 180) || 'your new client';
  const jobTitle = trimString(request.jobTitle, 180);
  const isReminder = !!request.isReminder;
  const accessLinkType = trimString(links?.accessLinkType, 40).toLowerCase();
  const usesSecureAccess = !!accessLinkType || links?.secureAccess === true;
  const primaryActionLabel = usesSecureAccess
    ? (accessLinkType === 'invite' ? 'Open secure HMJ account and onboarding' : 'Open secure HMJ onboarding')
    : 'Complete HMJ registration';
  const primaryActionIntro = usesSecureAccess
    ? (accessLinkType === 'invite'
      ? 'Use the secure HMJ button below to finish opening your candidate account and go straight into your onboarding area.'
      : 'Use the secure HMJ button below to open your candidate account and go straight into your onboarding area.')
    : 'Please complete your HMJ website registration so we can progress your onboarding, right to work checks, supporting documents, and payment setup where applicable.';
  const fallbackRegistrationLabel = usesSecureAccess ? 'Open secure HMJ access' : 'Open HMJ registration';
  const subject = isReminder
    ? (jobTitle ? `Reminder – HMJ onboarding steps for your ${jobTitle} assignment` : 'Reminder – please complete your HMJ registration')
    : (jobTitle
      ? 'Welcome to HMJ Global – next steps for your new assignment'
      : 'Welcome to HMJ Global – complete your registration');

  const html = buildEmailTemplate({
    ...settings,
    senderName,
    supportEmail,
  }, {
    heading: isReminder ? 'Reminder — HMJ Registration' : 'Welcome to HMJ Global',
    intro: isReminder
      ? `This is a reminder that your HMJ registration and onboarding steps are still pending${jobTitle ? ` for your ${jobTitle} assignment` : ''} with ${clientName}.`
      : `Congratulations on starting your new role${jobTitle ? ` as ${jobTitle}` : ''} with ${clientName}.`,
    actionLabel: primaryActionLabel,
    actionUrl: registrationUrl,
    actions: [
      { label: primaryActionLabel, url: registrationUrl, tone: 'primary' },
      { label: 'Open HMJ timesheets / portal access', url: timesheetsUrl, tone: 'secondary' },
    ],
    fallbackLinks: [
      { label: fallbackRegistrationLabel, url: registrationUrl },
      { label: 'Open HMJ timesheets / portal access', url: timesheetsUrl },
    ],
    bodyHtml: `
      <p style="margin:0 0 14px;color:#42557f;font-size:15px;line-height:1.7">Hi ${escapeHtml(firstName)},</p>
      <p style="margin:0 0 14px;color:#42557f;font-size:15px;line-height:1.7">${escapeHtml(primaryActionIntro)}</p>
      <p style="margin:0 0 14px;color:#42557f;font-size:15px;line-height:1.7">HMJ needs your profile, right-to-work, onboarding, and payment details where relevant so we can move your setup forward properly.</p>
      <p style="margin:0 0 14px;color:#42557f;font-size:15px;line-height:1.7">We will also use this information to help get you set up on the HMJ Timesheet Portal dashboard so you can submit hours once your setup is underway.</p>
      <p style="margin:0;color:#42557f;font-size:15px;line-height:1.7">Use the HMJ buttons below rather than saving direct system links. They will take you to the correct HMJ access path.</p>
    `,
    preheader: `Welcome to HMJ Global. Complete your registration and onboarding steps for ${clientName}.`,
  });

  return {
    subject,
    html,
    registrationUrl,
    timesheetsUrl,
    accessLinkType: accessLinkType || null,
  };
}

async function resolveIntroEmailLinks(event, supabase, request = {}) {
  const candidate = await loadCandidateRecord(supabase, null, request.email);
  const onboardingUrl = buildCandidatePortalDeepLink(event, {
    tab: 'documents',
    focus: 'right_to_work',
    onboarding: true,
    documents: ['right_to_work', 'passport', 'qualification_certificate', 'reference', 'bank_document'],
  });

  if (!candidate?.id) {
    return {
      candidate: null,
      registrationUrl: null,
      accessLinkType: null,
      secureAccess: false,
      onboardingUrl,
    };
  }

  const accessLink = await generateCandidateAccessLink(supabase, candidate, onboardingUrl, {
    email: request.email,
  });
  return {
    candidate,
    registrationUrl: trimString(accessLink?.action_link, 4000) || onboardingUrl,
    accessLinkType: trimString(accessLink?.link_type, 40).toLowerCase() || null,
    secureAccess: true,
    onboardingUrl,
  };
}

const baseHandler = async (event, context) => {
  if ((event.httpMethod || '').toUpperCase() !== 'POST') {
    throw coded(405, 'Method Not Allowed');
  }

  const { supabase, user } = await getContext(event, context, { requireAdmin: true });
  const body = parseBody(event);
  const request = normaliseIntroEmailRequest(body);
  validateIntroEmailRequest(request);

  const settingsResult = await readCandidateEmailSettings(event);
  const settings = settingsResult?.settings || {};
  const diagnostics = settingsResult?.diagnostics || {};

  if (diagnostics.publicDeliveryReady !== true) {
    const reason = Array.isArray(diagnostics.warnings) && diagnostics.warnings.length
      ? diagnostics.warnings[0]
      : 'Candidate email delivery is not configured yet. Update Candidate account email settings first.';
    const error = new Error(reason);
    error.code = 409;
    error.details = { diagnostics };
    throw error;
  }

  const links = await resolveIntroEmailLinks(event, supabase, request);
  const message = buildIntroEmailMessage(settings, request, links);
  const delivery = await sendTransactionalEmail({
    toEmail: request.email,
    fromEmail: settings.senderEmail || settings.supportEmail || 'info@hmj-global.com',
    fromName: settings.senderName || 'HMJ Global',
    replyTo: settings.supportEmail || settings.senderEmail || '',
    subject: message.subject,
    html: message.html,
    smtpSettings: settings,
  });

  // ── Provisional new-starter profile ─────────────────────────────────────
  // If no candidate profile exists yet, create a provisional one so the
  // admin can track completion, send reminders, and maintain a CRM trail.
  // If one already exists, ensure onboarding_mode is set correctly.
  let candidateId = links?.candidate?.id ? String(links.candidate.id) : null;
  let provisionalCreated = false;

  if (supabase) {
    try {
      if (!candidateId) {
        // No existing profile — create provisional new starter record
        const fullName = [request.firstName, request.lastName].filter(Boolean).join(' ');
        const { data: newRecord, error: insertErr } = await supabase
          .from('candidates')
          .insert({
            first_name: request.firstName || null,
            last_name: request.lastName || null,
            full_name: fullName || null,
            email: request.email,
            phone: request.phone || null,
            client_name: request.company || null,
            job_title: request.jobTitle || null,
            onboarding_mode: true,
            status: 'Invited',
            created_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (!insertErr && newRecord?.id) {
          candidateId = String(newRecord.id);
          provisionalCreated = true;
        } else if (insertErr) {
          console.warn('[send-intro-email] provisional candidate create failed', insertErr?.message);
        }
      } else if (links?.candidate && links.candidate.onboarding_mode !== true) {
        // Profile exists but isn't marked as a new starter — correct it
        await supabase
          .from('candidates')
          .update({ onboarding_mode: true })
          .eq('id', candidateId);
      }

      // Log the intro/reminder email to candidate_activity so it appears in the CRM trail
      if (candidateId) {
        const activityType = request.isReminder ? 'intro_reminder_sent' : 'intro_email_sent';
        const description = request.isReminder
          ? `Reminder email sent by ${user?.email || 'admin'}${request.jobTitle ? ` for ${request.jobTitle}` : ''}${request.company ? ` at ${request.company}` : ''}.`
          : `Intro/welcome email sent by ${user?.email || 'admin'}${request.jobTitle ? ` for ${request.jobTitle}` : ''}${request.company ? ` at ${request.company}` : ''}. Profile provisionally created.`;
        await supabase.from('candidate_activity').insert({
          candidate_id: candidateId,
          activity_type: activityType,
          description,
          actor_role: 'admin',
          created_at: new Date().toISOString(),
        });
      }
    } catch (profileErr) {
      // Non-fatal — email was already sent; just log and continue
      console.warn('[send-intro-email] post-send profile/activity step failed', profileErr?.message || profileErr);
    }
  }

  await recordAudit({
    actor: user,
    action: request.isReminder ? 'send_intro_reminder' : 'send_intro_email',
    targetType: 'starter_intro_email',
    targetId: request.email,
    meta: {
      first_name: request.firstName,
      last_name: request.lastName,
      company: request.company,
      job_title: request.jobTitle || null,
      phone: request.phone || null,
      delivery_provider: delivery?.provider || null,
      candidate_id: candidateId,
      access_link_type: message.accessLinkType || null,
      provisional_created: provisionalCreated,
      is_reminder: request.isReminder,
    },
  });

  return response(200, {
    ok: true,
    recipient: request.email,
    subject: message.subject,
    registrationUrl: message.registrationUrl,
    timesheetsUrl: message.timesheetsUrl,
    accessLinkType: message.accessLinkType,
    delivery,
    candidateId,
    provisionalCreated,
    message: provisionalCreated
      ? 'Intro email sent and provisional new-starter profile created.'
      : 'Intro email accepted for delivery.',
  });
};

module.exports = {
  buildIntroEmailMessage,
  normaliseIntroEmailRequest,
  resolveIntroEmailLinks,
  validateIntroEmailRequest,
  handler: withAdminCors(baseHandler, { requireToken: false }),
};
