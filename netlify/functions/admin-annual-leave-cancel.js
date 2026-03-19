'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { loadExistingBooking, parseBody } = require('./_annual-leave-write.js');
const { BOOKING_STATUS, getBankHolidays, lowerEmail, normaliseBookingRow, trimString } = require('./_annual-leave.js');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

module.exports.handler = withAdminCors(async (event, context) => {
  const { user } = await getContext(event, context, { requireAdmin: true });
  const body = parseBody(event);
  const bookingId = trimString(body.id, 120);
  if (!bookingId) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, code: 'booking_id_required', message: 'Booking id is required.' }),
    };
  }

  const supabase = getSupabase(event);
  const existing = await loadExistingBooking(supabase, bookingId);
  if (!existing) {
    return {
      statusCode: 404,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, code: 'booking_not_found', message: 'Annual leave booking not found.' }),
    };
  }

  const cancelledAt = new Date().toISOString();
  const update = {
    status: BOOKING_STATUS.CANCELLED,
    cancelled_at: cancelledAt,
    cancelled_by_user_id: trimString(user?.id || user?.sub, 120),
    cancelled_by_email: lowerEmail(user?.email),
    updated_at: cancelledAt,
  };

  const { data, error } = await supabase
    .from('annual_leave_bookings')
    .update(update)
    .eq('id', bookingId)
    .select('*')
    .single();

  if (error) throw error;

  const holidayBundle = await getBankHolidays(event, {
    supabase,
    region: data?.source_region,
    year: data?.leave_year,
  });

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok: true,
      row: {
        id: data.id,
      },
      booking: normaliseBookingRow(data, holidayBundle.holidays),
      message: 'Annual leave booking cancelled.',
    }),
  };
});
