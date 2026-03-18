const test = require('node:test');
const assert = require('node:assert/strict');

test('bulk candidate email backend normalises recipient and template payload', () => {
  const mod = require('../netlify/functions/admin-candidate-bulk-email.js');

  const payload = mod.normaliseBulkEmailRequest({
    candidate_id: ' 123 ',
    recipient: {
      first_name: ' Ava ',
      last_name: ' Miles ',
      full_name: ' Ava Miles ',
      email: ' Ava.Miles@Example.com ',
      reference: ' 5449 ',
      client_name: ' ACME Pharma ',
      job_title: ' Senior Planner ',
    },
    template: {
      subject: ' HMJ update for <FIRST_NAME> ',
      heading: ' A quick HMJ check-in ',
      body: 'Hi <FIRST_NAME>,\n\nPlease review your profile.',
      fallback_client_name: ' HMJ client ',
      fallback_job_title: ' Planner ',
      primary_action: ' portal_access ',
      include_timesheets_button: 'true',
    },
  });

  assert.equal(payload.candidateId, '123');
  assert.equal(payload.recipient.firstName, 'Ava');
  assert.equal(payload.recipient.lastName, 'Miles');
  assert.equal(payload.recipient.email, 'ava.miles@example.com');
  assert.equal(payload.recipient.reference, '5449');
  assert.equal(payload.template.subject, 'HMJ update for <FIRST_NAME>');
  assert.equal(payload.template.heading, 'A quick HMJ check-in');
  assert.equal(payload.template.primaryAction, 'portal_access');
  assert.equal(payload.template.includeTimesheetsButton, true);
});

test('bulk candidate email merge renderer supports bullhorn-style and mustache tokens', () => {
  const mod = require('../netlify/functions/admin-candidate-bulk-email.js');

  const rendered = mod.renderMergeTokens(
    'Hi <FIRST NAME>, {{client_name}} needs a <JOB_TITLE> update for <REFERENCE>.',
    {
      first_name: 'Ava',
      client_name: 'ACME Pharma',
      job_title: 'Senior Planner',
      reference: '5449',
    },
  );

  assert.equal(rendered, 'Hi Ava, ACME Pharma needs a Senior Planner update for 5449.');
});

test('bulk candidate email builder creates branded HMJ HTML with button labels instead of raw system URLs', () => {
  const mod = require('../netlify/functions/admin-candidate-bulk-email.js');

  const message = mod.buildBulkEmailMessage({
    siteUrl: 'https://hmjg.netlify.app/',
    senderName: 'HMJ Global',
    senderEmail: 'info@hmj-global.com',
    supportEmail: 'info@hmj-global.com',
    footerTagline: 'Specialist recruitment for technical projects.',
  }, {
    recipient: {
      firstName: 'Ava',
      lastName: 'Miles',
      fullName: 'Ava Miles',
      email: 'ava@example.com',
      reference: '5449',
      clientName: 'ACME Pharma',
      jobTitle: 'Senior Planner',
    },
    template: {
      subject: 'HMJ update for <FIRST_NAME>',
      heading: 'Update for <CLIENT_NAME>',
      body: 'Hi <FIRST_NAME>,\n\nPlease review your HMJ profile for <CLIENT_NAME>.',
      primaryAction: 'documents_upload',
      includeTimesheetsButton: true,
      fallbackClientName: '',
      fallbackJobTitle: '',
    },
  }, {
    primaryActionUrl: 'https://mftwpbpwisxyaenfoizb.supabase.co/auth/v1/verify?token=abc',
    timesheetsUrl: 'https://hmjg.netlify.app/timesheets.html',
  });

  assert.equal(message.subject, 'HMJ update for Ava');
  assert.match(message.html, /Update for ACME Pharma/);
  assert.match(message.html, /Hi Ava,/);
  assert.match(message.html, /Open HMJ documents/);
  assert.match(message.html, /Open HMJ timesheets \/ portal access/);
  assert.match(message.html, /Use the HMJ buttons below rather than saving raw system URLs/);
  assert.match(message.html, /background:#173779/);
});

test('bulk candidate email validation requires a usable recipient and message template', () => {
  const mod = require('../netlify/functions/admin-candidate-bulk-email.js');

  assert.throws(() => mod.validateBulkEmailRequest({
    recipient: { email: 'invalid' },
    template: { subject: '', heading: '', body: '', primaryAction: 'bad' },
  }), /valid recipient email address|Email subject is required/);
});
