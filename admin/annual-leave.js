(function () {
  'use strict';

  const LEAVE_TYPE_LABELS = {
    annual_leave: 'Annual leave',
    unpaid_leave: 'Unpaid leave',
    sick: 'Sick leave',
    other: 'Other',
  };

  const STATUS_LABELS = {
    booked: 'Booked',
    cancelled: 'Cancelled',
  };

  const DURATION_LABELS = {
    full_day: 'Full day(s)',
    half_day_am: 'Half day AM',
    half_day_pm: 'Half day PM',
  };

  const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const USER_COLOR_PALETTE = [
    { fill: 'rgba(47, 78, 162, 0.14)', border: 'rgba(47, 78, 162, 0.28)', accent: '#2f4ea2', text: '#16244c' },
    { fill: 'rgba(20, 132, 90, 0.14)', border: 'rgba(20, 132, 90, 0.28)', accent: '#14845a', text: '#12382b' },
    { fill: 'rgba(185, 116, 5, 0.14)', border: 'rgba(185, 116, 5, 0.28)', accent: '#b97405', text: '#5e4309' },
    { fill: 'rgba(114, 69, 199, 0.14)', border: 'rgba(114, 69, 199, 0.28)', accent: '#7245c7', text: '#35205f' },
    { fill: 'rgba(166, 54, 43, 0.14)', border: 'rgba(166, 54, 43, 0.28)', accent: '#a6362b', text: '#5d221d' },
    { fill: 'rgba(13, 116, 144, 0.14)', border: 'rgba(13, 116, 144, 0.28)', accent: '#0d7490', text: '#143540' },
    { fill: 'rgba(123, 86, 34, 0.14)', border: 'rgba(123, 86, 34, 0.28)', accent: '#7b5622', text: '#46341d' },
    { fill: 'rgba(32, 103, 171, 0.14)', border: 'rgba(32, 103, 171, 0.28)', accent: '#2067ab', text: '#18324f' },
  ];

  const state = {
    helpers: null,
    viewer: null,
    year: new Date().getFullYear(),
    monthDate: monthStart(new Date()),
    settings: null,
    region: 'england-and-wales',
    holidays: [],
    holidayWarning: '',
    adminUsers: [],
    bookings: [],
    filtered: [],
    summary: null,
    activeId: '',
    loading: false,
    saving: false,
    filters: {
      userId: 'all',
      status: 'all',
      leaveType: 'all',
      query: '',
    },
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function setupElements() {
    [
      'annualWelcomeMeta',
      'leaveYearLabel',
      'leaveYearSelect',
      'annualStatusChips',
      'btnNewBooking',
      'btnToday',
      'btnThisMonth',
      'btnExportAnnualLeaveCsv',
      'btnRefreshAnnualLeave',
      'heroTotalLeave',
      'heroTotalLeaveMeta',
      'heroUpcoming',
      'heroUpcomingMeta',
      'heroThisWeek',
      'heroThisWeekMeta',
      'heroBankHolidays',
      'heroBankHolidaysMeta',
      'bookingPanelHeading',
      'bookingId',
      'leaveBookingForm',
      'bookingUser',
      'bookingStartDate',
      'bookingEndDate',
      'bookingDurationMode',
      'bookingLeaveType',
      'bookingNote',
      'bookingMetrics',
      'metricCalendarDays',
      'metricWorkingDays',
      'metricBankHolidays',
      'metricEffectiveLeave',
      'bookingFormFeedback',
      'btnBookLeaveForMe',
      'btnResetBooking',
      'btnSaveBooking',
      'btnCancelEditing',
      'btnPrevMonth',
      'btnCurrentMonth',
      'btnNextMonth',
      'calendarMonthLabel',
      'filterUser',
      'filterStatus',
      'filterLeaveType',
      'filterSearch',
      'annualAlerts',
      'calendarWeekdays',
      'calendarGrid',
      'resultsChip',
      'btnClearFilters',
      'bookingTableBody',
      'bookingEmptyState',
      'kpiTotalLeaveDays',
      'kpiUpcoming30',
      'kpiUpcoming30Meta',
      'kpiThisWeek',
      'kpiNextWeek',
      'kpiBankHolidaysRemaining',
      'peopleOffTodayList',
      'peopleOffThisWeekList',
      'peopleOffNextWeekList',
      'monthDistributionChart',
      'busiestMonthsMeta',
      'perPersonList',
      'overlapWarningsList',
      'bankHolidayList',
      'recentLeaveList',
      'detailOverlay',
      'detailDrawer',
      'detailTitle',
      'detailMeta',
      'detailBody',
      'btnCloseDetail',
      'btnEditDetail',
      'btnCancelDetail',
    ].forEach((id) => {
      els[id] = $(id);
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toIsoDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? date.toISOString().slice(0, 10)
      : '';
  }

  function parseIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(date, amount) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + amount);
    return next;
  }

  function monthStart(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  function startOfWeek(date) {
    const safe = new Date(date.getTime());
    const day = safe.getUTCDay();
    const delta = day === 0 ? -6 : 1 - day;
    return addDays(safe, delta);
  }

  function formatDate(value, options) {
    const date = value instanceof Date ? value : parseIsoDate(value);
    if (!date) return '—';
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeZone: 'UTC',
      ...(options || {}),
    }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function formatDateRange(startDate, endDate) {
    if (!startDate || !endDate) return '—';
    if (startDate === endDate) return formatDate(startDate);
    return `${formatDate(startDate)} – ${formatDate(endDate)}`;
  }

  function formatLeaveDays(value) {
    const amount = Number(value || 0);
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
  }

  function statusTone(status) {
    return status === 'cancelled' ? 'danger' : 'ok';
  }

  function leaveTypeTone(type) {
    if (type === 'sick') return 'danger';
    if (type === 'unpaid_leave') return 'warn';
    if (type === 'other') return 'warn';
    return 'ok';
  }

  function yearOptions(baseYear) {
    return [baseYear - 1, baseYear, baseYear + 1, baseYear + 2];
  }

  function fillYearSelect() {
    if (!els.leaveYearSelect) return;
    els.leaveYearSelect.innerHTML = yearOptions(new Date().getFullYear())
      .map((year) => `<option value="${year}">${year}</option>`)
      .join('');
    els.leaveYearSelect.value = String(state.year);
  }

  function annualUrl(path) {
    return `/.netlify/functions/${path}`;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(options?.body ? { 'content-type': 'application/json' } : {}),
      },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.error || 'Annual leave request failed.');
      error.code = payload?.code || '';
      error.details = payload?.details || null;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function userDisplay(row) {
    if (!row) return '—';
    return row.displayName || row.userName || row.userEmail || 'Admin';
  }

  function setFormFeedback(message, tone) {
    if (!els.bookingFormFeedback) return;
    if (!message) {
      els.bookingFormFeedback.hidden = true;
      els.bookingFormFeedback.textContent = '';
      els.bookingFormFeedback.removeAttribute('data-tone');
      return;
    }
    els.bookingFormFeedback.hidden = false;
    els.bookingFormFeedback.textContent = message;
    els.bookingFormFeedback.dataset.tone = tone || 'info';
  }

  function computeDraftMetrics() {
    const start = parseIsoDate(els.bookingStartDate?.value || '');
    const end = parseIsoDate(els.bookingEndDate?.value || '');
    const durationMode = els.bookingDurationMode?.value || 'full_day';
    const holidayMap = new Map((state.holidays || []).map((row) => [row.date, row]));

    const fallback = {
      calendarDays: 0,
      workingDays: 0,
      bankHolidays: 0,
      effectiveLeave: 0,
      warning: '',
    };

    if (!start || !end) return fallback;
    if (end < start) {
      return {
        ...fallback,
        warning: 'End date cannot be before start date.',
      };
    }
    if (durationMode !== 'full_day' && toIsoDate(start) !== toIsoDate(end)) {
      return {
        ...fallback,
        warning: 'Half-day bookings must use the same start and end date.',
      };
    }

    let calendarDays = 0;
    let workingDays = 0;
    let bankHolidays = 0;
    let weekends = 0;

    for (let cursor = new Date(start.getTime()); cursor <= end; cursor = addDays(cursor, 1)) {
      calendarDays += 1;
      const iso = toIsoDate(cursor);
      const day = cursor.getUTCDay();
      if (day === 0 || day === 6) {
        weekends += 1;
        continue;
      }
      if (holidayMap.has(iso)) {
        bankHolidays += 1;
        continue;
      }
      workingDays += 1;
    }

    if (workingDays < 1) {
      return {
        calendarDays,
        workingDays,
        bankHolidays,
        effectiveLeave: 0,
        warning: 'This range contains no working days after weekends and bank holidays are excluded.',
      };
    }

    const effectiveLeave = durationMode === 'full_day' ? workingDays : 0.5;
    const warnings = [];
    if (weekends > 0) warnings.push('Weekend dates are excluded.');
    if (bankHolidays > 0) warnings.push('Bank holidays are excluded.');

    return {
      calendarDays,
      workingDays,
      bankHolidays,
      effectiveLeave,
      warning: warnings.join(' '),
    };
  }

  function renderDraftMetrics() {
    const metrics = computeDraftMetrics();
    if (els.metricCalendarDays) els.metricCalendarDays.textContent = String(metrics.calendarDays || 0);
    if (els.metricWorkingDays) els.metricWorkingDays.textContent = formatLeaveDays(metrics.workingDays || 0);
    if (els.metricBankHolidays) els.metricBankHolidays.textContent = formatLeaveDays(metrics.bankHolidays || 0);
    if (els.metricEffectiveLeave) els.metricEffectiveLeave.textContent = formatLeaveDays(metrics.effectiveLeave || 0);
    setFormFeedback(metrics.warning || '', metrics.warning ? 'info' : '');
    return metrics;
  }

  function findCurrentUserOption() {
    const viewerEmail = String(state.viewer?.email || '').toLowerCase();
    return state.adminUsers.find((row) => String(row.email || '').toLowerCase() === viewerEmail)
      || state.adminUsers[0]
      || null;
  }

  function fillUserSelects() {
    const options = ['<option value="">Select an admin user</option>']
      .concat(state.adminUsers.map((row) => (
        `<option value="${escapeHtml(row.userId)}" data-email="${escapeHtml(row.email)}" data-name="${escapeHtml(row.displayName)}">${escapeHtml(userDisplay(row))}</option>`
      )));

    if (els.bookingUser) {
      const current = els.bookingUser.value;
      els.bookingUser.innerHTML = options.join('');
      if (current && state.adminUsers.some((row) => row.userId === current)) {
        els.bookingUser.value = current;
      } else if (!state.activeId) {
        const me = findCurrentUserOption();
        els.bookingUser.value = me ? me.userId : '';
      }
    }

    if (els.filterUser) {
      const currentFilter = state.filters.userId;
      els.filterUser.innerHTML = ['<option value="all">All admins</option>']
        .concat(state.adminUsers.map((row) => `<option value="${escapeHtml(row.userId)}">${escapeHtml(userDisplay(row))}</option>`))
        .join('');
      els.filterUser.value = state.adminUsers.some((row) => row.userId === currentFilter) ? currentFilter : 'all';
      state.filters.userId = els.filterUser.value;
    }
  }

  function renderStatusChips() {
    if (!els.annualStatusChips) return;
    const chips = [
      { label: `Leave year ${state.year}`, tone: 'ok' },
      { label: 'UK bank holidays active', tone: 'ok' },
      { label: '7 day + 1 working day reminders', tone: state.settings?.remindersEnabled ? 'ok' : 'warn' },
      { label: state.region.replace(/-/g, ' '), tone: 'ok' },
    ];
    els.annualStatusChips.innerHTML = chips.map((chip) => `<span class="finance-status" data-tone="${chip.tone}">${escapeHtml(chip.label)}</span>`).join('');
  }

  function bookingTypeLabel(type) {
    return LEAVE_TYPE_LABELS[type] || LEAVE_TYPE_LABELS.annual_leave;
  }

  function bookingStatusLabel(status) {
    return STATUS_LABELS[status] || STATUS_LABELS.booked;
  }

  function bookingDurationLabel(mode) {
    return DURATION_LABELS[mode] || DURATION_LABELS.full_day;
  }

  function hashString(value) {
    const text = String(value || '');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function userCalendarColor(row) {
    const key = row?.userId || row?.userEmail || row?.userName || row?.id || '';
    const index = hashString(key) % USER_COLOR_PALETTE.length;
    return USER_COLOR_PALETTE[index];
  }

  function userChipStyle(row) {
    const palette = userCalendarColor(row);
    const cancelledOpacity = row?.status === 'cancelled' ? '0.62' : '1';
    return [
      `--annual-user-fill:${palette.fill}`,
      `--annual-user-border:${palette.border}`,
      `--annual-user-accent:${palette.accent}`,
      `--annual-user-text:${palette.text}`,
      `opacity:${cancelledOpacity}`,
    ].join(';');
  }

  function sortBookings(rows) {
    return rows.slice().sort((left, right) => {
      if (left.status !== right.status) {
        if (left.status === 'cancelled') return 1;
        if (right.status === 'cancelled') return -1;
      }
      return (left.startDate || '').localeCompare(right.startDate || '')
        || (left.userName || '').localeCompare(right.userName || '', 'en-GB', { sensitivity: 'base' });
    });
  }

  function applyFilters() {
    const needle = String(state.filters.query || '').trim().toLowerCase();
    state.filtered = sortBookings(state.bookings.filter((row) => {
      if (state.filters.userId !== 'all' && row.userId !== state.filters.userId) return false;
      if (state.filters.status !== 'all' && row.status !== state.filters.status) return false;
      if (state.filters.leaveType !== 'all' && row.leaveType !== state.filters.leaveType) return false;
      if (!needle) return true;
      const haystack = [
        row.userName,
        row.userEmail,
        row.note,
        row.leaveTypeLabel,
        row.statusLabel,
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    }));
  }

  function renderHeroSummary() {
    const summary = state.summary || {};
    if (els.leaveYearLabel) els.leaveYearLabel.textContent = summary?.leaveYear?.label || 'Loading…';
    if (els.heroTotalLeave) els.heroTotalLeave.textContent = `${formatLeaveDays(summary.totalEffectiveDays || 0)} day${Number(summary.totalEffectiveDays || 0) === 1 ? '' : 's'}`;
    if (els.heroTotalLeaveMeta) els.heroTotalLeaveMeta.textContent = `${summary.bookingsCount || 0} booked item${summary.bookingsCount === 1 ? '' : 's'} in ${state.year}.`;
    if (els.heroUpcoming) els.heroUpcoming.textContent = `${summary.upcoming30Bookings || 0}`;
    if (els.heroUpcomingMeta) els.heroUpcomingMeta.textContent = `${formatLeaveDays(summary.upcoming30EffectiveDays || 0)} effective day${Number(summary.upcoming30EffectiveDays || 0) === 1 ? '' : 's'} in the next 30 days.`;
    if (els.heroThisWeek) els.heroThisWeek.textContent = `${(summary.peopleOffThisWeek || []).length}`;
    if (els.heroThisWeekMeta) els.heroThisWeekMeta.textContent = `${(summary.peopleOffThisWeek || []).map((row) => row.userName).slice(0, 3).join(', ') || 'No one off this week.'}`;
    if (els.heroBankHolidays) els.heroBankHolidays.textContent = `${summary.bankHolidaysRemaining || 0}`;
    if (els.heroBankHolidaysMeta) els.heroBankHolidaysMeta.textContent = state.holidayWarning || 'England and Wales default calendar.';
  }

  function renderAlerts() {
    if (!els.annualAlerts) return;
    const alerts = [];
    if (state.holidayWarning) {
      alerts.push({ tone: 'info', text: state.holidayWarning });
    }
    (state.summary?.alerts || []).forEach((item) => alerts.push(item));
    if (!state.filtered.length && state.bookings.length) {
      alerts.push({ tone: 'info', text: 'No bookings match the current filters.' });
    }
    els.annualAlerts.innerHTML = alerts.map((item) => `<div class="annual-alert" data-tone="${item.tone || 'warn'}">${escapeHtml(item.text)}</div>`).join('');
  }

  function renderWeekdays() {
    if (!els.calendarWeekdays) return;
    els.calendarWeekdays.innerHTML = WEEKDAY_LABELS.map((label) => `<div>${label}</div>`).join('');
  }

  function bookingsForDate(isoDate) {
    return state.filtered.filter((row) => Array.isArray(row.effectiveDates) && row.effectiveDates.includes(isoDate));
  }

  function holidayForDate(isoDate) {
    return (state.holidays || []).find((row) => row.date === isoDate) || null;
  }

  function openDetail(bookingId) {
    state.activeId = bookingId;
    renderDetailDrawer();
  }

  function renderCalendar() {
    if (!els.calendarGrid || !state.monthDate) return;
    const monthStartDate = monthStart(state.monthDate);
    const monthStartIso = toIsoDate(monthStartDate);
    const gridStart = startOfWeek(monthStartDate);
    const todayIso = toIsoDate(new Date());
    const monthLabel = new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(monthStartDate);

    if (els.calendarMonthLabel) els.calendarMonthLabel.textContent = monthLabel;

    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const date = addDays(gridStart, index);
      const iso = toIsoDate(date);
      const outside = iso.slice(0, 7) !== monthStartIso.slice(0, 7);
      const holiday = holidayForDate(iso);
      const bookings = bookingsForDate(iso);
      const bookingMarkup = bookings.slice(0, 3).map((row) => (
        `<button type="button" class="annual-leave-chip" data-booking-id="${escapeHtml(row.id)}" data-type="${escapeHtml(row.leaveType)}" data-status="${escapeHtml(row.status)}" style="${escapeHtml(userChipStyle(row))}">
          <span class="annual-leave-chip__person">
            <i class="annual-leave-chip__swatch" aria-hidden="true"></i>
            <span>${escapeHtml(row.userName)}</span>
          </span>
          <span class="annual-leave-chip__meta">${escapeHtml(bookingDurationLabel(row.durationMode))}</span>
        </button>`
      )).join('');
      const moreMarkup = bookings.length > 3
        ? `<div class="annual-day__meta">+${bookings.length - 3} more</div>`
        : '';

      cells.push(`
        <article class="annual-day" data-date="${iso}" data-outside-month="${outside}" data-weekend="${date.getUTCDay() === 0 || date.getUTCDay() === 6}" data-today="${iso === todayIso}">
          <div class="annual-day__head">
            <strong class="annual-day__num">${date.getUTCDate()}</strong>
            <span class="annual-day__meta">${bookings.length ? `${bookings.length} off` : ''}</span>
          </div>
          <div class="annual-day__items">
            ${holiday ? `<div class="annual-holiday-chip">${escapeHtml(holiday.title)}</div>` : ''}
            ${bookingMarkup}
            ${moreMarkup}
          </div>
        </article>
      `);
    }

    els.calendarGrid.innerHTML = cells.join('');
    els.calendarGrid.querySelectorAll('[data-booking-id]').forEach((button) => {
      button.addEventListener('click', () => openDetail(button.getAttribute('data-booking-id')));
    });
  }

  function renderTable() {
    if (!els.bookingTableBody || !els.bookingEmptyState) return;
    if (els.resultsChip) {
      els.resultsChip.textContent = `${state.filtered.length} booking${state.filtered.length === 1 ? '' : 's'} in view`;
    }
    if (!state.filtered.length) {
      els.bookingTableBody.innerHTML = '';
      els.bookingEmptyState.hidden = false;
      return;
    }

    els.bookingEmptyState.hidden = true;
    els.bookingTableBody.innerHTML = state.filtered.map((row) => `
      <tr>
        <td>
          <strong>${escapeHtml(row.userName)}</strong>
          <small>${escapeHtml(row.userEmail)}</small>
        </td>
        <td>
          <strong>${escapeHtml(formatDateRange(row.startDate, row.endDate))}</strong>
          <small>${escapeHtml(bookingDurationLabel(row.durationMode))}</small>
        </td>
        <td>
          <strong>${escapeHtml(formatLeaveDays(row.effectiveLeaveDays))}</strong>
          <small>${escapeHtml(formatLeaveDays(row.workingDaysCount))} working days • ${escapeHtml(formatLeaveDays(row.bankHolidaysCount))} bank holidays excluded</small>
        </td>
        <td>
          <span class="finance-status" data-tone="${leaveTypeTone(row.leaveType)}">${escapeHtml(bookingTypeLabel(row.leaveType))}</span>
        </td>
        <td>
          <span class="finance-status" data-tone="${statusTone(row.status)}">${escapeHtml(bookingStatusLabel(row.status))}</span>
        </td>
        <td><small>${escapeHtml(row.note || '—')}</small></td>
        <td><small>${escapeHtml(row.createdByEmail || '—')}</small></td>
        <td><small>${escapeHtml(formatDateTime(row.createdAt))}</small></td>
        <td>
          <div class="annual-table__actions">
            <button class="finance-btn finance-btn--ghost" type="button" data-action="view" data-booking-id="${escapeHtml(row.id)}">View</button>
            <button class="finance-btn finance-btn--ghost" type="button" data-action="edit" data-booking-id="${escapeHtml(row.id)}">Edit</button>
            <button class="finance-btn finance-btn--ghost" type="button" data-action="cancel" data-booking-id="${escapeHtml(row.id)}" ${row.status === 'cancelled' ? 'disabled' : ''}>Cancel</button>
          </div>
        </td>
      </tr>
    `).join('');

    els.bookingTableBody.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const bookingId = button.getAttribute('data-booking-id');
        const action = button.getAttribute('data-action');
        if (action === 'view') {
          openDetail(bookingId);
          return;
        }
        if (action === 'edit') {
          const row = state.bookings.find((item) => item.id === bookingId);
          if (row) loadBookingIntoForm(row);
          return;
        }
        if (action === 'cancel') {
          await cancelBooking(bookingId);
        }
      });
    });
  }

  function renderFinanceList(host, items, renderItem) {
    if (!host) return;
    if (!items || !items.length) {
      host.innerHTML = '<div class="finance-empty">Nothing to show.</div>';
      return;
    }
    host.innerHTML = items.map(renderItem).join('');
  }

  function renderAnalytics() {
    const summary = state.summary || {};
    if (els.kpiTotalLeaveDays) els.kpiTotalLeaveDays.textContent = formatLeaveDays(summary.totalEffectiveDays || 0);
    if (els.kpiUpcoming30) els.kpiUpcoming30.textContent = String(summary.upcoming30Bookings || 0);
    if (els.kpiUpcoming30Meta) els.kpiUpcoming30Meta.textContent = `${formatLeaveDays(summary.upcoming30EffectiveDays || 0)} effective days booked.`;
    if (els.kpiThisWeek) els.kpiThisWeek.textContent = String((summary.peopleOffThisWeek || []).length);
    if (els.kpiNextWeek) els.kpiNextWeek.textContent = String((summary.peopleOffNextWeek || []).length);
    if (els.kpiBankHolidaysRemaining) els.kpiBankHolidaysRemaining.textContent = String(summary.bankHolidaysRemaining || 0);

    renderFinanceList(els.peopleOffTodayList, summary.peopleOffToday || [], (row) => `
      <div class="finance-list-item">
        <strong>${escapeHtml(row.userName)}</strong>
        <small>${escapeHtml(row.userEmail || '')}</small>
      </div>
    `);
    renderFinanceList(els.peopleOffThisWeekList, summary.peopleOffThisWeek || [], (row) => `
      <div class="finance-list-item">
        <strong>${escapeHtml(row.userName)}</strong>
        <small>${escapeHtml(row.userEmail || '')}</small>
      </div>
    `);
    renderFinanceList(els.peopleOffNextWeekList, summary.peopleOffNextWeek || [], (row) => `
      <div class="finance-list-item">
        <strong>${escapeHtml(row.userName)}</strong>
        <small>${escapeHtml(row.userEmail || '')}</small>
      </div>
    `);

    if (els.monthDistributionChart) {
      const monthly = summary.monthly || [];
      const maxValue = Math.max(1, ...monthly.map((row) => Number(row.effectiveDays || 0)));
      els.monthDistributionChart.innerHTML = monthly.map((row) => {
        const height = Math.max(8, Math.round((Number(row.effectiveDays || 0) / maxValue) * 160));
        return `
          <div class="annual-month-bar">
            <span class="annual-month-bar__value">${escapeHtml(formatLeaveDays(row.effectiveDays || 0))}</span>
            <div class="annual-month-bar__fill" style="height:${height}px"></div>
            <span class="annual-month-bar__label">${escapeHtml(row.label)}</span>
          </div>
        `;
      }).join('');
    }

    if (els.busiestMonthsMeta) {
      const busiest = (summary.busiestMonths || []).map((row) => `${row.label} (${formatLeaveDays(row.effectiveDays)} days)`);
      els.busiestMonthsMeta.textContent = busiest.length
        ? `Most booked months: ${busiest.join(' • ')}`
        : 'No booked leave has been recorded in this year yet.';
    }

    renderFinanceList(els.perPersonList, summary.perPerson || [], (row) => `
      <div class="finance-list-item">
        <strong>${escapeHtml(row.userName)}</strong>
        <small>${escapeHtml(formatLeaveDays(row.effectiveLeaveDays))} day${Number(row.effectiveLeaveDays) === 1 ? '' : 's'} • ${escapeHtml(String(row.bookingsCount || 0))} booking${row.bookingsCount === 1 ? '' : 's'}</small>
      </div>
    `);

    renderFinanceList(els.overlapWarningsList, summary.overlaps || [], (row) => `
      <div class="finance-list-item">
        <strong>${escapeHtml(formatDate(row.date))}</strong>
        <small>${escapeHtml(String(row.count))} people off • ${escapeHtml((row.people || []).join(', '))}</small>
      </div>
    `);

    renderFinanceList(els.bankHolidayList, summary.remainingBankHolidays || [], (row) => `
      <div class="finance-list-item">
        <strong>${escapeHtml(row.title)}</strong>
        <small>${escapeHtml(formatDate(row.date))}</small>
      </div>
    `);

    renderFinanceList(els.recentLeaveList, summary.recent || [], (row) => `
      <div class="finance-list-item">
        <strong>${escapeHtml(row.userName)}</strong>
        <small>${escapeHtml(formatDateRange(row.startDate, row.endDate))} • ${escapeHtml(bookingStatusLabel(row.status))}</small>
      </div>
    `);
  }

  function detailBooking() {
    return state.bookings.find((row) => row.id === state.activeId) || null;
  }

  function renderDetailDrawer() {
    const row = detailBooking();
    if (!els.detailDrawer || !els.detailOverlay) return;
    const isOpen = !!row;
    els.detailOverlay.hidden = !isOpen;
    els.detailDrawer.dataset.open = isOpen ? 'true' : 'false';
    els.detailDrawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    if (!row) {
      if (els.detailBody) els.detailBody.innerHTML = '<div class="finance-empty">Select a leave booking to inspect it here.</div>';
      if (els.detailTitle) els.detailTitle.textContent = 'Leave booking';
      if (els.detailMeta) els.detailMeta.textContent = 'Select a leave event to inspect it here.';
      if (els.btnCancelDetail) els.btnCancelDetail.disabled = true;
      return;
    }

    if (els.detailTitle) els.detailTitle.textContent = row.userName;
    if (els.detailMeta) els.detailMeta.textContent = `${formatDateRange(row.startDate, row.endDate)} • ${formatLeaveDays(row.effectiveLeaveDays)} effective day${Number(row.effectiveLeaveDays) === 1 ? '' : 's'}`;
    if (els.btnCancelDetail) els.btnCancelDetail.disabled = row.status === 'cancelled';
    if (els.detailBody) {
      els.detailBody.innerHTML = `
        <div class="annual-detail-block">
          <div class="annual-detail-grid">
            <div><span>User</span><strong>${escapeHtml(row.userName)}</strong></div>
            <div><span>Email</span><strong>${escapeHtml(row.userEmail || '—')}</strong></div>
            <div><span>Leave type</span><strong>${escapeHtml(bookingTypeLabel(row.leaveType))}</strong></div>
            <div><span>Status</span><strong>${escapeHtml(bookingStatusLabel(row.status))}</strong></div>
            <div><span>Duration</span><strong>${escapeHtml(bookingDurationLabel(row.durationMode))}</strong></div>
            <div><span>Leave year</span><strong>${escapeHtml(String(row.leaveYear || state.year))}</strong></div>
            <div><span>Working days</span><strong>${escapeHtml(formatLeaveDays(row.workingDaysCount))}</strong></div>
            <div><span>Effective leave</span><strong>${escapeHtml(formatLeaveDays(row.effectiveLeaveDays))}</strong></div>
            <div><span>Bank holidays excluded</span><strong>${escapeHtml(formatLeaveDays(row.bankHolidaysCount))}</strong></div>
            <div><span>Weekends excluded</span><strong>${escapeHtml(formatLeaveDays(row.excludedWeekendDaysCount))}</strong></div>
          </div>
        </div>
        <div class="annual-detail-block">
          <strong>Note</strong>
          <div>${escapeHtml(row.note || 'No note recorded.')}</div>
        </div>
        <div class="annual-detail-block">
          <div class="annual-detail-grid">
            <div><span>Created by</span><strong>${escapeHtml(row.createdByEmail || '—')}</strong></div>
            <div><span>Created at</span><strong>${escapeHtml(formatDateTime(row.createdAt))}</strong></div>
            <div><span>Updated at</span><strong>${escapeHtml(formatDateTime(row.updatedAt))}</strong></div>
            <div><span>Cancelled at</span><strong>${escapeHtml(row.cancelledAt ? formatDateTime(row.cancelledAt) : '—')}</strong></div>
          </div>
        </div>
      `;
    }
  }

  function closeDetail() {
    state.activeId = '';
    renderDetailDrawer();
  }

  function selectedUserData(userId) {
    const option = state.adminUsers.find((row) => row.userId === userId);
    return option || null;
  }

  function readFormPayload() {
    const user = selectedUserData(els.bookingUser?.value || '');
    return {
      id: els.bookingId?.value || '',
      userId: user?.userId || '',
      userEmail: user?.email || '',
      userName: user?.displayName || '',
      startDate: els.bookingStartDate?.value || '',
      endDate: els.bookingEndDate?.value || '',
      durationMode: els.bookingDurationMode?.value || 'full_day',
      leaveType: els.bookingLeaveType?.value || 'annual_leave',
      note: els.bookingNote?.value || '',
    };
  }

  function resetForm(options) {
    if (els.leaveBookingForm) els.leaveBookingForm.reset();
    if (els.bookingId) els.bookingId.value = '';
    if (els.bookingPanelHeading) els.bookingPanelHeading.textContent = 'New booking';
    if (els.btnCancelEditing) els.btnCancelEditing.hidden = true;
    const targetYear = options?.preserveDates ? state.year : new Date().getFullYear();
    if (!options?.preserveDates) {
      const today = new Date();
      if (state.year === today.getFullYear()) {
        const iso = toIsoDate(today);
        if (els.bookingStartDate) els.bookingStartDate.value = iso;
        if (els.bookingEndDate) els.bookingEndDate.value = iso;
      } else {
        const iso = `${targetYear}-01-02`;
        if (els.bookingStartDate) els.bookingStartDate.value = iso;
        if (els.bookingEndDate) els.bookingEndDate.value = iso;
      }
      if (els.bookingDurationMode) els.bookingDurationMode.value = 'full_day';
      if (els.bookingLeaveType) els.bookingLeaveType.value = 'annual_leave';
    }
    const me = findCurrentUserOption();
    if (els.bookingUser && me) els.bookingUser.value = me.userId;
    renderDraftMetrics();
  }

  function loadBookingIntoForm(row) {
    if (!row) return;
    if (els.bookingPanelHeading) els.bookingPanelHeading.textContent = `Editing ${row.userName}`;
    if (els.bookingId) els.bookingId.value = row.id;
    if (els.bookingUser) els.bookingUser.value = row.userId;
    if (els.bookingStartDate) els.bookingStartDate.value = row.startDate;
    if (els.bookingEndDate) els.bookingEndDate.value = row.endDate;
    if (els.bookingDurationMode) els.bookingDurationMode.value = row.durationMode;
    if (els.bookingLeaveType) els.bookingLeaveType.value = row.leaveType;
    if (els.bookingNote) els.bookingNote.value = row.note || '';
    if (els.btnCancelEditing) els.btnCancelEditing.hidden = false;
    state.monthDate = monthStart(parseIsoDate(row.startDate) || state.monthDate);
    renderDraftMetrics();
    renderCalendar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveBooking(event) {
    event.preventDefault();
    const draftMetrics = computeDraftMetrics();
    if (draftMetrics.warning && draftMetrics.effectiveLeave <= 0) {
      setFormFeedback(draftMetrics.warning, 'error');
      return;
    }
    const payload = readFormPayload();
    if (!payload.userId) {
      setFormFeedback('Select an admin user before saving.', 'error');
      return;
    }
    state.saving = true;
    setFormFeedback('Saving booking…', 'info');
    try {
      const isEdit = !!payload.id;
      const bookingYear = parseIsoDate(payload.startDate)?.getUTCFullYear() || state.year;
      if (bookingYear !== state.year) {
        state.year = bookingYear;
        if (els.leaveYearSelect) els.leaveYearSelect.value = String(state.year);
      }
      const response = await fetchJson(annualUrl(isEdit ? 'admin-annual-leave-update' : 'admin-annual-leave-create'), {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      state.helpers.toast(response.message || 'Annual leave booking saved.', 'ok', 2600);
      resetForm();
      await loadWorkspace();
    } catch (error) {
      if (error.status === 409 && error.details?.conflicts?.length) {
        const conflictText = error.details.conflicts.map((row) => `${row.userName}: ${formatDateRange(row.startDate, row.endDate)}`).join(' • ');
        setFormFeedback(`${error.message} ${conflictText}`, 'error');
      } else {
        setFormFeedback(error.message, 'error');
      }
    } finally {
      state.saving = false;
    }
  }

  async function cancelBooking(bookingId) {
    if (!bookingId) return;
    if (!window.confirm('Cancel this annual leave booking?')) return;
    try {
      const response = await fetchJson(annualUrl('admin-annual-leave-cancel'), {
        method: 'POST',
        body: JSON.stringify({ id: bookingId }),
      });
      state.helpers.toast(response.message || 'Annual leave booking cancelled.', 'ok', 2600);
      closeDetail();
      await loadWorkspace();
    } catch (error) {
      state.helpers.toast(error.message, 'warn', 3200);
    }
  }

  async function exportCsv() {
    const headers = [
      'Person',
      'Email',
      'Start date',
      'End date',
      'Duration',
      'Leave type',
      'Status',
      'Working days',
      'Bank holidays excluded',
      'Effective leave days',
      'Note',
      'Created by',
      'Created at',
    ];
    const lines = [headers];
    state.filtered.forEach((row) => {
      lines.push([
        row.userName,
        row.userEmail,
        row.startDate,
        row.endDate,
        bookingDurationLabel(row.durationMode),
        bookingTypeLabel(row.leaveType),
        bookingStatusLabel(row.status),
        row.workingDaysCount,
        row.bankHolidaysCount,
        row.effectiveLeaveDays,
        row.note || '',
        row.createdByEmail || '',
        row.createdAt || '',
      ]);
    });
    const csv = lines
      .map((cols) => cols.map((value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `annual-leave-${state.year}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1200);
  }

  async function loadAdminUsers() {
    const payload = await fetchJson(annualUrl('admin-annual-leave-admin-users'));
    state.adminUsers = Array.isArray(payload.rows) ? payload.rows : [];
    fillUserSelects();
  }

  async function loadWorkspace() {
    state.loading = true;
    const payload = await fetchJson(`${annualUrl('admin-annual-leave-list')}?year=${encodeURIComponent(state.year)}&region=${encodeURIComponent(state.region)}`);
    state.viewer = payload.viewer || {};
    state.settings = payload.settings || {};
    state.region = payload.region || state.region;
    state.holidays = Array.isArray(payload.holidays) ? payload.holidays : [];
    state.holidayWarning = payload.holidayWarning || '';
    state.bookings = Array.isArray(payload.rows) ? payload.rows : [];
    state.summary = payload.summary || {};
    if (els.annualWelcomeMeta) {
      els.annualWelcomeMeta.textContent = `Signed in as ${payload.viewer?.email || 'admin user'}`;
    }
    applyFilters();
    renderStatusChips();
    renderHeroSummary();
    renderAlerts();
    renderCalendar();
    renderTable();
    renderAnalytics();
    renderDetailDrawer();
    renderDraftMetrics();
    state.loading = false;
  }

  function updateMonth(date) {
    state.monthDate = monthStart(date);
    renderCalendar();
  }

  function bindEvents() {
    els.leaveYearSelect?.addEventListener('change', async () => {
      state.year = Number(els.leaveYearSelect.value || new Date().getFullYear());
      state.monthDate = monthStart(parseIsoDate(`${state.year}-01-01`) || new Date(Date.UTC(state.year, 0, 1)));
      resetForm({ preserveDates: false });
      await loadWorkspace();
    });
    els.btnRefreshAnnualLeave?.addEventListener('click', () => loadWorkspace().catch((error) => state.helpers.toast(error.message, 'warn', 3200)));
    els.btnNewBooking?.addEventListener('click', () => {
      resetForm();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    els.btnToday?.addEventListener('click', () => {
      const today = new Date();
      state.year = today.getFullYear();
      if (els.leaveYearSelect) els.leaveYearSelect.value = String(state.year);
      updateMonth(today);
      loadWorkspace().catch((error) => state.helpers.toast(error.message, 'warn', 3200));
    });
    els.btnThisMonth?.addEventListener('click', () => {
      const today = new Date();
      state.year = today.getFullYear();
      if (els.leaveYearSelect) els.leaveYearSelect.value = String(state.year);
      updateMonth(today);
      loadWorkspace().catch((error) => state.helpers.toast(error.message, 'warn', 3200));
    });
    els.btnCurrentMonth?.addEventListener('click', () => {
      const today = new Date();
      state.year = today.getFullYear();
      if (els.leaveYearSelect) els.leaveYearSelect.value = String(state.year);
      updateMonth(today);
      loadWorkspace().catch((error) => state.helpers.toast(error.message, 'warn', 3200));
    });
    els.btnPrevMonth?.addEventListener('click', () => updateMonth(new Date(Date.UTC(state.monthDate.getUTCFullYear(), state.monthDate.getUTCMonth() - 1, 1))));
    els.btnNextMonth?.addEventListener('click', () => updateMonth(new Date(Date.UTC(state.monthDate.getUTCFullYear(), state.monthDate.getUTCMonth() + 1, 1))));
    els.btnBookLeaveForMe?.addEventListener('click', () => {
      const me = findCurrentUserOption();
      if (me && els.bookingUser) els.bookingUser.value = me.userId;
    });
    els.btnResetBooking?.addEventListener('click', () => resetForm());
    els.btnCancelEditing?.addEventListener('click', () => resetForm());
    els.leaveBookingForm?.addEventListener('submit', saveBooking);
    ['bookingStartDate', 'bookingEndDate', 'bookingDurationMode', 'bookingLeaveType', 'bookingUser'].forEach((id) => {
      els[id]?.addEventListener('change', renderDraftMetrics);
    });
    els.bookingNote?.addEventListener('input', () => {
      if (!els.bookingFormFeedback?.hidden) renderDraftMetrics();
    });
    els.filterUser?.addEventListener('change', () => {
      state.filters.userId = els.filterUser.value || 'all';
      applyFilters();
      renderAlerts();
      renderCalendar();
      renderTable();
    });
    els.filterStatus?.addEventListener('change', () => {
      state.filters.status = els.filterStatus.value || 'all';
      applyFilters();
      renderAlerts();
      renderCalendar();
      renderTable();
    });
    els.filterLeaveType?.addEventListener('change', () => {
      state.filters.leaveType = els.filterLeaveType.value || 'all';
      applyFilters();
      renderAlerts();
      renderCalendar();
      renderTable();
    });
    els.filterSearch?.addEventListener('input', () => {
      state.filters.query = els.filterSearch.value || '';
      applyFilters();
      renderAlerts();
      renderCalendar();
      renderTable();
    });
    els.btnClearFilters?.addEventListener('click', () => {
      state.filters = { userId: 'all', status: 'all', leaveType: 'all', query: '' };
      if (els.filterUser) els.filterUser.value = 'all';
      if (els.filterStatus) els.filterStatus.value = 'all';
      if (els.filterLeaveType) els.filterLeaveType.value = 'all';
      if (els.filterSearch) els.filterSearch.value = '';
      applyFilters();
      renderAlerts();
      renderCalendar();
      renderTable();
    });
    els.btnExportAnnualLeaveCsv?.addEventListener('click', exportCsv);
    els.detailOverlay?.addEventListener('click', closeDetail);
    els.btnCloseDetail?.addEventListener('click', closeDetail);
    els.btnEditDetail?.addEventListener('click', () => {
      const row = detailBooking();
      if (!row) return;
      loadBookingIntoForm(row);
      closeDetail();
    });
    els.btnCancelDetail?.addEventListener('click', () => {
      const row = detailBooking();
      if (!row) return;
      cancelBooking(row.id);
    });
  }

  function boot() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      window.setTimeout(boot, 40);
      return;
    }
    setupElements();
    renderWeekdays();
    fillYearSelect();
    resetForm();

    window.Admin.bootAdmin(async (helpers) => {
      state.helpers = helpers;
      state.viewer = await helpers.identity('admin');
      await loadAdminUsers();
      await loadWorkspace();
      bindEvents();
    });
  }

  boot();
})();
