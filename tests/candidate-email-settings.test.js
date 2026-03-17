const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../netlify/functions/_candidate-email-settings.js');

function loadModule(env = {}) {
  const baseline = {
    SUPABASE_URL: '',
    SUPABASE_SERVICE_KEY: '',
    SUPABASE_SERVICE_ROLE: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_MANAGEMENT_ACCESS_TOKEN: '',
    SUPABASE_PERSONAL_ACCESS_TOKEN: '',
    SUPABASE_ACCESS_TOKEN: '',
    SUPABASE_PROJECT_REF: '',
    RESEND_API_KEY: '',
  };
  const mergedEnv = { ...baseline, ...env };
  const original = {};
  Object.keys(mergedEnv).forEach((key) => {
    original[key] = process.env[key];
    process.env[key] = mergedEnv[key];
  });
  delete require.cache[modulePath];
  const mod = require(modulePath);
  return {
    mod,
    restore() {
      Object.keys(mergedEnv).forEach((key) => {
        if (original[key] === undefined) delete process.env[key];
        else process.env[key] = original[key];
      });
      delete require.cache[modulePath];
    }
  };
}

test('normaliseCandidateEmailSettings keeps saved SMTP password when the form leaves it blank', () => {
  const { mod, restore } = loadModule();
  try {
    const current = {
      smtpProvider: 'godaddy_microsoft365',
      customSmtpEnabled: true,
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      smtpEncryption: 'starttls',
      smtpUser: 'info@hmj-global.com',
      smtpPassword: 'existing-secret',
      senderEmail: 'info@hmj-global.com',
      senderName: 'HMJ Global',
      supportEmail: 'info@hmj-global.com',
      siteUrl: 'https://www.hmj-global.com',
      verificationRedirectUrl: 'https://www.hmj-global.com/candidates.html?candidate_auth=verified',
      recoveryRedirectUrl: 'https://www.hmj-global.com/candidates.html?candidate_action=recovery',
    };
    const next = mod.normaliseCandidateEmailSettings({
      smtpPassword: '',
    }, {
      existing: current,
      derived: mod.deriveEmailRouteSettings({
        headers: { host: 'www.hmj-global.com', 'x-forwarded-proto': 'https' }
      }),
    });

    assert.equal(next.smtpPassword, 'existing-secret');
  } finally {
    restore();
  }
});

test('normaliseCandidateEmailSettings clears saved SMTP password when requested', () => {
  const { mod, restore } = loadModule();
  try {
    const next = mod.normaliseCandidateEmailSettings({
      clearSmtpPassword: true,
    }, {
      existing: {
        smtpPassword: 'existing-secret',
        siteUrl: 'https://www.hmj-global.com',
        verificationRedirectUrl: 'https://www.hmj-global.com/candidates.html?candidate_auth=verified',
        recoveryRedirectUrl: 'https://www.hmj-global.com/candidates.html?candidate_action=recovery',
      },
      derived: mod.deriveEmailRouteSettings({
        headers: { host: 'www.hmj-global.com', 'x-forwarded-proto': 'https' }
      }),
    });

    assert.equal(next.smtpPassword, '');
  } finally {
    restore();
  }
});

test('candidateEmailDiagnostics flags incomplete SMTP as not ready for public delivery', () => {
  const { mod, restore } = loadModule({
    SUPABASE_URL: 'https://mftwpbpwisxyaenfoizb.supabase.co',
  });
  try {
    const diagnostics = mod.candidateEmailDiagnostics({
      customSmtpEnabled: false,
      senderEmail: 'info@hmj-global.com',
      senderName: 'HMJ Global',
      siteUrl: 'https://www.hmj-global.com',
      verificationRedirectUrl: 'https://www.hmj-global.com/candidates.html?candidate_auth=verified',
      recoveryRedirectUrl: 'https://www.hmj-global.com/candidates.html?candidate_action=recovery',
      confirmationSubject: 'Confirm your HMJ candidate account',
      recoverySubject: 'Reset your HMJ candidate password',
    });

    assert.equal(diagnostics.projectRef, 'mftwpbpwisxyaenfoizb');
    assert.equal(diagnostics.publicDeliveryReady, false);
    assert.equal(diagnostics.managementTokenAvailable, false);
    assert.ok(diagnostics.warnings.some((item) => /custom smtp/i.test(item)));
  } finally {
    restore();
  }
});

test('candidateEmailDiagnostics treats a validated Resend provider as ready for public delivery', () => {
  const { mod, restore } = loadModule({
    SUPABASE_URL: 'https://mftwpbpwisxyaenfoizb.supabase.co',
    RESEND_API_KEY: 're_live_placeholder',
  });
  try {
    const diagnostics = mod.candidateEmailDiagnostics({
      customSmtpEnabled: false,
      senderEmail: 'info@hmj-global.com',
      senderName: 'HMJ Global',
      siteUrl: 'https://hmjg.netlify.app',
      verificationRedirectUrl: 'https://hmjg.netlify.app/candidates.html?candidate_auth=verified',
      recoveryRedirectUrl: 'https://hmjg.netlify.app/candidates.html?candidate_action=recovery',
      confirmationSubject: 'Confirm your HMJ candidate account',
      recoverySubject: 'Reset your HMJ candidate password',
    }, {
      deliveryProbe: {
        configured: true,
        ready: true,
        status: 'ready',
        message: 'Resend is configured and accepted the API key.',
      },
    });

    assert.equal(diagnostics.publicDeliveryReady, true);
    assert.equal(diagnostics.deliverySource, 'resend');
    assert.equal(diagnostics.resendConfigured, true);
    assert.equal(diagnostics.resendReady, true);
  } finally {
    restore();
  }
});

test('buildSupabaseAuthPatch includes SMTP fields only when custom SMTP is enabled', () => {
  const { mod, restore } = loadModule();
  try {
    const withoutSmtp = mod.buildSupabaseAuthPatch({
      customSmtpEnabled: false,
      siteUrl: 'https://www.hmj-global.com',
      verificationRedirectUrl: 'https://www.hmj-global.com/candidates.html?candidate_auth=verified',
      recoveryRedirectUrl: 'https://www.hmj-global.com/candidates.html?candidate_action=recovery',
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
      footerTagline: 'Specialist recruitment for technical projects.',
    });

    const withSmtp = mod.buildSupabaseAuthPatch({
      ...withoutSmtp,
      customSmtpEnabled: true,
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      smtpUser: 'info@hmj-global.com',
      smtpPassword: 'secret',
      senderEmail: 'info@hmj-global.com',
      senderName: 'HMJ Global',
    });

    assert.equal(Object.prototype.hasOwnProperty.call(withoutSmtp, 'smtp_host'), false);
    assert.equal(withSmtp.smtp_host, 'smtp.office365.com');
    assert.equal(withSmtp.smtp_pass, 'secret');
  } finally {
    restore();
  }
});
