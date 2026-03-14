'use strict';

const { CHATBOT_SETTINGS_KEY, resolveChatbotSettings, toPublicChatbotSettings } = require('./_chatbot-config.js');
const { fetchSettings } = require('./_settings-helpers.js');

const HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'public, max-age=300, stale-while-revalidate=300',
};

exports.handler = async (event) => {
  if ((event.httpMethod || 'GET').toUpperCase() !== 'GET') {
    return {
      statusCode: 405,
      headers: HEADERS,
      body: JSON.stringify({ ok: false, error: 'method_not_allowed' }),
    };
  }

  try {
    const { settings } = await fetchSettings(event, [CHATBOT_SETTINGS_KEY]);
    const resolved = resolveChatbotSettings(settings?.[CHATBOT_SETTINGS_KEY]);

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: true,
        config: toPublicChatbotSettings(resolved),
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({
        ok: false,
        error: error?.message || 'chatbot_config_failed',
      }),
    };
  }
};
