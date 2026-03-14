'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { CHATBOT_SETTINGS_KEY, buildActionCatalog, resolveChatbotSettings } = require('./_chatbot-config.js');
const { buildFallbackReply, buildPromptPreview, buildUserTag, callOpenAIForChat } = require('./_chatbot-core.js');
const { fetchSettings } = require('./_settings-helpers.js');

function normaliseContext(context = {}) {
  return {
    route: String(context.route || '/index.html').slice(0, 240),
    pageCategory: String(context.pageCategory || 'home').slice(0, 80),
    pageTitle: String(context.pageTitle || 'HMJ Global').slice(0, 200),
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

const baseHandler = async (event, context) => {
  await getContext(event, context, { requireAdmin: true });

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'invalid_json' }),
    };
  }

  const message = String(payload?.message || '').trim();
  if (!message) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'message_required' }),
    };
  }

  const stored = await fetchSettings(event, [CHATBOT_SETTINGS_KEY]);
  const resolved = resolveChatbotSettings(payload?.settings || stored?.settings?.[CHATBOT_SETTINGS_KEY]);
  const actionCatalog = buildActionCatalog(resolved);
  const previewContext = normaliseContext(payload?.context);
  const sessionProfile = normaliseSessionProfile(payload?.sessionProfile);

  try {
    const response = await callOpenAIForChat({
      settings: resolved,
      message,
      history: Array.isArray(payload?.history) ? payload.history : [],
      context: previewContext,
      sessionProfile,
      userTag: buildUserTag('admin-preview', previewContext.route),
      includePromptPreview: true,
    });

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        reply: response.reply,
        intent: response.intent,
        visitorType: response.visitorType,
        ctaIds: response.ctaIds,
        quickReplyIds: response.quickReplyIds,
        shouldHandoff: response.shouldHandoff,
        handoffReason: response.handoffReason,
        followUpQuestion: response.followUpQuestion,
        answerConfidence: response.answerConfidence,
        outcome: response.outcome,
        resourceLinks: response.resourceLinks,
        suggestedPrompts: response.suggestedPrompts,
        sessionProfile: response.sessionProfile,
        model: response.model,
        promptPreview: response.promptPreview || buildPromptPreview(resolved, { ...previewContext, previewMessage: message, sessionProfile }),
        actionCatalog,
      }),
    };
  } catch (error) {
    const fallback = buildFallbackReply(resolved, actionCatalog, 'general_company_question', '', {
      message,
      context: previewContext,
      sessionProfile,
    });
    return {
      statusCode: Number(error?.statusCode || 500),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: error?.code || 'preview_failed',
        message: error?.message || 'preview_failed',
        fallback,
        promptPreview: buildPromptPreview(resolved, { ...previewContext, previewMessage: message, sessionProfile }),
        actionCatalog,
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
