const test = require('node:test');
const assert = require('node:assert/strict');

const { callOpenAIForChat, buildFallbackReply } = require('../netlify/functions/_chatbot-core.js');
const chatbotConfigFunction = require('../netlify/functions/chatbot-config.js');
const chatbotChatFunction = require('../netlify/functions/chatbot-chat.js');

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
              intent: 'job_search',
              cta_ids: ['find_jobs', 'register_candidate'],
              quick_reply_ids: ['contact_hmj'],
              should_handoff: false,
              handoff_reason: '',
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
    assert.equal(requestBody.max_output_tokens, 280);
    assert.equal(response.intent, 'job_search');
    assert.deepEqual(response.ctaIds, ['find_jobs', 'register_candidate']);
    assert.deepEqual(response.quickReplyIds, ['contact_hmj']);
    assert.match(response.reply, /jobs board/i);
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
    assert.match(payload.fallback.reply, /jobs board/i);
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
  }, actionCatalog, 'candidate_registration');

  assert.equal(reply.intent, 'candidate_registration');
  assert.deepEqual(reply.ctaIds, ['register_candidate', 'find_jobs']);
});
