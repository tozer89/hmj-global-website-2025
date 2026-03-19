'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase, supabaseStatus } = require('./_supabase.js');
const {
  DEFAULT_REGION,
  getBankHolidays,
  leaveYearBounds,
  normaliseBookingRow,
  normaliseRegion,
  readAnnualLeaveSettings,
  summariseBookings,
  trimString,
} = require('./_annual-leave.js');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

function parseYear(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100) return parsed;
  return new Date().getUTCFullYear();
}

function parseQuery(event) {
  return event?.queryStringParameters || {};
}

module.exports.handler = withAdminCors(async (event, context) => {
  const { user } = await getContext(event, context, { requireAdmin: true });
  const query = parseQuery(event);
  const year = parseYear(query.year);
  const settings = await readAnnualLeaveSettings(event);
  const region = normaliseRegion(query.region || settings.defaultRegion || DEFAULT_REGION);
  const supabase = getSupabase(event);
  const yearBounds = leaveYearBounds(year);

  const [{ data, error }, holidayBundle] = await Promise.all([
    supabase
      .from('annual_leave_bookings')
      .select('*')
      .eq('leave_year', year)
      .order('start_date', { ascending: true })
      .order('created_at', { ascending: false }),
    getBankHolidays(event, {
      supabase,
      region,
      year,
      settings,
    }),
  ]);

  if (error) throw error;

  const holidays = holidayBundle.holidays || [];
  const rows = (Array.isArray(data) ? data : []).map((row) => normaliseBookingRow(row, holidays));
  const summary = summariseBookings(rows, holidays, {
    year,
    overlapThreshold: settings.overlapWarningThreshold,
  });

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok: true,
      viewer: {
        email: trimString(user?.email, 320),
      },
      leaveYear: {
        year,
        start: yearBounds.start,
        end: yearBounds.end,
        label: summary.leaveYear.label,
      },
      region,
      settings,
      holidays,
      holidaySource: holidayBundle.source,
      holidayFetchedAt: holidayBundle.fetchedAt || '',
      holidayWarning: holidayBundle.warning || '',
      rows,
      summary,
      supabase: supabaseStatus(),
    }),
  };
});
