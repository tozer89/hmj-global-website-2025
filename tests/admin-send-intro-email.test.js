const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('admin dashboard exposes the send intro email module card', () => {
  const html = read('admin/index.html');

  assert.match(html, /send-intro-email\.html/);
  assert.match(html, /Send intro email/);
});

test('send intro email page uses the shared admin bootstrap and expected operational fields', () => {
  const html = read('admin/send-intro-email.html');

  assert.match(html, /identity-loader\.js\?v=3/);
  assert.match(html, /\/admin\/common\.js\?v=34/);
  assert.match(html, /id="introFirstName"/);
  assert.match(html, /id="introLastName"/);
  assert.match(html, /id="introEmail"/);
  assert.match(html, /id="introClientCompany"/);
  assert.match(html, /id="introPhone"/);
  assert.match(html, /id="introJobTitle"/);
  assert.match(html, /id="sendIntroStatus"/);
  assert.match(html, /send-intro-email\.js\?v=1/);
});

test('send intro email page reuses candidate email diagnostics and the dedicated send endpoint', () => {
  const source = read('admin/send-intro-email.js');

  assert.match(source, /admin-candidate-email-settings/);
  assert.match(source, /admin-send-intro-email/);
  assert.match(source, /publicDeliveryReady/);
  assert.match(source, /state\.sending/);
});

test('send intro email backend normalises input and builds branded website links', () => {
  const mod = require('../netlify/functions/admin-send-intro-email.js');

  const payload = mod.normaliseIntroEmailRequest({
    first_name: '  Ava ',
    last_name: ' Miles ',
    email: ' Ava.Miles@Example.com ',
    company: ' ACME Pharma ',
    phone: ' +44 7700 900123 ',
    job_title: ' Senior Planner ',
  });

  assert.deepEqual(payload, {
    firstName: 'Ava',
    lastName: 'Miles',
    email: 'ava.miles@example.com',
    company: 'ACME Pharma',
    phone: '+44 7700 900123',
    jobTitle: 'Senior Planner',
  });

  const message = mod.buildIntroEmailMessage({
    siteUrl: 'https://hmjg.netlify.app/',
    senderName: 'HMJ Global',
    senderEmail: 'info@hmj-global.com',
    supportEmail: 'info@hmj-global.com',
    footerTagline: 'Specialist recruitment for technical projects.',
  }, payload);

  assert.equal(message.subject, 'Welcome to HMJ Global – next steps for your new assignment');
  assert.equal(message.registrationUrl, 'https://hmjg.netlify.app/candidates.html');
  assert.equal(message.timesheetsUrl, 'https://hmjg.netlify.app/timesheets.html');
  assert.match(message.html, /Complete HMJ registration/);
  assert.match(message.html, /Open timesheets \/ portal access/);
  assert.match(message.html, /ACME Pharma/);
  assert.match(message.html, /Senior Planner/);
});

test('send intro email backend validates required starter details', () => {
  const mod = require('../netlify/functions/admin-send-intro-email.js');

  assert.throws(() => mod.validateIntroEmailRequest({
    firstName: 'Ava',
    lastName: 'Miles',
    email: 'ava@example.com',
    company: '',
  }), /Company \/ client is required/);
});
