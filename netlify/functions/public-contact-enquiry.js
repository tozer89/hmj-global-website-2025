'use strict';

// public-contact-enquiry.js
// Accepts a general website enquiry and sends a branded HTML email to HMJ.
// Public endpoint — no auth required.

const { buildCors } = require('./_http.js');
const { escapeHtml } = require('./_html.js');
const { buildRateLimitHeaders, enforceRateLimit } = require('./_rate-limit.js');
const { sendTransactionalEmail, trimString, lowerEmail } = require('./_mail-delivery.js');

const RECIPIENT_EMAIL = 'info@hmj-global.com';
const FROM_EMAIL = process.env.CONTACT_ENQUIRY_FROM_EMAIL || 'noreply@hmj-global.com';
const FROM_NAME = 'HMJ Global Website';
const SUBJECT_PREFIX = 'Website enquiry';

const ENQUIRY_TYPE_LABELS = {
  general: 'General enquiry',
  hire: 'Hire talent / staffing',
  client: 'Client services',
  candidate: 'Candidate / job seeker',
  media: 'Media / press',
  partnership: 'Partnerships',
  other: 'Other',
};

const RATE_LIMIT_WINDOW_SECONDS = Math.max(Number.parseInt(process.env.CONTACT_ENQUIRY_RATE_LIMIT_WINDOW_SECONDS || '60', 10) || 60, 1);
const RATE_LIMIT_MAX = Math.max(Number.parseInt(process.env.CONTACT_ENQUIRY_RATE_LIMIT_MAX || '3', 10) || 3, 1);

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch {
    return {};
  }
}

function normaliseInput(raw = {}) {
  return {
    firstName:   trimString(raw.first_name  ?? raw.firstName, 80),
    lastName:    trimString(raw.last_name   ?? raw.lastName, 80),
    email:       lowerEmail(raw.email),
    phone:       trimString(raw.phone, 40),
    company:     trimString(raw.company, 160),
    enquiryType: trimString(raw.enquiry_type ?? raw.enquiryType, 40).toLowerCase(),
    message:     trimString(raw.message, 4000),
  };
}

function validate(input) {
  const errors = [];
  if (!input.firstName) errors.push('First name is required.');
  if (!input.lastName)  errors.push('Last name is required.');
  if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    errors.push('A valid email address is required.');
  }
  if (!input.message || input.message.length < 5) {
    errors.push('Please include a message.');
  }
  return errors;
}

function buildEnquiryEmail(input) {
  const typeLabel = ENQUIRY_TYPE_LABELS[input.enquiryType] || 'General enquiry';
  const name = escapeHtml(`${input.firstName} ${input.lastName}`.trim());
  const email = escapeHtml(input.email);
  const phone = escapeHtml(input.phone);
  const company = escapeHtml(input.company);
  const message = escapeHtml(input.message).replace(/\n/g, '<br>');
  const receivedAt = new Date().toUTCString();

  const subject = `${SUBJECT_PREFIX}: ${typeLabel}${input.firstName ? ` from ${escapeHtml(input.firstName)}` : ''}`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Website Enquiry – HMJ Global</title>
  </head>
  <body style="margin:0;padding:0;background:#eef2fb;font-family:Arial,sans-serif;color:#14244f;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">New website enquiry from ${name} — ${typeLabel}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#eef2fb" style="background:#eef2fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#ffffff;border:1px solid #d7e0f5;border-radius:24px;overflow:hidden;">

            <!-- Header -->
            <tr>
              <td bgcolor="#173779" style="padding:28px 32px;background:#173779;background-color:#173779;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;font-weight:700;color:#dbe6ff;">HMJ Global · Website Enquiry</div>
                <h1 style="margin:14px 0 0;font-size:26px;line-height:1.2;font-weight:800;color:#ffffff;">New ${escapeHtml(typeLabel)}</h1>
              </td>
            </tr>

            <!-- Contact summary -->
            <tr>
              <td style="padding:28px 32px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e0e8f8;border-radius:14px;overflow:hidden;background:#f7f9ff;">
                  <tr>
                    <td style="padding:18px 20px;">
                      <p style="margin:0 0 14px;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:800;color:#5266a8;">Contact details</p>
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td width="120" style="padding:5px 0;font-size:14px;color:#7a8bb2;font-weight:700;vertical-align:top;">Name</td>
                          <td style="padding:5px 0;font-size:14px;color:#14244f;font-weight:700;">${name}</td>
                        </tr>
                        <tr>
                          <td style="padding:5px 0;font-size:14px;color:#7a8bb2;font-weight:700;vertical-align:top;">Email</td>
                          <td style="padding:5px 0;font-size:14px;color:#14244f;">
                            <a href="mailto:${email}" style="color:#3154b3;text-decoration:none;font-weight:700;">${email}</a>
                          </td>
                        </tr>
                        ${phone ? `<tr>
                          <td style="padding:5px 0;font-size:14px;color:#7a8bb2;font-weight:700;vertical-align:top;">Phone</td>
                          <td style="padding:5px 0;font-size:14px;color:#14244f;">${phone}</td>
                        </tr>` : ''}
                        ${company ? `<tr>
                          <td style="padding:5px 0;font-size:14px;color:#7a8bb2;font-weight:700;vertical-align:top;">Company</td>
                          <td style="padding:5px 0;font-size:14px;color:#14244f;">${company}</td>
                        </tr>` : ''}
                        <tr>
                          <td style="padding:5px 0;font-size:14px;color:#7a8bb2;font-weight:700;vertical-align:top;">Type</td>
                          <td style="padding:5px 0;font-size:14px;">
                            <span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#e8edfa;color:#3154b3;font-size:13px;font-weight:800;">${escapeHtml(typeLabel)}</span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Message body -->
            <tr>
              <td style="padding:20px 32px 0;">
                <p style="margin:0 0 10px;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:800;color:#5266a8;">Message</p>
                <div style="background:#f7f9ff;border:1px solid #e0e8f8;border-radius:14px;padding:18px 20px;font-size:15px;line-height:1.75;color:#1c2f5e;">
                  ${message}
                </div>
              </td>
            </tr>

            <!-- Reply CTA -->
            <tr>
              <td style="padding:24px 32px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td bgcolor="#3154b3" style="border-radius:14px;background:#3154b3;background-color:#3154b3;border:1px solid #3154b3;">
                      <a href="mailto:${email}?subject=Re: ${encodeURIComponent(subject)}" style="display:inline-block;padding:13px 22px;border-radius:14px;background:#3154b3;background-color:#3154b3;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Reply to ${escapeHtml(input.firstName) || 'enquiry'}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:18px 32px 28px;border-top:1px solid #e6ecfb;margin-top:20px;background:#f7f9ff;">
                <p style="margin:0 0 4px;font-size:13px;color:#7a8bb2;">Received: ${escapeHtml(receivedAt)}</p>
                <p style="margin:0;font-size:12px;color:#9aabcc;">This enquiry was submitted via the HMJ Global website contact form.</p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html };
}

const handler = async (event = {}) => {
  const cors = buildCors(event);
  const method = (event.httpMethod || '').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: cors };
  }

  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Method not allowed.' }),
    };
  }

  // Rate limit
  const limit = await enforceRateLimit({
    event,
    bucket: 'contact_enquiry',
    max: RATE_LIMIT_MAX,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    metadata: {
      recipient: RECIPIENT_EMAIL,
    },
  });
  const rateLimitHeaders = buildRateLimitHeaders(limit);
  if (!limit.allowed) {
    return {
      statusCode: 429,
      headers: { ...cors, ...rateLimitHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: 'Too many requests. Please wait a moment and try again.',
        retryAfterMs: limit.retryAfterMs,
      }),
    };
  }

  const raw = parseBody(event);
  const input = normaliseInput(raw);
  const errors = validate(input);

  if (errors.length) {
    return {
      statusCode: 400,
      headers: { ...cors, ...rateLimitHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: errors[0], errors }),
    };
  }

  const { subject, html } = buildEnquiryEmail(input);

  try {
    const delivery = await sendTransactionalEmail({
      toEmail: RECIPIENT_EMAIL,
      fromEmail: FROM_EMAIL,
      fromName: FROM_NAME,
      replyTo: input.email,
      subject,
      html,
    });

    return {
      statusCode: 200,
      headers: { ...cors, ...rateLimitHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        message: 'Enquiry received. We will be in touch shortly.',
        delivery: { provider: delivery?.provider || null },
      }),
    };
  } catch (err) {
    console.error('[contact-enquiry] email delivery error', err?.message || err);
    return {
      statusCode: 502,
      headers: { ...cors, ...rateLimitHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: 'We could not send your enquiry at this time. Please email us directly at info@hmj-global.com.',
      }),
    };
  }
};

module.exports = { handler };
