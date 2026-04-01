'use strict';

const { buildCors } = require('./_http.js');
const { escapeHtml } = require('./_html.js');
const { buildRateLimitHeaders, enforceRateLimit } = require('./_rate-limit.js');
const { sendTransactionalEmail } = require('./_mail-delivery.js');
const { readCandidateEmailSettings } = require('./_candidate-email-settings.js');
const { fetchSettings } = require('./_settings-helpers.js');
const { hasSupabase, getSupabase } = require('./_supabase.js');
const {
  TURNOVER_BANDS,
  YEARS_TRADING_BANDS,
  SECTOR_OPTIONS,
  COMPANY_STRUCTURE_OPTIONS,
  PAYMENT_TERMS_OPTIONS,
  ACCOUNTS_STATUS_OPTIONS,
  buildLeadReference,
  calculateIndicativeLimit,
  formatCurrency,
  normaliseSettings,
  normalisePublicSubmission,
  validatePublicSubmission,
} = require('../../lib/credit-limit-checker.js');

const TABLE = 'credit_limit_checker_leads';
const RATE_LIMIT_WINDOW_SECONDS = Math.max(Number.parseInt(process.env.CREDIT_CHECK_RATE_LIMIT_WINDOW_SECONDS || '600', 10) || 600, 30);
const RATE_LIMIT_MAX = Math.max(Number.parseInt(process.env.CREDIT_CHECK_RATE_LIMIT_MAX || '4', 10) || 4, 1);

function parseBody(event) {
  try {
    return JSON.parse(event?.body || '{}');
  } catch {
    return {};
  }
}

function jsonResponse(statusCode, body, headers) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      ...(headers || {}),
    },
    body: JSON.stringify(body),
  };
}

function labelFor(list, value) {
  const match = Array.isArray(list) ? list.find(function (item) { return item.value === value; }) : null;
  return match ? match.label : value;
}

function buildLeadEmailHtml(lead, settings) {
  const createdAt = new Date(lead.created_at).toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  });

  const turnoverLabel = labelFor(TURNOVER_BANDS, lead.turnover_band);
  const yearsLabel = labelFor(YEARS_TRADING_BANDS, lead.years_trading_band);
  const sectorLabel = labelFor(SECTOR_OPTIONS, lead.sector);
  const structureLabel = labelFor(COMPANY_STRUCTURE_OPTIONS, lead.company_structure);
  const paymentTermsLabel = labelFor(PAYMENT_TERMS_OPTIONS, lead.payment_terms_band);
  const accountsStatusLabel = labelFor(ACCOUNTS_STATUS_OPTIONS, lead.accounts_status);
  const detailRow = function (label, value) {
    if (!value) return '';
    return `<tr>
      <td style="padding:10px 12px;background:#f6f8ff;border-bottom:1px solid #e4eaf7;font-size:12px;font-weight:700;color:#6074a3;width:35%;">${escapeHtml(label)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e4eaf7;font-size:14px;color:#14244f;">${value}</td>
    </tr>`;
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New HMJ Credit Checker Lead</title>
  </head>
  <body style="margin:0;padding:0;background:#eef2fb;font-family:Arial,sans-serif;color:#14244f;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef2fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:660px;background:#ffffff;border:1px solid #d8e0f5;border-radius:24px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px;background:#142b67;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#cfdcff;">HMJ Global · Credit Checker</div>
                <h1 style="margin:12px 0 8px;font-size:28px;line-height:1.1;font-weight:800;color:#ffffff;">New indicative credit-check lead</h1>
                <p style="margin:0;font-size:14px;line-height:1.7;color:#dbe6ff;">A prospective client requested an indicative trade-credit range through the discreet client widget.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0;">
                <div style="padding:20px 22px;border-radius:18px;background:linear-gradient(135deg,#173779,#0f1b3f);color:#ffffff;">
                  <div style="font-size:13px;color:#cddafe;margin-bottom:8px;">Indicative range shown</div>
                  <div style="font-size:34px;line-height:1.08;font-weight:800;letter-spacing:-0.02em;">${escapeHtml(lead.indicative_range_label)}</div>
                  <div style="margin-top:10px;font-size:13px;color:#dbe6ff;">Mid-point ${escapeHtml(formatCurrency(lead.indicative_mid, 'GBP'))} · ${escapeHtml(lead.result_payload?.band || 'standard')} band</div>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0;">
                <p style="margin:0 0 12px;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;font-weight:800;color:#6074a3;">Lead summary</p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e4eaf7;border-radius:16px;overflow:hidden;">
                  ${detailRow('Reference', `<strong>${escapeHtml(lead.lead_reference)}</strong>`)}
                  ${detailRow('Submitted', escapeHtml(createdAt))}
                  ${detailRow('Name', escapeHtml(lead.full_name))}
                  ${detailRow('Company', escapeHtml(lead.company_name))}
                  ${detailRow('Email', `<a href="mailto:${escapeHtml(lead.email)}" style="color:#3154b3;text-decoration:none;font-weight:700;">${escapeHtml(lead.email)}</a>`)}
                  ${detailRow('Phone', escapeHtml(lead.phone || ''))}
                  ${detailRow('Turnover', escapeHtml(turnoverLabel))}
                  ${detailRow('Years trading', escapeHtml(yearsLabel))}
                  ${detailRow('Sector', escapeHtml(sectorLabel))}
                  ${detailRow('Business structure', escapeHtml(structureLabel))}
                  ${detailRow('Payment terms', escapeHtml(paymentTermsLabel))}
                  ${detailRow('Accounts position', escapeHtml(accountsStatusLabel))}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0;">
                <div style="padding:18px 20px;border-radius:16px;border:1px solid #e4eaf7;background:#f8faff;">
                  <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;font-weight:800;color:#6074a3;">Model note</p>
                  <p style="margin:0 0 10px;font-size:14px;line-height:1.75;color:#30456f;">${escapeHtml(lead.result_payload?.narrative || settings.pageDisclaimer)}</p>
                  <p style="margin:0;font-size:12px;line-height:1.7;color:#6074a3;">${escapeHtml(settings.pageDisclaimer)}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="border-radius:14px;background:#3154b3;">
                      <a href="https://www.hmj-global.com/admin/credit-checker.html" style="display:inline-block;padding:13px 22px;border-radius:14px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">Open credit-checker admin</a>
                    </td>
                    <td style="width:10px;"></td>
                    <td style="border-radius:14px;background:#ffffff;border:1px solid #3154b3;">
                      <a href="mailto:${escapeHtml(lead.email)}?subject=${encodeURIComponent('HMJ Global credit enquiry follow-up')}" style="display:inline-block;padding:13px 22px;border-radius:14px;color:#3154b3;font-size:15px;font-weight:700;text-decoration:none;">Reply to lead</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 28px;border-top:1px solid #e6ecfb;background:#f8faff;">
                <p style="margin:0 0 4px;font-size:13px;color:#6074a3;">Source: ${escapeHtml(lead.source_context || 'clients_widget')}</p>
                <p style="margin:0;font-size:12px;color:#8fa0c4;">Saved to the HMJ credit-checker lead register${lead.storage_status === 'stored' ? ' and queued for follow-up.' : '.'}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildLeadRecord(input, result, settings, event) {
  const now = new Date();
  const safeSettings = normaliseSettings(settings);
  return {
    lead_reference: buildLeadReference(now),
    full_name: input.fullName,
    company_name: input.companyName,
    email: input.email,
    phone: input.phone || null,
    turnover_band: input.turnoverBand,
    years_trading_band: input.yearsTradingBand,
    sector: input.sector,
    company_structure: input.companyStructure,
    payment_terms_band: input.paymentTermsBand,
    accounts_status: input.accountsStatus,
    consent_confirmed: true,
    status: 'new',
    source_page: input.sourcePage || '/credit-check',
    source_context: input.sourceContext || 'clients_widget',
    indicative_low: result.low,
    indicative_mid: result.mid,
    indicative_high: result.high,
    indicative_range_label: result.rangeLabel,
    result_payload: {
      band: result.band,
      narrative: result.narrative,
      disclaimer: result.disclaimer,
      breakdown: result.breakdown,
      input_summary: {
        companyStructure: input.companyStructure,
        paymentTermsBand: input.paymentTermsBand,
        accountsStatus: input.accountsStatus,
      },
    },
    calculator_snapshot: safeSettings.calculator,
    storage_status: 'pending',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    meta: {
      userAgent: event?.headers?.['user-agent'] || event?.headers?.['User-Agent'] || '',
      origin: event?.headers?.origin || event?.headers?.Origin || '',
    },
  };
}

async function storeLead(event, record) {
  if (!hasSupabase()) {
    return { ok: false, stored: false, error: 'supabase_unavailable', lead: record };
  }

  try {
    const supabase = getSupabase(event);
    const payload = { ...record, storage_status: 'stored' };
    const { data, error } = await supabase
      .from(TABLE)
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;
    return { ok: true, stored: true, lead: data || payload };
  } catch (error) {
    console.error('[credit-check-submit] lead storage failed', error?.message || error);
    return { ok: false, stored: false, error: error?.message || 'storage_failed', lead: record };
  }
}

async function deliverLeadNotifications(event, settings, lead) {
  const recipients = Array.isArray(settings.notificationRecipients) && settings.notificationRecipients.length
    ? settings.notificationRecipients
    : ['accounts@hmj-global.com', 'info@hmj-global.com'];
  const emailConfig = await readCandidateEmailSettings(event).catch(function () {
    return { settings: {} };
  });
  const senderSettings = emailConfig?.settings || {};
  const fromEmail = senderSettings.senderEmail || senderSettings.supportEmail || 'info@hmj-global.com';
  const fromName = senderSettings.senderName || 'HMJ Global';
  const subject = 'Credit checker lead: ' + lead.company_name + ' (' + lead.indicative_range_label + ')';
  const html = buildLeadEmailHtml(lead, settings);

  const results = await Promise.allSettled(recipients.map(function (toEmail) {
    return sendTransactionalEmail({
      toEmail,
      fromEmail,
      fromName,
      replyTo: lead.email,
      subject,
      html,
      smtpSettings: senderSettings,
    });
  }));

  const sent = results.filter(function (entry) { return entry.status === 'fulfilled'; }).length;
  const failed = results
    .filter(function (entry) { return entry.status === 'rejected'; })
    .map(function (entry) { return entry.reason?.message || 'delivery_failed'; });

  if (!sent && failed.length) {
    console.error('[credit-check-submit] notification delivery failed', failed.join(' | '));
  }

  return {
    attempted: recipients.length,
    sent,
    failed,
  };
}

exports.handler = async function handler(event) {
  const cors = buildCors(event);
  const method = String(event?.httpMethod || '').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: cors };
  }

  if (method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed.' }, cors);
  }

  const rateLimit = await enforceRateLimit({
    event,
    bucket: 'credit_checker_submit',
    max: RATE_LIMIT_MAX,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    metadata: { tool: 'credit_checker' },
  });
  const rateLimitHeaders = buildRateLimitHeaders(rateLimit);

  if (!rateLimit.allowed) {
    return jsonResponse(429, {
      ok: false,
      error: 'Too many requests. Please wait a few minutes and try again.',
      retryAfterMs: rateLimit.retryAfterMs,
    }, { ...cors, ...rateLimitHeaders });
  }

  const raw = parseBody(event);
  const settingsResult = await fetchSettings(event, ['credit_checker_settings']);
  const settings = normaliseSettings(settingsResult?.settings?.credit_checker_settings);

  if (!settings.enabled) {
    return jsonResponse(503, {
      ok: false,
      error: 'The indicative credit checker is temporarily unavailable.',
    }, { ...cors, ...rateLimitHeaders });
  }

  const input = normalisePublicSubmission(raw);
  const errors = validatePublicSubmission(input, settings);
  if (errors.length) {
    return jsonResponse(400, {
      ok: false,
      error: errors[0],
      errors,
    }, { ...cors, ...rateLimitHeaders });
  }

  const result = calculateIndicativeLimit(input, settings);
  if (!result) {
    return jsonResponse(422, {
      ok: false,
      error: 'We could not calculate an indicative range from those answers.',
    }, { ...cors, ...rateLimitHeaders });
  }

  const provisionalLead = buildLeadRecord(input, result, settings, event);
  const storage = await storeLead(event, provisionalLead);
  const lead = storage.lead || provisionalLead;
  const notifications = await deliverLeadNotifications(event, settings, lead);
  const notificationSucceeded = notifications.sent > 0;
  const ok = storage.stored || notificationSucceeded;

  if (!ok) {
    return jsonResponse(502, {
      ok: false,
      error: 'We could not complete the indicative check at this time. Please try again shortly.',
    }, { ...cors, ...rateLimitHeaders });
  }

  return jsonResponse(200, {
    ok: true,
    leadReference: lead.lead_reference,
    result: {
      low: result.low,
      mid: result.mid,
      high: result.high,
      lowLabel: result.lowLabel,
      midLabel: result.midLabel,
      highLabel: result.highLabel,
      rangeLabel: result.rangeLabel,
      narrative: result.narrative,
      disclaimer: settings.pageDisclaimer,
      thankYouMessage: settings.thankYouMessage,
    },
  }, { ...cors, ...rateLimitHeaders });
};
