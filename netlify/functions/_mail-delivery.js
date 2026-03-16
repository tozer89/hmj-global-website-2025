'use strict';

const nodemailer = require('nodemailer');

const RESEND_API_URL = 'https://api.resend.com/emails';

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function lowerEmail(value) {
  const email = trimString(value, 320);
  return email ? email.toLowerCase() : '';
}

function plainTextFromHtml(value) {
  return String(value == null ? '' : value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function senderAddress(fromEmail, fromName) {
  const email = lowerEmail(fromEmail);
  const name = trimString(fromName, 160);
  if (!email) return '';
  return name ? `"${name.replace(/"/g, '\\"')}" <${email}>` : email;
}

async function sendViaResend(message) {
  const apiKey = trimString(process.env.RESEND_API_KEY, 4000);
  if (!apiKey) return null;
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: senderAddress(message.fromEmail, message.fromName),
      to: [message.toEmail],
      reply_to: message.replyTo || undefined,
      subject: message.subject,
      html: message.html,
      text: message.text || plainTextFromHtml(message.html),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Resend email failed (${response.status})`);
    error.code = 'resend_email_failed';
    error.status = response.status;
    throw error;
  }
  return {
    provider: 'resend',
    id: data?.id || null,
  };
}

function smtpConfig(settings = {}) {
  const host = trimString(settings.smtpHost, 320);
  const user = trimString(settings.smtpUser, 320);
  const pass = trimString(settings.smtpPassword, 4000);
  if (!host || !user || !pass) return null;
  const encryption = trimString(settings.smtpEncryption, 32).toLowerCase();
  return {
    host,
    port: Number(settings.smtpPort) || 587,
    secure: encryption === 'ssl',
    requireTLS: encryption === 'starttls',
    auth: { user, pass },
  };
}

async function sendViaSmtp(message) {
  const transportConfig = smtpConfig(message.smtpSettings);
  if (!transportConfig) return null;
  const transporter = nodemailer.createTransport(transportConfig);
  const info = await transporter.sendMail({
    from: senderAddress(message.fromEmail, message.fromName),
    to: message.toEmail,
    replyTo: message.replyTo || undefined,
    subject: message.subject,
    html: message.html,
    text: message.text || plainTextFromHtml(message.html),
  });
  return {
    provider: 'smtp',
    id: info?.messageId || null,
  };
}

async function sendTransactionalEmail(message = {}) {
  const toEmail = lowerEmail(message.toEmail);
  const fromEmail = lowerEmail(message.fromEmail);
  const subject = trimString(message.subject, 200);
  if (!toEmail || !fromEmail || !subject || !trimString(message.html, 20000)) {
    const error = new Error('Email message is incomplete.');
    error.code = 'email_message_invalid';
    throw error;
  }

  const resendResult = await sendViaResend({ ...message, toEmail, fromEmail, subject });
  if (resendResult) return resendResult;

  const smtpResult = await sendViaSmtp({ ...message, toEmail, fromEmail, subject });
  if (smtpResult) return smtpResult;

  const error = new Error('No email provider is configured. Add RESEND_API_KEY or save SMTP settings in Admin Settings.');
  error.code = 'email_provider_not_configured';
  throw error;
}

module.exports = {
  lowerEmail,
  plainTextFromHtml,
  sendTransactionalEmail,
  trimString,
};
