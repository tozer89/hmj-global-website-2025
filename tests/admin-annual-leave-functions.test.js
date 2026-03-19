'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

[
  'netlify/functions/admin-annual-leave-list.js',
  'netlify/functions/admin-annual-leave-create.js',
  'netlify/functions/admin-annual-leave-update.js',
  'netlify/functions/admin-annual-leave-cancel.js',
  'netlify/functions/admin-annual-leave-admin-users.js',
  'netlify/functions/admin-annual-leave-bank-holidays.js',
].forEach((file) => {
  test(`${path.basename(file)} enforces server-side admin auth`, () => {
    const source = read(file);
    assert.match(source, /withAdminCors/);
    assert.match(source, /getContext\(event, context, \{ requireAdmin: true \}\)/);
  });
});

test('annual leave reminders run through the shared HMJ email wrapper and cron secret guard', () => {
  const source = read('netlify/functions/admin-annual-leave-reminders-run.js');
  assert.match(source, /ANNUAL_LEAVE_CRON_SECRET/);
  assert.match(source, /readCandidateEmailSettings/);
  assert.match(source, /buildEmailTemplate/);
  assert.match(source, /sendTransactionalEmail/);
});

test('annual leave helper uses GOV.UK bank holidays and admin user merge helpers', () => {
  const source = read('netlify/functions/_annual-leave.js');
  assert.match(source, /https:\/\/www\.gov\.uk\/bank-holidays\.json/);
  assert.match(source, /fetchNetlifyIdentityUsers/);
  assert.match(source, /buildAssignableAdminMembers/);
  assert.match(source, /annual_leave_settings/);
});
