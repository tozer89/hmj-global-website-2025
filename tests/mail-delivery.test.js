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
    sendMail: async () => ({ messageId: 'smtp-message-id', accepted: ['candidate@example.com'], rejected: [], pending: [] }),
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
    assert.deepEqual(result.accepted, ['candidate@example.com']);
    assert.deepEqual(result.rejected, []);
  } finally {
    global.fetch = originalFetch;
    nodemailer.createTransport = originalCreateTransport;
    restore();
  }
});

test('probeSmtpProvider reports invalid SMTP credentials clearly', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    verify: async () => {
      const error = new Error('Invalid login');
      error.code = 'EAUTH';
      error.responseCode = 535;
      throw error;
    },
  });

  const { mod, restore } = loadModule({});

  try {
    const result = await mod.probeSmtpProvider({
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      smtpEncryption: 'starttls',
      smtpUser: 'info@hmj-global.com',
      smtpPassword: 'bad-secret',
    });

    assert.equal(result.provider, 'smtp');
    assert.equal(result.ready, false);
    assert.equal(result.status, 'invalid_credentials');
    assert.match(result.message, /rejected by Microsoft 365/i);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    restore();
  }
});

test('sendTransactionalEmail strips header line breaks before SMTP delivery', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  let captured = null;
  nodemailer.createTransport = () => ({
    sendMail: async (payload) => {
      captured = payload;
      return { messageId: 'smtp-header-test', accepted: ['candidate@example.com'], rejected: [], pending: [] };
    },
  });

  const { mod, restore } = loadModule({});

  try {
    const result = await mod.sendTransactionalEmail({
      toEmail: 'candidate@example.com',
      fromEmail: 'info@hmj-global.com',
      fromName: 'HMJ Global\r\nBCC: hidden@example.com',
      replyTo: 'reply@hmj-global.com',
      subject: 'Welcome\r\nBCC: hidden@example.com',
      html: '<p>Welcome</p>',
      smtpSettings: {
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        smtpEncryption: 'starttls',
        smtpUser: 'info@hmj-global.com',
        smtpPassword: 'smtp-secret',
      },
    });

    assert.equal(result.provider, 'smtp');
    assert.equal(captured.from, '"HMJ Global BCC: hidden@example.com" <info@hmj-global.com>');
    assert.equal(captured.subject, 'Welcome BCC: hidden@example.com');
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    restore();
  }
});

test('sendTransactionalEmail rejects invalid email addresses after sanitisation', async () => {
  const { mod, restore } = loadModule({});

  try {
    await assert.rejects(
      () => mod.sendTransactionalEmail({
        toEmail: 'candidate@example.com\r\nbcc: hidden@example.com',
        fromEmail: 'info@hmj-global.com',
        fromName: 'HMJ Global',
        subject: 'Invalid recipient',
        html: '<p>Test</p>',
        smtpSettings: {
          smtpHost: 'smtp.office365.com',
          smtpPort: 587,
          smtpEncryption: 'starttls',
          smtpUser: 'info@hmj-global.com',
          smtpPassword: 'smtp-secret',
        },
      }),
      /Email message is incomplete\./
    );
  } finally {
    restore();
  }
});
