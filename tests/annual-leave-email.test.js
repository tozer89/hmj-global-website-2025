'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAnnualLeaveEmailMessage } = require('../netlify/functions/_annual-leave-email.js');

test('annual leave email message includes booked and remaining balance summary', () => {
  const message = buildAnnualLeaveEmailMessage({
    senderName: 'HMJ Global',
    senderEmail: 'info@hmj-global.com',
    supportEmail: 'info@hmj-global.com',
    footerTagline: 'HMJ',
  }, {
    userName: 'Joe Tozer-O\'Sullivan',
    userEmail: 'joe@hmj-global.com',
    startDate: '2026-04-10',
    endDate: '2026-04-15',
    effectiveLeaveDays: 4,
    leaveType: 'annual_leave',
    statusLabel: 'Booked',
    note: 'Family holiday',
  }, {
    bookedDays: 9,
    entitlementDays: 28,
    remainingDays: 19,
  }, {
    type: 'booked',
    actorEmail: 'joe@hmj-global.com',
  });

  assert.match(message.subject, /Annual leave booked:/);
  assert.match(message.html, /Current year balance:/);
  assert.match(message.html, />9<\/strong> booked/);
  assert.match(message.html, />28<\/strong> entitlement/);
  assert.match(message.html, />19<\/strong> remaining/);
  assert.match(message.html, /Family holiday/);
});
