(function () {
  'use strict';

  const STORAGE_KEY = 'hmj.analytics.dashboard-state:v2';
  const TREND_METRICS = [
    { key: 'pageViews', comparisonKey: 'totalPageViews', label: 'Page views', color: '#2f4ea2' },
    { key: 'sessions', comparisonKey: 'sessions', label: 'Sessions', color: '#158059' },
    { key: 'uniqueVisitors', comparisonKey: 'uniqueVisitors', label: 'Unique visitors', color: '#9d5cff' },
    { key: 'ctaClicks', comparisonKey: 'ctaClicks', label: 'CTA clicks', color: '#b78103' },
  ];
  const SCOPE_OPTIONS = [
    { key: 'public', label: 'Public Website' },
    { key: 'admin', label: 'Admin Portal' },
    { key: 'combined', label: 'Combined' },
  ];
  const PRESET_OPTIONS = [
    { key: 'today', label: 'Today' },
    { key: 'last-7', label: 'Last 7 days' },
    { key: 'last-14', label: 'Last 14 days' },
    { key: 'last-30', label: 'Last 30 days' },
    { key: 'this-month', label: 'This month' },
    { key: 'custom', label: 'Custom' },
  ];

  function formatDateInput(date) {
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
  }

  function addDays(date, amount) {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + amount);
    return next;
  }

  function buildPresetRange(preset) {
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (preset === 'today') {
      return { from: formatDateInput(end), to: formatDateInput(end) };
    }
    if (preset === 'last-7') {
      return { from: formatDateInput(addDays(end, -6)), to: formatDateInput(end) };
    }
    if (preset === 'last-14') {
      return { from: formatDateInput(addDays(end, -13)), to: formatDateInput(end) };
    }
    if (preset === 'this-month') {
      const start = new Date(end.getFullYear(), end.getMonth(), 1);
      return { from: formatDateInput(start), to: formatDateInput(end) };
    }
    return { from: formatDateInput(addDays(end, -29)), to: formatDateInput(end) };
  }

  function defaultFilters(scope) {
    const range = buildPresetRange('last-30');
    return {
      from: range.from,
      to: range.to,
      pagePath: '',
      eventType: '',
      source: '',
      deviceType: '',
      scope: scope || 'combined',
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function trimString(value) {
    return String(value == null ? '' : value).trim();
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return number.toLocaleString();
  }

  function formatPercent(value, digits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0%';
    return `${number.toFixed(Number.isInteger(digits) ? digits : 1)}%`;
  }

  function formatSignedPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0%';
    if (number === 0) return '0%';
    return `${number > 0 ? '+' : ''}${number.toFixed(1)}%`;
  }

  function formatDuration(seconds) {
    const total = Number(seconds);
    if (!Number.isFinite(total) || total <= 0) return '0s';
    const rounded = Math.round(total);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const secs = rounded % 60;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }

  function formatWhen(value) {
    try {
      return new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return value || '';
    }
  }

  function emptyMarkup(message) {
    return `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  function createCsv(rows) {
    const items = Array.isArray(rows) ? rows : [];
    const header = ['timestamp', 'page_path', 'page_title', 'event_type', 'detail', 'session_id', 'source', 'device_type'];
    const body = items.map((row) => [
      row.occurredAt || '',
      row.pagePath || '',
      row.pageTitle || '',
      row.eventType || '',
      row.detail || '',
      row.sessionIdShort || '',
      row.source || '',
      row.deviceType || '',
    ]);
    return [header, ...body]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  }

  function buildLinePath(points) {
    if (!points.length) return '';
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  }

  function getTrendMetric(metricKey) {
    return TREND_METRICS.find((metric) => metric.key === metricKey) || TREND_METRICS[0];
  }

  function scopeLabel(scope) {
    return SCOPE_OPTIONS.find((item) => item.key === scope)?.label || 'Combined';
  }

  function presetLabel(preset) {
    return PRESET_OPTIONS.find((item) => item.key === preset)?.label || 'Custom';
  }

  function rangesMatch(left, right) {
    return left && right && left.from === right.from && left.to === right.to;
  }

  function derivePreset(filters) {
    const candidate = {
      from: filters?.from || '',
      to: filters?.to || '',
    };
    const presets = ['today', 'last-7', 'last-14', 'last-30', 'this-month'];
    for (const preset of presets) {
      if (rangesMatch(candidate, buildPresetRange(preset))) {
        return preset;
      }
    }
    return 'custom';
  }

  function hasAdvancedFilters(filters) {
    return !!(filters?.eventType || filters?.deviceType);
  }

  function loadStoredState() {
    const defaults = {
      filters: defaultFilters('combined'),
      preset: 'last-30',
      compareMode: true,
      trendMetric: TREND_METRICS[0].key,
      advancedOpen: false,
    };

    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
      const scope = ['public', 'admin', 'combined'].includes(parsed?.filters?.scope) ? parsed.filters.scope : 'combined';
      const base = {
        ...defaults,
        ...parsed,
        filters: {
          ...defaultFilters(scope),
          ...(parsed?.filters || {}),
          scope,
        },
      };
      base.preset = derivePreset(base.filters);
      base.advancedOpen = parsed?.advancedOpen === true || hasAdvancedFilters(base.filters);
      base.compareMode = parsed?.compareMode !== false;
      base.trendMetric = TREND_METRICS.some((metric) => metric.key === parsed?.trendMetric)
        ? parsed.trendMetric
        : TREND_METRICS[0].key;
      return base;
    } catch {
      return defaults;
    }
  }

  function saveStoredState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        filters: state.filters,
        preset: state.preset,
        compareMode: state.compareMode,
        trendMetric: state.trendMetric,
        advancedOpen: state.advancedOpen,
      }));
    } catch {}
  }

  function buildRequestPayload(state) {
    return {
      from: state.filters.from,
      to: state.filters.to,
      pagePath: state.filters.pagePath,
      eventType: state.filters.eventType,
      source: state.filters.source,
      deviceType: state.filters.deviceType,
      scope: state.filters.scope,
      compare: state.compareMode,
    };
  }

  function normaliseEmptyResponse(filters) {
    return {
      source: 'supabase',
      setupRequired: false,
      schemaMismatch: false,
      schemaWarnings: [],
      message: '',
      truncated: false,
      definitions: {},
      filters: {
        applied: {
          ...filters,
          siteArea: filters.scope === 'combined' ? '' : filters.scope,
        },
        options: {
          pagePaths: [],
          eventTypes: [],
          referrers: [],
          sources: [],
          deviceTypes: [],
          siteAreas: ['public', 'admin'],
        },
      },
      kpis: {
        totalPageViews: 0,
        uniqueVisitors: 0,
        sessions: 0,
        avgSessionDurationSeconds: 0,
        avgTimeOnPageSeconds: 0,
        bounceRate: 0,
        ctaClicks: 0,
        topPage: '',
      },
      comparison: {
        enabled: false,
        currentPeriod: { from: filters.from, to: filters.to },
        previousPeriod: { from: '', to: '' },
        kpis: {},
      },
      trend: [],
      topPages: [],
      recentActivity: [],
      clickAnalytics: {
        topCtas: [],
        clicksByPage: [],
        clicksOverTime: [],
        jobsFilterUsage: [],
      },
      breakdowns: {
        sources: [],
        devices: [],
        siteAreas: [],
      },
      listings: {
        summary: {
          jobViews: 0,
          specViews: 0,
          applyClicks: 0,
          avgListingTimeSeconds: 0,
        },
        jobs: [],
        specs: [],
        topIntentActions: [],
        mostEngaged: [],
      },
      pathInsights: {
        landingPages: [],
        exitPages: [],
        topPaths: [],
        topTransitions: [],
      },
    };
  }

  function compareTone(metricKey, delta) {
    if (!delta || delta.direction === 'flat') return 'neutral';
    const currentDirection = delta.direction;
    const goodWhenDown = metricKey === 'bounceRate';
    if ((goodWhenDown && currentDirection === 'down') || (!goodWhenDown && currentDirection === 'up')) {
      return 'good';
    }
    return 'bad';
  }

  function compareLabel(delta, previousPeriod) {
    if (!delta) return '';
    if (delta.previous === 0 && delta.current > 0) {
      return `New vs ${previousPeriod || 'previous period'}`;
    }
    return `${formatSignedPercent(delta.deltaPercent)} vs ${previousPeriod || 'previous period'}`;
  }

  function skeletonCard() {
    return `
      <article class="skeleton-card">
        <div class="skeleton skeleton-line skeleton-line--short"></div>
        <div class="skeleton skeleton-line skeleton-line--medium" style="height:28px"></div>
        <div class="skeleton skeleton-line skeleton-line--long"></div>
      </article>
    `;
  }

  function sortRows(rows, sort) {
    const items = Array.isArray(rows) ? rows.slice() : [];
    const key = sort?.key || '';
    const dir = sort?.dir === 'asc' ? 1 : -1;

    return items.sort((left, right) => {
      const a = left?.[key];
      const b = right?.[key];
      const aNumber = Number(a);
      const bNumber = Number(b);
      let result = 0;
      if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
        result = aNumber - bNumber;
      } else {
        result = String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
      }
      if (result === 0) {
        result = String(left?.title || left?.path || '').localeCompare(String(right?.title || right?.path || ''), undefined, { numeric: true, sensitivity: 'base' });
      }
      return result * dir;
    });
  }

  function boot() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      window.setTimeout(boot, 40);
      return;
    }

    window.Admin.bootAdmin(async ({ api, sel, toast }) => {
      const storedState = loadStoredState();
      const state = {
        data: null,
        filters: storedState.filters,
        preset: storedState.preset,
        compareMode: storedState.compareMode,
        trendMetric: storedState.trendMetric,
        advancedOpen: storedState.advancedOpen,
        csvText: '',
        isLoading: true,
        requestId: 0,
        debounceTimer: 0,
        cache: new Map(),
        sorts: {
          topPages: { key: 'pageViews', dir: 'desc' },
          topJobs: { key: 'views', dir: 'desc' },
          topSpecs: { key: 'views', dir: 'desc' },
        },
      };

      const els = {
        statusBanner: sel('#statusBanner'),
        filterSummary: sel('#filterSummary'),
        filterFrom: sel('#filterFrom'),
        filterTo: sel('#filterTo'),
        filterPagePath: sel('#filterPagePath'),
        filterSource: sel('#filterSource'),
        filterEventType: sel('#filterEventType'),
        filterDeviceType: sel('#filterDeviceType'),
        compareToggle: sel('#compareToggle'),
        scopeToggle: sel('#scopeToggle'),
        presetToggle: sel('#presetToggle'),
        toggleAdvancedFilters: sel('#toggleAdvancedFilters'),
        advancedFilters: sel('#advancedFilters'),
        activeFilterChips: sel('#activeFilterChips'),
        refreshData: sel('#refreshData'),
        resetFilters: sel('#resetFilters'),
        exportCsv: sel('#exportCsv'),
        printReport: sel('#printReport'),
        sourceChip: sel('#sourceChip'),
        rangeChip: sel('#rangeChip'),
        truncationChip: sel('#truncationChip'),
        definitionNote: sel('#definitionNote'),
        heroSummary: sel('#heroSummary'),
        lastUpdatedChip: sel('#lastUpdatedChip'),
        topPageChip: sel('#topPageChip'),
        kpiGrid: sel('#kpiGrid'),
        trendMetricToggle: sel('#trendMetricToggle'),
        trendLegend: sel('#trendLegend'),
        trendChart: sel('#trendChart'),
        sourceMixList: sel('#sourceMixList'),
        deviceMixList: sel('#deviceMixList'),
        siteMixList: sel('#siteMixList'),
        topPagesBody: sel('#topPagesBody'),
        listingSummaryCards: sel('#listingSummaryCards'),
        topJobsBody: sel('#topJobsBody'),
        topSpecsBody: sel('#topSpecsBody'),
        listingIntentList: sel('#listingIntentList'),
        listingEngagementList: sel('#listingEngagementList'),
        topCtasList: sel('#topCtasList'),
        clicksByPageList: sel('#clicksByPageList'),
        jobsFilterUsageList: sel('#jobsFilterUsageList'),
        landingPagesList: sel('#landingPagesList'),
        exitPagesList: sel('#exitPagesList'),
        topPathsList: sel('#topPathsList'),
        topTransitionsList: sel('#topTransitionsList'),
        recentActivityList: sel('#recentActivityList'),
        pagePathOptions: sel('#pagePathOptions'),
        sourceOptions: sel('#sourceOptions'),
      };

      function setStatus(message, tone, visible) {
        if (!els.statusBanner) return;
        els.statusBanner.textContent = message || '';
        els.statusBanner.dataset.tone = tone || 'warn';
        els.statusBanner.classList.toggle('is-visible', !!visible && !!message);
      }

      function formatSchemaWarning(field) {
        const labels = {
          event_id: 'event ID column',
          event_id_conflict: 'event ID uniqueness constraint',
          page_visit_id: 'page visit ID',
          full_url: 'full URL',
          utm_source: 'UTM source',
        };
        return labels[field] || String(field || '').replace(/_/g, ' ');
      }

      function analyticsEmptyMessage(defaultMessage) {
        const summary = state.data || {};
        if (summary.schemaMismatch) {
          return summary.message || 'Analytics schema mismatch detected. Apply the Supabase reconciliation SQL and refresh this page.';
        }
        if (summary.setupRequired) {
          return summary.message || 'Apply the website analytics SQL and refresh this page to start loading live analytics.';
        }
        return defaultMessage;
      }

      function syncInputs() {
        if (els.filterFrom) els.filterFrom.value = state.filters.from;
        if (els.filterTo) els.filterTo.value = state.filters.to;
        if (els.filterPagePath) els.filterPagePath.value = state.filters.pagePath;
        if (els.filterSource) els.filterSource.value = state.filters.source;
        if (els.filterEventType) els.filterEventType.value = state.filters.eventType;
        if (els.filterDeviceType) els.filterDeviceType.value = state.filters.deviceType;
        if (els.compareToggle) els.compareToggle.checked = !!state.compareMode;
        if (els.toggleAdvancedFilters) {
          els.toggleAdvancedFilters.setAttribute('aria-expanded', state.advancedOpen ? 'true' : 'false');
          els.toggleAdvancedFilters.textContent = state.advancedOpen ? 'Hide advanced filters' : 'Advanced filters';
        }
        if (els.advancedFilters) {
          els.advancedFilters.hidden = !state.advancedOpen;
        }
      }

      function persistState() {
        saveStoredState(state);
      }

      function renderScopeToggle() {
        if (!els.scopeToggle) return;
        els.scopeToggle.innerHTML = SCOPE_OPTIONS.map((item) => `
          <button type="button" data-scope="${item.key}" aria-pressed="${item.key === state.filters.scope ? 'true' : 'false'}">${escapeHtml(item.label)}</button>
        `).join('');
      }

      function renderPresetToggle() {
        if (!els.presetToggle) return;
        els.presetToggle.innerHTML = PRESET_OPTIONS.map((item) => `
          <button type="button" data-preset="${item.key}" aria-pressed="${item.key === state.preset ? 'true' : 'false'}">${escapeHtml(item.label)}</button>
        `).join('');
      }

      function populateSelect(select, values, emptyLabel) {
        if (!select) return;
        const current = select.value;
        const list = Array.isArray(values) ? values : [];
        select.innerHTML = ['<option value="">' + escapeHtml(emptyLabel) + '</option>']
          .concat(list.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`))
          .join('');
        if (list.includes(current)) {
          select.value = current;
        }
      }

      function populateDatalist(host, values) {
        if (!host) return;
        const list = Array.isArray(values) ? values : [];
        host.innerHTML = list.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
      }

      function renderFilterOptions() {
        const options = state.data?.filters?.options || {};
        populateSelect(els.filterEventType, options.eventTypes || [], 'All event types');
        populateSelect(els.filterDeviceType, options.deviceTypes || [], 'All devices');
        populateDatalist(els.pagePathOptions, options.pagePaths || []);
        populateDatalist(els.sourceOptions, options.sources || options.referrers || []);
        syncInputs();
      }

      function activeFilterConfig() {
        const items = [];
        if (state.filters.pagePath) {
          items.push({ key: 'pagePath', label: 'Page', value: state.filters.pagePath });
        }
        if (state.filters.source) {
          items.push({ key: 'source', label: 'Source', value: state.filters.source });
        }
        if (state.filters.eventType) {
          items.push({ key: 'eventType', label: 'Event', value: state.filters.eventType.replace(/_/g, ' ') });
        }
        if (state.filters.deviceType) {
          items.push({ key: 'deviceType', label: 'Device', value: state.filters.deviceType });
        }
        return items;
      }

      function renderActiveFilters() {
        if (!els.activeFilterChips) return;
        const chips = activeFilterConfig();
        if (!chips.length) {
          els.activeFilterChips.innerHTML = '';
          return;
        }
        els.activeFilterChips.innerHTML = chips.map((chip) => `
          <button class="filter-chip" type="button" data-clear-filter="${escapeHtml(chip.key)}">
            <strong>${escapeHtml(chip.label)}</strong>
            <small>${escapeHtml(chip.value)}</small>
            <span aria-hidden="true">×</span>
          </button>
        `).join('');
      }

      function renderHeader() {
        const summary = state.data || {};
        const filters = summary.filters?.applied || state.filters;
        const setupRequired = !!summary.setupRequired;
        const schemaMismatch = !!summary.schemaMismatch;
        const schemaWarnings = Array.isArray(summary.schemaWarnings) ? summary.schemaWarnings : [];
        const compareSummary = summary.comparison || {};
        const topPage = summary.topPages?.[0];
        const summaryFragments = [
          scopeLabel(filters.scope || state.filters.scope),
          presetLabel(state.preset),
          filters.pagePath ? `Path contains ${filters.pagePath}` : 'All pages',
          filters.source ? `Source includes ${filters.source}` : 'All sources',
          filters.eventType ? `Event: ${filters.eventType.replace(/_/g, ' ')}` : 'All events',
          filters.deviceType ? `${filters.deviceType} traffic` : 'All devices',
        ];

        if (els.filterSummary) {
          els.filterSummary.textContent = summaryFragments.join(' • ');
        }

        if (els.sourceChip) {
          if (schemaMismatch) {
            els.sourceChip.textContent = 'Schema mismatch';
            els.sourceChip.dataset.tone = 'error';
          } else if (setupRequired) {
            els.sourceChip.textContent = 'SQL setup needed';
            els.sourceChip.dataset.tone = 'warn';
          } else if (schemaWarnings.length) {
            els.sourceChip.textContent = 'Compat mode';
            els.sourceChip.dataset.tone = 'warn';
          } else {
            els.sourceChip.textContent = state.isLoading && state.data ? 'Refreshing live view' : 'Supabase live';
            els.sourceChip.dataset.tone = state.isLoading && state.data ? 'warn' : 'good';
          }
        }

        if (els.rangeChip) {
          const compareText = state.compareMode && compareSummary?.previousPeriod?.from
            ? ` • vs ${compareSummary.previousPeriod.from} → ${compareSummary.previousPeriod.to}`
            : '';
          els.rangeChip.textContent = `${filters.from || state.filters.from} → ${filters.to || state.filters.to}${compareText}`;
        }

        if (summary.truncated) {
          els.truncationChip.hidden = false;
          els.truncationChip.dataset.tone = 'warn';
          els.truncationChip.textContent = 'Large range sampled for speed';
        } else {
          els.truncationChip.hidden = true;
        }

        if (els.heroSummary) {
          els.heroSummary.textContent = schemaMismatch
            ? (summary.message || 'Analytics schema mismatch detected. Apply the Supabase reconciliation SQL so the dashboard can return to full live reporting.')
            : setupRequired
            ? 'Apply the Supabase analytics SQL and refresh this page to start loading live traffic, role demand, CTA performance, and session drop-off insights.'
            : schemaWarnings.length
            ? `Live analytics loaded with compatibility fallbacks. Missing schema support: ${schemaWarnings.map(formatSchemaWarning).join(', ')}. Apply the reconciliation SQL for full fidelity.`
            : 'Operational visibility into traffic, engagement quality, CTA intent, and role demand across the HMJ public site and admin portal.';
        }

        if (els.lastUpdatedChip) {
          els.lastUpdatedChip.textContent = schemaMismatch
            ? 'Schema reconciliation required'
            : setupRequired
            ? 'Awaiting analytics schema'
            : summary.recentActivity?.[0]?.occurredAt
            ? `Latest event • ${formatWhen(summary.recentActivity[0].occurredAt)}`
            : 'Waiting for analytics events';
        }

        if (els.topPageChip) {
          els.topPageChip.textContent = topPage?.path
            ? `Top page • ${topPage.path} (${formatNumber(topPage.pageViews || 0)} views)`
            : schemaMismatch
            ? 'Top page unavailable until schema is reconciled'
            : 'Top page pending';
        }

        if (els.definitionNote) {
          const definitions = summary.definitions || {};
          els.definitionNote.textContent = schemaMismatch
            ? `Admin diagnostic: ${summary.message || 'Analytics schema mismatch detected.'}`
            : setupRequired
            ? 'This module expects the Supabase analytics schema before it can report sessions, page performance, and CTA activity.'
            : schemaWarnings.length
            ? `Compatibility note: ${schemaWarnings.map(formatSchemaWarning).join(', ')} missing. Core reporting remains available, but apply the reconciliation SQL for full health checks and deduplication.`
            : `Definitions: unique visitor = ${definitions.unique_visitor || 'distinct visitor_id'}, session = ${definitions.session || 'distinct session_id'}, time on page = ${definitions.time_on_page || 'time_on_page_seconds events'}.`;
        }
      }

      function renderKpis() {
        if (!els.kpiGrid) return;
        if (state.isLoading && !state.data) {
          els.kpiGrid.innerHTML = Array.from({ length: 8 }, skeletonCard).join('');
          return;
        }

        const kpis = state.data?.kpis || {};
        const comparison = state.data?.comparison || {};
        const comparisonPeriod = comparison?.previousPeriod?.from
          ? `${comparison.previousPeriod.from} → ${comparison.previousPeriod.to}`
          : 'previous period';
        const topPage = state.data?.topPages?.[0];

        const cards = [
          {
            key: 'totalPageViews',
            label: 'Total page views',
            value: formatNumber(kpis.totalPageViews || 0),
            subtitle: 'Tracked page_view events',
            meta: `Across ${scopeLabel(state.filters.scope).toLowerCase()}`,
          },
          {
            key: 'uniqueVisitors',
            label: 'Unique visitors',
            value: formatNumber(kpis.uniqueVisitors || 0),
            subtitle: 'Distinct anonymous visitors',
            meta: 'Browser-level visitor IDs',
          },
          {
            key: 'sessions',
            label: 'Sessions',
            value: formatNumber(kpis.sessions || 0),
            subtitle: 'Distinct session IDs',
            meta: 'Good indicator of active usage',
          },
          {
            key: 'avgSessionDurationSeconds',
            label: 'Avg session duration',
            value: formatDuration(kpis.avgSessionDurationSeconds || 0),
            subtitle: 'Session depth over time',
            meta: 'Last event minus first event',
          },
          {
            key: 'avgTimeOnPageSeconds',
            label: 'Avg time on page',
            value: formatDuration(kpis.avgTimeOnPageSeconds || 0),
            subtitle: 'Average active time per page',
            meta: 'Based on heartbeat and leave events',
          },
          {
            key: 'bounceRate',
            label: 'Bounce rate',
            value: formatPercent(kpis.bounceRate || 0),
            subtitle: 'Approximate single-page sessions',
            meta: 'Lower is generally stronger',
          },
          {
            key: 'ctaClicks',
            label: 'CTA clicks',
            value: formatNumber(kpis.ctaClicks || 0),
            subtitle: 'Tracked commercial actions',
            meta: 'Apply, contact, email, phone, share',
          },
          {
            key: 'topPage',
            label: 'Top page',
            value: escapeHtml(kpis.topPage || '—'),
            subtitle: topPage?.pageViews ? `${formatNumber(topPage.pageViews)} views` : 'Awaiting traffic data',
            meta: topPage?.title || 'Most viewed path in range',
          },
        ];

        els.kpiGrid.innerHTML = cards.map((card) => {
          const delta = comparison?.enabled ? comparison.kpis?.[card.key] : null;
          const deltaMarkup = delta
            ? `<span class="metric-delta" data-tone="${compareTone(card.key, delta)}">${escapeHtml(compareLabel(delta, comparisonPeriod))}</span>`
            : '';
          return `
            <article class="kpi-card">
              <div class="kpi-card__top">
                <span class="kpi-card__eyebrow">${escapeHtml(card.label)}</span>
                ${deltaMarkup}
              </div>
              <p class="kpi-card__value">${card.value}</p>
              <p class="kpi-card__subline">${card.subtitle}</p>
              <div class="kpi-card__bottom">
                <span class="kpi-card__meta">${escapeHtml(card.meta)}</span>
              </div>
            </article>
          `;
        }).join('');
      }

      function renderTrendToggle() {
        if (!els.trendMetricToggle) return;
        els.trendMetricToggle.innerHTML = TREND_METRICS.map((item) => `
          <button type="button" data-trend-metric="${item.key}" aria-pressed="${item.key === state.trendMetric ? 'true' : 'false'}">${escapeHtml(item.label)}</button>
        `).join('');
      }

      function renderTrend() {
        renderTrendToggle();
        if (state.isLoading && !state.data) {
          els.trendLegend.innerHTML = `
            <div class="skeleton skeleton-line skeleton-line--medium"></div>
            <div class="skeleton skeleton-line skeleton-line--short"></div>
          `;
          els.trendChart.innerHTML = `
            <div style="padding:18px;display:grid;gap:12px">
              <div class="skeleton skeleton-line skeleton-line--long" style="height:18px"></div>
              <div class="skeleton" style="height:260px;border-radius:18px"></div>
            </div>
          `;
          return;
        }

        const metric = getTrendMetric(state.trendMetric);
        const rows = Array.isArray(state.data?.trend) ? state.data.trend : [];
        const delta = state.data?.comparison?.enabled ? state.data?.comparison?.kpis?.[metric.comparisonKey] : null;
        const periodLabel = state.data?.comparison?.previousPeriod?.from
          ? `${state.data.comparison.previousPeriod.from} → ${state.data.comparison.previousPeriod.to}`
          : 'previous period';

        if (!rows.length) {
          els.trendLegend.innerHTML = '';
          els.trendChart.innerHTML = emptyMarkup(analyticsEmptyMessage('No trend data yet for the current filters.'));
          return;
        }

        const values = rows.map((row) => Number(row[metric.key] || 0));
        const maxValue = Math.max(...values, 1);
        const width = 960;
        const height = 340;
        const padX = 56;
        const padY = 28;
        const chartWidth = width - (padX * 2);
        const chartHeight = height - (padY * 2);
        const points = rows.map((row, index) => ({
          date: row.date,
          value: Number(row[metric.key] || 0),
          x: padX + (index * (chartWidth / Math.max(rows.length - 1, 1))),
          y: padY + chartHeight - ((Number(row[metric.key] || 0) / maxValue) * chartHeight),
        }));
        const areaPath = points.length
          ? `${buildLinePath(points)} L ${points[points.length - 1].x.toFixed(2)} ${(padY + chartHeight).toFixed(2)} L ${points[0].x.toFixed(2)} ${(padY + chartHeight).toFixed(2)} Z`
          : '';
        const yAxis = [0, 0.25, 0.5, 0.75, 1].map((step) => ({
          value: Math.round(maxValue * step),
          y: padY + chartHeight - (chartHeight * step),
        }));
        const labelEvery = Math.max(1, Math.floor(rows.length / 6));
        const labelPoints = points.filter((point, index) => index % labelEvery === 0 || index === points.length - 1);

        els.trendLegend.innerHTML = `
          <span><strong>${escapeHtml(metric.label)}</strong> • ${formatNumber(values.reduce((sum, value) => sum + value, 0))} in range</span>
          <span>Peak day • ${formatNumber(Math.max(...values))}</span>
          <span>Period • ${escapeHtml(rows[0].date)} to ${escapeHtml(rows[rows.length - 1].date)}</span>
          ${delta ? `<span>${escapeHtml(compareLabel(delta, periodLabel))}</span>` : ''}
        `;

        els.trendChart.innerHTML = `
          <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(metric.label)} trend chart">
            <defs>
              <linearGradient id="trendArea" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stop-color="${metric.color}" stop-opacity="0.22"></stop>
                <stop offset="100%" stop-color="${metric.color}" stop-opacity="0.02"></stop>
              </linearGradient>
            </defs>
            ${yAxis.map((tick) => `
              <g>
                <line x1="${padX}" y1="${tick.y}" x2="${width - padX}" y2="${tick.y}" stroke="rgba(47,78,162,0.12)" stroke-dasharray="4 6"></line>
                <text x="${padX - 12}" y="${tick.y + 4}" text-anchor="end" fill="#6678a4" font-size="12" font-weight="700">${formatNumber(tick.value)}</text>
              </g>
            `).join('')}
            ${areaPath ? `<path d="${areaPath}" fill="url(#trendArea)"></path>` : ''}
            <path d="${buildLinePath(points)}" fill="none" stroke="${metric.color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
            ${points.map((point) => `
              <g>
                <circle cx="${point.x}" cy="${point.y}" r="5" fill="#fff" stroke="${metric.color}" stroke-width="3">
                  <title>${point.date}: ${formatNumber(point.value)} ${metric.label.toLowerCase()}</title>
                </circle>
              </g>
            `).join('')}
            ${labelPoints.map((point) => `
              <text x="${point.x}" y="${height - 12}" text-anchor="middle" fill="#6678a4" font-size="12" font-weight="700">${escapeHtml(point.date.slice(5))}</text>
            `).join('')}
          </svg>
        `;
      }

      function renderMixList(host, rows, emptyMessage) {
        if (!host) return;
        const items = Array.isArray(rows) ? rows : [];
        if (!items.length) {
          host.innerHTML = emptyMarkup(emptyMessage);
          return;
        }
        const max = Math.max(...items.map((item) => Number(item.pageViews || 0)), 1);
        host.innerHTML = items.map((item) => `
          <article class="mix-item">
            <div class="mix-item__top">
              <strong>${escapeHtml(item.label || 'Unknown')}</strong>
              <span>${formatNumber(item.pageViews || 0)} views</span>
            </div>
            <div class="mix-bar"><i style="width:${Math.max(8, Math.round((Number(item.pageViews || 0) / max) * 100))}%"></i></div>
            <span>${formatNumber(item.sessions || 0)} sessions • ${formatNumber(item.uniqueVisitors || 0)} visitors</span>
          </article>
        `).join('');
      }

      function renderTopPages() {
        if (!els.topPagesBody) return;
        if (state.isLoading && !state.data) {
          els.topPagesBody.innerHTML = `<tr><td colspan="8">${emptyMarkup('Loading page performance…')}</td></tr>`;
          return;
        }
        const rows = sortRows(state.data?.topPages || [], state.sorts.topPages);
        if (!rows.length) {
          els.topPagesBody.innerHTML = `<tr><td colspan="8">${emptyMarkup(analyticsEmptyMessage('No page data yet for the current filters.'))}</td></tr>`;
          return;
        }
        els.topPagesBody.innerHTML = rows.map((row) => `
          <tr>
            <td>
              <div class="entity-cell">
                <button class="row-link" type="button" data-filter-path="${escapeHtml(row.path || '')}" title="Filter dashboard to this path">${escapeHtml(row.path || '—')}</button>
              </div>
            </td>
            <td title="${escapeHtml(row.title || '—')}">
              <div class="entity-cell">
                <span class="entity-title">${escapeHtml(row.title || '—')}</span>
              </div>
            </td>
            <td class="is-numeric">${formatNumber(row.pageViews || 0)}</td>
            <td class="is-numeric">${formatNumber(row.uniqueVisitors || 0)}</td>
            <td class="is-numeric">${formatDuration(row.avgTimeOnPageSeconds || 0)}</td>
            <td class="is-numeric">${formatNumber(row.exits || 0)}</td>
            <td class="is-numeric">${formatPercent(row.exitRate || 0)}</td>
            <td class="is-numeric">${formatNumber(row.ctaClicks || 0)}</td>
          </tr>
        `).join('');
      }

      function renderSimpleList(host, rows, renderer, emptyMessage) {
        if (!host) return;
        const items = Array.isArray(rows) ? rows : [];
        host.innerHTML = items.length ? items.map(renderer).join('') : emptyMarkup(emptyMessage);
      }

      function listingMeta(row) {
        const parts = [];
        if (row.location) parts.push(row.location);
        if (row.status) parts.push(row.status);
        if (row.jobId) parts.push(`ID ${row.jobId}`);
        else if (row.slug) parts.push(`Spec ${row.slug}`);
        return parts.join(' • ');
      }

      function renderListings() {
        if (state.isLoading && !state.data) {
          els.listingSummaryCards.innerHTML = Array.from({ length: 4 }, skeletonCard).join('');
          els.topJobsBody.innerHTML = `<tr><td colspan="4">${emptyMarkup('Loading job demand…')}</td></tr>`;
          els.topSpecsBody.innerHTML = `<tr><td colspan="4">${emptyMarkup('Loading spec engagement…')}</td></tr>`;
          els.listingIntentList.innerHTML = emptyMarkup('Loading role-level CTA activity…');
          els.listingEngagementList.innerHTML = emptyMarkup('Loading engaged roles…');
          return;
        }

        const listings = state.data?.listings || {};
        const summary = listings.summary || {};
        const jobs = sortRows(listings.jobs || [], state.sorts.topJobs);
        const specs = sortRows(listings.specs || [], state.sorts.topSpecs);

        els.listingSummaryCards.innerHTML = [
          { label: 'Job views', value: formatNumber(summary.jobViews || 0), hint: 'Role detail opens and role-level demand' },
          { label: 'Spec views', value: formatNumber(summary.specViews || 0), hint: 'Resolved spec page interest' },
          { label: 'Apply clicks', value: formatNumber(summary.applyClicks || 0), hint: 'Role apply intent across jobs and specs' },
          { label: 'Avg listing time', value: formatDuration(summary.avgListingTimeSeconds || 0), hint: 'Average engaged time on tracked roles' },
        ].map((item) => `
          <article class="summary-card">
            <span>${escapeHtml(item.label)}</span>
            <strong>${item.value}</strong>
            <small>${escapeHtml(item.hint)}</small>
          </article>
        `).join('');

        els.topJobsBody.innerHTML = jobs.length ? jobs.map((row) => `
          <tr>
            <td>
              <div class="entity-cell" title="${escapeHtml(listingMeta(row))}">
                <span class="entity-title">${escapeHtml(row.title || 'Untitled role')}</span>
                <span class="entity-meta">${escapeHtml(listingMeta(row) || 'HMJ role activity')}</span>
              </div>
            </td>
            <td class="is-numeric">${formatNumber(row.views || 0)}</td>
            <td class="is-numeric">${formatNumber(row.applyClicks || 0)}</td>
            <td class="is-numeric">${formatNumber(row.ctaClicks || 0)}</td>
          </tr>
        `).join('') : `<tr><td colspan="4">${emptyMarkup(analyticsEmptyMessage('No identifiable job activity yet for the current filters.'))}</td></tr>`;

        els.topSpecsBody.innerHTML = specs.length ? specs.map((row) => `
          <tr>
            <td>
              <div class="entity-cell" title="${escapeHtml(listingMeta(row))}">
                <span class="entity-title">${escapeHtml(row.title || 'Untitled spec')}</span>
                <span class="entity-meta">${escapeHtml(listingMeta(row) || 'Shareable spec page')}</span>
              </div>
            </td>
            <td class="is-numeric">${formatNumber(row.views || 0)}</td>
            <td class="is-numeric">${formatDuration(row.avgTimeOnPageSeconds || 0)}</td>
            <td class="is-numeric">${formatNumber(row.applyClicks || 0)}</td>
          </tr>
        `).join('') : `<tr><td colspan="4">${emptyMarkup(analyticsEmptyMessage('No identifiable spec activity yet for the current filters.'))}</td></tr>`;

        renderSimpleList(
          els.listingIntentList,
          listings.topIntentActions,
          (row) => `
            <article class="list-item">
              <div class="list-item__top">
                <strong>${escapeHtml(row.title || 'Untitled role')}</strong>
                <span class="badge" data-tone="cta">${escapeHtml(row.action || 'CTA')}</span>
              </div>
              <span>${formatNumber(row.count || 0)} tracked actions</span>
            </article>
          `,
          analyticsEmptyMessage('Role-level CTA actions will appear here once job and spec clicks are recorded.')
        );

        renderSimpleList(
          els.listingEngagementList,
          listings.mostEngaged,
          (row) => `
            <article class="list-item">
              <div class="list-item__top">
                <strong>${escapeHtml(row.title || 'Untitled role')}</strong>
                <span class="badge">${row.kind === 'spec' ? 'Spec' : 'Job'}</span>
              </div>
              <span>${formatNumber(row.views || 0)} views • ${formatNumber(row.applyClicks || 0)} apply clicks • ${formatDuration(row.avgTimeOnPageSeconds || 0)} avg time</span>
            </article>
          `,
          analyticsEmptyMessage('Most engaged roles will appear here once enough listing activity is recorded.')
        );
      }

      function renderClicks() {
        renderSimpleList(
          els.topCtasList,
          state.data?.clickAnalytics?.topCtas,
          (row) => `
            <article class="list-item">
              <div class="list-item__top">
                <strong>${escapeHtml(row.label)}</strong>
                <span class="badge" data-tone="cta">${formatNumber(row.clicks || 0)} clicks</span>
              </div>
              <span>${row.topPage ? `Top page: ${escapeHtml(row.topPage)}` : 'CTA activity across current filters'}</span>
            </article>
          `,
          analyticsEmptyMessage('No CTA clicks recorded for the current filters.')
        );

        renderSimpleList(
          els.clicksByPageList,
          state.data?.clickAnalytics?.clicksByPage,
          (row) => `
            <article class="list-item">
              <div class="list-item__top">
                <strong>${escapeHtml(row.path)}</strong>
                <span>${formatNumber(row.clicks || 0)} clicks</span>
              </div>
            </article>
          `,
          analyticsEmptyMessage('No page-level CTA clicks recorded yet.')
        );

        renderSimpleList(
          els.jobsFilterUsageList,
          state.data?.clickAnalytics?.jobsFilterUsage,
          (row) => `
            <article class="list-item">
              <div class="list-item__top">
                <strong>${escapeHtml(row.label || 'Jobs filter used')}</strong>
                <span>${escapeHtml(formatWhen(row.occurredAt))}</span>
              </div>
            </article>
          `,
          analyticsEmptyMessage('No jobs filter activity yet.')
        );
      }

      function renderPaths() {
        renderSimpleList(
          els.landingPagesList,
          state.data?.pathInsights?.landingPages,
          (row) => `<article class="list-item"><strong>${escapeHtml(row.path)}</strong><span>${formatNumber(row.sessions || 0)} landing sessions</span></article>`,
          analyticsEmptyMessage('Landing pages will appear here once sessions are recorded.')
        );

        renderSimpleList(
          els.exitPagesList,
          state.data?.pathInsights?.exitPages,
          (row) => `<article class="list-item"><strong>${escapeHtml(row.path)}</strong><span>${formatNumber(row.sessions || 0)} exit sessions</span></article>`,
          analyticsEmptyMessage('Exit pages will appear here once sessions are recorded.')
        );

        renderSimpleList(
          els.topPathsList,
          state.data?.pathInsights?.topPaths,
          (row) => `<article class="list-item"><strong>${escapeHtml(row.path)}</strong><span>${formatNumber(row.sessions || 0)} sessions</span></article>`,
          analyticsEmptyMessage('Common journeys will appear here after multiple page sequences are tracked.')
        );

        renderSimpleList(
          els.topTransitionsList,
          state.data?.pathInsights?.topTransitions,
          (row) => `<article class="list-item"><strong>${escapeHtml(row.from)} → ${escapeHtml(row.to)}</strong><span>${formatNumber(row.count || 0)} transitions</span></article>`,
          analyticsEmptyMessage('Next-page transitions will appear here once visitors move between pages.')
        );
      }

      function renderRecent() {
        if (!els.recentActivityList) return;
        if (state.isLoading && !state.data) {
          els.recentActivityList.innerHTML = Array.from({ length: 5 }, () => `
            <article class="skeleton-card">
              <div class="skeleton skeleton-line skeleton-line--short"></div>
              <div class="skeleton skeleton-line skeleton-line--long"></div>
              <div class="skeleton skeleton-line skeleton-line--medium"></div>
            </article>
          `).join('');
          return;
        }

        const rows = Array.isArray(state.data?.recentActivity) ? state.data.recentActivity : [];
        if (!rows.length) {
          els.recentActivityList.innerHTML = emptyMarkup(analyticsEmptyMessage('No recent visitor activity yet.'));
          return;
        }
        els.recentActivityList.innerHTML = rows.map((row) => `
          <article class="feed-item">
            <div class="feed-item__top">
              <div>
                <strong>${escapeHtml(row.eventLabel || row.eventType || 'Activity')}</strong>
                <span>${escapeHtml(row.detail || row.pagePath || '')}</span>
              </div>
              <span class="badge" data-tone="${escapeHtml(row.category || 'activity')}">${escapeHtml((row.siteArea || '').toUpperCase() || 'EVENT')}</span>
            </div>
            <div class="feed-item__meta">
              <small>${escapeHtml(formatWhen(row.occurredAt))}</small>
              <small>${escapeHtml(row.pagePath || '/')}</small>
              <small>Session ${escapeHtml(row.sessionIdShort || '')}</small>
              ${row.source ? `<small>${escapeHtml(row.source)}</small>` : ''}
              ${row.deviceType ? `<small>${escapeHtml(row.deviceType)}</small>` : ''}
            </div>
          </article>
        `).join('');
      }

      function renderSortStates() {
        document.querySelectorAll('[data-sort-table]').forEach((button) => {
          const table = button.getAttribute('data-sort-table');
          const key = button.getAttribute('data-sort-key');
          const current = state.sorts?.[table];
          const sortState = current?.key === key ? current.dir : 'none';
          button.setAttribute('aria-sort-state', sortState);
        });
      }

      function renderMixPanels() {
        renderMixList(els.sourceMixList, state.data?.breakdowns?.sources, analyticsEmptyMessage('Source mix will appear after live traffic is recorded.'));
        renderMixList(els.deviceMixList, state.data?.breakdowns?.devices, analyticsEmptyMessage('Device mix will appear once visitor sessions are recorded.'));
        renderMixList(els.siteMixList, state.data?.breakdowns?.siteAreas, analyticsEmptyMessage('Public and admin scope mix will appear here.'));
      }

      function renderAll() {
        renderScopeToggle();
        renderPresetToggle();
        renderFilterOptions();
        renderActiveFilters();
        renderHeader();
        renderKpis();
        renderTrend();
        renderMixPanels();
        renderTopPages();
        renderListings();
        renderClicks();
        renderPaths();
        renderRecent();
        renderSortStates();
        state.csvText = createCsv(state.data?.recentActivity || []);
      }

      function updateFilter(key, value) {
        state.filters = {
          ...state.filters,
          [key]: value,
        };
        if (key === 'from' || key === 'to') {
          state.preset = derivePreset(state.filters);
        }
        if (key === 'eventType' || key === 'deviceType') {
          state.advancedOpen = hasAdvancedFilters(state.filters) || state.advancedOpen;
        }
        persistState();
        syncInputs();
        renderScopeToggle();
        renderPresetToggle();
        renderActiveFilters();
      }

      function applyPreset(preset) {
        state.preset = preset;
        if (preset !== 'custom') {
          const range = buildPresetRange(preset);
          state.filters = {
            ...state.filters,
            from: range.from,
            to: range.to,
          };
        }
        persistState();
        syncInputs();
        renderPresetToggle();
      }

      function resetFilters() {
        const scope = state.filters.scope;
        state.filters = defaultFilters(scope);
        state.preset = 'last-30';
        state.compareMode = true;
        state.advancedOpen = false;
        persistState();
        syncInputs();
        renderScopeToggle();
        renderPresetToggle();
        renderActiveFilters();
      }

      function cacheKey() {
        return JSON.stringify(buildRequestPayload(state));
      }

      async function loadDashboard(options) {
        const force = !!options?.force;
        const requestPayload = buildRequestPayload(state);
        const key = JSON.stringify(requestPayload);
        const requestId = ++state.requestId;

        if (!force && state.cache.has(key)) {
          state.data = state.cache.get(key);
          state.isLoading = false;
          renderAll();
          setStatus('Loaded cached HMJ analytics view.', 'good', true);
          return;
        }

        state.isLoading = true;
        renderAll();
        if (els.refreshData) {
          els.refreshData.disabled = true;
          els.refreshData.textContent = 'Refreshing…';
        }
        setStatus('Loading live analytics from Supabase…', 'good', true);

        try {
          const response = await api('admin-analytics-dashboard', 'POST', requestPayload);
          if (requestId !== state.requestId) return;
          if (response.setupRequired || response.schemaMismatch || response.schemaWarnings?.length) {
            state.cache.delete(key);
          } else {
            state.cache.set(key, response);
          }
          state.data = response;
          state.isLoading = false;
          renderAll();

          if (response.setupRequired) {
            setStatus(response.message || 'Apply the website analytics SQL in Supabase, then refresh this page.', 'warn', true);
          } else if (response.schemaMismatch) {
            setStatus(response.message || 'Analytics schema mismatch detected. Apply the Supabase reconciliation SQL.', 'error', true);
          } else if (response.schemaWarnings?.length) {
            setStatus(response.message || `Live analytics loaded in compatibility mode. Missing schema support: ${response.schemaWarnings.map(formatSchemaWarning).join(', ')}.`, 'warn', true);
          } else if (!response.topPages?.length && !response.recentActivity?.length) {
            setStatus('Analytics is live, but there are no matching events for the current filters yet.', 'warn', true);
          } else if (response.truncated) {
            setStatus('A large date range was sampled for speed. Narrow the range if you need the full raw event spread.', 'warn', true);
          } else {
            setStatus('Live HMJ analytics loaded successfully.', 'good', true);
          }
        } catch (error) {
          if (requestId !== state.requestId) return;
          state.isLoading = false;
          setStatus(error?.message || 'Analytics failed to load.', 'error', true);
          if (!state.data) {
            state.data = normaliseEmptyResponse(state.filters);
            renderAll();
          }
        } finally {
          if (requestId === state.requestId && els.refreshData) {
            els.refreshData.disabled = false;
            els.refreshData.textContent = 'Refresh';
          }
        }
      }

      function scheduleLoad(delay) {
        window.clearTimeout(state.debounceTimer);
        state.debounceTimer = window.setTimeout(() => {
          void loadDashboard();
        }, Number.isFinite(delay) ? delay : 260);
      }

      function bindEvents() {
        els.scopeToggle?.addEventListener('click', (event) => {
          const button = event.target.closest('[data-scope]');
          if (!button) return;
          updateFilter('scope', button.getAttribute('data-scope') || 'combined');
          void loadDashboard();
        });

        els.presetToggle?.addEventListener('click', (event) => {
          const button = event.target.closest('[data-preset]');
          if (!button) return;
          applyPreset(button.getAttribute('data-preset') || 'custom');
          void loadDashboard();
        });

        els.filterFrom?.addEventListener('change', () => {
          updateFilter('from', els.filterFrom.value || defaultFilters(state.filters.scope).from);
          state.preset = 'custom';
          persistState();
          renderPresetToggle();
          void loadDashboard();
        });

        els.filterTo?.addEventListener('change', () => {
          updateFilter('to', els.filterTo.value || defaultFilters(state.filters.scope).to);
          state.preset = 'custom';
          persistState();
          renderPresetToggle();
          void loadDashboard();
        });

        els.filterPagePath?.addEventListener('input', () => {
          updateFilter('pagePath', trimString(els.filterPagePath.value));
          scheduleLoad(320);
        });

        els.filterSource?.addEventListener('input', () => {
          updateFilter('source', trimString(els.filterSource.value));
          scheduleLoad(320);
        });

        els.filterEventType?.addEventListener('change', () => {
          updateFilter('eventType', els.filterEventType.value || '');
          void loadDashboard();
        });

        els.filterDeviceType?.addEventListener('change', () => {
          updateFilter('deviceType', els.filterDeviceType.value || '');
          void loadDashboard();
        });

        els.compareToggle?.addEventListener('change', () => {
          state.compareMode = !!els.compareToggle.checked;
          persistState();
          void loadDashboard({ force: true });
        });

        els.toggleAdvancedFilters?.addEventListener('click', () => {
          state.advancedOpen = !state.advancedOpen;
          persistState();
          syncInputs();
        });

        els.resetFilters?.addEventListener('click', () => {
          resetFilters();
          void loadDashboard({ force: true });
        });

        els.refreshData?.addEventListener('click', () => {
          state.cache.delete(cacheKey());
          void loadDashboard({ force: true });
        });

        els.exportCsv?.addEventListener('click', () => {
          if (!state.csvText) {
            toast('No analytics rows available to export yet.', 'warn', 2600);
            return;
          }
          const blob = new Blob([state.csvText], { type: 'text/csv;charset=utf-8' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `hmj-analytics-${state.filters.scope}-${state.filters.from}-to-${state.filters.to}.csv`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(link.href), 1200);
          toast('Analytics CSV exported.', 'ok', 2200);
        });

        els.printReport?.addEventListener('click', () => {
          window.print();
        });

        document.addEventListener('click', (event) => {
          const clearButton = event.target.closest('[data-clear-filter]');
          if (clearButton) {
            const key = clearButton.getAttribute('data-clear-filter');
            if (key && Object.prototype.hasOwnProperty.call(state.filters, key)) {
              updateFilter(key, '');
              void loadDashboard();
            }
            return;
          }

          const sortButton = event.target.closest('[data-sort-table]');
          if (sortButton) {
            const table = sortButton.getAttribute('data-sort-table');
            const key = sortButton.getAttribute('data-sort-key');
            if (!table || !key) return;
            const current = state.sorts[table] || {};
            state.sorts[table] = {
              key,
              dir: current.key === key && current.dir === 'desc' ? 'asc' : 'desc',
            };
            renderAll();
            return;
          }

          const pathButton = event.target.closest('[data-filter-path]');
          if (pathButton) {
            const path = pathButton.getAttribute('data-filter-path') || '';
            updateFilter('pagePath', path);
            void loadDashboard();
          }
        });
      }

      renderAll();
      syncInputs();
      bindEvents();
      await loadDashboard({ force: true });
    });
  }

  boot();
})();
