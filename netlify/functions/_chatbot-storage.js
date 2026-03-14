'use strict';

const { createHash } = require('node:crypto');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { isMissingTableError } = require('./_jobs-helpers.js');

const CHATBOT_CONVERSATIONS_TABLE = 'chatbot_conversations';
const CHATBOT_MESSAGES_TABLE = 'chatbot_messages';
const CHATBOT_EVENTS_TABLE = 'chatbot_events';

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function uniqueStrings(list, maxItems) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const safe = trimString(entry, 120);
    if (safe && !out.includes(safe)) out.push(safe);
  });
  if (Number.isInteger(maxItems) && maxItems > 0) return out.slice(0, maxItems);
  return out;
}

function hashValue(value) {
  const safe = trimString(value, 240);
  if (!safe) return '';
  return createHash('sha256').update(safe).digest('hex');
}

function normaliseMetadata(context = {}) {
  return {
    route: trimString(context.route, 240),
    page_title: trimString(context.pageTitle, 200),
    page_category: trimString(context.pageCategory, 80),
    meta_description: trimString(context.metaDescription, 280),
  };
}

function mergeMetadata(baseValue, extraValue) {
  const base = baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue) ? baseValue : {};
  const extra = extraValue && typeof extraValue === 'object' && !Array.isArray(extraValue) ? extraValue : {};
  return { ...base, ...extra };
}

function buildConversationRow(existing, sessionId, context, ipAddress, userAgent, userIntent, assistantReply) {
  const metadata = normaliseMetadata(context);
  const derivedMetadata = mergeMetadata(existing?.metadata, {
    visitor_type: trimString(assistantReply?.visitorType, 40) || null,
    outcome: trimString(assistantReply?.outcome, 80) || null,
    topics: uniqueStrings(assistantReply?.sessionProfile?.topics, 6),
    locations: uniqueStrings(assistantReply?.sessionProfile?.locations, 4),
    answer_confidence: trimString(assistantReply?.answerConfidence, 20) || null,
  });
  const nextMessageCount = Number(existing?.message_count || 0) + 2;
  const nextAssistantCount = Number(existing?.assistant_message_count || 0) + 1;
  const nextHandoffCount = Number(existing?.handoff_count || 0) + (assistantReply?.shouldHandoff ? 1 : 0);

  if (!existing) {
    return {
      session_id: sessionId,
      first_route: metadata.route || null,
      latest_route: metadata.route || null,
      latest_page_title: metadata.page_title || null,
      page_category: metadata.page_category || null,
      ip_hash: hashValue(ipAddress) || null,
      user_agent: trimString(userAgent, 240) || null,
      initial_intent: trimString(userIntent, 80) || null,
      latest_intent: trimString(assistantReply?.intent || userIntent, 80) || null,
      message_count: nextMessageCount,
      assistant_message_count: nextAssistantCount,
      handoff_count: nextHandoffCount,
      last_handoff_reason: trimString(assistantReply?.handoffReason, 280) || null,
      last_message_preview: trimString(assistantReply?.reply, 280) || null,
      metadata: mergeMetadata(metadata, derivedMetadata),
    };
  }

  return {
    latest_route: metadata.route || existing.latest_route || null,
    latest_page_title: metadata.page_title || existing.latest_page_title || null,
    page_category: metadata.page_category || existing.page_category || null,
    latest_intent: trimString(assistantReply?.intent || userIntent, 80) || existing.latest_intent || null,
    message_count: nextMessageCount,
    assistant_message_count: nextAssistantCount,
    handoff_count: nextHandoffCount,
    last_handoff_reason: trimString(assistantReply?.handoffReason, 280) || existing.last_handoff_reason || null,
    last_message_preview: trimString(assistantReply?.reply, 280) || existing.last_message_preview || null,
    metadata: mergeMetadata(metadata, derivedMetadata),
  };
}

async function getConversationBySession(supabase, sessionId) {
  const { data, error } = await supabase
    .from(CHATBOT_CONVERSATIONS_TABLE)
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function saveConversationRecord(event, entry = {}) {
  if (!hasSupabase()) {
    return { ok: false, skipped: true, reason: supabaseStatus().error || 'supabase_unavailable' };
  }

  const sessionId = trimString(entry.sessionId, 120);
  if (!sessionId) {
    return { ok: false, skipped: true, reason: 'session_id_missing' };
  }

  const supabase = getSupabase(event);
  try {
    const existing = await getConversationBySession(supabase, sessionId);
    const row = buildConversationRow(
      existing,
      sessionId,
      entry.context,
      entry.ipAddress,
      entry.userAgent,
      entry.userIntent,
      entry.assistantReply,
    );

    const savedConversation = existing
      ? await supabase
        .from(CHATBOT_CONVERSATIONS_TABLE)
        .update(row)
        .eq('id', existing.id)
        .select('*')
        .single()
      : await supabase
        .from(CHATBOT_CONVERSATIONS_TABLE)
        .insert([row])
        .select('*')
        .single();

    if (savedConversation.error) throw savedConversation.error;

    const conversation = savedConversation.data;
    const metadata = normaliseMetadata(entry.context);
    const rows = [
      {
        conversation_id: conversation.id,
        role: 'user',
        content: trimString(entry.userMessage, 2000),
        intent: trimString(entry.userIntent, 80) || null,
        route: metadata.route || null,
        page_title: metadata.page_title || null,
        page_category: metadata.page_category || null,
        fallback: false,
        metadata: mergeMetadata(metadata, {
          visitor_type: trimString(entry.assistantReply?.visitorType, 40) || null,
          outcome: trimString(entry.assistantReply?.outcome, 80) || null,
        }),
      },
      {
        conversation_id: conversation.id,
        role: 'assistant',
        content: trimString(entry.assistantReply?.reply, 2400),
        intent: trimString(entry.assistantReply?.intent, 80) || null,
        cta_ids: uniqueStrings(entry.assistantReply?.ctaIds, 5),
        quick_reply_ids: uniqueStrings(entry.assistantReply?.quickReplyIds, 5),
        handoff: !!entry.assistantReply?.shouldHandoff,
        handoff_reason: trimString(entry.assistantReply?.handoffReason, 280) || null,
        model: trimString(entry.assistantReply?.model, 80) || null,
        response_id: trimString(entry.assistantReply?.responseId, 120) || null,
        route: metadata.route || null,
        page_title: metadata.page_title || null,
        page_category: metadata.page_category || null,
        fallback: !!entry.assistantReply?.fallback,
        metadata: mergeMetadata(metadata, {
          visitor_type: trimString(entry.assistantReply?.visitorType, 40) || null,
          outcome: trimString(entry.assistantReply?.outcome, 80) || null,
          answer_confidence: trimString(entry.assistantReply?.answerConfidence, 20) || null,
          follow_up_question: trimString(entry.assistantReply?.followUpQuestion, 220) || null,
          suggested_prompts: uniqueStrings(entry.assistantReply?.suggestedPrompts, 4),
          resource_links: Array.isArray(entry.assistantReply?.resourceLinks)
            ? entry.assistantReply.resourceLinks.slice(0, 4).map((link) => ({
              id: trimString(link?.id, 80),
              label: trimString(link?.label, 120),
              href: trimString(link?.href, 280),
              kind: trimString(link?.kind, 40),
            }))
            : [],
          session_profile: entry.assistantReply?.sessionProfile && typeof entry.assistantReply.sessionProfile === 'object'
            ? {
              visitorType: trimString(entry.assistantReply.sessionProfile.visitorType, 40),
              currentIntent: trimString(entry.assistantReply.sessionProfile.currentIntent, 80),
              topics: uniqueStrings(entry.assistantReply.sessionProfile.topics, 6),
              locations: uniqueStrings(entry.assistantReply.sessionProfile.locations, 4),
              lastOutcome: trimString(entry.assistantReply.sessionProfile.lastOutcome, 80),
            }
            : null,
        }),
      },
    ];

    const messageInsert = await supabase
      .from(CHATBOT_MESSAGES_TABLE)
      .insert(rows)
      .select('id,role,created_at');

    if (messageInsert.error) throw messageInsert.error;

    return {
      ok: true,
      conversation,
      messages: messageInsert.data || [],
    };
  } catch (error) {
    if (
      isMissingTableError(error, CHATBOT_CONVERSATIONS_TABLE)
      || isMissingTableError(error, CHATBOT_MESSAGES_TABLE)
    ) {
      return {
        ok: false,
        skipped: true,
        setupRequired: true,
        reason: error.message || 'chatbot_storage_missing',
      };
    }
    console.warn('[chatbot-storage] unable to store conversation', error?.message || error);
    return {
      ok: false,
      skipped: true,
      reason: error?.message || 'chatbot_storage_failed',
    };
  }
}

async function saveChatbotEventRecord(event, entry = {}) {
  if (!hasSupabase()) {
    return { ok: false, skipped: true, reason: supabaseStatus().error || 'supabase_unavailable' };
  }

  const supabase = getSupabase(event);
  const row = {
    session_id: trimString(entry.sessionId, 120) || null,
    conversation_id: trimString(entry.conversationId, 120) || null,
    event_type: trimString(entry.eventType, 80) || null,
    route: trimString(entry.route || entry.context?.route, 240) || null,
    page_category: trimString(entry.pageCategory || entry.context?.pageCategory, 80) || null,
    intent: trimString(entry.intent, 80) || null,
    visitor_type: trimString(entry.visitorType, 40) || null,
    outcome: trimString(entry.outcome, 80) || null,
    cta_id: trimString(entry.ctaId, 80) || null,
    fallback: !!entry.fallback,
    metadata: entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
      ? entry.metadata
      : {},
  };

  if (!row.event_type) {
    return { ok: false, skipped: true, reason: 'event_type_missing' };
  }

  try {
    const response = await supabase
      .from(CHATBOT_EVENTS_TABLE)
      .insert([row])
      .select('id,event_type,created_at')
      .single();

    if (response.error) throw response.error;
    return { ok: true, event: response.data || null };
  } catch (error) {
    if (isMissingTableError(error, CHATBOT_EVENTS_TABLE)) {
      return {
        ok: false,
        skipped: true,
        setupRequired: true,
        reason: error.message || 'chatbot_events_missing',
      };
    }
    console.warn('[chatbot-storage] unable to store event', error?.message || error);
    return {
      ok: false,
      skipped: true,
      reason: error?.message || 'chatbot_event_store_failed',
    };
  }
}

function buildTopEntries(counts, limit = 5) {
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

async function getChatbotAnalyticsSummary(event, options = {}) {
  if (!hasSupabase()) {
    return {
      ok: true,
      setupRequired: false,
      source: 'unavailable',
      summary: {
        widgetOpens: 0,
        firstMessages: 0,
        ctaClicks: 0,
        fallbackResponses: 0,
        candidateSignals: 0,
        clientSignals: 0,
        usefulRoutes: 0,
        topIntents: [],
        topOutcomes: [],
        topCtas: [],
      },
      supabase: supabaseStatus(),
    };
  }

  const supabase = getSupabase(event);
  const limit = Math.max(50, Math.min(Number(options.limit) || 800, 2000));

  try {
    const response = await supabase
      .from(CHATBOT_EVENTS_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (response.error) throw response.error;
    const rows = Array.isArray(response.data) ? response.data : [];
    const intentCounts = {};
    const outcomeCounts = {};
    const ctaCounts = {};
    let widgetOpens = 0;
    let firstMessages = 0;
    let ctaClicks = 0;
    let fallbackResponses = 0;
    let candidateSignals = 0;
    let clientSignals = 0;
    let usefulRoutes = 0;

    rows.forEach((row) => {
      const eventType = trimString(row.event_type, 80);
      const intent = trimString(row.intent, 80);
      const outcome = trimString(row.outcome, 80);
      const ctaId = trimString(row.cta_id, 80);
      const visitorType = trimString(row.visitor_type, 40);

      if (eventType === 'widget_open') widgetOpens += 1;
      if (eventType === 'first_user_message') firstMessages += 1;
      if (eventType === 'cta_click') ctaClicks += 1;
      if (row.fallback || eventType === 'response_fallback') fallbackResponses += 1;
      if (visitorType === 'candidate') candidateSignals += 1;
      if (visitorType === 'client') clientSignals += 1;
      if (['browse_jobs', 'apply_now', 'register_candidate', 'client_enquiry', 'contact_human'].includes(outcome)) {
        usefulRoutes += 1;
      }

      if (intent) intentCounts[intent] = (intentCounts[intent] || 0) + 1;
      if (outcome) outcomeCounts[outcome] = (outcomeCounts[outcome] || 0) + 1;
      if (ctaId) ctaCounts[ctaId] = (ctaCounts[ctaId] || 0) + 1;
    });

    return {
      ok: true,
      setupRequired: false,
      source: 'supabase',
      summary: {
        widgetOpens,
        firstMessages,
        ctaClicks,
        fallbackResponses,
        candidateSignals,
        clientSignals,
        usefulRoutes,
        topIntents: buildTopEntries(intentCounts),
        topOutcomes: buildTopEntries(outcomeCounts),
        topCtas: buildTopEntries(ctaCounts),
      },
      supabase: supabaseStatus(),
    };
  } catch (error) {
    const setupRequired = isMissingTableError(error, CHATBOT_EVENTS_TABLE);
    return {
      ok: true,
      setupRequired,
      source: 'unavailable',
      error: error?.message || 'chatbot_analytics_failed',
      summary: {
        widgetOpens: 0,
        firstMessages: 0,
        ctaClicks: 0,
        fallbackResponses: 0,
        candidateSignals: 0,
        clientSignals: 0,
        usefulRoutes: 0,
        topIntents: [],
        topOutcomes: [],
        topCtas: [],
      },
      supabase: supabaseStatus(),
    };
  }
}

async function listConversationRows(event, options = {}) {
  if (!hasSupabase()) {
    return {
      ok: true,
      conversations: [],
      readOnly: true,
      setupRequired: false,
      source: 'unavailable',
      supabase: supabaseStatus(),
      error: supabaseStatus().error || 'supabase_unavailable',
    };
  }

  const supabase = getSupabase(event);
  const search = trimString(options.search, 120).toLowerCase();
  const limit = Math.max(1, Math.min(Number(options.limit) || 40, 100));

  try {
    const response = await supabase
      .from(CHATBOT_CONVERSATIONS_TABLE)
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (response.error) throw response.error;

    let conversations = Array.isArray(response.data) ? response.data : [];
    if (search) {
      conversations = conversations.filter((row) => {
        const haystack = [
          row.session_id,
          row.first_route,
          row.latest_route,
          row.latest_page_title,
          row.latest_intent,
          row.last_message_preview,
        ].join(' ').toLowerCase();
        return haystack.includes(search);
      });
    }

    return {
      ok: true,
      conversations,
      readOnly: false,
      setupRequired: false,
      source: 'supabase',
      supabase: supabaseStatus(),
    };
  } catch (error) {
    const setupRequired = isMissingTableError(error, CHATBOT_CONVERSATIONS_TABLE);
    return {
      ok: true,
      conversations: [],
      readOnly: true,
      setupRequired,
      source: 'unavailable',
      supabase: supabaseStatus(),
      error: error?.message || 'chatbot_conversations_failed',
    };
  }
}

async function getConversationDetail(event, conversationId) {
  if (!hasSupabase()) {
    return {
      ok: false,
      error: supabaseStatus().error || 'supabase_unavailable',
      readOnly: true,
      setupRequired: false,
      supabase: supabaseStatus(),
    };
  }

  const supabase = getSupabase(event);
  const id = trimString(conversationId, 120);
  if (!id) {
    return { ok: false, error: 'conversation_id_required', readOnly: false, setupRequired: false, supabase: supabaseStatus() };
  }

  try {
    const conversationResponse = await supabase
      .from(CHATBOT_CONVERSATIONS_TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (conversationResponse.error) throw conversationResponse.error;

    const messagesResponse = await supabase
      .from(CHATBOT_MESSAGES_TABLE)
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
      .limit(200);
    if (messagesResponse.error) throw messagesResponse.error;

    return {
      ok: true,
      conversation: conversationResponse.data || null,
      messages: Array.isArray(messagesResponse.data) ? messagesResponse.data : [],
      readOnly: false,
      setupRequired: false,
      supabase: supabaseStatus(),
    };
  } catch (error) {
    const setupRequired = isMissingTableError(error, CHATBOT_MESSAGES_TABLE) || isMissingTableError(error, CHATBOT_CONVERSATIONS_TABLE);
    return {
      ok: false,
      error: error?.message || 'chatbot_conversation_detail_failed',
      readOnly: true,
      setupRequired,
      supabase: supabaseStatus(),
    };
  }
}

module.exports = {
  CHATBOT_CONVERSATIONS_TABLE,
  CHATBOT_EVENTS_TABLE,
  CHATBOT_MESSAGES_TABLE,
  getChatbotAnalyticsSummary,
  getConversationDetail,
  listConversationRows,
  saveChatbotEventRecord,
  saveConversationRecord,
};
