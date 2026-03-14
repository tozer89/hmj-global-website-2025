'use strict';

const { saveChatbotEventRecord } = require('./_chatbot-storage.js');

const HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

const ALLOWED_EVENT_TYPES = new Set([
  'widget_open',
  'cta_click',
  'cta_shown',
  'suggested_prompt_click',
]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: HEADERS,
    body: JSON.stringify(body),
  };
}

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function normaliseContext(context = {}) {
  return {
    route: trimString(context.route, 240),
    pageCategory: trimString(context.pageCategory, 80),
    pageTitle: trimString(context.pageTitle, 200),
    metaDescription: trimString(context.metaDescription, 280),
  };
}

exports.handler = async (event) => {
  const method = (event.httpMethod || 'POST').toUpperCase();
  if (method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const eventType = trimString(payload?.eventType, 80);
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    return json(400, { ok: false, error: 'invalid_event_type' });
  }

  const result = await saveChatbotEventRecord(event, {
    sessionId: trimString(payload?.sessionId, 120),
    conversationId: trimString(payload?.conversationId, 120),
    eventType,
    context: normaliseContext(payload?.context),
    ctaId: trimString(payload?.ctaId, 80),
    intent: trimString(payload?.intent, 80),
    visitorType: trimString(payload?.visitorType, 40),
    outcome: trimString(payload?.outcome, 80),
    fallback: !!payload?.fallback,
    metadata: payload?.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? payload.metadata
      : {},
  });

  return json(202, {
    ok: true,
    stored: !!result?.ok,
    skipped: !!result?.skipped,
    setupRequired: !!result?.setupRequired,
  });
};
