'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getChatbotAnalyticsSummary } = require('./_chatbot-storage.js');

const baseHandler = async (event, context) => {
  await getContext(event, context, { requireAdmin: true });

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {}

  const summary = await getChatbotAnalyticsSummary(event, {
    limit: payload?.limit,
  });

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(summary),
  };
};

exports.handler = withAdminCors(baseHandler);
