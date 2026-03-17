const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../netlify/functions/_mail-delivery.js');
const nodemailer = require('nodemailer');

function loadModule(env = {}) {
  const originalEnv = {};
  Object.keys(env).forEach((key) => {
    originalEnv[key] = process.env[key];
    process.env[key] = env[key];
  });
  delete require.cache[modulePath];
  const mod = require(modulePath);
  return {
    mod,
    restore() {
      Object.keys(env).forEach((key) => {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
      });
      delete require.cache[modulePath];
    },
  };
}

test('sendTransactionalEmail falls back to SMTP when Resend is configured but rejected', async () => {
  const originalFetch = global.fetch;
  const originalCreateTransport = nodemailer.createTransport;
  global.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ message: 'API key is invalid' }),
  });
  nodemailer.createTransport = () => ({
    sendMail: async () => ({ messageId: 'smtp-message-id' }),
  });

  const { mod, restore } = loadModule({
    RESEND_API_KEY: 're_invalid_key',
  });

  try {
    const result = await mod.sendTransactionalEmail({
      toEmail: 'candidate@example.com',
      fromEmail: 'info@hmj-global.com',
      fromName: 'HMJ Global',
      replyTo: 'info@hmj-global.com',
      subject: 'Fallback test',
      html: '<p>Fallback test</p>',
      smtpSettings: {
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        smtpEncryption: 'starttls',
        smtpUser: 'info@hmj-global.com',
        smtpPassword: 'smtp-secret',
      },
    });

    assert.equal(result.provider, 'smtp');
    assert.equal(result.id, 'smtp-message-id');
  } finally {
    global.fetch = originalFetch;
    nodemailer.createTransport = originalCreateTransport;
    restore();
  }
});
