'use strict';

const { readCandidateEmailSettings, buildEmailTemplate } = require('./_candidate-email-settings.js');
const { escapeHtml } = require('./_html.js');
const { sendTransactionalEmail } = require('./_mail-delivery.js');
const {
  BOOKING_STATUS,
  getBankHolidays,
  isBookingActive,
  leaveTypeLabel,
  listAdminUsers,
  lowerEmail,
  normaliseBookingRow,
  previousWorkingDay,
  readAnnualLeaveSettings,
  resolveEntitlementDays,
  resolveSevenDayReminderDate,
  roundHalf,
  trimString,
} = require('./_annual-leave.js');

function currentSiteUrl() {
  return trimString(
    process.env.URL
      || process.env.DEPLOY_PRIME_URL
      || process.env.SITE_URL
      || '',
    500
  ).replace(/\/$/, '');
}

function annualLeaveAdminUrl() {
  return `${currentSiteUrl()}/admin/annual-leave.html`;
}

function dateRangeLabel(booking) {
  return booking.startDate === booking.endDate
    ? booking.startDate
    : `${booking.startDate} to ${booking.endDate}`;
}

async function loadUserYearBalance(event, supabase, booking, settings) {
  let query = supabase
    .from('annual_leave_bookings')
    .select('*')
    .eq('leave_year', booking.leaveYear);

  if (booking.userId) {
    query = query.eq('user_id', booking.userId);
  } else {
    query = query.eq('user_email', booking.userEmail);
  }

  const { data, error } = await query;
  if (error) throw error;

  const holidayBundle = await getBankHolidays(event, {
    supabase,
    region: booking.sourceRegion,
    year: booking.leaveYear,
    settings,
  });

  const rows = (Array.isArray(data) ? data : []).map((row) => normaliseBookingRow(row, holidayBundle.holidays || []));
  const bookedDays = roundHalf(rows.filter(isBookingActive).reduce((sum, row) => sum + row.effectiveLeaveDays, 0));
  const entitlementDays = resolveEntitlementDays(booking, settings);

  return {
    bookedDays,
    entitlementDays,
    remainingDays: roundHalf(Math.max(0, entitlementDays - bookedDays)),
    bookingsCount: rows.filter(isBookingActive).length,
  };
}

function subjectForType(type, booking) {
  const range = dateRangeLabel(booking);
  if (type === 'cancelled') return `Annual leave cancelled: ${booking.userName} (${range})`;
  if (type === 'updated') return `Annual leave updated: ${booking.userName} (${range})`;
  if (type === '1wd') return `Annual leave tomorrow: ${booking.userName}`;
  if (type === '7d') return `Upcoming annual leave: ${booking.userName}`;
  return `Annual leave booked: ${booking.userName} (${range})`;
}

function headingForType(type, booking) {
  if (type === 'cancelled') return `${booking.userName} has cancelled leave`;
  if (type === 'updated') return `${booking.userName}'s leave has been updated`;
  if (type === '1wd') return `${booking.userName} is off on the next working day`;
  if (type === '7d') return `${booking.userName} has leave coming up in 7 days`;
  return `${booking.userName} has booked leave`;
}

function actionCopyForType(type) {
  if (type === 'cancelled') return 'The cancelled leave remains visible in the HMJ calendar for audit and coverage tracking.';
  if (type === 'updated') return 'Review the HMJ annual leave workspace for the updated dates and any overlap impact.';
  if (type === '1wd') return 'This is the 1-working-day reminder for the HMJ admin team.';
  if (type === '7d') return 'This is the 7-day reminder for the HMJ admin team.';
  return 'The leave is now visible in the HMJ annual leave workspace.';
}

function reminderMeta(type, booking, holidays) {
  if (type === '1wd') {
    return `1 working day reminder • send date ${previousWorkingDay(booking.startDate, holidays)}`;
  }
  if (type === '7d') {
    return `7 day reminder • send date ${resolveSevenDayReminderDate(booking.startDate, holidays)}`;
  }
  return '';
}

function buildAnnualLeaveEmailMessage(emailSettings, booking, balance, options = {}) {
  const type = trimString(options.type, 32) || 'booked';
  const actorEmail = lowerEmail(options.actorEmail);
  const holidays = Array.isArray(options.holidays) ? options.holidays : [];
  const adminUrl = annualLeaveAdminUrl();
  const noteHtml = booking.note
    ? `<p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">Note: ${escapeHtml(booking.note)}</p>`
    : '';
  const actorHtml = actorEmail
    ? `<p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">Updated by: <strong>${escapeHtml(actorEmail)}</strong>.</p>`
    : '';
  const reminderHtml = reminderMeta(type, booking, holidays)
    ? `<p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">${escapeHtml(reminderMeta(type, booking, holidays))}.</p>`
    : '';

  return {
    subject: subjectForType(type, booking),
    html: buildEmailTemplate(emailSettings, {
      heading: headingForType(type, booking),
      intro: 'HMJ Global annual leave notification.',
      actionLabel: 'Open annual leave workspace',
      actionUrl: adminUrl,
      bodyHtml: `
        <p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7"><strong>${escapeHtml(booking.userName)}</strong> is set as <strong>${escapeHtml(type === 'cancelled' ? 'Cancelled' : booking.statusLabel || 'Booked')}</strong>.</p>
        <p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">Dates: <strong>${escapeHtml(dateRangeLabel(booking))}</strong>.</p>
        <p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">Effective leave: <strong>${escapeHtml(String(booking.effectiveLeaveDays))}</strong> day${Number(booking.effectiveLeaveDays) === 1 ? '' : 's'} • Type: <strong>${escapeHtml(leaveTypeLabel(booking.leaveType))}</strong>.</p>
        <p style="margin:0 0 12px;color:#42557f;font-size:15px;line-height:1.7">Current year balance: <strong>${escapeHtml(String(balance.bookedDays))}</strong> booked • <strong>${escapeHtml(String(balance.entitlementDays))}</strong> entitlement • <strong>${escapeHtml(String(balance.remainingDays))}</strong> remaining.</p>
        ${noteHtml}
        ${actorHtml}
        ${reminderHtml}
        <p style="margin:0;color:#42557f;font-size:15px;line-height:1.7">${escapeHtml(actionCopyForType(type))}</p>
      `,
      fallbackLinks: [
        { label: 'Open annual leave workspace', url: adminUrl },
      ],
    }),
  };
}

async function sendAnnualLeaveNotifications(event, context, options = {}) {
  const supabase = options.supabase;
  const booking = options.booking;
  if (!supabase || !booking || !booking.id) {
    return { ok: false, sent: 0, failed: 0, warning: 'Annual leave notifications skipped because booking context was incomplete.' };
  }

  const settings = options.settings || await readAnnualLeaveSettings(event);
  const emailConfig = await readCandidateEmailSettings(event);
  const senderSettings = emailConfig.settings || {};
  const senderEmail = lowerEmail(senderSettings.senderEmail || senderSettings.supportEmail || 'info@hmj-global.com');
  if (!senderEmail) {
    return { ok: false, sent: 0, failed: 0, warning: 'Annual leave notifications skipped because no HMJ sender email is configured.' };
  }

  const members = await listAdminUsers(event, context, {
    supabase,
    includeIdentity: options.includeIdentity !== false,
    currentUser: options.currentUser || null,
  });
  const balance = await loadUserYearBalance(event, supabase, booking, settings);
  const holidays = (await getBankHolidays(event, {
    supabase,
    region: booking.sourceRegion,
    year: booking.leaveYear,
    settings,
  })).holidays || [];

  const recipients = new Map();
  members.forEach((member) => {
    if (!member.email) return;
    recipients.set(lowerEmail(member.email), {
      email: lowerEmail(member.email),
      name: trimString(member.displayName, 160) || lowerEmail(member.email),
    });
  });
  if (booking.userEmail) {
    recipients.set(lowerEmail(booking.userEmail), {
      email: lowerEmail(booking.userEmail),
      name: trimString(booking.userName, 160) || lowerEmail(booking.userEmail),
    });
  }

  const message = buildAnnualLeaveEmailMessage(senderSettings, booking, balance, {
    type: options.type || 'booked',
    actorEmail: options.actorEmail || '',
    holidays,
  });

  const summary = {
    ok: true,
    sent: 0,
    failed: 0,
    recipients: recipients.size,
    warning: '',
  };

  for (const recipient of recipients.values()) {
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
      summary.failed += 1;
      summary.warning = error?.message || 'Annual leave email delivery failed.';
      console.warn('[annual-leave] email send failed (%s)', error?.message || error);
    }
  }

  return summary;
}

module.exports = {
  annualLeaveAdminUrl,
  buildAnnualLeaveEmailMessage,
  loadUserYearBalance,
  sendAnnualLeaveNotifications,
};
