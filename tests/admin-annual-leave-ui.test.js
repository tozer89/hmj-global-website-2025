'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

function buildHarnessHtml() {
  return read('admin/annual-leave.html')
    .replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>\s*/g, '');
}

async function settle(window, passes = 10) {
  for (let index = 0; index < passes; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
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
  assert.match(html, /class="finance-muted why">Checking your session/i);
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
  assert.match(source, /Authorization/);
  assert.match(source, /helpers\.identity/);
});

test('annual leave bootstrap forwards the live admin bearer token on secure data requests', async () => {
  const requests = [];
  const dom = new JSDOM(buildHarnessHtml(), {
    url: 'https://example.com/admin/annual-leave.html',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.console = console;
      window.scrollTo = () => {};
      window.confirm = () => true;
      window.matchMedia = () => ({
        matches: false,
        media: '',
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
      window.Admin = {
        bootAdmin: async (mainFn) => mainFn({
          identity: async () => ({
            ok: true,
            email: 'admin@hmj-global.com',
            roles: ['admin'],
            token: 'test-admin-token',
          }),
          toast: () => {},
        }),
      };
      window.fetch = async (resource, options = {}) => {
        requests.push({
          url: String(resource || ''),
          headers: { ...(options.headers || {}) },
        });
        if (String(resource).includes('admin-annual-leave-admin-users')) {
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                ok: true,
                rows: [
                  {
                    userId: 'user-1',
                    email: 'admin@hmj-global.com',
                    displayName: 'Admin User',
                    role: 'admin',
                    roles: ['admin'],
                    isOwner: false,
                  },
                ],
              };
            },
          };
        }
        if (String(resource).includes('admin-annual-leave-list')) {
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                ok: true,
                viewer: {
                  email: 'admin@hmj-global.com',
                  roles: ['admin'],
                  isOwner: false,
                },
                settings: {
                  remindersEnabled: true,
                  defaultEntitlementDays: 28,
                  overlapWarningThreshold: 2,
                  reminderRunHourLocal: 8,
                },
                region: 'england-and-wales',
                holidays: [],
                holidayWarning: '',
                adminUsers: [
                  {
                    userId: 'user-1',
                    email: 'admin@hmj-global.com',
                    displayName: 'Admin User',
                    role: 'admin',
                    roles: ['admin'],
                    isOwner: false,
                  },
                ],
                rows: [],
                summary: {
                  leaveYear: { label: '2026' },
                  totalEffectiveDays: 0,
                  bookingsCount: 0,
                  upcoming30Bookings: 0,
                  upcoming30EffectiveDays: 0,
                  peopleOffThisWeek: [],
                  peopleOffToday: [],
                  peopleOffNextWeek: [],
                  bankHolidaysRemaining: 0,
                  monthly: [],
                  busiestMonths: [],
                  perPerson: [],
                  overlaps: [],
                  remainingBankHolidays: [],
                  recent: [],
                  alerts: [],
                },
              };
            },
          };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return {};
          },
        };
      };
    },
  });

  dom.window.eval(read('admin/annual-leave.js'));
  await settle(dom.window, 16);

  const annualRequests = requests.filter((entry) => entry.url.includes('admin-annual-leave-'));
  assert.equal(annualRequests.length >= 2, true);
  annualRequests.forEach((entry) => {
    assert.equal(entry.headers.Authorization, 'Bearer test-admin-token');
  });
});
