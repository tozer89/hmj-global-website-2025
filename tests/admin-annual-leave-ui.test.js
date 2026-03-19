'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

test('admin dashboard exposes the Annual Leave quick access tile', () => {
  const html = read('admin/index.html');
  assert.match(html, /Annual Leave/);
  assert.match(html, /Manage team leave, calendar visibility, reminders, and annual summaries/i);
  assert.match(html, /href="\/admin\/annual-leave\.html"/);
});

test('annual leave page exposes booking, calendar, analytics, and detail controls', () => {
  const html = read('admin/annual-leave.html');
  assert.match(html, /Annual Leave/);
  assert.match(html, /id="leaveBookingForm"/);
  assert.match(html, /id="ownerControlsPanel"/);
  assert.match(html, /id="ownerEntitlementsBody"/);
  assert.match(html, /id="bookingUser"/);
  assert.match(html, /id="calendarGrid"/);
  assert.match(html, /id="bookingTableBody"/);
  assert.match(html, /id="monthDistributionChart"/);
  assert.match(html, /id="peopleOffThisWeekList"/);
  assert.match(html, /id="overlapWarningsList"/);
  assert.match(html, /id="detailDrawer"/);
  assert.match(html, /id="btnDeleteDetail"/);
  assert.match(html, /admin\.annual-leave\.css\?v=\d+/);
  assert.match(html, /annual-leave\.js\?v=\d+/);
});

test('annual leave route is protected and reminder runner is scheduled', () => {
  const netlify = read('netlify.toml');
  assert.match(netlify, /\[functions\."admin-annual-leave-reminders-run"\][\s\S]*schedule = "@hourly"/);
  assert.match(netlify, /from = "\/admin\/annual-leave\.html"[\s\S]*conditions = \{ Role = \["admin", "owner"\] \}/);
  assert.match(netlify, /to = "\/admin\/\?next=annual-leave\.html"/);
});

test('annual leave frontend calls the expected secure backend endpoints', () => {
  const source = read('admin/annual-leave.js');
  assert.match(source, /admin-annual-leave-admin-users/);
  assert.match(source, /admin-annual-leave-list/);
  assert.match(source, /admin-annual-leave-create/);
  assert.match(source, /admin-annual-leave-update/);
  assert.match(source, /admin-annual-leave-cancel/);
  assert.match(source, /admin-annual-leave-delete/);
  assert.match(source, /admin-annual-leave-settings-save/);
});
