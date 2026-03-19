'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase, supabaseStatus } = require('./_supabase.js');
const {
  DEFAULT_REGION,
  getBankHolidays,
  listAdminUsers,
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
  const { user, roles } = await getContext(event, context, { requireAdmin: true });
  const query = parseQuery(event);
  const year = parseYear(query.year);
  const settings = await readAnnualLeaveSettings(event);
  const region = normaliseRegion(query.region || settings.defaultRegion || DEFAULT_REGION);
  const supabase = getSupabase(event);
  const yearBounds = leaveYearBounds(year);

  const [{ data, error }, holidayBundle, adminUsers] = await Promise.all([
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
    listAdminUsers(event, context, { supabase, currentUser: user }),
  ]);

  if (error) throw error;

  const holidays = holidayBundle.holidays || [];
  const rows = (Array.isArray(data) ? data : []).map((row) => normaliseBookingRow(row, holidays));
  const summary = summariseBookings(rows, holidays, {
    year,
    overlapThreshold: settings.overlapWarningThreshold,
    members: adminUsers,
    settings,
  });

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok: true,
      viewer: {
        email: trimString(user?.email, 320),
        roles,
        isOwner: Array.isArray(roles) && roles.includes('owner'),
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
      adminUsers: adminUsers.map((row) => ({
        userId: trimString(row.userId, 120),
        email: trimString(row.email, 320),
        displayName: trimString(row.displayName, 160) || trimString(row.email, 320),
        role: trimString(row.role, 40) || 'admin',
        roles: Array.isArray(row.roles) ? row.roles : [trimString(row.role, 40) || 'admin'],
        isOwner: trimString(row.role, 40) === 'owner' || (Array.isArray(row.roles) && row.roles.includes('owner')),
      })),
      rows,
      summary,
      supabase: supabaseStatus(),
    }),
  };
});
