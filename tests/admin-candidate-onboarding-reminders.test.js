const test = require('node:test');
const assert = require('node:assert/strict');

const reminders = require('../netlify/functions/admin-candidate-onboarding-reminders.js');

test('general onboarding reminder copy covers the broader onboarding follow-up path', () => {
  const message = reminders.buildReminderContent(
    {
      senderName: 'HMJ Global',
      senderEmail: 'info@hmj-global.com',
      supportEmail: 'info@hmj-global.com',
    },
    'Ava',
    'https://www.hmj-global.com/candidates.html?candidate_onboarding=1',
    ['right_to_work', 'bank_document'],
    { requestType: 'general', linkType: 'magiclink' },
  );

  assert.match(message.subject, /complete your HMJ onboarding/i);
  assert.match(message.html, /still needs a few onboarding details/i);
  assert.match(message.html, /secure HMJ access button/i);
});

test('verification complete copy confirms HMJ has finished the latest check', () => {
  const message = reminders.buildReminderContent(
    {
      senderName: 'HMJ Global',
      senderEmail: 'info@hmj-global.com',
      supportEmail: 'info@hmj-global.com',
    },
    'Ava',
    'https://www.hmj-global.com/candidates.html?candidate_onboarding=1',
    [],
    { requestType: 'verification_complete', linkType: 'magiclink' },
  );

  assert.match(message.subject, /verification is complete/i);
  assert.match(message.html, /latest onboarding documents have been reviewed/i);
  assert.match(message.html, /If we need anything else, we will contact you directly/i);
});
