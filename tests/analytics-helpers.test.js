const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseIngestBody,
  buildIngestRows,
  parseDashboardFilters,
  buildComparisonFilters,
  buildComparisonSummary,
  summariseAnalytics,
  createCsv,
  extractMissingAnalyticsColumn,
  classifyAnalyticsSchemaIssue,
  writeAnalyticsRowsWithCompatibility,
} = require('../netlify/functions/_analytics.js');

function createMockSupabase(handlers = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        upsert(rows, options) {
          calls.push({ table, method: 'upsert', rows, options });
          return Promise.resolve(handlers.upsert ? handlers.upsert(rows, options, table) : { error: null });
        },
        insert(rows) {
          calls.push({ table, method: 'insert', rows });
          return Promise.resolve(handlers.insert ? handlers.insert(rows, table) : { error: null });
        },
        select(columns) {
          calls.push({ table, method: 'select', columns });
          return {
            limit(count) {
              calls.push({ table, method: 'limit', count });
              return Promise.resolve(handlers.select ? handlers.select(columns, count, table) : { data: [], error: null });
            },
          };
        },
      };
    },
  };
}

test('buildIngestRows normalises valid analytics events and skips invalid entries', () => {
  const payload = parseIngestBody(JSON.stringify({
    events: [
      {
        eventType: 'page_view',
        visitorId: 'visitor-1',
        sessionId: 'session-1',
        pageVisitId: 'visit-1',
        fullUrl: 'https://www.hmj-global.com/jobs.html?utm_source=linkedin',
        pageTitle: 'Jobs | HMJ',
        deviceType: 'mobile',
        viewport: { width: 390, height: 844 },
        timezone: 'Europe/London',
      },
      {
        eventType: 'INVALID TYPE',
        visitorId: 'visitor-1',
        sessionId: 'session-1',
      },
    ],
  }));

  const { rows, rejected } = buildIngestRows({
    headers: {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'x-nf-client-connection-ip': '203.0.113.10',
      'x-country': 'GB',
    },
  }, payload, { ipSalt: 'hmj-test-salt' });

  assert.equal(rows.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rows[0].event_type, 'page_view');
  assert.equal(rows[0].page_path, '/jobs.html');
  assert.equal(rows[0].page_title, 'Jobs | HMJ');
  assert.equal(rows[0].device_type, 'mobile');
  assert.equal(rows[0].viewport_width, 390);
  assert.equal(rows[0].timezone, 'Europe/London');
  assert.equal(rows[0].country, 'GB');
  assert.match(rows[0].ip_hash, /^[a-f0-9]{64}$/);
});

test('parseDashboardFilters clamps very large ranges to the supported analytics window', () => {
  const filters = parseDashboardFilters({
    from: '2025-01-01',
    to: '2026-01-01',
    eventType: 'page_view',
    deviceType: 'desktop',
    scope: 'public',
  });

  assert.equal(filters.to, '2026-01-01');
  assert.equal(filters.eventType, 'page_view');
  assert.equal(filters.deviceType, 'desktop');
  assert.equal(filters.siteArea, 'public');
  assert.equal(filters.scope, 'public');

  const fromMs = Date.parse(filters.fromIso);
  const toMs = Date.parse(filters.toExclusiveIso);
  const diffDays = Math.round((toMs - fromMs) / 86400000);
  assert.ok(diffDays <= 120, 'date range should be capped to 120 days');
});

test('buildComparisonFilters mirrors the previous equivalent period', () => {
  const filters = parseDashboardFilters({
    from: '2026-03-10',
    to: '2026-03-16',
    source: 'linkedin',
    scope: 'admin',
  });
  const previous = buildComparisonFilters(filters);

  assert.equal(previous.from, '2026-03-03');
  assert.equal(previous.to, '2026-03-09');
  assert.equal(previous.source, 'linkedin');
  assert.equal(previous.scope, 'admin');
});

test('analytics schema helpers detect missing event_id correctly', () => {
  const error = { message: 'column analytics_events.event_id does not exist' };
  assert.equal(extractMissingAnalyticsColumn(error), 'event_id');
  assert.deepEqual(classifyAnalyticsSchemaIssue(error), {
    type: 'missing_column',
    message: 'column analytics_events.event_id does not exist',
    missingColumn: 'event_id',
  });
});

test('writeAnalyticsRowsWithCompatibility falls back to legacy insert when event_id is missing', async () => {
  const supabase = createMockSupabase({
    upsert() {
      return { error: { message: 'column analytics_events.event_id does not exist' } };
    },
    insert() {
      return { error: null };
    },
  });

  const rows = [{
    event_id: 'evt_1',
    occurred_at: '2026-03-01T00:00:00.000Z',
    visitor_id: 'visitor-1',
    session_id: 'session-1',
    event_type: 'page_view',
    site_area: 'public',
    page_path: '/',
    payload: {},
  }];

  const result = await writeAnalyticsRowsWithCompatibility(supabase, rows);

  assert.equal(result.mode, 'legacy_insert');
  assert.deepEqual(result.schemaWarnings, ['event_id']);
  assert.equal(supabase.calls[0].method, 'upsert');
  assert.equal(supabase.calls[1].method, 'insert');
  assert.ok(!Object.prototype.hasOwnProperty.call(supabase.calls[1].rows[0], 'event_id'));
});

test('summariseAnalytics builds KPI, page, click, and path insights from raw events', () => {
  const rows = [
    {
      occurred_at: '2026-03-01T10:00:00.000Z',
      visitor_id: 'visitor-1',
      session_id: 'session-1',
      page_visit_id: 'visit-home',
      event_type: 'page_view',
      page_path: '/',
      page_title: 'Home',
      referrer_domain: 'linkedin.com',
      device_type: 'desktop',
      payload: {},
    },
    {
      occurred_at: '2026-03-01T10:01:00.000Z',
      visitor_id: 'visitor-1',
      session_id: 'session-1',
      page_visit_id: 'visit-home',
      event_type: 'time_on_page_seconds',
      page_path: '/',
      page_title: 'Home',
      duration_seconds: 24,
      device_type: 'desktop',
      payload: {},
    },
    {
      occurred_at: '2026-03-01T10:02:00.000Z',
      visitor_id: 'visitor-1',
      session_id: 'session-1',
      page_visit_id: 'visit-jobs',
      event_type: 'page_view',
      page_path: '/jobs.html',
      page_title: 'Jobs',
      referrer_domain: 'linkedin.com',
      device_type: 'desktop',
      payload: {},
    },
    {
      occurred_at: '2026-03-01T10:03:00.000Z',
      visitor_id: 'visitor-1',
      session_id: 'session-1',
      page_visit_id: 'visit-jobs',
      event_type: 'jobs_card_clicked',
      page_path: '/jobs.html',
      page_title: 'Jobs',
      event_label: 'Open MEP Manager',
      device_type: 'desktop',
      payload: { job_id: 'role-1', job_title: 'MEP Manager', job_location: 'Slough' },
    },
    {
      occurred_at: '2026-03-01T10:04:00.000Z',
      visitor_id: 'visitor-1',
      session_id: 'session-1',
      page_visit_id: 'visit-spec',
      event_type: 'page_view',
      page_path: '/jobs/spec.html',
      full_url: 'https://www.hmj-global.com/jobs/spec.html?id=role-1',
      page_title: 'Job Spec',
      referrer_domain: 'linkedin.com',
      device_type: 'desktop',
      payload: {},
    },
    {
      occurred_at: '2026-03-01T10:05:00.000Z',
      visitor_id: 'visitor-1',
      session_id: 'session-1',
      page_visit_id: 'visit-spec',
      event_type: 'job_apply_clicked',
      page_path: '/jobs/spec.html',
      full_url: 'https://www.hmj-global.com/jobs/spec.html?id=role-1',
      page_title: 'MEP Manager | HMJ Global',
      event_label: 'Apply for MEP Manager',
      device_type: 'desktop',
      payload: { job_id: 'role-1', job_title: 'MEP Manager', job_location: 'Slough' },
    },
    {
      occurred_at: '2026-03-01T10:06:00.000Z',
      visitor_id: 'visitor-1',
      session_id: 'session-1',
      page_visit_id: 'visit-spec',
      event_type: 'time_on_page_seconds',
      page_path: '/jobs/spec.html',
      full_url: 'https://www.hmj-global.com/jobs/spec.html?id=role-1',
      page_title: 'MEP Manager | HMJ Global',
      duration_seconds: 63,
      device_type: 'desktop',
      payload: {},
    },
    {
      occurred_at: '2026-03-02T08:00:00.000Z',
      visitor_id: 'visitor-2',
      session_id: 'session-2',
      page_visit_id: 'visit-about',
      event_type: 'page_view',
      page_path: '/about.html',
      page_title: 'About',
      referrer_domain: 'google.com',
      device_type: 'mobile',
      payload: {},
    },
    {
      occurred_at: '2026-03-02T08:01:00.000Z',
      visitor_id: 'visitor-2',
      session_id: 'session-2',
      page_visit_id: 'visit-about',
      event_type: 'time_on_page_seconds',
      page_path: '/about.html',
      page_title: 'About',
      duration_seconds: 11,
      device_type: 'mobile',
      payload: {},
    },
  ];

  const filters = parseDashboardFilters({ from: '2026-03-01', to: '2026-03-02' });
  const summary = summariseAnalytics(rows, filters, rows.slice().reverse(), false);

  assert.equal(summary.kpis.totalPageViews, 4);
  assert.equal(summary.kpis.uniqueVisitors, 2);
  assert.equal(summary.kpis.sessions, 2);
  assert.equal(summary.kpis.ctaClicks, 2);
  assert.equal(summary.kpis.bounceRate, 50);
  assert.equal(summary.topPages[0].path, '/');
  assert.equal(summary.clickAnalytics.topCtas[0].label, 'Apply for MEP Manager');
  assert.equal(summary.filters.applied.scope, 'combined');
  assert.equal(summary.breakdowns.sources[0].label, 'linkedin.com');
  assert.equal(summary.listings.jobs[0].title, 'MEP Manager');
  assert.equal(summary.listings.jobs[0].views, 2);
  assert.equal(summary.listings.specs[0].title, 'MEP Manager');
  assert.equal(summary.listings.specs[0].avgTimeOnPageSeconds, 63);
  assert.equal(summary.meta.matchedEvents, rows.length);
  assert.equal(summary.meta.topPageCount, 4);
  assert.deepEqual(summary.pathInsights.landingPages[0], { path: '/', sessions: 1 });
  assert.equal(summary.pathInsights.topTransitions[0].from, '/');
  assert.equal(summary.pathInsights.topTransitions[0].to, '/jobs.html');
  assert.equal(summary.recentActivity[0].eventType, 'time_on_page_seconds');

  const csv = createCsv(summary.recentActivity.slice(0, 2));
  assert.match(csv, /"timestamp","page_path","page_title","event_type","detail","session_id","source","device_type"/);
});

test('buildComparisonSummary calculates KPI deltas against the previous period', () => {
  const current = {
    kpis: {
      totalPageViews: 120,
      uniqueVisitors: 70,
      sessions: 80,
      avgSessionDurationSeconds: 145,
      avgTimeOnPageSeconds: 52,
      bounceRate: 32.1,
      ctaClicks: 18,
    },
  };
  const previous = {
    kpis: {
      totalPageViews: 100,
      uniqueVisitors: 60,
      sessions: 75,
      avgSessionDurationSeconds: 132,
      avgTimeOnPageSeconds: 44,
      bounceRate: 40.1,
      ctaClicks: 12,
    },
  };
  const comparison = buildComparisonSummary(
    current,
    previous,
    { from: '2026-03-10', to: '2026-03-16' },
    { from: '2026-03-03', to: '2026-03-09' }
  );

  assert.equal(comparison.kpis.totalPageViews.delta, 20);
  assert.equal(comparison.kpis.totalPageViews.deltaPercent, 20);
  assert.equal(comparison.kpis.bounceRate.direction, 'down');
  assert.equal(comparison.previousPeriod.from, '2026-03-03');
});
