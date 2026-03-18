const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function createMatchMedia(width) {
  return (query) => {
    const max = /max-width:\s*(\d+)px/i.exec(query);
    const min = /min-width:\s*(\d+)px/i.exec(query);
    let matches = true;
    if (max) matches = matches && width <= Number(max[1]);
    if (min) matches = matches && width >= Number(min[1]);
    return {
      matches,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    };
  };
}

function buildHarnessHtml() {
  const file = path.join(process.cwd(), 'admin', 'analytics.html');
  return fs
    .readFileSync(file, 'utf8')
    .replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>\s*/g, '');
}

function buildDashboardResponse(payload = {}) {
  const scope = payload.scope || 'combined';
  const from = payload.from || '2026-03-01';
  const to = payload.to || '2026-03-30';
  const pagePath = payload.pagePath || '';
  const source = payload.source || '';
  const eventType = payload.eventType || '';
  const deviceType = payload.deviceType || '';
  const path = pagePath || '/jobs.html';
  return {
    source: 'supabase',
    setupRequired: false,
    schemaMismatch: false,
    schemaWarnings: [],
    message: '',
    truncated: false,
    meta: {
      matchedEvents: pagePath ? 12 : 10400,
      recentEvents: 3,
      topPageCount: 2,
      appliedRangeDays: 30,
    },
    definitions: {},
    filters: {
      applied: {
        from,
        to,
        pagePath,
        eventType,
        source,
        deviceType,
        siteArea: scope === 'combined' ? '' : scope,
        scope,
      },
      options: {
        pagePaths: ['/jobs.html', '/contact.html'],
        eventTypes: ['page_view', 'job_apply_clicked'],
        referrers: ['google.com', 'linkedin.com'],
        sources: ['google.com', 'linkedin.com'],
        deviceTypes: ['desktop', 'mobile'],
        siteAreas: ['public', 'admin'],
      },
    },
    kpis: {
      totalPageViews: pagePath ? 8 : 240,
      uniqueVisitors: pagePath ? 5 : 112,
      sessions: pagePath ? 4 : 88,
      avgSessionDurationSeconds: 92,
      avgTimeOnPageSeconds: 54,
      bounceRate: 31.4,
      ctaClicks: pagePath ? 2 : 18,
      topPage: path,
    },
    comparison: {
      enabled: false,
      currentPeriod: { from, to },
      previousPeriod: { from: '', to: '' },
      kpis: {},
    },
    trend: [
      { date: from, pageViews: 6, sessions: 4, uniqueVisitors: 4, ctaClicks: 1 },
      { date: to, pageViews: 10, sessions: 7, uniqueVisitors: 6, ctaClicks: 2 },
    ],
    topPages: [
      {
        path,
        title: path === '/jobs.html' ? 'Jobs' : 'Filtered page',
        pageViews: pagePath ? 8 : 120,
        uniqueVisitors: pagePath ? 5 : 80,
        avgTimeOnPageSeconds: 54,
        exits: 3,
        exitRate: 12.5,
        ctaClicks: pagePath ? 2 : 14,
      },
      {
        path: '/contact.html',
        title: 'Contact',
        pageViews: 48,
        uniqueVisitors: 30,
        avgTimeOnPageSeconds: 38,
        exits: 8,
        exitRate: 16.7,
        ctaClicks: 4,
      },
    ],
    recentActivity: [
      {
        occurredAt: '2026-03-30T12:00:00.000Z',
        pagePath: path,
        pageTitle: 'Jobs',
        eventType: 'page_view',
        eventLabel: 'Page View',
        category: 'traffic',
        detail: 'Viewed page',
        sessionIdShort: 'sess1234',
        source: source || 'Direct',
        deviceType: deviceType || 'desktop',
        siteArea: scope === 'combined' ? 'public' : scope,
      },
    ],
    clickAnalytics: {
      topCtas: [{ label: 'Apply', clicks: 4, topPage: path }],
      clicksByPage: [{ path, clicks: 4 }],
      clicksOverTime: [{ date: from, clicks: 1 }],
      jobsFilterUsage: [],
    },
    breakdowns: {
      sources: [{ label: 'linkedin.com', pageViews: 44, sessions: 20, uniqueVisitors: 18 }],
      devices: [{ label: 'desktop', pageViews: 66, sessions: 42, uniqueVisitors: 40 }],
      siteAreas: [{ label: scope === 'admin' ? 'Admin portal' : 'Public website', pageViews: 80, sessions: 40, uniqueVisitors: 38 }],
    },
    listings: {
      summary: {
        jobViews: 18,
        specViews: 9,
        applyClicks: 4,
        avgListingTimeSeconds: 57,
      },
      jobs: [{ title: 'Project Manager', views: 18, applyClicks: 4, ctaClicks: 6 }],
      specs: [{ title: 'Project Manager Spec', views: 9, avgTimeOnPageSeconds: 57, applyClicks: 4 }],
      topIntentActions: [{ title: 'Project Manager', action: 'Apply Clicked', count: 4 }],
      mostEngaged: [{ title: 'Project Manager', kind: 'job', views: 18, applyClicks: 4, ctaClicks: 6, avgTimeOnPageSeconds: 57 }],
    },
    pathInsights: {
      landingPages: [{ path: '/', sessions: 16 }],
      exitPages: [{ path: '/contact.html', sessions: 8 }],
      topPaths: [{ path: '/ -> /jobs.html', sessions: 6 }],
      topTransitions: [{ from: '/', to: '/jobs.html', count: 6 }],
    },
  };
}

async function settle(window, passes = 10) {
  for (let index = 0; index < passes; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

async function createAnalyticsDom(options = {}) {
  const html = buildHarnessHtml();
  const apiCalls = [];
  let failOnce = !!options.failOnce;

  const dom = new JSDOM(html, {
    url: options.url || 'https://example.com/admin/analytics.html',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.matchMedia = createMatchMedia(1280);
      window.console = console;
      window.print = () => {};
      window.scrollTo = () => {};
      window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
      window.Blob = global.Blob;
      window.URL.createObjectURL = () => 'blob:analytics';
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = function click() {};
      window.Admin = {
        bootAdmin: async (mainFn) => mainFn({
          api: async (_endpoint, _method, payload) => {
            apiCalls.push(payload);
            if (failOnce) {
              failOnce = false;
              throw new Error('analytics_dashboard_failed');
            }
            return buildDashboardResponse(payload);
          },
          sel: (selector, root = window.document) => root.querySelector(selector),
          toast: () => {},
        }),
      };
    },
  });

  const source = fs.readFileSync(path.join(process.cwd(), 'admin', 'analytics.js'), 'utf8');
  dom.window.eval(source);
  await settle(dom.window, 16);
  return { dom, apiCalls };
}

test('analytics dashboard loads live data, syncs URL state, and applies scope and filter changes', async () => {
  const { dom, apiCalls } = await createAnalyticsDom();
  const { document, Event } = dom.window;

  assert.equal(apiCalls.length >= 1, true);
  assert.equal(apiCalls[0].scope, 'combined');
  assert.match(document.querySelector('#volumeChip').textContent, /10,400 events/i);
  assert.match(document.querySelector('#filterSummary').textContent, /matched events/i);

  document.querySelector('[data-scope="admin"]').click();
  await settle(dom.window, 12);
  assert.equal(apiCalls.at(-1).scope, 'admin');
  assert.match(dom.window.location.search, /scope=admin/);

  const pageInput = document.querySelector('#filterPagePath');
  pageInput.value = '/jobs';
  pageInput.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#applyFilters').click();
  await settle(dom.window, 12);

  assert.equal(apiCalls.at(-1).pagePath, '/jobs');
  assert.match(dom.window.location.search, /page=%2Fjobs/);

  const rowPathButton = document.querySelector('[data-filter-path]');
  assert.ok(rowPathButton, 'top pages table should render a path filter button');
  const renderedPath = rowPathButton.getAttribute('data-filter-path');
  rowPathButton.click();
  await settle(dom.window, 12);
  assert.equal(apiCalls.at(-1).pagePath, renderedPath);

  document.querySelector('#resetFilters').click();
  await settle(dom.window, 12);
  assert.equal(apiCalls.at(-1).pagePath, '');
});

test('analytics dashboard shows a retry action when the data request fails', async () => {
  const { dom, apiCalls } = await createAnalyticsDom({ failOnce: true });
  const { document } = dom.window;

  assert.match(document.querySelector('#statusBanner').textContent, /analytics_dashboard_failed/i);
  const retryButton = document.querySelector('[data-status-action="retry"]');
  assert.ok(retryButton, 'retry button should render on dashboard load failure');

  retryButton.click();
  await settle(dom.window, 12);

  assert.equal(apiCalls.length >= 2, true);
  assert.match(document.querySelector('#statusBanner').textContent, /loaded successfully/i);
});
