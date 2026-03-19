'use strict';

const {
  BOOKING_STATUS,
  calculateLeaveBreakdown,
  coded,
  deriveLeaveYear,
  findPersonBookingConflicts,
  getBankHolidays,
  leaveYearBounds,
  lowerEmail,
  normaliseBookingRow,
  normaliseDurationMode,
  normaliseLeaveType,
  normaliseRegion,
  normaliseStatus,
  parseDateOnly,
  readAnnualLeaveSettings,
  trimString,
} = require('./_annual-leave.js');

function parseBody(event) {
  if (!event?.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw coded(400, 'invalid_json', 'Request body must be valid JSON.');
  }
}

function warningMessages(breakdown) {
  const warnings = [];
  if (breakdown?.warningFlags?.includesWeekend) {
    warnings.push('Weekend dates are excluded from the effective leave calculation.');
  }
  if (breakdown?.warningFlags?.includesBankHoliday) {
    warnings.push('UK bank holidays inside this range are excluded from the effective leave calculation.');
  }
  return warnings;
}

function buildPayload(body = {}, actor = {}, options = {}) {
  const userId = trimString(body.userId || body.user_id, 120);
  const userEmail = lowerEmail(body.userEmail || body.user_email);
  const userName = trimString(body.userName || body.user_name, 160);
  if (!userId || !userEmail || !userName) {
    throw coded(400, 'booking_user_required', 'Booking user, email, and display name are required.');
  }

  const startDate = trimString(body.startDate || body.start_date, 10);
  const endDate = trimString(body.endDate || body.end_date, 10);
  parseDateOnly(startDate, 'start_date');
  parseDateOnly(endDate, 'end_date');

  const startYear = deriveLeaveYear(startDate);
  const endYear = deriveLeaveYear(endDate);
  if (startYear !== endYear) {
    throw coded(400, 'cross_year_booking_not_supported', 'Leave bookings must stay inside one calendar leave year. Split bookings that cross 31 December.');
  }

  const leaveYear = startYear;
  const durationMode = normaliseDurationMode(body.durationMode || body.duration_mode);
  const leaveType = normaliseLeaveType(body.leaveType || body.leave_type);
  const sourceRegion = normaliseRegion(body.sourceRegion || body.source_region || options.defaultRegion);
  const note = trimString(body.note, 4000);
  const status = normaliseStatus(body.status || options.status || BOOKING_STATUS.BOOKED);

  return {
    row: {
      user_id: userId,
      user_email: userEmail,
      user_name: userName,
      leave_year: leaveYear,
      start_date: startDate,
      end_date: endDate,
      duration_mode: durationMode,
      leave_type: leaveType,
      source_region: sourceRegion,
      note,
      status,
      created_by_user_id: trimString(actor.userId, 120),
      created_by_email: lowerEmail(actor.email),
    },
    leaveYear,
  };
}

async function loadExistingBooking(supabase, id) {
  const { data, error } = await supabase
    .from('annual_leave_bookings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadBookingConflicts(supabase, row, excludeId = '') {
  let query = supabase
    .from('annual_leave_bookings')
    .select('*')
    .eq('user_id', row.user_id)
    .eq('leave_year', row.leave_year)
    .neq('status', BOOKING_STATUS.CANCELLED)
    .lte('start_date', row.end_date)
    .gte('end_date', row.start_date);

  if (excludeId) query = query.neq('id', excludeId);

  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function prepareBookingMutation(event, supabase, body, actor, options = {}) {
  const settings = options.settings || await readAnnualLeaveSettings(event);
  const built = buildPayload(body, actor, {
    defaultRegion: settings.defaultRegion,
    status: options.status,
  });
  const holidayBundle = await getBankHolidays(event, {
    supabase,
    region: built.row.source_region,
    year: built.leaveYear,
    settings,
  });
  const breakdown = calculateLeaveBreakdown({
    startDate: built.row.start_date,
    endDate: built.row.end_date,
    durationMode: built.row.duration_mode,
  }, holidayBundle.holidays);

  built.row.working_days_count = breakdown.workingDaysCount;
  built.row.bank_holidays_count = breakdown.bankHolidaysCount;
  built.row.excluded_weekend_days_count = breakdown.excludedWeekendDaysCount;
  built.row.effective_leave_days = breakdown.effectiveLeaveDays;

  if (normaliseStatus(built.row.status) === BOOKING_STATUS.CANCELLED) {
    built.row.cancelled_at = new Date().toISOString();
    built.row.cancelled_by_user_id = trimString(actor.userId, 120);
    built.row.cancelled_by_email = lowerEmail(actor.email);
  } else {
    built.row.cancelled_at = null;
    built.row.cancelled_by_user_id = null;
    built.row.cancelled_by_email = null;
  }

  const conflicts = normaliseStatus(built.row.status) === BOOKING_STATUS.CANCELLED
    ? []
    : findPersonBookingConflicts(
        await loadBookingConflicts(supabase, built.row, options.excludeId || ''),
        built.row,
        { excludeId: options.excludeId || '' }
      );

  if (conflicts.length) {
    const normalisedConflicts = conflicts.map((row) => normaliseBookingRow(row, holidayBundle.holidays));
    throw coded(409, 'leave_conflict', 'This person already has overlapping leave booked for that range.', {
      details: {
        conflicts: normalisedConflicts,
      },
    });
  }

  return {
    settings,
    holidayBundle,
    payload: built.row,
    warnings: warningMessages(breakdown),
  };
}

function bookingWriteResponse(row, holidays = [], extra = {}) {
  return {
    ok: true,
    row: normaliseBookingRow(row, holidays),
    ...extra,
  };
}

module.exports = {
  bookingWriteResponse,
  buildPayload,
  loadExistingBooking,
  parseBody,
  prepareBookingMutation,
};
