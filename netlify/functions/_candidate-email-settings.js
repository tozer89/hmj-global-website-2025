'use strict';

const { fetchSettings, saveSettings } = require('./_settings-helpers.js');
const {
  _resolveCandidatePortalBaseUrl: resolveCandidatePortalBaseUrl,
  _buildRedirectUrl: buildRedirectUrl,
} = require('./candidate-auth-config.js');

const SETTINGS_KEY = 'candidate_email_settings';
const MANAGEMENT_TOKEN_KEYS = [
  'SUPABASE_MANAGEMENT_ACCESS_TOKEN',
  'SUPABASE_PERSONAL_ACCESS_TOKEN',
  'SUPABASE_ACCESS_TOKEN',
];

const PROVIDER_PRESETS = {
  godaddy_microsoft365: {
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpEncryption: 'starttls',
  },
  custom: {
    smtpHost: '',
    smtpPort: 587,
    smtpEncryption: 'starttls',
  },
  supabase_default: {
    smtpHost: '',
    smtpPort: 587,
    smtpEncryption: 'starttls',
  },
};

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function lowerEmail(value) {
  const email = trimString(value, 320).toLowerCase();
  return email || '';
}

function normaliseUrl(value) {
  const raw = trimString(value, 1000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) return '';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function normalisePort(value, fallback = 587) {
  const parsed = Number.parseInt(String(value == null ? '' : value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return fallback;
  return parsed;
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const raw = trimString(value, 32).toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveProjectRef() {
  const explicit = trimString(process.env.SUPABASE_PROJECT_REF, 64);
  if (explicit) return explicit;
  const supabaseUrl = trimString(process.env.SUPABASE_URL, 1000);
  if (!supabaseUrl) return '';
  try {
    const hostname = new URL(supabaseUrl).hostname;
    return trimString(hostname.split('.')[0], 64);
  } catch (error) {
    return '';
  }
}

function resolveManagementToken() {
  for (const key of MANAGEMENT_TOKEN_KEYS) {
    const value = trimString(process.env[key], 4000);
    if (value) return { token: value, source: key };
  }
  return { token: '', source: null };
}

function deriveEmailRouteSettings(event = {}) {
  const siteUrl = resolveCandidatePortalBaseUrl(event);
  return {
    siteUrl,
    verificationRedirectUrl: buildRedirectUrl(siteUrl, '/candidates.html?candidate_auth=verified'),
    recoveryRedirectUrl: buildRedirectUrl(siteUrl, '/candidates.html?candidate_action=recovery'),
  };
}

function defaultCandidateEmailSettings(derived = {}) {
  return {
    smtpProvider: 'godaddy_microsoft365',
    customSmtpEnabled: false,
    smtpHost: PROVIDER_PRESETS.godaddy_microsoft365.smtpHost,
    smtpPort: PROVIDER_PRESETS.godaddy_microsoft365.smtpPort,
    smtpEncryption: PROVIDER_PRESETS.godaddy_microsoft365.smtpEncryption,
    smtpUser: '',
    smtpPassword: '',
    senderEmail: 'info@hmj-global.com',
    senderName: 'HMJ Global',
    supportEmail: 'info@hmj-global.com',
    siteUrl: derived.siteUrl || '',
    verificationRedirectUrl: derived.verificationRedirectUrl || '',
    recoveryRedirectUrl: derived.recoveryRedirectUrl || '',
    confirmationSubject: 'Confirm your HMJ candidate account',
    recoverySubject: 'Reset your HMJ candidate password',
    emailChangeSubject: 'Confirm your new HMJ candidate email address',
    confirmationHeading: 'Confirm your HMJ candidate account',
    recoveryHeading: 'Reset your HMJ candidate password',
    emailChangeHeading: 'Confirm your new HMJ candidate email address',
    preheader: 'Secure access to your HMJ candidate dashboard.',
    introCopy: 'Use the secure button below to finish your HMJ candidate account setup.',
    recoveryCopy: 'Use the secure button below to choose a new password for your HMJ candidate account.',
    helpCopy: 'If the button does not work, copy the full link into your browser or contact HMJ support.',
    footerTagline: 'Specialist recruitment for technical projects, commissioning, and delivery teams.',
    lastAppliedAt: '',
    lastAppliedBy: '',
  };
}

function applyProviderPreset(settings, provider) {
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.custom;
  return {
    ...settings,
    smtpProvider: provider,
    smtpHost: trimString(settings.smtpHost, 320) || preset.smtpHost,
    smtpPort: normalisePort(settings.smtpPort, preset.smtpPort),
    smtpEncryption: ['starttls', 'ssl', 'none'].includes(trimString(settings.smtpEncryption, 32).toLowerCase())
      ? trimString(settings.smtpEncryption, 32).toLowerCase()
      : preset.smtpEncryption,
  };
}

function normaliseCandidateEmailSettings(input = {}, options = {}) {
  const derived = options.derived || {};
  const existing = options.existing || {};
  const defaults = defaultCandidateEmailSettings(derived);
  const merged = {
    ...defaults,
    ...(existing && typeof existing === 'object' ? existing : {}),
  };

  const provider = ['godaddy_microsoft365', 'custom', 'supabase_default'].includes(trimString(input.smtpProvider, 64))
    ? trimString(input.smtpProvider, 64)
    : trimString(merged.smtpProvider, 64) || defaults.smtpProvider;

  const next = applyProviderPreset(merged, provider);

  next.customSmtpEnabled = toBoolean(
    input.customSmtpEnabled,
    toBoolean(merged.customSmtpEnabled, false)
  );
  next.smtpHost = trimString(input.smtpHost != null ? input.smtpHost : next.smtpHost, 320);
  next.smtpPort = normalisePort(input.smtpPort != null ? input.smtpPort : next.smtpPort, next.smtpPort);
  next.smtpEncryption = ['starttls', 'ssl', 'none'].includes(trimString(input.smtpEncryption != null ? input.smtpEncryption : next.smtpEncryption, 32).toLowerCase())
    ? trimString(input.smtpEncryption != null ? input.smtpEncryption : next.smtpEncryption, 32).toLowerCase()
    : 'starttls';
  next.smtpUser = trimString(input.smtpUser != null ? input.smtpUser : next.smtpUser, 320);

  const incomingPassword = Object.prototype.hasOwnProperty.call(input, 'smtpPassword')
    ? String(input.smtpPassword == null ? '' : input.smtpPassword)
    : null;
  if (toBoolean(input.clearSmtpPassword, false)) {
    next.smtpPassword = '';
  } else if (incomingPassword != null) {
    next.smtpPassword = incomingPassword.trim() ? incomingPassword.trim() : trimString(next.smtpPassword, 4000);
  } else {
    next.smtpPassword = trimString(next.smtpPassword, 4000);
  }

  next.senderEmail = lowerEmail(input.senderEmail != null ? input.senderEmail : next.senderEmail);
  next.senderName = trimString(input.senderName != null ? input.senderName : next.senderName, 160);
  next.supportEmail = lowerEmail(input.supportEmail != null ? input.supportEmail : next.supportEmail);
  next.siteUrl = normaliseUrl(input.siteUrl != null ? input.siteUrl : next.siteUrl) || defaults.siteUrl;
  next.verificationRedirectUrl = normaliseUrl(
    input.verificationRedirectUrl != null ? input.verificationRedirectUrl : next.verificationRedirectUrl
  ) || buildRedirectUrl(next.siteUrl, '/candidates.html?candidate_auth=verified');
  next.recoveryRedirectUrl = normaliseUrl(
    input.recoveryRedirectUrl != null ? input.recoveryRedirectUrl : next.recoveryRedirectUrl
  ) || buildRedirectUrl(next.siteUrl, '/candidates.html?candidate_action=recovery');

  next.confirmationSubject = trimString(input.confirmationSubject != null ? input.confirmationSubject : next.confirmationSubject, 160) || defaults.confirmationSubject;
  next.recoverySubject = trimString(input.recoverySubject != null ? input.recoverySubject : next.recoverySubject, 160) || defaults.recoverySubject;
  next.emailChangeSubject = trimString(input.emailChangeSubject != null ? input.emailChangeSubject : next.emailChangeSubject, 160) || defaults.emailChangeSubject;
  next.confirmationHeading = trimString(input.confirmationHeading != null ? input.confirmationHeading : next.confirmationHeading, 160) || defaults.confirmationHeading;
  next.recoveryHeading = trimString(input.recoveryHeading != null ? input.recoveryHeading : next.recoveryHeading, 160) || defaults.recoveryHeading;
  next.emailChangeHeading = trimString(input.emailChangeHeading != null ? input.emailChangeHeading : next.emailChangeHeading, 160) || defaults.emailChangeHeading;
  next.preheader = trimString(input.preheader != null ? input.preheader : next.preheader, 220) || defaults.preheader;
  next.introCopy = trimString(input.introCopy != null ? input.introCopy : next.introCopy, 320) || defaults.introCopy;
  next.recoveryCopy = trimString(input.recoveryCopy != null ? input.recoveryCopy : next.recoveryCopy, 320) || defaults.recoveryCopy;
  next.helpCopy = trimString(input.helpCopy != null ? input.helpCopy : next.helpCopy, 320) || defaults.helpCopy;
  next.footerTagline = trimString(input.footerTagline != null ? input.footerTagline : next.footerTagline, 220) || defaults.footerTagline;
  next.lastAppliedAt = trimString(existing.lastAppliedAt || '', 64);
  next.lastAppliedBy = trimString(existing.lastAppliedBy || '', 240);

  return next;
}

function redactCandidateEmailSettings(settings = {}) {
  const next = {
    ...settings,
    smtpPassword: '',
    smtpPasswordStored: !!trimString(settings.smtpPassword, 4000),
  };
  return next;
}

function buildEmailTemplate(settings, options = {}) {
  const heading = escapeHtml(options.heading || 'HMJ Global');
  const intro = escapeHtml(options.intro || '');
  const actionLabel = escapeHtml(options.actionLabel || 'Open secure link');
  const actionUrl = escapeHtml(options.actionUrl || '{{ .ConfirmationURL }}');
  const helpCopy = escapeHtml(settings.helpCopy || '');
  const senderName = escapeHtml(settings.senderName || 'HMJ Global');
  const supportEmail = escapeHtml(settings.supportEmail || settings.senderEmail || 'info@hmj-global.com');
  const footerTagline = escapeHtml(settings.footerTagline || '');
  const preheader = escapeHtml(settings.preheader || '');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef2fb;font-family:Arial,sans-serif;color:#14244f;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef2fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#ffffff;border:1px solid #d7e0f5;border-radius:24px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px;background:linear-gradient(135deg,#274390,#3d66c8);color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;font-weight:700;opacity:.88;">HMJ Global</div>
                <h1 style="margin:14px 0 0;font-size:30px;line-height:1.18;font-weight:800;color:#ffffff;">${heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 18px;">
                <p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:#334a7e;">${intro}</p>
                <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#5f74a8;">This link is tied to your HMJ candidate account and should only be used by you.</p>
                <p style="margin:0 0 26px;">
                  <a href="${actionUrl}" style="display:inline-block;padding:14px 22px;border-radius:14px;background:#3154b3;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">${actionLabel}</a>
                </p>
                <p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#5f74a8;">${escapeHtml(settings.helpCopy || '')}</p>
                <p style="margin:0;font-size:14px;line-height:1.7;color:#5f74a8;">Need help? Email <a href="mailto:${supportEmail}" style="color:#3154b3;text-decoration:none;">${supportEmail}</a>.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 28px;border-top:1px solid #e6ecfb;background:#f7f9ff;">
                <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#5f74a8;font-weight:700;">${senderName}</p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#5f74a8;">${footerTagline}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildCandidateEmailTemplates(settings = {}) {
  return {
    confirmation: buildEmailTemplate(settings, {
      heading: settings.confirmationHeading,
      intro: settings.introCopy,
      actionLabel: 'Confirm candidate account',
      actionUrl: '{{ .ConfirmationURL }}',
    }),
    recovery: buildEmailTemplate(settings, {
      heading: settings.recoveryHeading,
      intro: settings.recoveryCopy,
      actionLabel: 'Reset your password',
      actionUrl: '{{ .ConfirmationURL }}',
    }),
    emailChange: buildEmailTemplate(settings, {
      heading: settings.emailChangeHeading,
      intro: 'Use the secure button below to confirm your updated email address for your HMJ candidate account.',
      actionLabel: 'Confirm new email address',
      actionUrl: '{{ .ConfirmationURL }}',
    }),
  };
}

function buildSupabaseAuthPatch(settings = {}) {
  const templates = buildCandidateEmailTemplates(settings);
  const candidatePageUrl = trimString(settings.siteUrl, 1000)
    ? buildRedirectUrl(settings.siteUrl, '/candidates.html')
    : '';
  const redirectUrls = Array.from(new Set([
    trimString(settings.siteUrl, 1000),
    trimString(settings.verificationRedirectUrl, 1000),
    trimString(settings.recoveryRedirectUrl, 1000),
    candidatePageUrl,
  ].filter(Boolean)));

  const patch = {
    site_url: settings.siteUrl,
    uri_allow_list: redirectUrls,
    external_email_enabled: true,
    mailer_autoconfirm: false,
    mailer_secure_email_change_enabled: true,
    mailer_subjects_confirmation: settings.confirmationSubject,
    mailer_subjects_recovery: settings.recoverySubject,
    mailer_subjects_email_change: settings.emailChangeSubject,
    mailer_templates_confirmation_content: templates.confirmation,
    mailer_templates_recovery_content: templates.recovery,
    mailer_templates_email_change_content: templates.emailChange,
  };

  if (settings.customSmtpEnabled) {
    patch.smtp_host = settings.smtpHost;
    patch.smtp_port = settings.smtpPort;
    patch.smtp_user = settings.smtpUser;
    patch.smtp_pass = settings.smtpPassword;
    patch.smtp_admin_email = settings.senderEmail;
    patch.smtp_sender_name = settings.senderName;
  }

  return patch;
}

function redactSupabaseAuthPatch(patch = {}) {
  return {
    ...patch,
    smtp_pass: patch.smtp_pass ? '********' : '',
  };
}

function candidateEmailDiagnostics(settings = {}) {
  const management = resolveManagementToken();
  const projectRef = resolveProjectRef();
  const smtpConfigured = !!(
    settings.customSmtpEnabled
    && trimString(settings.smtpHost, 320)
    && normalisePort(settings.smtpPort, 0)
    && trimString(settings.smtpUser, 320)
    && trimString(settings.smtpPassword, 4000)
    && lowerEmail(settings.senderEmail)
    && trimString(settings.senderName, 160)
  );
  const redirectsReady = !!(
    normaliseUrl(settings.siteUrl)
    && normaliseUrl(settings.verificationRedirectUrl)
    && normaliseUrl(settings.recoveryRedirectUrl)
  );
  const subjectsReady = !!(
    trimString(settings.confirmationSubject, 160)
    && trimString(settings.recoverySubject, 160)
  );

  const warnings = [];
  if (!smtpConfigured) {
    warnings.push('Custom SMTP is not complete. Supabase default email is only suitable for testing and is rate-limited.');
  }
  if (!redirectsReady) {
    warnings.push('Candidate auth redirects are incomplete. Verification and recovery emails can fail if these are wrong.');
  }
  if (!management.token) {
    warnings.push('Automatic apply to Supabase is not available until SUPABASE_MANAGEMENT_ACCESS_TOKEN is added to Netlify.');
  }

  return {
    projectRef,
    managementTokenAvailable: !!management.token,
    managementTokenSource: management.source,
    customSmtpReady: smtpConfigured,
    redirectsReady,
    subjectsReady,
    publicDeliveryReady: smtpConfigured,
    warnings,
    status: smtpConfigured && redirectsReady && subjectsReady ? 'ready' : 'needs_attention',
  };
}

async function readCandidateEmailSettings(event) {
  const derived = deriveEmailRouteSettings(event);
  const result = await fetchSettings(event, [SETTINGS_KEY]);
  const stored = result?.settings?.[SETTINGS_KEY] && typeof result.settings[SETTINGS_KEY] === 'object'
    ? result.settings[SETTINGS_KEY]
    : {};
  const settings = normaliseCandidateEmailSettings(stored, { existing: stored, derived });
  return {
    settings,
    redacted: redactCandidateEmailSettings(settings),
    previews: buildCandidateEmailTemplates(settings),
    patch: buildSupabaseAuthPatch(settings),
    patchPreview: redactSupabaseAuthPatch(buildSupabaseAuthPatch(settings)),
    diagnostics: candidateEmailDiagnostics(settings),
    source: result?.source || 'fallback',
  };
}

async function persistCandidateEmailSettings(event, nextInput = {}, meta = {}) {
  const current = await readCandidateEmailSettings(event);
  const next = normaliseCandidateEmailSettings(nextInput, {
    existing: current.settings,
    derived: deriveEmailRouteSettings(event),
  });

  if (meta.appliedAt) next.lastAppliedAt = trimString(meta.appliedAt, 64);
  if (meta.appliedBy) next.lastAppliedBy = trimString(meta.appliedBy, 240);

  await saveSettings(event, {
    [SETTINGS_KEY]: next,
  });

  return readCandidateEmailSettings(event);
}

async function applyCandidateEmailSettingsToSupabase(event, options = {}) {
  const current = options.settings
    ? {
        settings: options.settings,
        diagnostics: candidateEmailDiagnostics(options.settings),
        patch: buildSupabaseAuthPatch(options.settings),
      }
    : await readCandidateEmailSettings(event);

  const management = resolveManagementToken();
  if (!management.token) {
    const error = new Error('Add SUPABASE_MANAGEMENT_ACCESS_TOKEN to Netlify before applying these settings directly from admin.');
    error.code = 'management_token_missing';
    error.details = {
      diagnostics: current.diagnostics,
      patch: redactSupabaseAuthPatch(current.patch),
    };
    throw error;
  }

  const projectRef = resolveProjectRef();
  if (!projectRef) {
    const error = new Error('Supabase project reference could not be resolved.');
    error.code = 'project_ref_missing';
    throw error;
  }

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${management.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(current.patch),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `Supabase auth config update failed (${response.status})`);
    error.code = 'supabase_apply_failed';
    error.status = response.status;
    error.details = {
      diagnostics: current.diagnostics,
      response: data,
      patch: redactSupabaseAuthPatch(current.patch),
    };
    throw error;
  }

  return {
    ok: true,
    data,
    patch: redactSupabaseAuthPatch(current.patch),
    diagnostics: current.diagnostics,
  };
}

module.exports = {
  SETTINGS_KEY,
  PROVIDER_PRESETS,
  buildEmailTemplate,
  defaultCandidateEmailSettings,
  deriveEmailRouteSettings,
  normaliseCandidateEmailSettings,
  redactCandidateEmailSettings,
  buildCandidateEmailTemplates,
  buildSupabaseAuthPatch,
  redactSupabaseAuthPatch,
  candidateEmailDiagnostics,
  readCandidateEmailSettings,
  persistCandidateEmailSettings,
  applyCandidateEmailSettingsToSupabase,
  resolveProjectRef,
  resolveManagementToken,
};
