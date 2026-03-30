'use strict';

const { withAdminCors } = require('./_http.js');
const { buildRateLimitHeaders, enforceRateLimit } = require('./_rate-limit.js');
const { hasSupabase, getSupabase, supabaseStatus } = require('./_supabase.js');
const {
  parseIngestBody,
  buildIngestRows,
  writeAnalyticsRowsWithCompatibility,
  classifyAnalyticsSchemaIssue,
  isAnalyticsSchemaError,
  isMissingAnalyticsTableError,
} = require('./_analytics.js');

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};
const RATE_LIMIT_WINDOW_SECONDS = Math.max(Number.parseInt(process.env.ANALYTICS_INGEST_RATE_LIMIT_WINDOW_SECONDS || '300', 10) || 300, 1);
const RATE_LIMIT_MAX = Math.max(Number.parseInt(process.env.ANALYTICS_INGEST_RATE_LIMIT_MAX || '180', 10) || 180, 1);

function respond(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...(extraHeaders || {}) },
    body: JSON.stringify(body),
  };
}

const baseHandler = async (event) => {
  const limit = await enforceRateLimit({
    event,
    bucket: 'analytics_ingest',
    max: RATE_LIMIT_MAX,
    windowSeconds: RATE_LIMIT_WINDOW_SECONDS,
    metadata: {
      path: event?.path || '/.netlify/functions/analytics-ingest',
    },
  });
  const rateLimitHeaders = buildRateLimitHeaders(limit);
  if (!limit.allowed) {
    return respond(429, {
      ok: false,
      code: 'rate_limited',
      message: 'Too many analytics requests. Please wait a moment and try again.',
      retryAfterMs: limit.retryAfterMs,
    }, rateLimitHeaders);
  }

  if (!hasSupabase()) {
    return respond(503, {
      ok: false,
      code: 'supabase_unavailable',
      message: supabaseStatus().error || 'Supabase client unavailable',
    }, rateLimitHeaders);
  }

  let payload;
  try {
    payload = parseIngestBody(event.body);
  } catch (error) {
    return respond(error?.statusCode || 400, {
      ok: false,
      code: error?.message || 'invalid_payload',
      details: error?.details || [],
    }, rateLimitHeaders);
  }

  let rows;
  let rejected = [];
  try {
    const parsed = buildIngestRows(event, payload);
    rows = parsed.rows;
    rejected = parsed.rejected || [];
  } catch (error) {
    return respond(error?.statusCode || 400, {
      ok: false,
      code: error?.message || 'invalid_events',
      details: error?.details || [],
    }, rateLimitHeaders);
  }

  try {
    const supabase = getSupabase(event);
    const writeResult = await writeAnalyticsRowsWithCompatibility(supabase, rows);

    return respond(200, {
      ok: true,
      accepted: rows.length,
      rejected,
      compatibilityMode: writeResult.mode !== 'upsert',
      schemaWarnings: writeResult.schemaWarnings || [],
    }, rateLimitHeaders);
  } catch (error) {
    if (isMissingAnalyticsTableError(error)) {
      return respond(202, {
        ok: false,
        setupRequired: true,
        accepted: 0,
        rejected,
        message: error?.message || 'analytics_storage_missing',
      }, rateLimitHeaders);
    }

    if (isAnalyticsSchemaError(error)) {
      const issue = classifyAnalyticsSchemaIssue(error);
      const detail = issue.missingColumn
        ? ` Missing column: ${issue.missingColumn}.`
        : '';
      return respond(202, {
        ok: false,
        schemaMismatch: true,
        accepted: 0,
        rejected,
        code: 'analytics_schema_mismatch',
        message: `Analytics storage schema mismatch detected.${detail} Apply the Supabase reconciliation SQL to restore full compatibility.`,
      }, rateLimitHeaders);
    }

    return respond(503, {
      ok: false,
      code: 'analytics_ingest_failed',
      message: error?.message || 'analytics_ingest_failed',
    }, rateLimitHeaders);
  }
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
