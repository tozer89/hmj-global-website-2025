// netlify/functions/admin-jobs-email.js
const { withSupabase, jsonOk, jsonError } = require('./_supabase.js');
const { getContext } = require('./_auth.js');

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    return value
      .split(/[\n,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [value].filter(Boolean);
};

const ensureLines = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [value].filter(Boolean);
};

const baseUrl = () => (
  process.env.HMJ_PUBLIC_URL ||
  process.env.SITE_URL ||
  process.env.URL ||
  process.env.DEPLOY_PRIME_URL ||
  'https://www.hmj-global.com'
);

function buildEmailHtml(job, opts = {}) {
  const { intro = '', highlight = '' } = opts;
  const applyLink = job.apply_url || `${baseUrl().replace(/\/$/, '')}/contact.html?role=${encodeURIComponent(job.title || job.id)}`;
  const bullets = (label, items) => (!items.length ? '' : `
    <tr>
      <td style="padding:0 0 8px 0;font-size:14px;color:#0b0f18;font-weight:700">${label}</td>
    </tr>
    ${items.map((item) => `
      <tr>
        <td style="padding:4px 0 4px 18px;font-size:14px;color:#1b2236">• ${item}</td>
      </tr>`).join('')}
  `);

  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8"/>
    <title>${job.title || 'Role'} — HMJ Global</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0f18;font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0f18;padding:30px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:18px;border:1px solid #1f2a3d;color:#e8eef7;box-shadow:0 24px 60px rgba(0,0,0,.45);overflow:hidden;">
            <tr>
              <td style="padding:24px 32px 12px 32px;">
                <img src="${baseUrl().replace(/\/$/, '')}/images/logo-email.png" alt="HMJ Global" style="width:120px;display:block;margin-bottom:22px"/>
                <h1 style="margin:0;font-size:26px;line-height:1.3;color:#e8eef7;">${job.title || 'Role opportunity'}</h1>
                <p style="margin:10px 0 0;font-size:16px;color:#9fb0c9;">${job.location_text || ''}</p>
                ${highlight ? `<p style="margin:16px 0;font-size:15px;color:#d7e3ff;font-weight:600;">${highlight}</p>` : ''}
                ${intro ? `<p style="margin:16px 0;font-size:15px;color:#d7e3ff;">${intro}</p>` : ''}
              </td>
            </tr>
            <tr>
              <td style="background:#f8faff;color:#0b0f18;padding:28px 32px;border-top:1px solid rgba(15,23,42,.18);">
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1b2236;">${job.overview || ''}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  ${bullets('Key responsibilities', job.responsibilities)}
                  ${bullets('Ideal experience', job.requirements)}
                </table>
                <p style="margin:24px 0 16px;font-size:14px;color:#4b5c78;">Reference: <strong>${job.id}</strong> • Status: <strong>${(job.status || '').toUpperCase()}</strong></p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                  <tr>
                    <td style="background:linear-gradient(135deg,#4f7df3,#6ca6ff);border-radius:999px;padding:0;">
                      <a href="${applyLink}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:white;text-decoration:none;">Apply / Contact HMJ Global</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#0f172a;font-size:12px;color:#6b7ca1;text-align:center;">
                HMJ Global • Talent for Data Centres, Energy &amp; Life Sciences • <a href="${baseUrl().replace(/\/$/, '')}/contact.html" style="color:#8ea8ff;text-decoration:none;">hmj-global.com</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;
}

async function sendViaResend({ to, subject, html, text }) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { sent: false, reason: 'missing_resend_api_key' };

  const from = process.env.HMJ_EMAIL_FROM || 'HMJ Global <jobs@hmj-global.com>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { sent: false, reason: `resend_error_${res.status}`, details: errText.slice(0, 240) };
  }

  return { sent: true, provider: 'resend' };
}

module.exports.handler = withSupabase(async ({ event, context, supabase, trace, debug }) => {
  try {
    await getContext(event, context, { requireAdmin: true });
  } catch (err) {
    const status = err.code === 401 ? 401 : err.code === 403 ? 403 : 500;
    return jsonError(status, err.code || 'unauthorized', err.message || 'Unauthorized', { trace });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const id = (body.id || '').trim();
  if (!id) return jsonError(400, 'id_required', 'Job id is required', { trace });

  const recipients = ensureArray(body.recipients).filter(Boolean);
  if (!recipients.length) {
    return jsonError(400, 'recipients_required', 'Provide at least one recipient email', { trace });
  }

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (jobErr) {
    return jsonError(500, 'job_lookup_failed', jobErr.message || 'Failed to load job', { trace });
  }

  if (!job) return jsonError(404, 'job_not_found', 'Job not found', { trace });

  job.responsibilities = ensureLines(job.responsibilities);
  job.requirements = ensureLines(job.requirements);

  const subject = (body.subject || `${job.title || 'Role opportunity'} — HMJ Global`).trim();
  const intro = (body.intro || '').trim();
  const highlight = (body.highlight || '').trim();
  const html = buildEmailHtml(job, { intro, highlight });
  const text = [
    job.title,
    job.location_text,
    '',
    job.overview,
    '',
    'Responsibilities:',
    ...job.responsibilities.map((r) => `• ${r}`),
    '',
    'Experience:',
    ...job.requirements.map((r) => `• ${r}`),
    '',
    `Apply: ${job.apply_url || baseUrl() + '/contact.html'}`,
  ].filter(Boolean).join('\n');

  let providerResult = { sent: false, reason: 'no_provider' };
  try {
    providerResult = await sendViaResend({ to: recipients, subject, html, text });
  } catch (sendErr) {
    debug?.('[admin-jobs-email] send error:', sendErr.message || sendErr);
    providerResult = { sent: false, reason: 'send_failed', details: sendErr.message || String(sendErr) };
  }

  if (!providerResult.sent) {
    debug?.('[admin-jobs-email] provider fallback triggered', providerResult);
  }

  try {
    await supabase.from('job_email_logs').insert({
      job_id: id,
      recipients,
      subject,
      sent: providerResult.sent,
      provider: providerResult.provider || providerResult.reason || 'none',
      payload: { html, text, intro, highlight },
      error: providerResult.sent ? null : (providerResult.details || providerResult.reason || null),
    });
  } catch (logErr) {
    debug?.('[admin-jobs-email] log insert failed:', logErr.message || logErr);
  }

  return jsonOk({
    ok: true,
    trace,
    job: { id: job.id, title: job.title },
    recipients,
    subject,
    html,
    provider: providerResult.provider || providerResult.reason,
    sent: providerResult.sent,
    reason: providerResult.reason || null,
  });
});
