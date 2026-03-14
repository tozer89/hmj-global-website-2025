'use strict';

const { CHATBOT_SETTINGS_KEY, buildActionCatalog, resolveChatbotSettings } = require('./_chatbot-config.js');
const { buildFallbackReply, buildUserTag, callOpenAIForChat, classifyIntent, sanitiseHistory } = require('./_chatbot-core.js');
const { saveConversationRecord } = require('./_chatbot-storage.js');
const { fetchSettings } = require('./_settings-helpers.js');

const HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;
const rateLimitStore = new Map();

function cleanIpAddress(value) {
  return String(value || '')
    .split(',')[0]
    .trim()
    .slice(0, 120);
}

function getRequesterIp(event) {
  return cleanIpAddress(
    event?.headers?.['x-nf-client-connection-ip']
    || event?.headers?.['client-ip']
    || event?.headers?.['x-forwarded-for']
    || ''
  );
}

function applyRateLimit(ipAddress) {
  if (!ipAddress) return { allowed: true, remaining: RATE_LIMIT_MAX };
  const now = Date.now();
  const current = rateLimitStore.get(ipAddress);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(ipAddress, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  current.count += 1;
  if (current.count > RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, retryAfterMs: current.resetAt - now };
  }

  return { allowed: true, remaining: Math.max(RATE_LIMIT_MAX - current.count, 0) };
}

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { ...HEADERS, ...(extraHeaders || {}) },
    body: JSON.stringify(body),
  };
}

function normaliseContext(context = {}) {
  return {
    route: String(context.route || '').slice(0, 240),
    pageCategory: String(context.pageCategory || '').slice(0, 80),
    pageTitle: String(context.pageTitle || '').slice(0, 200),
    metaDescription: String(context.metaDescription || '').slice(0, 280),
  };
}

exports.handler = async (event) => {
  const method = (event.httpMethod || 'POST').toUpperCase();
  if (method !== 'POST') {
    return json(405, { ok: false, error: 'method_not_allowed' });
  }

  let payload = null;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const message = String(payload?.message || '').trim();
  if (!message) {
    return json(400, { ok: false, error: 'message_required' });
  }
  if (message.length > 1200) {
    return json(400, { ok: false, error: 'message_too_long' });
  }

  try {
    const ipAddress = getRequesterIp(event);
    const limit = applyRateLimit(ipAddress);
    if (!limit.allowed) {
      return json(
        429,
        {
          ok: false,
          error: 'rate_limited',
          retryAfterMs: limit.retryAfterMs,
          fallback: {
            reply: 'The assistant is a little busy right now. You can still browse jobs, register as a candidate, or contact HMJ directly.',
            intent: 'general_question',
            ctaIds: [],
            quickReplyIds: [],
            shouldHandoff: false,
            handoffReason: '',
          },
        },
        { 'retry-after': String(Math.ceil((limit.retryAfterMs || RATE_LIMIT_WINDOW_MS) / 1000)) },
      );
    }

    const { settings, source, supabase, error } = await fetchSettings(event, [CHATBOT_SETTINGS_KEY]);
    const resolved = resolveChatbotSettings(settings?.[CHATBOT_SETTINGS_KEY]);
    const actionCatalog = buildActionCatalog(resolved);
    const history = sanitiseHistory(payload?.history, resolved.dataPolicy.maxHistoryMessages);
    const context = normaliseContext(payload?.context);
    const heuristicIntent = resolved.dataPolicy.classifyIntent ? classifyIntent(message) : 'general_question';

    if (!resolved.enabled) {
      return json(403, {
        ok: false,
        error: 'chatbot_disabled',
        fallback: buildFallbackReply(resolved, actionCatalog, heuristicIntent),
      });
    }

    const response = await callOpenAIForChat({
      settings: resolved,
      message,
      history,
      context,
      sessionId: String(payload?.sessionId || '').slice(0, 120),
      userTag: buildUserTag(ipAddress, payload?.sessionId),
    });

    const storage = await saveConversationRecord(event, {
      sessionId: String(payload?.sessionId || '').slice(0, 120),
      context,
      ipAddress,
      userAgent: String(event?.headers?.['user-agent'] || '').slice(0, 240),
      userIntent: heuristicIntent,
      userMessage: message,
      assistantReply: response,
    });

    return json(200, {
      ok: true,
      reply: response.reply,
      intent: response.intent,
      ctaIds: response.ctaIds,
      quickReplyIds: response.quickReplyIds,
      shouldHandoff: response.shouldHandoff,
      handoffReason: response.handoffReason,
      model: response.model,
      responseId: response.responseId,
      durationMs: response.durationMs,
      source,
      supabase,
      settingsError: error || null,
      storage,
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.status || 500);
    let fallback = null;
    let storage = null;

    try {
      const { settings } = await fetchSettings(event, [CHATBOT_SETTINGS_KEY]);
      const resolved = resolveChatbotSettings(settings?.[CHATBOT_SETTINGS_KEY]);
      const actionCatalog = buildActionCatalog(resolved);
      fallback = buildFallbackReply(
        resolved,
        actionCatalog,
        resolved.dataPolicy.classifyIntent ? classifyIntent(message) : 'general_question',
        'You can use the main HMJ routes below in the meantime.',
      );
      storage = await saveConversationRecord(event, {
        sessionId: String(payload?.sessionId || '').slice(0, 120),
        context: normaliseContext(payload?.context),
        ipAddress: getRequesterIp(event),
        userAgent: String(event?.headers?.['user-agent'] || '').slice(0, 240),
        userIntent: resolved.dataPolicy.classifyIntent ? classifyIntent(message) : 'general_question',
        userMessage: message,
        assistantReply: fallback,
      });
    } catch {}

    return json(statusCode >= 400 && statusCode < 600 ? statusCode : 500, {
      ok: false,
      error: error?.code || 'chatbot_request_failed',
      message: error?.message || 'chatbot_request_failed',
      fallback,
      storage,
    });
  }
};
