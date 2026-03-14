'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getConversationDetail, listConversationRows } = require('./_chatbot-storage.js');

const baseHandler = async (event, context) => {
  await getContext(event, context, { requireAdmin: true });

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {}

  const conversationId = String(payload?.conversationId || '').trim();
  if (conversationId) {
    const detail = await getConversationDetail(event, conversationId);
    return {
      statusCode: detail.ok ? 200 : 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(detail),
    };
  }

  const list = await listConversationRows(event, {
    search: payload?.search,
    limit: payload?.limit,
  });

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(list),
  };
};

exports.handler = withAdminCors(baseHandler);
