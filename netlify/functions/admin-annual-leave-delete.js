'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { loadExistingBooking, parseBody } = require('./_annual-leave-write.js');
const { trimString } = require('./_annual-leave.js');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

module.exports.handler = withAdminCors(async (event, context) => {
  const { roles } = await getContext(event, context, { requireAdmin: true });
  if (!Array.isArray(roles) || !roles.includes('owner')) {
    return {
      statusCode: 403,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: false,
        code: 'owner_required',
        message: 'Only Netlify owner-role users can permanently delete leave entries.',
      }),
    };
  }

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

  const { error } = await supabase
    .from('annual_leave_bookings')
    .delete()
    .eq('id', bookingId);

  if (error) throw error;

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok: true,
      row: { id: bookingId },
      message: 'Annual leave booking deleted permanently.',
    }),
  };
});
