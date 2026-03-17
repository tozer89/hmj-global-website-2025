const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../netlify/functions/_team-task-email.js');
const settingsPath = require.resolve('../netlify/functions/_settings-helpers.js');
const mailPath = require.resolve('../netlify/functions/_mail-delivery.js');

function withMockedModule(moduleId, exportsValue) {
  const original = require.cache[moduleId];
  require.cache[moduleId] = {
    id: moduleId,
    filename: moduleId,
    loaded: true,
    exports: exportsValue,
  };
  return () => {
    if (original) require.cache[moduleId] = original;
    else delete require.cache[moduleId];
  };
}

test('resolveTeamTaskEmailConfig uses candidate SMTP settings and reports readiness', async () => {
  const restoreSettings = withMockedModule(settingsPath, {
    fetchSettings: async () => ({
      settings: {
        candidate_email_settings: {
          customSmtpEnabled: true,
          smtpHost: 'smtp.office365.com',
          smtpPort: 587,
          smtpEncryption: 'starttls',
          smtpUser: 'info@hmj-global.com',
          smtpPassword: 'smtp-secret',
          senderEmail: 'info@hmj-global.com',
          senderName: 'HMJ Global',
          supportEmail: 'info@hmj-global.com',
        },
      },
    }),
  });
  const restoreMail = withMockedModule(mailPath, {
    probeResendProvider: async () => ({ configured: false, ready: false, status: 'missing', message: 'RESEND_API_KEY is not configured.' }),
    probeSmtpProvider: async () => ({ configured: true, ready: true, status: 'ready', message: 'SMTP credentials accepted.' }),
    sendTransactionalEmail: async () => ({ provider: 'smtp', id: 'smtp-1' }),
  });
  delete require.cache[modulePath];
  const mod = require(modulePath);

  const result = await mod.resolveTeamTaskEmailConfig({});

  assert.equal(result.ready, true);
  assert.equal(result.preferredProvider, 'smtp');
  assert.equal(result.senderEmail, 'info@hmj-global.com');
  assert.match(result.message, /Team Tasks emails will send/);

  restoreSettings();
  restoreMail();
  delete require.cache[modulePath];
});

test('sendTeamTaskEmail passes sender details and smtp settings into transactional delivery', async () => {
  let captured = null;
  const restoreSettings = withMockedModule(settingsPath, {
    fetchSettings: async () => ({
      settings: {
        candidate_email_settings: {
          customSmtpEnabled: true,
          smtpHost: 'smtp.office365.com',
          smtpPort: 587,
          smtpEncryption: 'starttls',
          smtpUser: 'info@hmj-global.com',
          smtpPassword: 'smtp-secret',
          senderEmail: 'info@hmj-global.com',
          senderName: 'HMJ Global',
          supportEmail: 'info@hmj-global.com',
        },
      },
    }),
  });
  const restoreMail = withMockedModule(mailPath, {
    probeResendProvider: async () => ({ configured: false, ready: false, status: 'missing', message: 'RESEND_API_KEY is not configured.' }),
    probeSmtpProvider: async () => ({ configured: true, ready: true, status: 'ready', message: 'SMTP credentials accepted.' }),
    sendTransactionalEmail: async (payload) => {
      captured = payload;
      return { provider: 'smtp', id: 'smtp-2' };
    },
  });
  delete require.cache[modulePath];
  const mod = require(modulePath);

  const result = await mod.sendTeamTaskEmail({
    event: {},
    toEmail: 'nick@hmj-global.com',
    subject: 'Task assigned',
    text: 'Hello',
    html: '<p>Hello</p>',
  });

  assert.equal(result.delivery.provider, 'smtp');
  assert.equal(captured.fromEmail, 'info@hmj-global.com');
  assert.equal(captured.fromName, 'HMJ Global');
  assert.equal(captured.smtpSettings.smtpHost, 'smtp.office365.com');

  restoreSettings();
  restoreMail();
  delete require.cache[modulePath];
});
