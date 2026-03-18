'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext, coded } = require('./_auth.js');
const { buildEmailTemplate, readCandidateEmailSettings } = require('./_candidate-email-settings.js');
const { sendTransactionalEmail, lowerEmail, trimString } = require('./_mail-delivery.js');
const { recordAudit } = require('./_audit.js');
const { _buildRedirectUrl: buildRedirectUrl, _resolveCandidatePortalBaseUrl: resolveCandidatePortalBaseUrl } = require('./candidate-auth-config.js');
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

function normaliseBoolean(value) {
  if (value === true || value === false) return value;
  const text = trimString(value, 16).toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function normaliseBulkEmailRequest(input = {}) {
  const recipientInput = input?.recipient && typeof input.recipient === 'object' && !Array.isArray(input.recipient)
    ? input.recipient
    : input;
  const templateInput = input?.template && typeof input.template === 'object' && !Array.isArray(input.template)
    ? input.template
    : input;

  return {
    candidateId: trimString(input.candidate_id != null ? input.candidate_id : input.candidateId, 120),
    recipient: {
      firstName: trimString(recipientInput.first_name != null ? recipientInput.first_name : recipientInput.firstName, 120),
      lastName: trimString(recipientInput.last_name != null ? recipientInput.last_name : recipientInput.lastName, 120),
      fullName: trimString(recipientInput.full_name != null ? recipientInput.full_name : recipientInput.fullName, 240),
      email: lowerEmail(recipientInput.email),
      reference: trimString(recipientInput.reference, 120),
      role: trimString(recipientInput.role, 180),
      clientName: trimString(recipientInput.client_name != null ? recipientInput.client_name : recipientInput.clientName, 180),
      jobTitle: trimString(recipientInput.job_title != null ? recipientInput.job_title : recipientInput.jobTitle, 180),
    },
    template: {
      subject: trimString(templateInput.subject, 160),
      heading: trimString(templateInput.heading, 160),
      body: trimString(templateInput.body, 8000),
      fallbackClientName: trimString(templateInput.fallback_client_name != null ? templateInput.fallback_client_name : templateInput.fallbackClientName, 180),
      fallbackJobTitle: trimString(templateInput.fallback_job_title != null ? templateInput.fallback_job_title : templateInput.fallbackJobTitle, 180),
      primaryAction: trimString(templateInput.primary_action != null ? templateInput.primary_action : templateInput.primaryAction, 40).toLowerCase() || 'portal_access',
      includeTimesheetsButton: normaliseBoolean(templateInput.include_timesheets_button != null ? templateInput.include_timesheets_button : templateInput.includeTimesheetsButton),
    },
  };
}

function validateBulkEmailRequest(request = {}) {
  if (!lowerEmail(request?.recipient?.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.recipient.email)) {
    throw coded(400, 'Enter a valid recipient email address.');
  }
  if (!trimString(request?.template?.subject, 160)) throw coded(400, 'Email subject is required.');
  if (!trimString(request?.template?.heading, 160)) throw coded(400, 'Email heading is required.');
  if (!trimString(request?.template?.body, 8000)) throw coded(400, 'Email message is required.');
  if (!['portal_access', 'documents_upload', 'timesheets'].includes(trimString(request?.template?.primaryAction, 40).toLowerCase())) {
    throw coded(400, 'Choose a valid primary HMJ button destination.');
  }
}

function bulkEmailPrimaryActionMeta(action = 'portal_access') {
  if (action === 'documents_upload') {
    return {
      label: 'Open HMJ documents',
      intro: 'Use the HMJ button below to open the correct secure documents area for your account.',
    };
  }
  if (action === 'timesheets') {
    return {
      label: 'Open HMJ timesheets / portal access',
      intro: 'Use the HMJ button below to open the HMJ timesheets path for your account.',
    };
  }
  return {
    label: 'Open secure HMJ access',
    intro: 'Use the HMJ button below to open the correct secure HMJ access path for your account.',
  };
}

function bulkEmailTemplateContext(request = {}, settings = {}) {
  const recipient = request.recipient || {};
  const template = request.template || {};
  const derivedFullName = trimString(
    recipient.fullName || [recipient.firstName, recipient.lastName].filter(Boolean).join(' '),
    240,
  );
  const firstName = trimString(recipient.firstName, 120) || trimString(derivedFullName.split(/\s+/).filter(Boolean)[0], 120) || 'there';
  const lastName = trimString(recipient.lastName, 120) || trimString(derivedFullName.split(/\s+/).slice(1).join(' '), 120);
  const fullName = trimString(derivedFullName || [firstName, lastName].filter(Boolean).join(' '), 240) || firstName;
  const clientName = trimString(recipient.clientName || template.fallbackClientName, 180) || 'your HMJ client';
  const jobTitle = trimString(recipient.jobTitle || recipient.role || template.fallbackJobTitle, 180) || 'your role';
  const supportEmail = trimString(settings.supportEmail || settings.senderEmail || 'info@hmj-global.com', 320) || 'info@hmj-global.com';
  return {
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    email_address: lowerEmail(recipient.email),
    reference: trimString(recipient.reference, 120),
    client_name: clientName,
    job_title: jobTitle,
    support_email: supportEmail,
  };
}

function bulkEmailTokenValue(rawToken, context = {}) {
  const normalized = String(rawToken || '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

  const key = {
    FIRST_NAME: 'first_name',
    LAST_NAME: 'last_name',
    FULL_NAME: 'full_name',
    EMAIL: 'email_address',
    EMAIL_ADDRESS: 'email_address',
    REFERENCE: 'reference',
    CANDIDATE_REFERENCE: 'reference',
    CLIENT: 'client_name',
    CLIENT_NAME: 'client_name',
    COMPANY: 'client_name',
    JOB_TITLE: 'job_title',
    ROLE: 'job_title',
    SUPPORT_EMAIL: 'support_email',
  }[normalized];

  if (!key) return null;
  return String(context[key] || '').trim();
}

function renderMergeTokens(text, context = {}) {
  const source = String(text == null ? '' : text);
  const replacer = (match, token) => {
    const value = bulkEmailTokenValue(token, context);
    return value == null ? match : value;
  };
  return source
    .replace(/<\s*([A-Za-z0-9 _-]+?)\s*>/g, replacer)
    .replace(/\{\{\s*([A-Za-z0-9 _-]+?)\s*\}\}/g, replacer);
}

function splitParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function paragraphsToHtml(paragraphs = []) {
  return (Array.isArray(paragraphs) ? paragraphs : [])
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 14px;color:#42557f;font-size:15px;line-height:1.7">${escapeHtml(String(paragraph)).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

async function resolveBulkEmailLinks(event, supabase, request = {}, settings = {}) {
  const siteUrl = trimString(settings.siteUrl, 1000) || resolveCandidatePortalBaseUrl(event);
  const candidate = await loadCandidateRecord(supabase, request.candidateId, request?.recipient?.email);
  const portalUrl = buildRedirectUrl(siteUrl, '/candidates.html');
  const documentsUrl = buildCandidatePortalDeepLink(event, {
    tab: 'documents',
    onboarding: candidate?.onboarding_mode === true || request?.template?.primaryAction === 'documents_upload',
  });
  const timesheetsUrl = buildRedirectUrl(siteUrl, '/timesheets.html');
  const primaryAction = trimString(request?.template?.primaryAction, 40).toLowerCase();

  if (primaryAction === 'timesheets') {
    return {
      candidate,
      primaryActionUrl: timesheetsUrl,
      primaryActionType: null,
      portalUrl,
      documentsUrl,
      timesheetsUrl,
    };
  }

  const redirectTo = primaryAction === 'documents_upload' ? documentsUrl : portalUrl;
  const accessLink = await generateCandidateAccessLink(supabase, candidate || {}, redirectTo, {
    email: request?.recipient?.email,
  });

  return {
    candidate,
    primaryActionUrl: trimString(accessLink?.action_link, 4000) || redirectTo,
    primaryActionType: trimString(accessLink?.link_type, 40).toLowerCase() || null,
    portalUrl,
    documentsUrl,
    timesheetsUrl,
  };
}

function buildBulkEmailMessage(settings = {}, request = {}, links = {}) {
  const context = bulkEmailTemplateContext(request, settings);
  const subject = trimString(renderMergeTokens(request?.template?.subject, context), 160);
  const heading = trimString(renderMergeTokens(request?.template?.heading, context), 160) || 'HMJ Global update';
  const primaryAction = bulkEmailPrimaryActionMeta(request?.template?.primaryAction);
  const paragraphs = splitParagraphs(renderMergeTokens(request?.template?.body, context));
  const bodyHtml = `${paragraphsToHtml(paragraphs)}
    <p style="margin:0;color:#42557f;font-size:15px;line-height:1.7">Use the HMJ buttons below rather than saving raw system URLs. They will take you to the correct HMJ path for your account.</p>`;

  const actions = [
    { label: primaryAction.label, url: links.primaryActionUrl, tone: 'primary' },
  ];
  const fallbackLinks = [
    { label: primaryAction.label, url: links.primaryActionUrl },
  ];

  if (request?.template?.includeTimesheetsButton && request?.template?.primaryAction !== 'timesheets' && links.timesheetsUrl) {
    actions.push({ label: 'Open HMJ timesheets / portal access', url: links.timesheetsUrl, tone: 'secondary' });
    fallbackLinks.push({ label: 'Open HMJ timesheets / portal access', url: links.timesheetsUrl });
  }

  const html = buildEmailTemplate({
    ...settings,
    senderName: settings.senderName || 'HMJ Global',
    supportEmail: settings.supportEmail || settings.senderEmail || 'info@hmj-global.com',
  }, {
    heading,
    intro: primaryAction.intro,
    actionLabel: primaryAction.label,
    actionUrl: links.primaryActionUrl,
    actions,
    fallbackLinks,
    bodyHtml,
    preheader: trimString(`${heading} — ${context.client_name}`, 220) || heading,
  });

  return {
    subject,
    html,
    heading,
    primaryActionLabel: primaryAction.label,
    primaryActionUrl: links.primaryActionUrl,
    timesheetsUrl: request?.template?.includeTimesheetsButton ? links.timesheetsUrl : null,
    context,
  };
}

const baseHandler = async (event, context) => {
  if ((event.httpMethod || '').toUpperCase() !== 'POST') {
    throw coded(405, 'Method Not Allowed');
  }

  const { supabase, user } = await getContext(event, context, { requireAdmin: true });
  const request = normaliseBulkEmailRequest(parseBody(event));
  validateBulkEmailRequest(request);

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

  const links = await resolveBulkEmailLinks(event, supabase, request, settings);
  const message = buildBulkEmailMessage(settings, request, links);
  const delivery = await sendTransactionalEmail({
    toEmail: request.recipient.email,
    fromEmail: settings.senderEmail || settings.supportEmail || 'info@hmj-global.com',
    fromName: settings.senderName || 'HMJ Global',
    replyTo: settings.supportEmail || settings.senderEmail || '',
    subject: message.subject,
    html: message.html,
    smtpSettings: settings,
  });

  await recordAudit({
    actor: user,
    action: 'send_candidate_bulk_email',
    targetType: 'candidate',
    targetId: request.candidateId || request.recipient.email,
    meta: {
      recipient_email: request.recipient.email,
      candidate_id: request.candidateId || links?.candidate?.id || null,
      subject: message.subject,
      heading: message.heading,
      primary_action: request.template.primaryAction,
      include_timesheets_button: request.template.includeTimesheetsButton === true,
      access_link_type: links.primaryActionType || null,
      delivery_provider: delivery?.provider || null,
    },
  });

  return response(200, {
    ok: true,
    recipient: request.recipient.email,
    subject: message.subject,
    primaryActionUrl: message.primaryActionUrl,
    timesheetsUrl: message.timesheetsUrl,
    delivery,
    message: 'HMJ bulk email accepted for delivery.',
  });
};

module.exports = {
  buildBulkEmailMessage,
  bulkEmailTemplateContext,
  normaliseBulkEmailRequest,
  renderMergeTokens,
  resolveBulkEmailLinks,
  validateBulkEmailRequest,
  handler: withAdminCors(baseHandler, { requireToken: false }),
};
