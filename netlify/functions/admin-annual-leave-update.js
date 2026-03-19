'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { bookingWriteResponse, loadExistingBooking, parseBody, prepareBookingMutation } = require('./_annual-leave-write.js');
const { lowerEmail, trimString } = require('./_annual-leave.js');

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

  const actor = {
    userId: trimString(user?.id || user?.sub, 120),
    email: lowerEmail(user?.email),
  };

  const prepared = await prepareBookingMutation(event, supabase, {
    ...existing,
    ...body,
  }, actor, {
    excludeId: bookingId,
    status: body.status || existing.status,
  });

  const payload = {
    ...prepared.payload,
    updated_at: new Date().toISOString(),
    created_by_user_id: existing.created_by_user_id || prepared.payload.created_by_user_id,
    created_by_email: existing.created_by_email || prepared.payload.created_by_email,
  };

  const { data, error } = await supabase
    .from('annual_leave_bookings')
    .update(payload)
    .eq('id', bookingId)
    .select('*')
    .single();

  if (error) throw error;

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify(bookingWriteResponse(data, prepared.holidayBundle.holidays, {
      warnings: prepared.warnings,
      message: 'Annual leave booking updated.',
    })),
  };
});
