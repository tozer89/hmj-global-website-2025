'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const { readCandidateEmailSettings } = require('./_candidate-email-settings.js');
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
  const timesheetsUrl = buildRedirectUrl(siteUrl, '/timesheets.html');
  const supportEmail = trimString(settings.supportEmail || settings.senderEmail || 'info@hmj-global.com', 320) || 'info@hmj-global.com';
  const senderName = trimString(settings.senderName, 160) || 'HMJ Global';
  const firstName = trimString(request.firstName, 120) || 'there';
  const clientName = trimString(request.company, 180) || 'your new client';
  const jobTitle = trimString(request.jobTitle, 180);
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
  const fallbackRegistrationLabel = usesSecureAccess ? 'Secure HMJ access' : 'Registration';
  const subject = jobTitle
    ? 'Welcome to HMJ Global – next steps for your new assignment'
    : 'Welcome to HMJ Global – complete your registration';
  const roleLine = jobTitle ? ` as ${escapeHtml(jobTitle)}` : '';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef2fb;font-family:Arial,sans-serif;color:#14244f;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Welcome to HMJ Global. Complete your registration and onboarding steps for ${escapeHtml(clientName)}.</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef2fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;border:1px solid #d7e0f5;border-radius:24px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px;background:linear-gradient(135deg,#274390,#3d66c8);color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;font-weight:700;opacity:.88;">HMJ Global</div>
                <h1 style="margin:14px 0 0;font-size:30px;line-height:1.18;font-weight:800;color:#ffffff;">Welcome to HMJ Global</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 18px;">
                <p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:#334a7e;">Hi ${escapeHtml(firstName)},</p>
                <p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:#334a7e;">Congratulations on starting your new role${roleLine} with <strong>${escapeHtml(clientName)}</strong>.</p>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#42557f;">${escapeHtml(primaryActionIntro)}</p>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#42557f;">We will also use this information to help get you set up on the Timesheet Portal system. The Timesheet Portal link can also be found in the top menu on the HMJ website.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0 10px;">
                  <tr>
                    <td style="padding:0 0 12px;">
                      <a href="${escapeHtml(registrationUrl)}" style="display:inline-block;padding:14px 22px;border-radius:14px;background:#3154b3;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">${escapeHtml(primaryActionLabel)}</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0;">
                      <a href="${escapeHtml(timesheetsUrl)}" style="display:inline-block;padding:14px 22px;border-radius:14px;background:#ffffff;color:#3154b3;font-size:16px;font-weight:700;text-decoration:none;border:1px solid rgba(49,84,179,.22);">Open timesheets / portal access</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:16px 0 12px;font-size:14px;line-height:1.7;color:#5f74a8;">If the buttons do not work, copy these links into your browser:</p>
                <p style="margin:0 0 8px;font-size:13px;line-height:1.7;color:#5f74a8;word-break:break-word;">${escapeHtml(fallbackRegistrationLabel)}: ${escapeHtml(registrationUrl)}</p>
                <p style="margin:0;font-size:13px;line-height:1.7;color:#5f74a8;word-break:break-word;">Timesheets / portal access: ${escapeHtml(timesheetsUrl)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 28px;border-top:1px solid #e6ecfb;background:#f7f9ff;">
                <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#5f74a8;font-weight:700;">${escapeHtml(senderName)}</p>
                <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#5f74a8;">${escapeHtml(settings.footerTagline || 'Specialist recruitment for technical projects, commissioning, and delivery teams.')}</p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#5f74a8;">Need help? Email <a href="mailto:${escapeHtml(supportEmail)}" style="color:#3154b3;text-decoration:none;">${escapeHtml(supportEmail)}</a>.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

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

  await recordAudit({
    actor: user,
    action: 'send_intro_email',
    targetType: 'starter_intro_email',
    targetId: request.email,
    meta: {
      first_name: request.firstName,
      last_name: request.lastName,
      company: request.company,
      job_title: request.jobTitle || null,
      phone: request.phone || null,
      delivery_provider: delivery?.provider || null,
      candidate_id: links?.candidate?.id ? String(links.candidate.id) : null,
      access_link_type: message.accessLinkType || null,
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
    message: 'Intro email accepted for delivery.',
  });
};

module.exports = {
  buildIntroEmailMessage,
  normaliseIntroEmailRequest,
  resolveIntroEmailLinks,
  validateIntroEmailRequest,
  handler: withAdminCors(baseHandler, { requireToken: false }),
};
