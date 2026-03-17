'use strict';

const { fetchSettings } = require('./_settings-helpers.js');
const {
  sendTransactionalEmail,
  probeResendProvider,
  probeSmtpProvider,
} = require('./_mail-delivery.js');
const { trimString, lowerEmail } = require('./_team-tasks-helpers.js');

const CANDIDATE_EMAIL_SETTINGS_KEY = 'candidate_email_settings';

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const raw = trimString(value, 32).toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function normalisePort(value, fallback = 587) {
  const parsed = Number.parseInt(String(value == null ? '' : value).trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function currentSiteUrl() {
  return trimString(
    process.env.URL
      || process.env.DEPLOY_PRIME_URL
      || process.env.SITE_URL
      || '',
    500
  ).replace(/\/$/, '');
}

function normaliseCandidateEmailSettings(input = {}) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    customSmtpEnabled: toBoolean(value.customSmtpEnabled, false),
    smtpHost: trimString(value.smtpHost, 320),
    smtpPort: normalisePort(value.smtpPort, 587),
    smtpEncryption: trimString(value.smtpEncryption, 32).toLowerCase() || 'starttls',
    smtpUser: trimString(value.smtpUser, 320),
    smtpPassword: trimString(value.smtpPassword, 4000),
    senderEmail: lowerEmail(value.senderEmail),
    senderName: trimString(value.senderName, 160) || 'HMJ Global',
    supportEmail: lowerEmail(value.supportEmail),
  };
}

function buildSmtpSettings(settings = {}) {
  if (!settings.customSmtpEnabled) return null;
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPassword) return null;
  return {
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpEncryption: settings.smtpEncryption,
    smtpUser: settings.smtpUser,
    smtpPassword: settings.smtpPassword,
  };
}

function fallbackSenderEmail(candidateSettings = {}) {
  return lowerEmail(
    candidateSettings.senderEmail
    || process.env.TASK_REMINDER_FROM_EMAIL
    || process.env.SMTP_FROM_EMAIL
    || ''
  );
}

async function resolveTeamTaskEmailConfig(event) {
  const settingsResult = await fetchSettings(event, [CANDIDATE_EMAIL_SETTINGS_KEY]);
  const candidateSettings = normaliseCandidateEmailSettings(settingsResult?.settings?.[CANDIDATE_EMAIL_SETTINGS_KEY]);
  const smtpSettings = buildSmtpSettings(candidateSettings);
  const [resendProbe, smtpProbe] = await Promise.all([
    probeResendProvider(),
    smtpSettings
      ? probeSmtpProvider(smtpSettings)
      : Promise.resolve({
        provider: 'smtp',
        configured: false,
        ready: false,
        status: candidateSettings.customSmtpEnabled ? 'missing' : 'disabled',
        message: candidateSettings.customSmtpEnabled
          ? 'SMTP host, username, or password is missing.'
          : 'Custom SMTP is not enabled in Candidate email settings.',
      }),
  ]);

  const senderEmail = fallbackSenderEmail(candidateSettings);
  const senderName = trimString(candidateSettings.senderName, 160) || 'HMJ Global';
  const supportEmail = lowerEmail(candidateSettings.supportEmail || senderEmail);
  const replyTo = lowerEmail(
    trimString(process.env.TASK_REMINDER_REPLY_TO, 320)
    || supportEmail
    || senderEmail
  );
  const ready = !!senderEmail && (smtpProbe.ready === true || resendProbe.ready === true);
  const preferredProvider = smtpProbe.ready === true
    ? 'smtp'
    : (resendProbe.ready === true ? 'resend' : 'none');
  const message = !senderEmail
    ? 'Team Tasks email sender is missing. Save the HMJ sender details in Candidate Email settings.'
    : ready
      ? `Team Tasks emails will send from ${senderEmail} via ${preferredProvider.toUpperCase()}.`
      : (smtpProbe.message || resendProbe.message || 'Team Tasks email delivery is not configured.');

  return {
    ready,
    senderEmail,
    senderName,
    supportEmail,
    replyTo,
    smtpSettings,
    preferredProvider,
    resend: resendProbe,
    smtp: smtpProbe,
    siteUrl: currentSiteUrl(),
    message,
  };
}

async function sendTeamTaskEmail({ event, emailConfig, toEmail, subject, html, text }) {
  const config = emailConfig || await resolveTeamTaskEmailConfig(event);
  if (!config.ready) {
    const error = new Error(config.message || 'Team Tasks email delivery is not configured.');
    error.code = 'team_task_email_not_ready';
    throw error;
  }
  const delivery = await sendTransactionalEmail({
    toEmail,
    fromEmail: config.senderEmail,
    fromName: config.senderName,
    replyTo: config.replyTo || undefined,
    subject,
    html,
    text,
    smtpSettings: config.smtpSettings,
  });
  return {
    delivery,
    emailConfig: config,
  };
}

module.exports = {
  resolveTeamTaskEmailConfig,
  sendTeamTaskEmail,
};
