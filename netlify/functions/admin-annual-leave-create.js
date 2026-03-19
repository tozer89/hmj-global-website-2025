'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { bookingWriteResponse, parseBody, prepareBookingMutation } = require('./_annual-leave-write.js');
const { lowerEmail, trimString } = require('./_annual-leave.js');
const { sendAnnualLeaveNotifications } = require('./_annual-leave-email.js');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

module.exports.handler = withAdminCors(async (event, context) => {
  const { user } = await getContext(event, context, { requireAdmin: true });
  const body = parseBody(event);
  const supabase = getSupabase(event);
  const actor = {
    userId: trimString(user?.id || user?.sub, 120),
    email: lowerEmail(user?.email),
  };

  const prepared = await prepareBookingMutation(event, supabase, body, actor, {});
  const { data, error } = await supabase
    .from('annual_leave_bookings')
    .insert(prepared.payload)
    .select('*')
    .single();

  if (error) throw error;

  let notification = null;
  try {
    notification = await sendAnnualLeaveNotifications(event, context, {
      supabase,
      booking: bookingWriteResponse(data, prepared.holidayBundle.holidays).row,
      settings: prepared.settings,
      type: 'booked',
      actorEmail: actor.email,
      currentUser: user,
    });
  } catch (notificationError) {
    notification = {
      ok: false,
      warning: notificationError?.message || 'Leave email notifications could not be sent.',
      sent: 0,
      failed: 0,
    };
    console.warn('[annual-leave] create notification failed (%s)', notificationError?.message || notificationError);
  }

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify(bookingWriteResponse(data, prepared.holidayBundle.holidays, {
      warnings: prepared.warnings,
      notification,
      message: notification?.warning
        ? 'Annual leave booking saved, but the email notification did not fully send.'
        : 'Annual leave booking saved.',
    })),
  };
});
