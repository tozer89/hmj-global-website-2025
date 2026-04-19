'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { listFormattingRuns } = require('../../lib/cv-formatting-history.js');

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  return maxLength && maxLength > 0 ? text.slice(0, maxLength) : text;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return null;
  }
}

const baseHandler = async (event, context) => {
  const { supabase, supabaseError } = await getContext(event, context, { requireAdmin: true });
  const body = safeJsonParse(event.body);
  const limit = Math.max(1, Math.min(Number(body?.limit) || 10, 20));

  if (!supabase || typeof supabase.from !== 'function') {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        history_enabled: false,
        runs: [],
        warnings: [
          trimString(supabaseError?.message)
            ? 'Run history is unavailable because the database connection is not configured in this environment.'
            : 'Run history is unavailable in this environment right now.',
        ],
      }),
    };
  }

  try {
    const result = await listFormattingRuns(supabase, limit, {
      ttlSeconds: 60 * 60,
    });

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        history_enabled: result.enabled !== false,
        runs: Array.isArray(result.runs) ? result.runs : [],
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
      }),
    };
  } catch (error) {
    const statusCode = Number(error?.statusCode) || Number(error?.code) || 500;
    return {
      statusCode: statusCode >= 400 && statusCode <= 599 ? statusCode : 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: trimString(error?.message || 'cv_formatting_history_failed', 240),
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
