'use strict';

const { getSupabase } = require('./_supabase.js');
const { readCandidateEmailSettings, buildEmailTemplate } = require('./_candidate-email-settings.js');
const { sendTransactionalEmail } = require('./_mail-delivery.js');
const {
  BOOKING_STATUS,
  asIsoDate,
  getBankHolidays,
  isBookingActive,
  leaveTypeLabel,
  listAdminUsers,
  lowerEmail,
  normaliseBookingRow,
  previousWorkingDay,
  readAnnualLeaveSettings,
  reminderDue,
  resolveSevenDayReminderDate,
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

function currentSiteUrl() {
  return trimString(
    process.env.URL
      || process.env.DEPLOY_PRIME_URL
      || process.env.SITE_URL
      || '',
    500
  ).replace(/\/$/, '');
}

function buildReminderMessage(emailSettings, booking, reminderType, holidays) {
  const adminUrl = `${currentSiteUrl()}/admin/annual-leave.html`;
  const heading = reminderType === '1wd'
    ? `${booking.userName} is off on the next working day`
    : `${booking.userName} has leave coming up in 7 days`;
  const dateRange = booking.startDate === booking.endDate
    ? booking.startDate
    : `${booking.startDate} to ${booking.endDate}`;
  const reminderMeta = reminderType === '1wd'
    ? `1 working day reminder • run date ${previousWorkingDay(booking.startDate, holidays)}`
    : `7 day reminder • run date ${resolveSevenDayReminderDate(booking.startDate, holidays)}`;

  const bodyHtml = `
    <p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">HMJ team reminder.</p>
    <p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7"><strong>${booking.userName}</strong> is booked off from <strong>${dateRange}</strong>.</p>
    <p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">Effective leave booked: <strong>${booking.effectiveLeaveDays}</strong> day${booking.effectiveLeaveDays === 1 ? '' : 's'}.</p>
    <p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">Leave type: <strong>${leaveTypeLabel(booking.leaveType)}</strong>. ${reminderMeta}.</p>
    ${booking.note ? `<p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">Note: ${String(booking.note).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : ''}
    <p style="margin:0;color:#42557f;font-size:15px;line-height:1.7">Use the HMJ Annual Leave workspace to review calendar coverage and any overlap warnings.</p>
  `;

  return {
    subject: reminderType === '1wd'
      ? `Annual leave tomorrow: ${booking.userName}`
      : `Upcoming annual leave: ${booking.userName}`,
    html: buildEmailTemplate(emailSettings, {
      heading,
      intro: 'This is an HMJ Global annual leave reminder for the admin team.',
      actionLabel: 'Open annual leave workspace',
      actionUrl: adminUrl,
      bodyHtml,
      fallbackLinks: [
        { label: 'Open annual leave workspace', url: adminUrl },
      ],
    }),
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
    const emailConfig = await readCandidateEmailSettings(event);
    const senderSettings = emailConfig.settings || {};
    const senderEmail = lowerEmail(senderSettings.senderEmail || senderSettings.supportEmail || 'info@hmj-global.com');
    if (!senderEmail) {
      return json(409, {
        ok: false,
        code: 'email_sender_missing',
        message: 'Candidate email settings do not have an HMJ sender configured.',
      });
    }

    const rawBookings = await loadReminderCandidates(event, supabase, clock.isoDate);
    const years = Array.from(new Set(rawBookings.map((row) => Number.parseInt(String(row.leave_year || ''), 10)).filter((value) => Number.isInteger(value))));
    const holidayBundle = await getBankHolidays(event, {
      supabase,
      region: settings.defaultRegion,
      years,
      settings,
    });
    const bookings = rawBookings.map((row) => normaliseBookingRow(row, holidayBundle.allHolidays || holidayBundle.holidays || []));
    const recipients = await listAdminUsers(event, context, { supabase, includeIdentity: false });
    const recipientIndex = new Map(
      recipients.map((row) => [lowerEmail(row.email), {
        email: lowerEmail(row.email),
        name: trimString(row.displayName, 160) || lowerEmail(row.email),
      }]).filter((entry) => entry[0])
    );

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

      const bookingRecipients = new Map(recipientIndex);
      if (booking.userEmail) {
        bookingRecipients.set(booking.userEmail, {
          email: booking.userEmail,
          name: booking.userName,
        });
      }

      for (const reminderType of reminderTypes) {
        summary.processed += 1;
        const message = buildReminderMessage(senderSettings, booking, reminderType, holidayBundle.allHolidays || holidayBundle.holidays || []);
        let failed = false;

        for (const recipient of bookingRecipients.values()) {
          try {
            await sendTransactionalEmail({
              toEmail: recipient.email,
              fromEmail: senderEmail,
              fromName: trimString(senderSettings.senderName, 160) || 'HMJ Global',
              replyTo: lowerEmail(senderSettings.supportEmail || senderEmail) || undefined,
              subject: message.subject,
              html: message.html,
              smtpSettings: senderSettings,
            });
            summary.sent += 1;
          } catch (error) {
            failed = true;
            summary.failed += 1;
            console.error('[annual-leave-reminders] send failed for %s (%s)', recipient.email, error?.message || error);
          }
        }

        if (!failed) {
          await markReminderSent(supabase, booking.id, reminderType);
          summary.bookings.push({
            bookingId: booking.id,
            userName: booking.userName,
            reminderType,
            startDate: booking.startDate,
          });
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
