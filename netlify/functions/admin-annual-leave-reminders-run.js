'use strict';

const { getSupabase } = require('./_supabase.js');
const { sendAnnualLeaveNotifications } = require('./_annual-leave-email.js');
const {
  BOOKING_STATUS,
  asIsoDate,
  getBankHolidays,
  isBookingActive,
  normaliseBookingRow,
  readAnnualLeaveSettings,
  reminderDue,
  trimString,
} = require('./_annual-leave.js');

function header(event, name) {
  const headers = event?.headers || {};
  if (headers[name]) return headers[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return '';
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function isScheduledInvocation(event) {
  const signal = String(
    header(event, 'x-netlify-event')
      || header(event, 'x-nf-event')
      || ''
  ).toLowerCase();
  return signal.includes('schedule');
}

function isAuthorisedManualInvocation(event) {
  const expected = trimString(process.env.ANNUAL_LEAVE_CRON_SECRET, 320);
  if (!expected) return false;
  const provided = trimString(
    header(event, 'x-hmj-cron-secret')
      || event?.queryStringParameters?.secret
      || '',
    320
  );
  return !!provided && provided === expected;
}

function londonClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now);

  const map = Object.create(null);
  parts.forEach((part) => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });

  return {
    isoDate: `${map.year}-${map.month}-${map.day}`,
    weekday: map.weekday || '',
    hour: Number.parseInt(map.hour || '0', 10) || 0,
    isWeekend: ['Sat', 'Sun'].includes(map.weekday || ''),
  };
}

async function loadReminderCandidates(event, supabase, todayIso) {
  const endIso = (() => {
    const date = new Date(`${todayIso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 30);
    return asIsoDate(date);
  })();
  const { data, error } = await supabase
    .from('annual_leave_bookings')
    .select('*')
    .eq('status', BOOKING_STATUS.BOOKED)
    .gte('start_date', todayIso)
    .lte('start_date', endIso)
    .order('start_date', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function markReminderSent(supabase, bookingId, reminderType) {
  const column = reminderType === '1wd' ? 'reminder_1wd_sent_at' : 'reminder_7d_sent_at';
  const { error } = await supabase
    .from('annual_leave_bookings')
    .update({ [column]: new Date().toISOString() })
    .eq('id', bookingId);
  if (error) throw error;
}

exports.handler = async (event = {}, context = {}) => {
  const scheduled = isScheduledInvocation(event);
  const authorised = scheduled || isAuthorisedManualInvocation(event);
  if (!authorised) {
    return json(403, {
      ok: false,
      code: 'forbidden',
      message: 'Annual leave reminder runner requires a scheduled invocation or cron secret.',
    });
  }

  try {
    const settings = await readAnnualLeaveSettings(event);
    const clock = londonClock(new Date());
    if (scheduled) {
      if (!settings.remindersEnabled) {
        return json(200, { ok: true, skipped: true, reason: 'reminders_disabled' });
      }
      if (clock.isWeekend || clock.hour !== settings.reminderRunHourLocal) {
        return json(200, {
          ok: true,
          skipped: true,
          reason: 'outside_schedule_window',
          clock,
        });
      }
    }

    const supabase = getSupabase(event);
    const rawBookings = await loadReminderCandidates(event, supabase, clock.isoDate);
    const years = Array.from(new Set(rawBookings.map((row) => Number.parseInt(String(row.leave_year || ''), 10)).filter((value) => Number.isInteger(value))));
    const holidayBundle = await getBankHolidays(event, {
      supabase,
      region: settings.defaultRegion,
      years,
      settings,
    });
    const bookings = rawBookings.map((row) => normaliseBookingRow(row, holidayBundle.allHolidays || holidayBundle.holidays || []));

    const summary = {
      ok: true,
      processed: 0,
      sent: 0,
      failed: 0,
      bookings: [],
    };

    for (const booking of bookings.filter(isBookingActive)) {
      const reminderTypes = [];
      if (reminderDue(booking, clock.isoDate, holidayBundle.allHolidays || holidayBundle.holidays || [], '7d')) reminderTypes.push('7d');
      if (reminderDue(booking, clock.isoDate, holidayBundle.allHolidays || holidayBundle.holidays || [], '1wd')) reminderTypes.push('1wd');
      if (!reminderTypes.length) continue;

      for (const reminderType of reminderTypes) {
        summary.processed += 1;
        const notification = await sendAnnualLeaveNotifications(event, context, {
          supabase,
          booking,
          settings,
          type: reminderType,
          includeIdentity: false,
        });
        summary.sent += Number(notification?.sent || 0);
        summary.failed += Number(notification?.failed || 0);
        summary.bookings.push({
          bookingId: booking.id,
          userName: booking.userName,
          reminderType,
          startDate: booking.startDate,
          sent: Number(notification?.sent || 0),
          warning: notification?.warning || '',
        });

        if (!notification?.failed) {
          await markReminderSent(supabase, booking.id, reminderType);
        }
      }
    }

    return json(200, summary);
  } catch (error) {
    return json(500, {
      ok: false,
      code: error?.code || 'annual_leave_reminders_failed',
      message: error?.message || 'Unable to process annual leave reminders.',
    });
  }
};
