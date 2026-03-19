'use strict';

const { fetchSettings } = require('./_settings-helpers.js');
const { getSupabase } = require('./_supabase.js');
const { fetchNetlifyIdentityUsers, buildAssignableAdminMembers } = require('./_admin-users.js');

const MS_DAY = 86400000;
const DEFAULT_REGION = 'england-and-wales';
const GOV_UK_BANK_HOLIDAYS_URL = 'https://www.gov.uk/bank-holidays.json';
const LEAVE_SETTINGS_KEY = 'annual_leave_settings';
const BANK_HOLIDAY_CACHE_PREFIX = 'annual_leave_bank_holidays:';

const BOOKING_STATUS = Object.freeze({
  BOOKED: 'booked',
  CANCELLED: 'cancelled',
});

const BOOKING_STATUSES = Object.freeze(Object.values(BOOKING_STATUS));
const LEAVE_TYPES = Object.freeze(['annual_leave', 'unpaid_leave', 'sick', 'other']);
const DURATION_MODES = Object.freeze(['full_day', 'half_day_am', 'half_day_pm']);
const ADMIN_TEAM_ROLES = Object.freeze(['admin', 'owner']);

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function lowerEmail(value) {
  return trimString(value, 320).toLowerCase();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundHalf(value) {
  return Math.round(toNumber(value) * 2) / 2;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function coded(statusCode, code, message, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function normaliseRegion(value) {
  const region = trimString(value, 64).toLowerCase();
  return ['england-and-wales', 'scotland', 'northern-ireland'].includes(region)
    ? region
    : DEFAULT_REGION;
}

function normaliseLeaveType(value) {
  const type = trimString(value, 40).toLowerCase();
  return LEAVE_TYPES.includes(type) ? type : 'annual_leave';
}

function normaliseDurationMode(value) {
  const mode = trimString(value, 40).toLowerCase();
  return DURATION_MODES.includes(mode) ? mode : 'full_day';
}

function normaliseStatus(value) {
  const status = trimString(value, 40).toLowerCase();
  return BOOKING_STATUSES.includes(status) ? status : BOOKING_STATUS.BOOKED;
}

function normaliseRole(value) {
  const role = trimString(value, 40).toLowerCase();
  return ADMIN_TEAM_ROLES.includes(role) ? role : 'admin';
}

function normaliseRoleList(value) {
  const list = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return Array.from(new Set(list.map((entry) => trimString(entry, 40).toLowerCase()).filter(Boolean)));
}

function isAdminTeamRole(input) {
  if (typeof input === 'string') {
    return ADMIN_TEAM_ROLES.includes(normaliseRole(input));
  }
  if (input && typeof input === 'object') {
    const roles = normaliseRoleList(input.roles || []);
    if (roles.some((role) => ADMIN_TEAM_ROLES.includes(role))) return true;
    return ADMIN_TEAM_ROLES.includes(normaliseRole(input.role));
  }
  return false;
}

function asIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value, field = 'date') {
  const raw = trimString(value, 32);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw coded(400, 'invalid_date', `${field} must be a valid YYYY-MM-DD date.`);
  }
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw coded(400, 'invalid_date', `${field} must be a valid date.`);
  }
  return date;
}

function parseDateOnlySafe(value) {
  try {
    return parseDateOnly(value);
  } catch {
    return null;
  }
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next;
}

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function isSameOrAfter(left, right) {
  return left.getTime() >= right.getTime();
}

function isSameOrBefore(left, right) {
  return left.getTime() <= right.getTime();
}

function leaveYearBounds(yearInput) {
  const year = Number.parseInt(String(yearInput || ''), 10);
  const safeYear = Number.isInteger(year) && year >= 2000 && year <= 2100
    ? year
    : new Date().getUTCFullYear();
  return {
    year: safeYear,
    start: `${safeYear}-01-01`,
    end: `${safeYear}-12-31`,
  };
}

function deriveLeaveYear(value) {
  return parseDateOnly(value).getUTCFullYear();
}

function buildLeaveYearLabel(yearInput) {
  const { year } = leaveYearBounds(yearInput);
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  const formatter = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function startOfWeek(date) {
  const safe = new Date(date.getTime());
  const day = safe.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  return addUtcDays(safe, delta);
}

function endOfWeek(date) {
  return addUtcDays(startOfWeek(date), 6);
}

function parseJson(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  return value;
}

function holidayCacheKey(region) {
  return `${BANK_HOLIDAY_CACHE_PREFIX}${normaliseRegion(region)}`;
}

async function readAdminSettingValue(supabase, key) {
  const { data, error } = await supabase
    .from('admin_settings')
    .select('key,value,updated_at')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function writeAdminSettingValue(supabase, key, value) {
  const { data, error } = await supabase
    .from('admin_settings')
    .upsert({ key, value }, { onConflict: 'key' })
    .select('key,value,updated_at')
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function readAnnualLeaveSettings(event) {
  const result = await fetchSettings(event, [LEAVE_SETTINGS_KEY]);
  const stored = parseJson(result?.settings?.[LEAVE_SETTINGS_KEY], {});
  const entitlementOverrides = Object.fromEntries(
    Object.entries(parseJson(stored.entitlementOverrides, {}))
      .map(([key, value]) => [trimString(key, 320), roundHalf(Math.max(0, toNumber(value, 0)))])
      .filter(([key]) => key)
  );
  return {
    defaultRegion: normaliseRegion(stored.defaultRegion || DEFAULT_REGION),
    remindersEnabled: stored.remindersEnabled !== false,
    overlapWarningThreshold: Math.max(1, Number.parseInt(String(stored.overlapWarningThreshold || 2), 10) || 2),
    reminderRunHourLocal: Math.max(0, Math.min(23, Number.parseInt(String(stored.reminderRunHourLocal || 8), 10) || 8)),
    holidayCacheTtlHours: Math.max(12, Number.parseInt(String(stored.holidayCacheTtlHours || 168), 10) || 168),
    defaultEntitlementDays: roundHalf(Math.max(0, toNumber(stored.defaultEntitlementDays, 28))),
    entitlementOverrides,
  };
}

async function fetchGovUkBankHolidayPayload(fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw coded(500, 'bank_holiday_fetch_missing', 'Global fetch is unavailable for GOV.UK bank holiday retrieval.');
  }
  const response = await fetchImpl(GOV_UK_BANK_HOLIDAYS_URL, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw coded(502, 'bank_holiday_fetch_failed', `GOV.UK bank holidays request failed (${response.status}).`);
  }
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    throw coded(502, 'bank_holiday_payload_invalid', 'GOV.UK bank holidays payload could not be read.');
  }
  return payload;
}

function normaliseGovUkRegion(payload, region) {
  const division = payload?.[region];
  if (!division || !Array.isArray(division.events)) {
    throw coded(502, 'bank_holiday_region_missing', `GOV.UK bank holidays do not include ${region}.`);
  }
  return division.events
    .map((entry) => ({
      date: trimString(entry?.date, 10),
      title: trimString(entry?.title, 200) || 'Bank holiday',
      notes: trimString(entry?.notes, 240),
      bunting: entry?.bunting === true,
      region,
    }))
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function filterHolidaysByYears(holidays = [], years = []) {
  const yearSet = new Set(
    (Array.isArray(years) ? years : [years])
      .map((value) => Number.parseInt(String(value || ''), 10))
      .filter((value) => Number.isInteger(value))
      .map((value) => String(value))
  );
  if (!yearSet.size) return holidays.slice();
  return holidays.filter((entry) => yearSet.has(entry.date.slice(0, 4)));
}

async function getBankHolidays(event, options = {}) {
  const supabase = options.supabase || getSupabase(event);
  const settings = options.settings || await readAnnualLeaveSettings(event);
  const region = normaliseRegion(options.region || settings.defaultRegion);
  const key = holidayCacheKey(region);
  const requestedYears = Array.isArray(options.years)
    ? options.years
    : (options.year != null ? [options.year] : []);
  const cacheRow = await readAdminSettingValue(supabase, key).catch(() => null);
  const cache = parseJson(cacheRow?.value, {});
  const cachedHolidays = Array.isArray(cache.holidays) ? cache.holidays : [];
  const cacheFetchedAt = trimString(cache.fetchedAt, 64);
  const cacheAgeHours = cacheFetchedAt
    ? (Date.now() - Date.parse(cacheFetchedAt)) / (60 * 60 * 1000)
    : Number.POSITIVE_INFINITY;
  const cachedYears = new Set(cachedHolidays.map((entry) => String(entry?.date || '').slice(0, 4)).filter(Boolean));
  const missingYears = requestedYears
    .map((value) => String(Number.parseInt(String(value || ''), 10)))
    .filter((value) => value && !cachedYears.has(value));
  const shouldRefresh = options.forceRefresh === true
    || !cachedHolidays.length
    || !Number.isFinite(cacheAgeHours)
    || cacheAgeHours >= settings.holidayCacheTtlHours
    || missingYears.length > 0;

  if (!shouldRefresh) {
    return {
      region,
      source: 'cache',
      fetchedAt: cacheFetchedAt || '',
      holidays: filterHolidaysByYears(cachedHolidays, requestedYears),
      allHolidays: cachedHolidays.slice(),
    };
  }

  try {
    const payload = await fetchGovUkBankHolidayPayload(options.fetchImpl || global.fetch);
    const holidays = normaliseGovUkRegion(payload, region);
    await writeAdminSettingValue(supabase, key, {
      region,
      source: GOV_UK_BANK_HOLIDAYS_URL,
      fetchedAt: new Date().toISOString(),
      holidays,
    }).catch((error) => {
      console.warn('[annual-leave] bank holiday cache save failed (%s)', error?.message || error);
    });
    return {
      region,
      source: 'gov.uk',
      fetchedAt: new Date().toISOString(),
      holidays: filterHolidaysByYears(holidays, requestedYears),
      allHolidays: holidays,
    };
  } catch (error) {
    if (cachedHolidays.length) {
      return {
        region,
        source: 'cache-stale',
        fetchedAt: cacheFetchedAt || '',
        holidays: filterHolidaysByYears(cachedHolidays, requestedYears),
        allHolidays: cachedHolidays.slice(),
        warning: error?.message || 'Bank holiday refresh failed.',
      };
    }
    throw error;
  }
}

function buildHolidayLookup(holidays = []) {
  return new Map(
    (Array.isArray(holidays) ? holidays : [])
      .filter((entry) => entry && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || '')))
      .map((entry) => [entry.date, entry])
  );
}

function iterateDates(startDate, endDate) {
  const out = [];
  const start = parseDateOnlySafe(startDate);
  const end = parseDateOnlySafe(endDate);
  if (!start || !end || end < start) return out;
  for (let cursor = start; isSameOrBefore(cursor, end); cursor = addUtcDays(cursor, 1)) {
    out.push(new Date(cursor.getTime()));
  }
  return out;
}

function calculateLeaveBreakdown(input = {}, holidays = []) {
  const start = parseDateOnly(input.startDate || input.start_date, 'start_date');
  const end = parseDateOnly(input.endDate || input.end_date, 'end_date');
  if (end < start) {
    throw coded(400, 'invalid_range', 'End date cannot be before start date.');
  }

  const durationMode = normaliseDurationMode(input.durationMode || input.duration_mode);
  if (durationMode !== 'full_day' && asIsoDate(start) !== asIsoDate(end)) {
    throw coded(400, 'half_day_single_date_required', 'Half-day bookings must use the same start and end date.');
  }

  const holidayLookup = buildHolidayLookup(holidays);
  let workingDaysCount = 0;
  let bankHolidaysCount = 0;
  let excludedWeekendDaysCount = 0;
  const effectiveDates = [];
  const holidayDates = [];

  iterateDates(asIsoDate(start), asIsoDate(end)).forEach((date) => {
    const iso = asIsoDate(date);
    if (isWeekend(date)) {
      excludedWeekendDaysCount += 1;
      return;
    }
    if (holidayLookup.has(iso)) {
      bankHolidaysCount += 1;
      holidayDates.push(iso);
      return;
    }
    workingDaysCount += 1;
    effectiveDates.push(iso);
  });

  if (workingDaysCount < 1) {
    throw coded(400, 'no_working_days', 'This leave range contains no working days after weekends and bank holidays are excluded.');
  }

  const effectiveLeaveDays = durationMode === 'full_day' ? workingDaysCount : 0.5;

  return {
    calendarDays: iterateDates(asIsoDate(start), asIsoDate(end)).length,
    workingDaysCount: round2(workingDaysCount),
    bankHolidaysCount: round2(bankHolidaysCount),
    excludedWeekendDaysCount: round2(excludedWeekendDaysCount),
    effectiveLeaveDays: roundHalf(effectiveLeaveDays),
    effectiveDates,
    holidayDates,
    warningFlags: {
      includesWeekend: excludedWeekendDaysCount > 0,
      includesBankHoliday: bankHolidaysCount > 0,
    },
  };
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  const aStart = parseDateOnlySafe(leftStart);
  const aEnd = parseDateOnlySafe(leftEnd);
  const bStart = parseDateOnlySafe(rightStart);
  const bEnd = parseDateOnlySafe(rightEnd);
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return isSameOrBefore(aStart, bEnd) && isSameOrAfter(aEnd, bStart);
}

function findPersonBookingConflicts(bookings = [], nextBooking = {}, options = {}) {
  const excludeId = trimString(options.excludeId || '', 120);
  const targetUserId = trimString(nextBooking.user_id || nextBooking.userId || '', 120);
  const targetEmail = lowerEmail(nextBooking.user_email || nextBooking.userEmail || '');
  return bookings
    .filter((row) => normaliseStatus(row.status) !== BOOKING_STATUS.CANCELLED)
    .filter((row) => !excludeId || trimString(row.id, 120) !== excludeId)
    .filter((row) => {
      const rowUserId = trimString(row.user_id || row.userId || '', 120);
      const rowEmail = lowerEmail(row.user_email || row.userEmail || '');
      return (targetUserId && rowUserId === targetUserId) || (targetEmail && rowEmail === targetEmail);
    })
    .filter((row) => rangesOverlap(row.start_date || row.startDate, row.end_date || row.endDate, nextBooking.start_date || nextBooking.startDate, nextBooking.end_date || nextBooking.endDate));
}

function leaveTypeLabel(type) {
  switch (normaliseLeaveType(type)) {
    case 'unpaid_leave': return 'Unpaid leave';
    case 'sick': return 'Sick leave';
    case 'other': return 'Other';
    default: return 'Annual leave';
  }
}

function durationModeLabel(mode) {
  switch (normaliseDurationMode(mode)) {
    case 'half_day_am': return 'Half day AM';
    case 'half_day_pm': return 'Half day PM';
    default: return 'Full day(s)';
  }
}

function statusLabel(status) {
  return normaliseStatus(status) === BOOKING_STATUS.CANCELLED ? 'Cancelled' : 'Booked';
}

function normaliseBookingRow(row = {}, holidays = []) {
  const startDate = trimString(row.start_date || row.startDate, 10);
  const endDate = trimString(row.end_date || row.endDate, 10);
  const durationMode = normaliseDurationMode(row.duration_mode || row.durationMode);
  let breakdown = null;
  if (startDate && endDate) {
    try {
      breakdown = calculateLeaveBreakdown({ startDate, endDate, durationMode }, holidays);
    } catch {
      breakdown = null;
    }
  }

  const leaveYear = Number.parseInt(String(row.leave_year || row.leaveYear || ''), 10)
    || (startDate ? deriveLeaveYear(startDate) : new Date().getUTCFullYear());

  return {
    id: trimString(row.id, 120),
    userId: trimString(row.user_id || row.userId, 120),
    userEmail: lowerEmail(row.user_email || row.userEmail),
    userName: trimString(row.user_name || row.userName, 160) || lowerEmail(row.user_email || row.userEmail) || 'Admin',
    leaveYear,
    startDate,
    endDate,
    durationMode,
    durationLabel: durationModeLabel(durationMode),
    leaveType: normaliseLeaveType(row.leave_type || row.leaveType),
    leaveTypeLabel: leaveTypeLabel(row.leave_type || row.leaveType),
    status: normaliseStatus(row.status),
    statusLabel: statusLabel(row.status),
    sourceRegion: normaliseRegion(row.source_region || row.sourceRegion || DEFAULT_REGION),
    workingDaysCount: round2(breakdown?.workingDaysCount ?? row.working_days_count ?? row.workingDaysCount),
    bankHolidaysCount: round2(breakdown?.bankHolidaysCount ?? row.bank_holidays_count ?? row.bankHolidaysCount),
    excludedWeekendDaysCount: round2(breakdown?.excludedWeekendDaysCount ?? row.excluded_weekend_days_count ?? row.excludedWeekendDaysCount),
    effectiveLeaveDays: roundHalf(breakdown?.effectiveLeaveDays ?? row.effective_leave_days ?? row.effectiveLeaveDays),
    calendarDays: Number.parseInt(String(breakdown?.calendarDays || row.calendar_days || row.calendarDays || 0), 10) || 0,
    effectiveDates: breakdown?.effectiveDates || [],
    holidayDates: breakdown?.holidayDates || [],
    note: trimString(row.note, 4000),
    reminder7dSentAt: trimString(row.reminder_7d_sent_at || row.reminder7dSentAt, 64),
    reminder1wdSentAt: trimString(row.reminder_1wd_sent_at || row.reminder1wdSentAt, 64),
    createdByUserId: trimString(row.created_by_user_id || row.createdByUserId, 120),
    createdByEmail: lowerEmail(row.created_by_email || row.createdByEmail),
    createdAt: trimString(row.created_at || row.createdAt, 64),
    updatedAt: trimString(row.updated_at || row.updatedAt, 64),
    cancelledAt: trimString(row.cancelled_at || row.cancelledAt, 64),
    cancelledByUserId: trimString(row.cancelled_by_user_id || row.cancelledByUserId, 120),
    cancelledByEmail: lowerEmail(row.cancelled_by_email || row.cancelledByEmail),
  };
}

function isBookingActive(booking) {
  return normaliseStatus(booking?.status) !== BOOKING_STATUS.CANCELLED;
}

function bookingTouchesDate(booking, isoDate) {
  const dates = Array.isArray(booking?.effectiveDates) ? booking.effectiveDates : [];
  return dates.includes(isoDate);
}

function uniquePeople(rows = []) {
  const seen = new Map();
  rows.forEach((row) => {
    const key = trimString(row.userId || row.userEmail, 320) || trimString(row.userName, 160);
    if (!key || seen.has(key)) return;
    seen.set(key, {
      userId: row.userId,
      userEmail: row.userEmail,
      userName: row.userName,
    });
  });
  return Array.from(seen.values());
}

function bookingsForWindow(bookings = [], startIso, endIso) {
  const start = parseDateOnlySafe(startIso);
  const end = parseDateOnlySafe(endIso);
  if (!start || !end) return [];
  return bookings.filter((booking) => {
    if (!isBookingActive(booking)) return false;
    return booking.effectiveDates.some((date) => {
      const current = parseDateOnlySafe(date);
      return current && isSameOrAfter(current, start) && isSameOrBefore(current, end);
    });
  });
}

function buildMonthlyDistribution(bookings = [], year) {
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    key: `${year}-${String(index + 1).padStart(2, '0')}`,
    label: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, index, 1))),
    effectiveDays: 0,
    bookingCount: 0,
  }));

  bookings.forEach((booking) => {
    if (!isBookingActive(booking)) return;
    const touched = new Set();
    booking.effectiveDates.forEach((iso) => {
      if (iso.slice(0, 4) !== String(year)) return;
      const monthIndex = Number.parseInt(iso.slice(5, 7), 10) - 1;
      if (monthIndex < 0 || monthIndex >= 12) return;
      months[monthIndex].effectiveDays = round2(months[monthIndex].effectiveDays + (booking.durationMode === 'full_day' ? 1 : 0.5));
      touched.add(monthIndex);
    });
    touched.forEach((monthIndex) => {
      months[monthIndex].bookingCount += 1;
    });
  });

  return months;
}

function entitlementLookupKeys(member = {}) {
  const keys = [
    trimString(member.userId || member.user_id, 120),
    lowerEmail(member.userEmail || member.user_email || member.email),
  ].filter(Boolean);
  return Array.from(new Set(keys));
}

function resolveEntitlementDays(member = {}, settings = {}) {
  const overrides = settings && typeof settings.entitlementOverrides === 'object'
    ? settings.entitlementOverrides
    : {};
  const overrideValue = entitlementLookupKeys(member)
    .map((key) => overrides[key])
    .find((value) => Number.isFinite(toNumber(value, Number.NaN)));
  if (Number.isFinite(toNumber(overrideValue, Number.NaN))) {
    return roundHalf(Math.max(0, toNumber(overrideValue, 0)));
  }
  return roundHalf(Math.max(0, toNumber(settings.defaultEntitlementDays, 28)));
}

function aggregatePerPerson(bookings = [], members = [], settings = {}) {
  const map = new Map();
  (Array.isArray(members) ? members : []).forEach((member) => {
    const key = trimString(member.userId || member.user_id, 320) || lowerEmail(member.email || member.userEmail) || trimString(member.displayName || member.userName, 160);
    if (!key || map.has(key) || !isAdminTeamRole(member)) return;
    map.set(key, {
      userId: trimString(member.userId || member.user_id, 120),
      userEmail: lowerEmail(member.email || member.userEmail),
      userName: trimString(member.displayName || member.userName, 160) || lowerEmail(member.email || member.userEmail) || 'Admin',
      role: normaliseRole(member.role || (Array.isArray(member.roles) && member.roles.includes('owner') ? 'owner' : 'admin')),
      effectiveLeaveDays: 0,
      bookingsCount: 0,
      nextStartDate: '',
      entitlementDays: resolveEntitlementDays(member, settings),
      remainingLeaveDays: resolveEntitlementDays(member, settings),
    });
  });

  bookings.forEach((booking) => {
    if (!isBookingActive(booking)) return;
    const key = trimString(booking.userId || booking.userEmail, 320) || booking.userName;
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        userId: booking.userId,
        userEmail: booking.userEmail,
        userName: booking.userName,
        role: 'admin',
        effectiveLeaveDays: 0,
        bookingsCount: 0,
        nextStartDate: '',
        entitlementDays: resolveEntitlementDays(booking, settings),
        remainingLeaveDays: resolveEntitlementDays(booking, settings),
      });
    }
    const entry = map.get(key);
    entry.effectiveLeaveDays = roundHalf(entry.effectiveLeaveDays + booking.effectiveLeaveDays);
    entry.bookingsCount += 1;
    if (booking.startDate && (!entry.nextStartDate || booking.startDate < entry.nextStartDate)) {
      entry.nextStartDate = booking.startDate;
    }
  });

  map.forEach((entry) => {
    entry.entitlementDays = resolveEntitlementDays(entry, settings);
    entry.remainingLeaveDays = roundHalf(Math.max(0, entry.entitlementDays - entry.effectiveLeaveDays));
  });

  return Array.from(map.values())
    .sort((left, right) => right.effectiveLeaveDays - left.effectiveLeaveDays || left.userName.localeCompare(right.userName, 'en-GB', { sensitivity: 'base' }));
}

function buildOverlapWarnings(bookings = [], threshold = 2) {
  const dayMap = new Map();
  bookings.forEach((booking) => {
    if (!isBookingActive(booking)) return;
    booking.effectiveDates.forEach((iso) => {
      if (!dayMap.has(iso)) dayMap.set(iso, []);
      dayMap.get(iso).push(booking);
    });
  });

  return Array.from(dayMap.entries())
    .filter(([, rows]) => rows.length >= threshold)
    .map(([date, rows]) => ({
      date,
      count: rows.length,
      people: uniquePeople(rows).map((person) => person.userName),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function sortByStartDate(rows = []) {
  return rows.slice().sort((left, right) => {
    const leftStart = left.startDate || '';
    const rightStart = right.startDate || '';
    return leftStart.localeCompare(rightStart) || (left.userName || '').localeCompare(right.userName || '', 'en-GB', { sensitivity: 'base' });
  });
}

function summariseBookings(bookings = [], holidays = [], options = {}) {
  const yearBounds = leaveYearBounds(options.year);
  const today = options.now instanceof Date && !Number.isNaN(options.now.getTime())
    ? new Date(Date.UTC(options.now.getUTCFullYear(), options.now.getUTCMonth(), options.now.getUTCDate()))
    : parseDateOnly(asIsoDate(new Date()), 'today');
  const activeBookings = bookings.filter(isBookingActive);
  const totalEffectiveDays = roundHalf(activeBookings.reduce((sum, booking) => sum + booking.effectiveLeaveDays, 0));
  const next30End = addUtcDays(today, 30);
  const thisWeekBookings = bookingsForWindow(activeBookings, asIsoDate(startOfWeek(today)), asIsoDate(endOfWeek(today)));
  const nextWeekStart = addUtcDays(startOfWeek(today), 7);
  const nextWeekEnd = addUtcDays(endOfWeek(today), 7);
  const nextWeekBookings = bookingsForWindow(activeBookings, asIsoDate(nextWeekStart), asIsoDate(nextWeekEnd));
  const upcoming = sortByStartDate(activeBookings.filter((booking) => booking.startDate && booking.startDate >= asIsoDate(today)));
  const upcoming30 = upcoming.filter((booking) => booking.startDate <= asIsoDate(next30End));
  const remainingHolidays = holidays.filter((holiday) => holiday.date >= asIsoDate(today) && holiday.date <= yearBounds.end);
  const monthly = buildMonthlyDistribution(activeBookings, yearBounds.year);
  const overlaps = buildOverlapWarnings(activeBookings, Math.max(1, options.overlapThreshold || 2));
  const alerts = [];

  if (overlaps.length) {
    const first = overlaps[0];
    alerts.push({
      tone: 'warn',
      text: `${first.count} team members are booked off on ${first.date}. Review coverage if this affects admin or delivery continuity.`,
    });
  }
  if (!upcoming.length) {
    alerts.push({
      tone: 'info',
      text: 'No upcoming leave is booked yet for the selected year.',
    });
  }

  return {
    leaveYear: {
      year: yearBounds.year,
      start: yearBounds.start,
      end: yearBounds.end,
      label: buildLeaveYearLabel(yearBounds.year),
    },
    bookingsCount: activeBookings.length,
    totalEffectiveDays,
    upcoming30Bookings: upcoming30.length,
    upcoming30EffectiveDays: roundHalf(upcoming30.reduce((sum, booking) => sum + booking.effectiveLeaveDays, 0)),
    peopleOffToday: uniquePeople(bookingsForWindow(activeBookings, asIsoDate(today), asIsoDate(today))),
    peopleOffThisWeek: uniquePeople(thisWeekBookings),
    peopleOffNextWeek: uniquePeople(nextWeekBookings),
    bankHolidaysRemaining: remainingHolidays.length,
    remainingBankHolidays: remainingHolidays.slice(0, 8),
    perPerson: aggregatePerPerson(activeBookings, options.members || [], options.settings || {}),
    monthly,
    busiestMonths: monthly
      .filter((entry) => entry.effectiveDays > 0)
      .sort((left, right) => right.effectiveDays - left.effectiveDays || left.month - right.month)
      .slice(0, 3),
    overlaps,
    upcoming: upcoming.slice(0, 12),
    recent: bookings
      .slice()
      .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))
      .slice(0, 12),
    alerts,
  };
}

function previousWorkingDay(startDate, holidays = []) {
  const holidayLookup = buildHolidayLookup(holidays);
  let cursor = addUtcDays(parseDateOnly(startDate, 'start_date'), -1);
  while (isWeekend(cursor) || holidayLookup.has(asIsoDate(cursor))) {
    cursor = addUtcDays(cursor, -1);
  }
  return asIsoDate(cursor);
}

function nextWorkingDay(startDate, holidays = []) {
  const holidayLookup = buildHolidayLookup(holidays);
  let cursor = parseDateOnly(startDate, 'start_date');
  while (isWeekend(cursor) || holidayLookup.has(asIsoDate(cursor))) {
    cursor = addUtcDays(cursor, 1);
  }
  return asIsoDate(cursor);
}

function resolveSevenDayReminderDate(startDate, holidays = []) {
  let cursor = addUtcDays(parseDateOnly(startDate, 'start_date'), -7);
  const holidayLookup = buildHolidayLookup(holidays);
  while (isWeekend(cursor) || holidayLookup.has(asIsoDate(cursor))) {
    cursor = addUtcDays(cursor, 1);
  }
  return asIsoDate(cursor);
}

function reminderDue(booking, todayIso, holidays = [], reminderType = '7d') {
  if (!booking || !isBookingActive(booking) || !booking.startDate) return false;
  if (booking.startDate <= todayIso) return false;
  if (reminderType === '1wd') {
    const target = previousWorkingDay(booking.startDate, holidays);
    return booking.reminder1wdSentAt ? false : todayIso >= target;
  }
  const target = resolveSevenDayReminderDate(booking.startDate, holidays);
  return booking.reminder7dSentAt ? false : todayIso >= target;
}

async function listAdminUsers(event, context, options = {}) {
  const supabase = options.supabase || getSupabase(event);
  const { data, error } = await supabase
    .from('admin_users')
    .select('id,user_id,email,role,is_active,meta')
    .eq('is_active', true)
    .in('role', ADMIN_TEAM_ROLES);
  if (error) throw error;

  let identityUsers = [];
  if (options.includeIdentity !== false) {
    try {
      identityUsers = await fetchNetlifyIdentityUsers(context, {});
    } catch (identityError) {
      console.warn('[annual-leave] netlify identity admin list failed (%s)', identityError?.message || identityError);
    }
  }

  return buildAssignableAdminMembers({
    tableRows: Array.isArray(data) ? data : [],
    identityUsers,
    currentUser: options.currentUser || null,
  }).filter((member) => isAdminTeamRole(member) && member.isActive !== false && lowerEmail(member.email));
}

module.exports = {
  ADMIN_TEAM_ROLES,
  BANK_HOLIDAY_CACHE_PREFIX,
  BOOKING_STATUS,
  BOOKING_STATUSES,
  DEFAULT_REGION,
  DURATION_MODES,
  GOV_UK_BANK_HOLIDAYS_URL,
  LEAVE_SETTINGS_KEY,
  LEAVE_TYPES,
  addUtcDays,
  asIsoDate,
  buildHolidayLookup,
  buildLeaveYearLabel,
  calculateLeaveBreakdown,
  coded,
  deriveLeaveYear,
  durationModeLabel,
  filterHolidaysByYears,
  findPersonBookingConflicts,
  getBankHolidays,
  isBookingActive,
  iterateDates,
  isAdminTeamRole,
  leaveTypeLabel,
  leaveYearBounds,
  listAdminUsers,
  nextWorkingDay,
  normaliseBookingRow,
  normaliseDurationMode,
  normaliseLeaveType,
  normaliseRegion,
  normaliseRole,
  normaliseStatus,
  parseDateOnly,
  parseDateOnlySafe,
  previousWorkingDay,
  rangesOverlap,
  readAnnualLeaveSettings,
  reminderDue,
  resolveEntitlementDays,
  resolveSevenDayReminderDate,
  round2,
  roundHalf,
  startOfWeek,
  statusLabel,
  summariseBookings,
  trimString,
  lowerEmail,
};
