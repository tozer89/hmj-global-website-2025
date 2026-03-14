'use strict';

const { createHash } = require('node:crypto');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const { isMissingTableError } = require('./_jobs-helpers.js');

const CHATBOT_CONVERSATIONS_TABLE = 'chatbot_conversations';
const CHATBOT_MESSAGES_TABLE = 'chatbot_messages';

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

function buildConversationRow(existing, sessionId, context, ipAddress, userAgent, userIntent, assistantReply) {
  const metadata = normaliseMetadata(context);
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
      metadata,
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
    metadata,
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
        metadata,
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
        metadata,
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
  CHATBOT_MESSAGES_TABLE,
  getConversationDetail,
  listConversationRows,
  saveConversationRecord,
};
