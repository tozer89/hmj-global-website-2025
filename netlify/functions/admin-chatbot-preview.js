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

  try {
    const response = await callOpenAIForChat({
      settings: resolved,
      message,
      history: Array.isArray(payload?.history) ? payload.history : [],
      context: previewContext,
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
        ctaIds: response.ctaIds,
        quickReplyIds: response.quickReplyIds,
        shouldHandoff: response.shouldHandoff,
        handoffReason: response.handoffReason,
        model: response.model,
        promptPreview: response.promptPreview || buildPromptPreview(resolved, { ...previewContext, previewMessage: message }),
        actionCatalog,
      }),
    };
  } catch (error) {
    const fallback = buildFallbackReply(resolved, actionCatalog, 'general_question');
    return {
      statusCode: Number(error?.statusCode || 500),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: error?.code || 'preview_failed',
        message: error?.message || 'preview_failed',
        fallback,
        promptPreview: buildPromptPreview(resolved, { ...previewContext, previewMessage: message }),
        actionCatalog,
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
