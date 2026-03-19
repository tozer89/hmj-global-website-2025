'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateLeaveBreakdown,
  normaliseBookingRow,
  reminderDue,
  resolveSevenDayReminderDate,
  previousWorkingDay,
  summariseBookings,
} = require('../netlify/functions/_annual-leave.js');

const HOLIDAYS_2026 = [
  { date: '2026-01-01', title: 'New Year' },
  { date: '2026-04-03', title: 'Good Friday' },
  { date: '2026-04-06', title: 'Easter Monday' },
  { date: '2026-05-25', title: 'Spring bank holiday' },
  { date: '2026-08-31', title: 'Summer bank holiday' },
  { date: '2026-12-25', title: 'Christmas Day' },
  { date: '2026-12-28', title: 'Boxing Day substitute day' },
];

test('annual leave breakdown excludes weekends and bank holidays from effective leave', () => {
  const breakdown = calculateLeaveBreakdown({
    startDate: '2026-05-22',
    endDate: '2026-05-27',
    durationMode: 'full_day',
  }, HOLIDAYS_2026);

  assert.equal(breakdown.calendarDays, 6);
  assert.equal(breakdown.workingDaysCount, 3);
  assert.equal(breakdown.excludedWeekendDaysCount, 2);
  assert.equal(breakdown.bankHolidaysCount, 1);
  assert.equal(breakdown.effectiveLeaveDays, 3);
});

test('half-day leave produces 0.5 effective days on a working day', () => {
  const breakdown = calculateLeaveBreakdown({
    startDate: '2026-03-18',
    endDate: '2026-03-18',
    durationMode: 'half_day_am',
  }, HOLIDAYS_2026);

  assert.equal(breakdown.workingDaysCount, 1);
  assert.equal(breakdown.effectiveLeaveDays, 0.5);
});

test('annual leave summary reports monthly totals, people off, and overlaps', () => {
  const bookings = [
    normaliseBookingRow({
      id: 'one',
      user_id: 'u1',
      user_email: 'one@example.com',
      user_name: 'One',
      leave_year: 2026,
      start_date: '2026-03-18',
      end_date: '2026-03-20',
      duration_mode: 'full_day',
      leave_type: 'annual_leave',
      status: 'booked',
      created_at: '2026-03-01T09:00:00Z',
      updated_at: '2026-03-01T09:00:00Z',
    }, HOLIDAYS_2026),
    normaliseBookingRow({
      id: 'two',
      user_id: 'u2',
      user_email: 'two@example.com',
      user_name: 'Two',
      leave_year: 2026,
      start_date: '2026-03-20',
      end_date: '2026-03-20',
      duration_mode: 'half_day_pm',
      leave_type: 'annual_leave',
      status: 'booked',
      created_at: '2026-03-02T09:00:00Z',
      updated_at: '2026-03-02T09:00:00Z',
    }, HOLIDAYS_2026),
  ];

  const summary = summariseBookings(bookings, HOLIDAYS_2026, {
    year: 2026,
    now: new Date('2026-03-19T08:00:00Z'),
    overlapThreshold: 2,
    members: [
      { userId: 'u1', email: 'one@example.com', displayName: 'One', role: 'admin' },
      { userId: 'u2', email: 'two@example.com', displayName: 'Two', role: 'owner' },
    ],
    settings: {
      defaultEntitlementDays: 28,
      entitlementOverrides: {
        'two@example.com': 30,
      },
    },
  });

  assert.equal(summary.totalEffectiveDays, 3.5);
  assert.equal(summary.peopleOffToday.length, 1);
  assert.equal(summary.monthly.find((row) => row.key === '2026-03').effectiveDays, 3.5);
  assert.equal(summary.overlaps.length, 1);
  assert.equal(summary.overlaps[0].date, '2026-03-20');
  assert.equal(summary.perPerson.find((row) => row.userId === 'u1').remainingLeaveDays, 25);
  assert.equal(summary.perPerson.find((row) => row.userId === 'u2').entitlementDays, 30);
});

test('reminder dates honour seven-day and one-working-day calculations', () => {
  assert.equal(resolveSevenDayReminderDate('2026-05-25', HOLIDAYS_2026), '2026-05-18');
  assert.equal(previousWorkingDay('2026-05-26', HOLIDAYS_2026), '2026-05-22');

  const booking = normaliseBookingRow({
    id: 'reminder',
    user_id: 'u3',
    user_email: 'three@example.com',
    user_name: 'Three',
    leave_year: 2026,
    start_date: '2026-05-26',
    end_date: '2026-05-27',
    duration_mode: 'full_day',
    leave_type: 'annual_leave',
    status: 'booked',
  }, HOLIDAYS_2026);

  assert.equal(reminderDue(booking, '2026-05-18', HOLIDAYS_2026, '7d'), false);
  assert.equal(reminderDue(booking, '2026-05-19', HOLIDAYS_2026, '7d'), true);
  assert.equal(reminderDue(booking, '2026-05-22', HOLIDAYS_2026, '1wd'), true);
});
