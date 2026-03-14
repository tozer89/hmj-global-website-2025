'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  parseDashboardFilters,
  buildComparisonFilters,
  fetchAnalyticsRows,
  fetchRecentAnalyticsRows,
  applySourceFilter,
  summariseAnalytics,
  buildComparisonSummary,
  createCsv,
  classifyAnalyticsSchemaIssue,
  isAnalyticsSchemaError,
  isMissingAnalyticsTableError,
} = require('./_analytics.js');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function buildEmptySummary(filters, overrides = {}) {
  return {
    source: 'supabase',
    setupRequired: false,
    schemaMismatch: false,
    schemaWarnings: [],
    message: '',
    filters: {
      applied: filters,
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
    ...overrides,
  };
}

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });
  } catch (error) {
    return respond(error?.code === 401 ? 401 : 403, {
      ok: false,
      code: error?.message || 'forbidden',
    });
  }

  if (!hasSupabase()) {
    return respond(503, {
      ok: false,
      code: 'supabase_unavailable',
      message: supabaseStatus().error || 'Supabase client unavailable',
    });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    payload = {};
  }

  const filters = parseDashboardFilters(payload || {});
  const compareMode = payload?.compare !== false;
  const comparisonFilters = compareMode ? buildComparisonFilters(filters) : null;
  const supabase = getSupabase(event);

  try {
    const tasks = [
      fetchAnalyticsRows(supabase, filters),
      fetchRecentAnalyticsRows(supabase, filters),
    ];

    if (comparisonFilters) {
      tasks.push(fetchAnalyticsRows(supabase, comparisonFilters));
    }

    const [currentRowsResult, recentRowsResult, previousRowsResult] = await Promise.all([
      tasks[0],
      tasks[1],
      tasks[2] || Promise.resolve(null),
    ]);

    const filteredRows = applySourceFilter(currentRowsResult.rows, filters.source);
    const filteredRecent = applySourceFilter(recentRowsResult.rows, filters.source);
    const summary = summariseAnalytics(filteredRows, filters, filteredRecent, currentRowsResult.truncated);
    summary.schemaWarnings = Array.from(new Set(
      []
        .concat(currentRowsResult.omittedFields || [])
        .concat(recentRowsResult.omittedFields || [])
    ));
    summary.schemaMismatch = false;
    summary.message = '';

    if (comparisonFilters && previousRowsResult) {
      const filteredPreviousRows = applySourceFilter(previousRowsResult.rows, comparisonFilters.source);
      const previousSummary = summariseAnalytics(filteredPreviousRows, comparisonFilters, [], previousRowsResult.truncated);
      summary.comparison = buildComparisonSummary(summary, previousSummary, filters, comparisonFilters);
    } else {
      summary.comparison = {
        enabled: false,
        currentPeriod: { from: filters.from, to: filters.to },
        previousPeriod: { from: '', to: '' },
        kpis: {},
      };
    }

    if (payload?.includeCsv) {
      summary.csv = createCsv(summary.recentActivity || []);
    }

    return respond(200, summary);
  } catch (error) {
    if (isMissingAnalyticsTableError(error)) {
      return respond(200, buildEmptySummary(filters, {
        setupRequired: true,
        message: 'Apply the website analytics SQL, then refresh this page.',
      }));
    }

    if (isAnalyticsSchemaError(error)) {
      const issue = classifyAnalyticsSchemaIssue(error);
      const detail = issue.missingColumn
        ? ` Missing column: ${issue.missingColumn}.`
        : '';
      return respond(200, buildEmptySummary(filters, {
        schemaMismatch: true,
        message: `Analytics schema mismatch detected.${detail} The dashboard is in safe fallback mode until the Supabase reconciliation SQL is applied.`,
      }));
    }

    return respond(500, {
      ok: false,
      code: 'analytics_dashboard_failed',
      message: error?.message || 'analytics_dashboard_failed',
    });
  }
};

exports.handler = withAdminCors(baseHandler);
