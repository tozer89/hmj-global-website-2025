'use strict';

const { withAdminCors } = require('./_http.js');
const { hasSupabase, getSupabase, supabaseStatus } = require('./_supabase.js');
const {
  ANALYTICS_EVENTS_TABLE,
  parseIngestBody,
  buildIngestRows,
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

const baseHandler = async (event) => {
  if (!hasSupabase()) {
    return respond(503, {
      ok: false,
      code: 'supabase_unavailable',
      message: supabaseStatus().error || 'Supabase client unavailable',
    });
  }

  let payload;
  try {
    payload = parseIngestBody(event.body);
  } catch (error) {
    return respond(error?.statusCode || 400, {
      ok: false,
      code: error?.message || 'invalid_payload',
      details: error?.details || [],
    });
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
    });
  }

  try {
    const supabase = getSupabase(event);
    const { error } = await supabase
      .from(ANALYTICS_EVENTS_TABLE)
      .upsert(rows, {
        onConflict: 'event_id',
        ignoreDuplicates: true,
      });

    if (error) throw error;

    return respond(200, {
      ok: true,
      accepted: rows.length,
      rejected,
    });
  } catch (error) {
    if (isMissingAnalyticsTableError(error)) {
      return respond(202, {
        ok: false,
        setupRequired: true,
        accepted: 0,
        rejected,
        message: error?.message || 'analytics_storage_missing',
      });
    }

    return respond(503, {
      ok: false,
      code: 'analytics_ingest_failed',
      message: error?.message || 'analytics_ingest_failed',
    });
  }
};

exports.handler = withAdminCors(baseHandler, { requireToken: false });
