'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { bookingWriteResponse, parseBody, prepareBookingMutation } = require('./_annual-leave-write.js');
const { lowerEmail, trimString } = require('./_annual-leave.js');

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

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify(bookingWriteResponse(data, prepared.holidayBundle.holidays, {
      warnings: prepared.warnings,
      message: 'Annual leave booking saved.',
    })),
  };
});
