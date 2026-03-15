const test = require('node:test');
const assert = require('node:assert/strict');

const { callOpenAIForChat, buildFallbackReply } = require('../netlify/functions/_chatbot-core.js');
const { resolveChatbotSettings } = require('../netlify/functions/_chatbot-config.js');
const adminChatbotConfigFunction = require('../netlify/functions/admin-chatbot-config.js');
const { classifyVisitorIntent } = require('../netlify/functions/_chatbot-grounding.js');
const chatbotConfigFunction = require('../netlify/functions/chatbot-config.js');
const chatbotChatFunction = require('../netlify/functions/chatbot-chat.js');
const adminChatbotConfigMirror = require('../admin-v2/functions/admin-chatbot-config.js');
const chatbotChatMirror = require('../admin-v2/functions/chatbot-chat.js');
const chatbotConfigMirror = require('../admin-v2/functions/chatbot-config.js');
const chatbotPreviewMirror = require('../admin-v2/functions/admin-chatbot-preview.js');
const chatbotConversationsMirror = require('../admin-v2/functions/admin-chatbot-conversations.js');
const chatbotEventMirror = require('../admin-v2/functions/chatbot-event.js');
const chatbotAnalyticsMirror = require('../admin-v2/functions/admin-chatbot-analytics.js');

function makeAdminBearerToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'admin-test',
    email: 'admin@example.com',
    app_metadata: { roles: ['admin'] },
  })).toString('base64url');
  return `${header}.${payload}.`;
}

test('callOpenAIForChat returns structured reply with approved CTA ids', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';

  let requestBody = null;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({
        id: 'resp_test_1',
        status: 'completed',
        output: [{
          status: 'completed',
          content: [{
            type: 'output_text',
            text: JSON.stringify({
              reply: 'The quickest next step is to browse the live HMJ jobs board or register your profile.',
              intent: 'candidate_job_search',
              visitor_type: 'candidate',
              cta_ids: ['find_jobs', 'register_candidate'],
              quick_reply_ids: ['contact_hmj'],
              should_handoff: false,
              handoff_reason: '',
              follow_up_question: 'Would you like me to point you to the live jobs page or the registration form?',
              answer_confidence: 'high',
              outcome: 'browse_jobs',
            }),
          }],
        }],
      }),
    };
  };

  try {
    const response = await callOpenAIForChat({
      message: 'I am looking for work in commissioning.',
      history: [],
      context: {
        route: '/jobs.html',
        pageCategory: 'jobs',
        pageTitle: 'Jobs | HMJ Global',
        metaDescription: 'Live HMJ roles.',
      },
      fetchImpl,
    });

    assert.equal(requestBody.model, 'gpt-5-mini');
    assert.equal(requestBody.max_output_tokens, 450);
    assert.equal(response.intent, 'candidate_job_search');
    assert.equal(response.visitorType, 'candidate');
    assert.deepEqual(response.ctaIds, ['find_jobs', 'register_candidate']);
    assert.deepEqual(response.quickReplyIds, ['contact_hmj']);
    assert.equal(response.outcome, 'browse_jobs');
    assert.equal(response.answerConfidence, 'high');
    assert.match(response.followUpQuestion, /jobs page/i);
    assert.equal(Array.isArray(response.resourceLinks), true);
    assert.equal(Array.isArray(response.suggestedPrompts), true);
    assert.match(response.reply, /jobs board/i);
  } finally {
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test('callOpenAIForChat serialises assistant history using output_text for the Responses API', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';

  let requestBody = null;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({
        id: 'resp_test_2',
        status: 'completed',
        output: [{
          status: 'completed',
          content: [{
            type: 'output_text',
            text: JSON.stringify({
              reply: 'The quickest next step is to share the requirement through the HMJ client route.',
              intent: 'client_hiring_enquiry',
              visitor_type: 'client',
              cta_ids: ['hiring_staff'],
              quick_reply_ids: ['contact_hmj'],
              should_handoff: false,
              handoff_reason: '',
              follow_up_question: 'What roles are you looking to fill?',
              answer_confidence: 'high',
              outcome: 'client_enquiry',
            }),
          }],
        }],
      }),
    };
  };

  try {
    await callOpenAIForChat({
      message: 'We need help hiring on a project in Germany.',
      history: [
        { role: 'user', text: 'I am looking for electrical work in Frankfurt.' },
        { role: 'assistant', text: 'I can point you to the live Frankfurt roles.' },
      ],
      context: {
        route: '/jobs',
        pageCategory: 'jobs',
        pageTitle: 'Jobs | HMJ Global',
      },
      fetchImpl,
    });

    assert.equal(requestBody.input[0].role, 'user');
    assert.equal(requestBody.input[0].content[0].type, 'input_text');
    assert.equal(requestBody.input[1].role, 'assistant');
    assert.equal(requestBody.input[1].content[0].type, 'output_text');
    assert.equal(requestBody.input[2].role, 'user');
    assert.equal(requestBody.input[2].content[0].type, 'input_text');
  } finally {
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test('chatbot-config exposes only public-safe configuration fields', async () => {
  const response = await chatbotConfigFunction.handler({ httpMethod: 'GET', headers: {} });
  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);

  assert.equal(payload.ok, true);
  assert.equal(typeof payload.config.welcome.title, 'string');
  assert.equal(Array.isArray(payload.config.quickReplies), true);
  assert.equal('prompts' in payload.config, false);
  assert.equal('advanced' in payload.config, false);
});

test('resolveChatbotSettings backfills missing sections with the new HMJ defaults', () => {
  const settings = resolveChatbotSettings({
    visibility: {
      routeMode: 'all_public',
      includePatterns: [],
      excludePatterns: ['/admin', '/timesheets'],
    },
    launcher: {
      label: 'Need help now',
    },
    quickReplies: [],
  });

  assert.equal(settings.launcher.label, 'Need help now');
  assert.equal(settings.launcher.assistantName, 'Jacob');
  assert.equal(settings.launcher.badge, 'Live support');
  assert.equal(settings.launcher.autoOpenDelayMs, 4500);
  assert.deepEqual(settings.visibility.includePatterns, ['/', '/about*', '/jobs*', '/candidates*', '/clients*', '/contact*', '/apply*']);
  assert.deepEqual(settings.visibility.excludePatterns, ['/admin*', '/dashboard*', '/preview*']);
  assert.equal(settings.goals.candidate_registration, 10);
  assert.equal(settings.dataPolicy.maxGroundingJobs, 12);
  assert.equal(settings.advanced.debugLogging, true);
  assert.equal(Array.isArray(settings.quickReplies), true);
  assert.ok(settings.quickReplies.length >= 1);
});

test('admin-chatbot-config returns effective defaults and reset seed data when no saved row exists', async () => {
  const response = await adminChatbotConfigFunction.handler({
    httpMethod: 'GET',
    headers: { authorization: `Bearer ${makeAdminBearerToken()}` },
  }, {});

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body);

  assert.equal(payload.ok, true);
  assert.equal(payload.usingDefaults, true);
  assert.equal(payload.settings.launcher.assistantName, 'Jacob');
  assert.equal(payload.settings.launcher.badge, 'Live support');
  assert.equal(payload.defaultSettings.launcher.assistantName, 'Jacob');
});

test('chatbot-chat returns graceful fallback when the OpenAI key is missing', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const response = await chatbotChatFunction.handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({
        sessionId: 'chat_test_missing_key',
        message: 'I need help finding jobs',
        context: {
          route: '/jobs.html',
          pageCategory: 'jobs',
          pageTitle: 'Jobs | HMJ Global',
        },
      }),
    });

    assert.equal(response.statusCode, 503);
    const payload = JSON.parse(response.body);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, 'openai_key_missing');
    assert.match(payload.fallback.reply, /(jobs board|relevant hmj role)/i);
    assert.equal(payload.fallback.intent, 'candidate_job_search');
    assert.equal(Array.isArray(payload.fallback.resourceLinks), true);
    assert.equal(Array.isArray(payload.fallback.suggestedPrompts), true);
  } finally {
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test('buildFallbackReply prioritises the right CTA set for candidate registration', () => {
  const actionCatalog = [
    { id: 'find_jobs' },
    { id: 'register_candidate' },
    { id: 'contact_hmj' },
  ];
  const reply = buildFallbackReply({
    handoff: { handoffMessage: 'Contact HMJ directly.' },
    tone: { fallbackStyle: 'reassuring_action', askFollowUpQuestion: 'balanced', maxReplySentences: 3 },
    dataPolicy: { injectWebsiteContext: true, injectJobsContext: true, maxGroundingJobs: 2 },
  }, actionCatalog, 'candidate_registration');

  assert.equal(reply.intent, 'candidate_registration');
  assert.deepEqual(reply.ctaIds, ['register_candidate', 'find_jobs']);
  assert.equal(reply.outcome, 'register_candidate');
  assert.equal(Array.isArray(reply.suggestedPrompts), true);
});

test('admin-v2 function entrypoints mirror the chatbot handlers used by preview and branch deploys', () => {
  assert.equal(adminChatbotConfigMirror.handler, adminChatbotConfigFunction.handler);
  assert.equal(chatbotChatMirror.handler, chatbotChatFunction.handler);
  assert.equal(chatbotConfigMirror.handler, chatbotConfigFunction.handler);
  assert.equal(typeof chatbotPreviewMirror.handler, 'function');
  assert.equal(typeof chatbotConversationsMirror.handler, 'function');
  assert.equal(typeof chatbotEventMirror.handler, 'function');
  assert.equal(typeof chatbotAnalyticsMirror.handler, 'function');
});

test('intent classifier keeps representative prompts on the right HMJ journey', () => {
  assert.equal(classifyVisitorIntent('I’m looking for electrical work in Frankfurt'), 'candidate_job_search');
  assert.equal(classifyVisitorIntent('Do you recruit for data centre roles?'), 'general_company_question');
  assert.equal(classifyVisitorIntent('We need help hiring on a project in Germany'), 'client_hiring_enquiry');
  assert.equal(classifyVisitorIntent('How do I register with HMJ Global?'), 'candidate_registration');
  assert.equal(classifyVisitorIntent('What does HMJ Global do?'), 'general_company_question');
  assert.equal(classifyVisitorIntent('Can you help me find staff?'), 'client_hiring_enquiry');
  assert.equal(classifyVisitorIntent('What is the weather in Paris this weekend?'), 'off_topic');
});
