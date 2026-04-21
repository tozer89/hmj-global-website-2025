'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const { escapeHtml } = require('./_html.js');
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
const {
  ACCOUNTS_SUPPORT_EMAIL,
  DEFAULT_CONFIRMATION_LANGUAGE,
  GENERAL_SUPPORT_EMAIL,
  buildConfirmationContext,
  buildConfirmationDefaults,
  buildPlacementContext,
  normaliseConfirmationLanguage,
  renderConfirmationBodyHtml,
  renderMergeTokens,
} = require('../../assets/js/onboarding-email-copy.js');

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

const INTRO_EMAIL_TYPE = 'intro';
const CONFIRMATION_EMAIL_TYPE = 'confirmation';
const DEFAULT_CONFIRMATION_SUBJECT = buildConfirmationDefaults(DEFAULT_CONFIRMATION_LANGUAGE).subject;
const DEFAULT_CONFIRMATION_HEADING = buildConfirmationDefaults(DEFAULT_CONFIRMATION_LANGUAGE).heading;
const DEFAULT_CONFIRMATION_BODY = buildConfirmationDefaults(DEFAULT_CONFIRMATION_LANGUAGE).body;

function normaliseEmailType(value) {
  return trimString(value, 40).toLowerCase() === CONFIRMATION_EMAIL_TYPE
    ? CONFIRMATION_EMAIL_TYPE
    : INTRO_EMAIL_TYPE;
}

function normaliseIntroEmailRequest(input = {}) {
  const candidateId = input.candidate_id || input.candidateId || null;
  const isReminder = !!(input.is_reminder || input.isReminder);
  const emailType = normaliseEmailType(input.email_type != null ? input.email_type : input.emailType);
  const language = normaliseConfirmationLanguage(input.language);
  return {
    firstName: trimString(input.first_name != null ? input.first_name : input.firstName, 120),
    lastName: trimString(input.last_name != null ? input.last_name : input.lastName, 120),
    email: lowerEmail(input.email),
    company: trimString(input.company != null ? input.company : input.client_company, 180),
    projectLocation: trimString(input.project_location != null ? input.project_location : input.projectLocation, 180),
    phone: trimString(input.phone, 80),
    jobTitle: trimString(input.job_title != null ? input.job_title : input.jobTitle, 180),
    subject: trimString(input.subject, 160),
    heading: trimString(input.heading, 160),
    body: trimString(input.body, 12000),
    language,
    emailType,
    ...(isReminder ? { isReminder: true } : {}),
    ...(candidateId ? { candidateId } : {}),
  };
}

function validateIntroEmailRequest(input = {}) {
  if (!trimString(input.firstName, 120)) throw coded(400, 'First name is required.');
  if (!trimString(input.lastName, 120)) throw coded(400, 'Last name is required.');
  if (!lowerEmail(input.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw coded(400, 'Enter a valid email address.');
  if (!trimString(input.company, 180)) throw coded(400, 'Company / client is required.');
  if (normaliseEmailType(input.emailType) === CONFIRMATION_EMAIL_TYPE) {
    const defaults = buildConfirmationDefaults(input.language);
    if (!trimString(input.subject || defaults.subject, 160)) throw coded(400, 'Confirmation email subject is required.');
    if (!trimString(input.heading || defaults.heading, 160)) throw coded(400, 'Confirmation email heading is required.');
    if (!trimString(input.body || defaults.body, 12000)) throw coded(400, 'Confirmation email body is required.');
  }
}

function buildStarterRegistrationUrl(siteUrl) {
  return buildRedirectUrl(
    siteUrl,
    '/candidates?path=starter&candidate_tab=documents&candidate_focus=right_to_work&candidate_onboarding=1&candidate_docs=right_to_work,passport,qualification_certificate,reference,bank_document'
  );
}

function buildIntroEmailMessage(settings = {}, request = {}, links = {}) {
  const siteUrl = trimString(settings.siteUrl, 1000) || 'https://www.hmj-global.com/';
  const registrationUrl = trimString(links.registrationUrl, 4000) || buildStarterRegistrationUrl(siteUrl);
  const timesheetsUrl = trimString(links.timesheetsUrl, 4000) || resolveCandidateTimesheetsDashboardUrl();
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
    : 'Start HMJ new starter registration';
  const primaryActionIntro = usesSecureAccess
    ? (accessLinkType === 'invite'
      ? 'Use the secure HMJ button below to finish opening your candidate account and go straight into your onboarding area.'
      : 'Use the secure HMJ button below to open your candidate account and go straight into your onboarding area.')
    : 'Use the HMJ button below to open the new starter registration page already pointed at the correct onboarding route.';
  const fallbackRegistrationLabel = usesSecureAccess ? 'Open secure HMJ access' : 'Open HMJ new starter registration';
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
      <p style="margin:0 0 14px;color:#42557f;font-size:15px;line-height:1.7">The registration link opens the HMJ candidate page with the new starter route selected for you, so you land in the correct onboarding form rather than the general sign-in area.</p>
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

function buildOnboardingConfirmationMessage(settings = {}, request = {}, links = {}) {
  const defaults = buildConfirmationDefaults(request.language);
  const context = buildConfirmationContext({
    first_name: request.firstName,
    last_name: request.lastName,
    company: request.company,
    project_location: request.projectLocation,
    support_email: GENERAL_SUPPORT_EMAIL,
    info_email: GENERAL_SUPPORT_EMAIL,
    accounts_email: ACCOUNTS_SUPPORT_EMAIL,
    language: request.language,
  });
  const subject = trimString(
    renderMergeTokens(request.subject || defaults.subject, context),
    160,
  ) || defaults.heading;
  const heading = trimString(
    renderMergeTokens(request.heading || defaults.heading, context),
    160,
  ) || defaults.heading;
  const bodyHtml = renderConfirmationBodyHtml(request.body || defaults.body, context);
  const timesheetsUrl = trimString(links.timesheetsUrl, 4000) || resolveCandidateTimesheetsDashboardUrl();
  const html = buildEmailTemplate({
    ...settings,
    senderName: settings.senderName || 'HMJ Global',
    supportEmail: GENERAL_SUPPORT_EMAIL,
  }, {
    heading,
    intro: renderMergeTokens(defaults.intro, context),
    contextNote: renderMergeTokens(defaults.contextNote, context),
    actionLabel: defaults.actionLabel,
    actionUrl: timesheetsUrl,
    actions: [
      { label: defaults.actionLabel, url: timesheetsUrl, tone: 'primary' },
    ],
    fallbackLinks: [
      { label: defaults.actionLabel, url: timesheetsUrl },
    ],
    bodyHtml,
    preheader: trimString(renderMergeTokens(defaults.intro, context), 220) || heading,
  });

  return {
    subject,
    html,
    heading,
    timesheetsUrl,
    context,
    language: defaults.language,
    accessLinkType: null,
  };
}

async function resolveIntroEmailLinks(event, supabase, request = {}) {
  let candidate = await loadCandidateRecord(supabase, request.candidateId, request.email);
  const onboardingUrl = buildCandidatePortalDeepLink(event, {
    tab: 'documents',
    focus: 'right_to_work',
    onboarding: true,
    documents: ['right_to_work', 'passport', 'qualification_certificate', 'reference', 'bank_document'],
  });
  let accessLink = null;

  try {
    accessLink = await generateCandidateAccessLink(
      supabase,
      candidate || {
        email: request.email,
        first_name: request.firstName,
        last_name: request.lastName,
        full_name: [request.firstName, request.lastName].filter(Boolean).join(' '),
      },
      onboardingUrl,
      { email: request.email },
    );
    candidate = await loadCandidateRecord(supabase, request.candidateId || candidate?.id || null, request.email);
  } catch (error) {
    console.warn('[send-intro-email] could not generate secure access link (%s)', error?.message || error);
  }

  return {
    candidate: candidate || null,
    registrationUrl: trimString(accessLink?.action_link, 4000) || onboardingUrl,
    accessLinkType: trimString(accessLink?.link_type, 40).toLowerCase() || null,
    secureAccess: !!trimString(accessLink?.action_link, 4000),
    onboardingUrl,
    timesheetsUrl: resolveCandidateTimesheetsDashboardUrl(),
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

  const links = request.emailType === CONFIRMATION_EMAIL_TYPE
    ? {
        candidate: await loadCandidateRecord(supabase, request.candidateId, request.email),
        timesheetsUrl: resolveCandidateTimesheetsDashboardUrl(),
      }
    : await resolveIntroEmailLinks(event, supabase, request);
  const message = request.emailType === CONFIRMATION_EMAIL_TYPE
    ? buildOnboardingConfirmationMessage(settings, request, links)
    : buildIntroEmailMessage(settings, request, links);
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

  let provisionalError = null;

  if (supabase && request.emailType === INTRO_EMAIL_TYPE) {
    try {
      if (!candidateId) {
        // No existing profile — create a provisional new-starter record.
        // Uses a resilient retry loop: if a column doesn't exist in the schema
        // (e.g. onboarding_mode), it is dropped and the insert is retried.
        const fullName = [request.firstName, request.lastName].filter(Boolean).join(' ');
        const baseInsert = {
          first_name: request.firstName || null,
          last_name: request.lastName || null,
          full_name: fullName || null,
          email: request.email,
          phone: request.phone || null,
          client_name: request.company || null,
          job_title: request.jobTitle || null,
          onboarding_mode: true,
          onboarding_status: 'new',
          onboarding_status_updated_at: new Date().toISOString(),
          onboarding_status_updated_by: user?.email || null,
          status: 'Invited',
          created_at: new Date().toISOString(),
        };

        let insertPayload = { ...baseInsert };
        let insertAttempt = 0;
        let newRecord = null;
        let insertErr = null;

        while (insertAttempt < 10) {
          insertAttempt++;
          const res = await supabase.from('candidates').insert(insertPayload).select('id').single();
          newRecord = res.data;
          insertErr = res.error;
          if (!insertErr) break;

          // Drop unknown columns and retry (mirrors admin-candidates-save.js strategy)
          const colMatch = /column "?([a-zA-Z0-9_]+)"? does not exist/i.exec(insertErr.message || '')
            || /Could not find the '([a-zA-Z0-9_]+)' column of '[^']+' in the schema cache/i.exec(insertErr.message || '');
          if (colMatch) {
            const col = colMatch[1];
            if (col && col in insertPayload) {
              console.warn('[send-intro-email] dropping unknown column %s and retrying insert', col);
              delete insertPayload[col];
              continue;
            }
          }
          break; // Non-column error — stop retrying
        }

        if (!insertErr && newRecord?.id) {
          candidateId = String(newRecord.id);
          provisionalCreated = true;
        } else if (insertErr) {
          provisionalError = insertErr.message || 'Unknown insert error';
          console.warn('[send-intro-email] provisional candidate create failed after retries', provisionalError);
        }
      } else if (links?.candidate) {
        // Profile exists — ensure it's flagged as a new starter
        const updatePayload = {
          status: 'Invited',
          onboarding_status: 'new',
          onboarding_status_updated_at: new Date().toISOString(),
          onboarding_status_updated_by: user?.email || null,
        };
        // Try to set onboarding_mode too; silently skip if column missing
        const updateRes = await supabase
          .from('candidates')
          .update({ ...updatePayload, onboarding_mode: true })
          .eq('id', candidateId);
        if (updateRes.error && /column|schema cache/i.test(updateRes.error.message || '')) {
          await supabase.from('candidates').update(updatePayload).eq('id', candidateId);
        }
      }

      // Log the intro/reminder email to candidate_activity so it appears in the CRM trail
      if (candidateId) {
        const activityType = request.isReminder ? 'intro_reminder_sent' : 'intro_email_sent';
        const description = request.isReminder
          ? `Reminder email sent by ${user?.email || 'admin'}${request.jobTitle ? ` for ${request.jobTitle}` : ''}${request.company ? ` at ${request.company}` : ''}.`
          : `Intro/welcome email sent by ${user?.email || 'admin'}${request.jobTitle ? ` for ${request.jobTitle}` : ''}${request.company ? ` at ${request.company}` : ''}.${provisionalCreated ? ' Profile provisionally created.' : ''}`;
        const actRes = await supabase.from('candidate_activity').insert({
          candidate_id: candidateId,
          activity_type: activityType,
          description,
          actor_role: 'admin',
          actor_identifier: user?.email || null,
          meta: {
            company: request.company || null,
            job_title: request.jobTitle || null,
            access_link_type: message.accessLinkType || null,
            provisional_created: provisionalCreated,
          },
          created_at: new Date().toISOString(),
        });
        if (actRes.error) {
          console.warn('[send-intro-email] candidate_activity insert failed', actRes.error.message);
        }
      }
    } catch (profileErr) {
      // Non-fatal — email was already sent; just log and continue
      provisionalError = profileErr?.message || String(profileErr);
      console.warn('[send-intro-email] post-send profile/activity step failed', provisionalError);
    }
  }

  if (supabase && request.emailType === CONFIRMATION_EMAIL_TYPE && candidateId) {
    try {
      const actRes = await supabase.from('candidate_activity').insert({
        candidate_id: candidateId,
        activity_type: 'onboarding_confirmation_sent',
        description: `Onboarding confirmation email sent by ${user?.email || 'admin'}${request.company ? ` for ${request.company}` : ''}${request.projectLocation ? ` on ${request.projectLocation}` : ''}.`,
        actor_role: 'admin',
        actor_identifier: user?.email || null,
        meta: {
          company: request.company || null,
          project_location: request.projectLocation || null,
          job_title: request.jobTitle || null,
          email_type: request.emailType,
          language: request.language || DEFAULT_CONFIRMATION_LANGUAGE,
        },
        created_at: new Date().toISOString(),
      });
      if (actRes.error) {
        console.warn('[send-intro-email] onboarding confirmation activity insert failed', actRes.error.message);
      }
    } catch (activityError) {
      console.warn('[send-intro-email] onboarding confirmation activity step failed', activityError?.message || activityError);
    }
  }

  await recordAudit({
    actor: user,
    action: request.emailType === CONFIRMATION_EMAIL_TYPE
      ? 'send_onboarding_confirmation_email'
      : request.isReminder
        ? 'send_intro_reminder'
        : 'send_intro_email',
    targetType: request.emailType === CONFIRMATION_EMAIL_TYPE ? 'starter_onboarding_email' : 'starter_intro_email',
    targetId: request.email,
    meta: {
      first_name: request.firstName,
      last_name: request.lastName,
      company: request.company,
      project_location: request.projectLocation || null,
      job_title: request.jobTitle || null,
      phone: request.phone || null,
      delivery_provider: delivery?.provider || null,
      candidate_id: candidateId,
      email_type: request.emailType,
      language: request.language || DEFAULT_CONFIRMATION_LANGUAGE,
      access_link_type: message.accessLinkType || null,
      provisional_created: provisionalCreated,
      is_reminder: request.isReminder,
    },
  });

  return response(200, {
    ok: true,
    recipient: request.email,
    subject: message.subject,
    language: request.language || DEFAULT_CONFIRMATION_LANGUAGE,
    registrationUrl: message.registrationUrl,
    timesheetsUrl: message.timesheetsUrl,
    accessLinkType: message.accessLinkType,
    delivery,
    candidateId,
    provisionalCreated,
    provisionalError: provisionalError || null,
    message: request.emailType === CONFIRMATION_EMAIL_TYPE
      ? 'Onboarding confirmation email accepted for delivery.'
      : provisionalCreated
        ? 'Intro email sent and provisional new-starter profile created.'
        : provisionalError
          ? `Intro email sent, but provisional profile creation failed: ${provisionalError}`
          : 'Intro email accepted for delivery.',
  });
};

module.exports = {
  CONFIRMATION_EMAIL_TYPE,
  DEFAULT_CONFIRMATION_LANGUAGE,
  DEFAULT_CONFIRMATION_BODY,
  DEFAULT_CONFIRMATION_HEADING,
  DEFAULT_CONFIRMATION_SUBJECT,
  INTRO_EMAIL_TYPE,
  buildOnboardingConfirmationMessage,
  buildPlacementContext,
  buildIntroEmailMessage,
  normaliseIntroEmailRequest,
  renderOnboardingMergeTokens: renderMergeTokens,
  resolveIntroEmailLinks,
  validateIntroEmailRequest,
  handler: withAdminCors(baseHandler, { requireToken: false }),
};
