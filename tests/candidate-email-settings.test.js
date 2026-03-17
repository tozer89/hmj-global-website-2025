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

test('candidateEmailDiagnostics surfaces invalid SMTP credentials explicitly', () => {
  const { mod, restore } = loadModule({
    SUPABASE_URL: 'https://mftwpbpwisxyaenfoizb.supabase.co',
  });
  try {
    const diagnostics = mod.candidateEmailDiagnostics({
      customSmtpEnabled: false,
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      smtpEncryption: 'starttls',
      smtpUser: 'info@hmj-global.com',
      smtpPassword: 'bad-secret',
      senderEmail: 'info@hmj-global.com',
      senderName: 'HMJ Global',
      siteUrl: 'https://hmjg.netlify.app',
      verificationRedirectUrl: 'https://hmjg.netlify.app/candidates.html?candidate_auth=verified',
      recoveryRedirectUrl: 'https://hmjg.netlify.app/candidates.html?candidate_action=recovery',
      confirmationSubject: 'Confirm your HMJ candidate account',
      recoverySubject: 'Reset your HMJ candidate password',
    }, {
      smtpProbe: {
        provider: 'smtp',
        configured: true,
        ready: false,
        status: 'invalid_credentials',
        message: 'The saved SMTP login for info@hmj-global.com was rejected by Microsoft 365.',
      },
      deliveryProbe: {
        provider: 'resend',
        configured: false,
        ready: false,
        status: 'missing',
        message: 'RESEND_API_KEY is not configured.',
      },
    });

    assert.equal(diagnostics.publicDeliveryReady, false);
    assert.equal(diagnostics.smtpStatus, 'invalid_credentials');
    assert.equal(diagnostics.deliverySource, 'smtp_invalid');
    assert.match(diagnostics.warnings.join(' '), /Microsoft 365/i);
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
      helpCopy: 'If the button does not open, use the secure fallback link below or contact HMJ support.',
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
    assert.equal(withoutSmtp.uri_allow_list, [
      'https://www.hmj-global.com',
      'https://www.hmj-global.com/candidates.html?candidate_auth=verified',
      'https://www.hmj-global.com/candidates.html?candidate_action=recovery',
      'https://www.hmj-global.com/candidates.html',
    ].join(','));
    assert.equal(withSmtp.smtp_host, 'smtp.office365.com');
    assert.equal(withSmtp.smtp_port, '587');
    assert.equal(withSmtp.smtp_pass, 'secret');
  } finally {
    restore();
  }
});

test('buildEmailTemplate uses a solid brand header and named fallback links', () => {
  const { mod, restore } = loadModule();
  try {
    const html = mod.buildEmailTemplate({
      senderName: 'HMJ Global',
      senderEmail: 'info@hmj-global.com',
      supportEmail: 'info@hmj-global.com',
      helpCopy: 'If the button does not work, use the secure fallback link below.',
      footerTagline: 'Specialist recruitment for technical projects.',
      preheader: 'Secure access to your HMJ candidate dashboard.',
    }, {
      heading: 'Confirm your HMJ candidate account',
      intro: 'Use the secure button below to finish your HMJ candidate account setup.',
      actionLabel: 'Confirm candidate account',
      actionUrl: 'https://example.com/secure-token',
    });

    assert.match(html, /background:#173779/);
    assert.match(html, /bgcolor="#173779"/);
    assert.match(html, /Open secure fallback link/);
    assert.doesNotMatch(html, /linear-gradient/);
  } finally {
    restore();
  }
});

test('resolveManagementToken prefers a one-time request override when provided', () => {
  const { mod, restore } = loadModule({
    SUPABASE_MANAGEMENT_ACCESS_TOKEN: '',
  });
  try {
    const token = mod.resolveManagementToken({ tokenOverride: 'override-token' });
    assert.deepEqual(token, {
      token: 'override-token',
      source: 'request_override',
    });
  } finally {
    restore();
  }
});

test('applyCandidateEmailSettingsToSupabase accepts a one-time management token override', async () => {
  const { mod, restore } = loadModule({
    SUPABASE_URL: 'https://mftwpbpwisxyaenfoizb.supabase.co',
  });
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      authorization: options?.headers?.authorization || '',
      body: options?.body || '',
    });
    return {
      ok: true,
      json: async () => ({ ok: true }),
    };
  };

  try {
    const result = await mod.applyCandidateEmailSettingsToSupabase({}, {
      managementToken: 'override-token',
      settings: {
        customSmtpEnabled: false,
        senderEmail: 'info@hmj-global.com',
        senderName: 'HMJ Global',
        supportEmail: 'info@hmj-global.com',
        siteUrl: 'https://hmjg.netlify.app',
        verificationRedirectUrl: 'https://hmjg.netlify.app/candidates.html?candidate_auth=verified',
        recoveryRedirectUrl: 'https://hmjg.netlify.app/candidates.html?candidate_action=recovery',
        confirmationSubject: 'Confirm your HMJ candidate account',
        recoverySubject: 'Reset your HMJ candidate password',
        emailChangeSubject: 'Confirm your new HMJ candidate email address',
        confirmationHeading: 'Confirm your HMJ candidate account',
        recoveryHeading: 'Reset your HMJ candidate password',
        emailChangeHeading: 'Confirm your new HMJ candidate email address',
        preheader: 'Secure access to your HMJ candidate dashboard.',
        introCopy: 'Use the secure button below to finish your HMJ candidate account setup.',
        recoveryCopy: 'Use the secure button below to choose a new password for your HMJ candidate account.',
        helpCopy: 'If the button does not open, use the secure fallback link below or contact HMJ support.',
        footerTagline: 'Specialist recruitment for technical projects.',
      },
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /api\.supabase\.com\/v1\/projects\/mftwpbpwisxyaenfoizb\/config\/auth$/);
    assert.equal(calls[0].authorization, 'Bearer override-token');
    const sentBody = JSON.parse(calls[0].body);
    assert.equal(typeof sentBody.smtp_port, 'undefined');
    assert.equal(typeof sentBody.uri_allow_list, 'string');
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test('buildSupabaseAuthPatch normalises smtp_port and uri_allow_list to strings for Supabase', () => {
  const { mod, restore } = loadModule();
  try {
    const patch = mod.buildSupabaseAuthPatch({
      customSmtpEnabled: true,
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      smtpUser: 'info@hmj-global.com',
      smtpPassword: 'secret',
      senderEmail: 'info@hmj-global.com',
      senderName: 'HMJ Global',
      supportEmail: 'info@hmj-global.com',
      siteUrl: 'https://hmjg.netlify.app',
      verificationRedirectUrl: 'https://hmjg.netlify.app/candidates.html?candidate_auth=verified',
      recoveryRedirectUrl: 'https://hmjg.netlify.app/candidates.html?candidate_action=recovery',
      confirmationSubject: 'Confirm your HMJ candidate account',
      recoverySubject: 'Reset your HMJ candidate password',
      emailChangeSubject: 'Confirm your new HMJ candidate email address',
      confirmationHeading: 'Confirm your HMJ candidate account',
      recoveryHeading: 'Reset your HMJ candidate password',
      emailChangeHeading: 'Confirm your new HMJ candidate email address',
      preheader: 'Secure access to your HMJ candidate dashboard.',
      introCopy: 'Use the secure button below to finish your HMJ candidate account setup.',
      recoveryCopy: 'Use the secure button below to choose a new password for your HMJ candidate account.',
      helpCopy: 'If the button does not open, use the secure fallback link below or contact HMJ support.',
      footerTagline: 'Specialist recruitment for technical projects.',
    });

    assert.equal(typeof patch.smtp_port, 'string');
    assert.equal(patch.smtp_port, '587');
    assert.equal(typeof patch.uri_allow_list, 'string');
    assert.equal(patch.uri_allow_list, [
      'https://hmjg.netlify.app',
      'https://hmjg.netlify.app/candidates.html?candidate_auth=verified',
      'https://hmjg.netlify.app/candidates.html?candidate_action=recovery',
      'https://hmjg.netlify.app/candidates.html',
    ].join(','));
  } finally {
    restore();
  }
});
