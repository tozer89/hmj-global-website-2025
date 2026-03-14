'use strict';

const { CHATBOT_SETTINGS_KEY, buildActionCatalog, resolveChatbotSettings } = require('./_chatbot-config.js');
const { buildFallbackReply, buildUserTag, callOpenAIForChat, classifyIntent, sanitiseHistory } = require('./_chatbot-core.js');
const { saveChatbotEventRecord, saveConversationRecord } = require('./_chatbot-storage.js');
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

function normaliseSessionProfile(profile = {}) {
  return {
    visitorType: String(profile.visitorType || '').slice(0, 40),
    currentIntent: String(profile.currentIntent || '').slice(0, 80),
    topics: Array.isArray(profile.topics)
      ? profile.topics.map((entry) => String(entry || '').slice(0, 80)).filter(Boolean).slice(0, 6)
      : [],
    locations: Array.isArray(profile.locations)
      ? profile.locations.map((entry) => String(entry || '').slice(0, 80)).filter(Boolean).slice(0, 4)
      : [],
    lastOutcome: String(profile.lastOutcome || '').slice(0, 80),
    lastCtaIds: Array.isArray(profile.lastCtaIds)
      ? profile.lastCtaIds.map((entry) => String(entry || '').slice(0, 80)).filter(Boolean).slice(0, 5)
      : [],
  };
}

async function logEvents(event, entries) {
  const tasks = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && entry.eventType)
    .map((entry) => saveChatbotEventRecord(event, entry));
  if (!tasks.length) return [];
  return Promise.allSettled(tasks);
}

function buildPublicReply(response = {}, conversationId = '') {
  return {
    reply: response.reply,
    intent: response.intent,
    visitorType: response.visitorType || 'general',
    ctaIds: Array.isArray(response.ctaIds) ? response.ctaIds : [],
    quickReplyIds: Array.isArray(response.quickReplyIds) ? response.quickReplyIds : [],
    shouldHandoff: !!response.shouldHandoff,
    handoffReason: response.handoffReason || '',
    followUpQuestion: response.followUpQuestion || '',
    answerConfidence: response.answerConfidence || 'medium',
    outcome: response.outcome || 'answer_site_question',
    resourceLinks: Array.isArray(response.resourceLinks) ? response.resourceLinks : [],
    suggestedPrompts: Array.isArray(response.suggestedPrompts) ? response.suggestedPrompts : [],
    sessionProfile: response.sessionProfile && typeof response.sessionProfile === 'object' ? response.sessionProfile : {},
    conversationId,
    model: response.model || '',
    responseId: response.responseId || '',
    durationMs: Number(response.durationMs) || 0,
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
    const sessionId = String(payload?.sessionId || '').slice(0, 120);
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
            intent: 'general_company_question',
            ctaIds: [],
            quickReplyIds: [],
            shouldHandoff: false,
            handoffReason: '',
          },
        },
        { 'retry-after': String(Math.ceil((limit.retryAfterMs || RATE_LIMIT_WINDOW_MS) / 1000)) },
      );
    }

    const { settings } = await fetchSettings(event, [CHATBOT_SETTINGS_KEY]);
    const resolved = resolveChatbotSettings(settings?.[CHATBOT_SETTINGS_KEY]);
    const actionCatalog = buildActionCatalog(resolved);
    const history = sanitiseHistory(payload?.history, resolved.dataPolicy.maxHistoryMessages);
    const context = normaliseContext(payload?.context);
    const sessionProfile = normaliseSessionProfile(payload?.sessionProfile);
    const heuristicIntent = resolved.dataPolicy.classifyIntent
      ? classifyIntent(message, history, sessionProfile)
      : 'general_company_question';
    const hasPreviousUserMessages = history.some((entry) => entry.role === 'user');

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
      sessionId,
      sessionProfile,
      userTag: buildUserTag(ipAddress, payload?.sessionId),
    });

    const storage = await saveConversationRecord(event, {
      sessionId,
      context,
      ipAddress,
      userAgent: String(event?.headers?.['user-agent'] || '').slice(0, 240),
      userIntent: heuristicIntent,
      userMessage: message,
      assistantReply: response,
    });
    const conversationId = String(storage?.conversation?.id || '').slice(0, 120);

    await logEvents(event, [
      !hasPreviousUserMessages ? {
        sessionId,
        conversationId,
        eventType: 'first_user_message',
        context,
        intent: response.intent,
        visitorType: response.visitorType,
        outcome: response.outcome,
        fallback: !!response.fallback,
      } : null,
      {
        sessionId,
        conversationId,
        eventType: 'intent_detected',
        context,
        intent: response.intent,
        visitorType: response.visitorType,
        outcome: response.outcome,
        fallback: !!response.fallback,
      },
      {
        sessionId,
        conversationId,
        eventType: response.fallback ? 'response_fallback' : 'response_served',
        context,
        intent: response.intent,
        visitorType: response.visitorType,
        outcome: response.outcome,
        fallback: !!response.fallback,
        metadata: {
          answer_confidence: response.answerConfidence || '',
          follow_up_question: response.followUpQuestion || '',
          cta_ids: Array.isArray(response.ctaIds) ? response.ctaIds : [],
          quick_reply_ids: Array.isArray(response.quickReplyIds) ? response.quickReplyIds : [],
        },
      },
      ...(Array.isArray(response.ctaIds) ? response.ctaIds : []).map((ctaId) => ({
        sessionId,
        conversationId,
        eventType: 'cta_shown',
        context,
        ctaId,
        intent: response.intent,
        visitorType: response.visitorType,
        outcome: response.outcome,
        fallback: !!response.fallback,
        metadata: { source: 'assistant_cta_ids' },
      })),
      ...(Array.isArray(response.resourceLinks) ? response.resourceLinks : []).map((link) => ({
        sessionId,
        conversationId,
        eventType: 'cta_shown',
        context,
        ctaId: String(link?.id || link?.href || '').slice(0, 80),
        intent: response.intent,
        visitorType: response.visitorType,
        outcome: response.outcome,
        fallback: !!response.fallback,
        metadata: {
          source: 'assistant_resource_link',
          label: String(link?.label || '').slice(0, 120),
          href: String(link?.href || '').slice(0, 280),
          kind: String(link?.kind || '').slice(0, 40),
        },
      })),
    ]);

    return json(200, {
      ok: true,
      ...buildPublicReply(response, conversationId),
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.status || 500);
    let fallback = null;
    let storage = null;
    let conversationId = '';

    try {
      const { settings } = await fetchSettings(event, [CHATBOT_SETTINGS_KEY]);
      const resolved = resolveChatbotSettings(settings?.[CHATBOT_SETTINGS_KEY]);
      const actionCatalog = buildActionCatalog(resolved);
      const history = sanitiseHistory(payload?.history, resolved.dataPolicy.maxHistoryMessages);
      const context = normaliseContext(payload?.context);
      const sessionId = String(payload?.sessionId || '').slice(0, 120);
      const sessionProfile = normaliseSessionProfile(payload?.sessionProfile);
      const intent = resolved.dataPolicy.classifyIntent
        ? classifyIntent(message, history, sessionProfile)
        : 'general_company_question';
      fallback = buildFallbackReply(
        resolved,
        actionCatalog,
        intent,
        'You can use the main HMJ routes below in the meantime.',
        {
          message,
          context,
          sessionProfile,
        },
      );
      storage = await saveConversationRecord(event, {
        sessionId,
        context,
        ipAddress: getRequesterIp(event),
        userAgent: String(event?.headers?.['user-agent'] || '').slice(0, 240),
        userIntent: intent,
        userMessage: message,
        assistantReply: fallback,
      });
      conversationId = String(storage?.conversation?.id || '').slice(0, 120);
      const hasPreviousUserMessages = history.some((entry) => entry.role === 'user');
      await logEvents(event, [
        !hasPreviousUserMessages ? {
          sessionId,
          conversationId,
          eventType: 'first_user_message',
          context,
          intent: fallback.intent,
          visitorType: fallback.visitorType,
          outcome: fallback.outcome,
          fallback: true,
        } : null,
        {
          sessionId,
          conversationId,
          eventType: 'response_fallback',
          context,
          intent: fallback.intent,
          visitorType: fallback.visitorType,
          outcome: fallback.outcome,
          fallback: true,
          metadata: {
            error_code: error?.code || 'chatbot_request_failed',
            answer_confidence: fallback.answerConfidence || '',
          },
        },
      ]);
    } catch {}

    return json(statusCode >= 400 && statusCode < 600 ? statusCode : 500, {
      ok: false,
      error: error?.code || 'chatbot_request_failed',
      message: error?.message || 'chatbot_request_failed',
      fallback: fallback ? buildPublicReply(fallback, conversationId) : null,
    });
  }
};
