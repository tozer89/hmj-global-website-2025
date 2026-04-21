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
  assert.match(html, /Onboarding/);
});

test('onboarding page uses the shared admin bootstrap and expected operational fields', () => {
  const html = read('admin/send-intro-email.html');

  assert.match(html, /identity-loader\.js\?v=3/);
  assert.match(html, /\/admin\/common\.js\?v=36/);
  assert.match(html, /onboarding-email-copy\.js\?v=1/);
  assert.match(html, /id="introFirstName"/);
  assert.match(html, /id="introLastName"/);
  assert.match(html, /id="introEmail"/);
  assert.match(html, /id="introClientCompany"/);
  assert.match(html, /id="introProjectLocation"/);
  assert.match(html, /id="introPhone"/);
  assert.match(html, /id="introJobTitle"/);
  assert.match(html, /id="confirmationLanguage"/);
  assert.match(html, /id="confirmationSubject"/);
  assert.match(html, /id="confirmationHeading"/);
  assert.match(html, /id="confirmationBody"/);
  assert.match(html, /id="onboardingStatus"/);
  assert.match(html, /id="sendConfirmationSubmit"/);
  assert.match(html, /send-intro-email\.js\?v=5/);
});

test('onboarding page reuses candidate email diagnostics and the dedicated send endpoint', () => {
  const source = read('admin/send-intro-email.js');

  assert.match(source, /admin-candidate-email-settings/);
  assert.match(source, /admin-send-intro-email/);
  assert.match(source, /publicDeliveryReady/);
  assert.match(source, /state\.sendingIntro/);
  assert.match(source, /state\.sendingConfirmation/);
  assert.match(source, /HMJOnboardingEmailCopy/);
  assert.match(source, /confirmationLanguage/);
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
    projectLocation: '',
    phone: '+44 7700 900123',
    jobTitle: 'Senior Planner',
    subject: '',
    heading: '',
    body: '',
    language: 'en',
    emailType: 'intro',
  });

  const message = mod.buildIntroEmailMessage({
    siteUrl: 'https://hmjg.netlify.app/',
    senderName: 'HMJ Global',
    senderEmail: 'info@hmj-global.com',
    supportEmail: 'info@hmj-global.com',
    footerTagline: 'Specialist recruitment for technical projects.',
  }, payload);

  assert.equal(message.subject, 'Welcome to HMJ Global – next steps for your new assignment');
  assert.match(message.registrationUrl, /^https:\/\/hmjg\.netlify\.app\/candidates\?/);
  assert.match(message.registrationUrl, /path=starter/);
  assert.equal(message.timesheetsUrl, 'https://hmjglobal.timesheetportal.com/Dashboard/');
  assert.match(message.html, /Start HMJ new starter registration/);
  assert.match(message.html, /Open HMJ timesheets \/ portal access/);
  assert.match(message.html, /ACME Pharma/);
  assert.match(message.html, /Senior Planner/);
  assert.match(message.html, /new starter route selected for you/i);
  assert.match(message.html, /Open HMJ new starter registration/);
  assert.match(message.html, /background:#173779/);
});

test('onboarding confirmation builder renders editable HMJ onboarding copy with the Monday release wording', () => {
  const mod = require('../netlify/functions/admin-send-intro-email.js');

  const payload = mod.normaliseIntroEmailRequest({
    email_type: 'confirmation',
    first_name: 'Ava',
    last_name: 'Miles',
    email: 'ava@example.com',
    company: 'SA3 Group',
    project_location: 'Media City',
  });

  assert.equal(payload.emailType, 'confirmation');
  assert.equal(payload.projectLocation, 'Media City');
  assert.equal(payload.language, 'en');

  const message = mod.buildOnboardingConfirmationMessage({
    siteUrl: 'https://hmjg.netlify.app/',
    senderName: 'HMJ Global',
    senderEmail: 'info@hmj-global.com',
    supportEmail: 'info@hmj-global.com',
  }, payload, {
    timesheetsUrl: 'https://hmjglobal.timesheetportal.com/Dashboard/',
  });

  assert.equal(message.subject, 'Welcome to HMJ Global - your onboarding details for SA3 Group');
  assert.equal(message.timesheetsUrl, 'https://hmjglobal.timesheetportal.com/Dashboard/');
  assert.match(message.html, /SA3 Group on Media City/);
  assert.match(message.html, /payment and support details/i);
  assert.doesNotMatch(message.html, /payment, contract, and support details/i);
  assert.match(message.html, /released in the early hours of Monday/i);
  assert.match(message.html, /working week ahead/i);
  assert.match(message.html, /following Wednesday/i);
  assert.match(message.html, /<strong>1\. Timesheet Portal - Login Check \(Important\)<\/strong>/);
  assert.match(message.html, /<ul style=/);
  assert.match(message.html, /Open HMJ timesheets \/ portal access/);
  assert.match(message.html, /Keep this onboarding summary for reference/i);
});

test('onboarding confirmation builder can switch to a translated language template', () => {
  const mod = require('../netlify/functions/admin-send-intro-email.js');

  const payload = mod.normaliseIntroEmailRequest({
    email_type: 'confirmation',
    language: 'de',
    first_name: 'Ava',
    last_name: 'Miles',
    email: 'ava@example.com',
    company: 'SA3 Group',
    project_location: 'Frankfurt',
  });

  const message = mod.buildOnboardingConfirmationMessage({
    siteUrl: 'https://hmjg.netlify.app/',
    senderName: 'HMJ Global',
    senderEmail: 'info@hmj-global.com',
    supportEmail: 'info@hmj-global.com',
  }, payload, {
    timesheetsUrl: 'https://hmjglobal.timesheetportal.com/Dashboard/',
  });

  assert.equal(payload.language, 'de');
  assert.equal(message.language, 'de');
  assert.match(message.subject, /Willkommen bei HMJ Global/);
  assert.match(message.html, /Zeiterfassung/);
  assert.match(message.html, /Login-Prufung|Login-Prüfung/);
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

test('send intro email builder can switch to a secure onboarding access link for existing candidates', () => {
  const mod = require('../netlify/functions/admin-send-intro-email.js');

  const payload = mod.normaliseIntroEmailRequest({
    first_name: 'Joseph',
    last_name: 'Tozer',
    email: 'tozer89@gmail.com',
    company: 'SA3',
    job_title: 'Electrician',
  });

  const message = mod.buildIntroEmailMessage({
    siteUrl: 'https://hmjg.netlify.app/',
    senderName: 'HMJ Global',
    senderEmail: 'info@hmj-global.com',
    supportEmail: 'info@hmj-global.com',
  }, payload, {
    registrationUrl: 'https://mftwpbpwisxyaenfoizb.supabase.co/auth/v1/verify?token=abc',
    accessLinkType: 'invite',
    secureAccess: true,
  });

  assert.equal(message.registrationUrl, 'https://mftwpbpwisxyaenfoizb.supabase.co/auth/v1/verify?token=abc');
  assert.equal(message.accessLinkType, 'invite');
  assert.match(message.html, /Open secure HMJ account and onboarding/);
  assert.match(message.html, /finish opening your candidate account/i);
  assert.match(message.html, /Use the HMJ buttons below/i);
  assert.match(message.html, /Open secure HMJ access/);
});

test('send intro email backend keeps intro sends inside the broader onboarding workflow', () => {
  const source = read('netlify/functions/admin-send-intro-email.js');

  assert.match(source, /onboarding_status:\s*'new'/);
  assert.match(source, /onboarding_status_updated_at/);
  assert.match(source, /onboarding_status_updated_by/);
  assert.match(source, /const activityType = request\.isReminder \? 'intro_reminder_sent' : 'intro_email_sent';/);
  assert.match(source, /onboarding_confirmation_sent/);
  assert.match(source, /generateCandidateAccessLink/);
  assert.match(source, /access_link_type/);
  assert.match(source, /provisional_created/);
});
