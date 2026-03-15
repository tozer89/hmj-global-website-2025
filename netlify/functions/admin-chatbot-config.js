'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const {
  CHATBOT_SETTINGS_KEY,
  DEFAULT_CHATBOT_SETTINGS,
  cloneJson,
  resolveChatbotSettings,
} = require('./_chatbot-config.js');
const { fetchSettings, saveSettings } = require('./_settings-helpers.js');

const TOP_LEVEL_KEYS = [
  'enabled',
  'visibility',
  'launcher',
  'welcome',
  'tone',
  'goals',
  'prompts',
  'dataPolicy',
  'handoff',
  'quickReplies',
  'advanced',
];

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function buildConfigResponse(event) {
  const result = await fetchSettings(event, [CHATBOT_SETTINGS_KEY]);
  const rawSettings = result?.settings?.[CHATBOT_SETTINGS_KEY];
  const hasRawObject = rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings);
  const missingKey = Array.isArray(result?.missing) && result.missing.includes(CHATBOT_SETTINGS_KEY);
  const hasSavedConfig = result?.source === 'supabase' && !missingKey && hasRawObject;
  const mergedDefaults = hasSavedConfig
    && TOP_LEVEL_KEYS.some((key) => rawSettings[key] == null);

  return {
    ok: true,
    settings: resolveChatbotSettings(rawSettings),
    defaultSettings: cloneJson(DEFAULT_CHATBOT_SETTINGS),
    source: result?.source || 'fallback',
    missing: Array.isArray(result?.missing) ? result.missing : [],
    usingDefaults: !hasSavedConfig,
    mergedDefaults,
    hasSavedConfig,
  };
}

const baseHandler = async (event, context) => {
  await getContext(event, context, { requireAdmin: true });

  const method = (event.httpMethod || 'GET').toUpperCase();
  if (method === 'GET') {
    return json(200, await buildConfigResponse(event));
  }

  if (method === 'POST') {
    let payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { ok: false, error: 'invalid_json' });
    }

    const resolved = resolveChatbotSettings(payload?.settings || payload);
    await saveSettings(event, {
      [CHATBOT_SETTINGS_KEY]: resolved,
    });
    return json(200, await buildConfigResponse(event));
  }

  return json(405, { ok: false, error: 'method_not_allowed' });
};

exports.handler = withAdminCors(baseHandler);
