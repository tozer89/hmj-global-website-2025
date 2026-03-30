const test = require('node:test');
const assert = require('node:assert/strict');

const MODULES_TO_CLEAR = [
  '../netlify/functions/_supabase.js',
  '../netlify/functions/_rate-limit.js',
  '../netlify/functions/jobs-list.js',
  '../netlify/functions/analytics-ingest.js',
  '../netlify/functions/public-contact-enquiry.js',
  '../netlify/functions/chatbot-chat.js',
];

const ORIGINAL_ENV = {
  JOBS_LIST_RATE_LIMIT_MAX: process.env.JOBS_LIST_RATE_LIMIT_MAX,
  JOBS_LIST_RATE_LIMIT_WINDOW_SECONDS: process.env.JOBS_LIST_RATE_LIMIT_WINDOW_SECONDS,
  ANALYTICS_INGEST_RATE_LIMIT_MAX: process.env.ANALYTICS_INGEST_RATE_LIMIT_MAX,
  ANALYTICS_INGEST_RATE_LIMIT_WINDOW_SECONDS: process.env.ANALYTICS_INGEST_RATE_LIMIT_WINDOW_SECONDS,
  CONTACT_ENQUIRY_RATE_LIMIT_MAX: process.env.CONTACT_ENQUIRY_RATE_LIMIT_MAX,
  CONTACT_ENQUIRY_RATE_LIMIT_WINDOW_SECONDS: process.env.CONTACT_ENQUIRY_RATE_LIMIT_WINDOW_SECONDS,
  CHATBOT_RATE_LIMIT_MAX: process.env.CHATBOT_RATE_LIMIT_MAX,
  CHATBOT_RATE_LIMIT_WINDOW_SECONDS: process.env.CHATBOT_RATE_LIMIT_WINDOW_SECONDS,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

function restoreEnv() {
  Object.entries(ORIGINAL_ENV).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}

function clearModules() {
  MODULES_TO_CLEAR.forEach((modulePath) => {
    delete require.cache[require.resolve(modulePath)];
  });
}

function fresh(modulePath) {
  clearModules();
  return require(modulePath);
}

test.afterEach(() => {
  restoreEnv();
  clearModules();
});

test('jobs-list rate limits repeated requests before the Supabase check', async () => {
  process.env.JOBS_LIST_RATE_LIMIT_MAX = '1';
  process.env.JOBS_LIST_RATE_LIMIT_WINDOW_SECONDS = '60';

  const jobsList = fresh('../netlify/functions/jobs-list.js');
  const event = {
    httpMethod: 'GET',
    headers: {
      'x-nf-client-connection-ip': '203.0.113.10',
    },
  };

  const first = await jobsList.handler(event);
  const second = await jobsList.handler(event);

  assert.equal(first.statusCode, 503);
  assert.equal(second.statusCode, 429);
  assert.equal(JSON.parse(second.body).code, 'rate_limited');
});

test('analytics-ingest rate limits repeated requests before the Supabase check', async () => {
  process.env.ANALYTICS_INGEST_RATE_LIMIT_MAX = '1';
  process.env.ANALYTICS_INGEST_RATE_LIMIT_WINDOW_SECONDS = '60';

  const analyticsIngest = fresh('../netlify/functions/analytics-ingest.js');
  const event = {
    httpMethod: 'POST',
    headers: {
      origin: 'https://hmj-global.com',
      'x-nf-client-connection-ip': '203.0.113.11',
    },
    body: JSON.stringify({ events: [] }),
  };

  const first = await analyticsIngest.handler(event, {});
  const second = await analyticsIngest.handler(event, {});

  assert.equal(first.statusCode, 503);
  assert.equal(second.statusCode, 429);
  assert.equal(JSON.parse(second.body).code, 'rate_limited');
});

test('public-contact-enquiry uses the shared limiter across repeated requests', async () => {
  process.env.CONTACT_ENQUIRY_RATE_LIMIT_MAX = '1';
  process.env.CONTACT_ENQUIRY_RATE_LIMIT_WINDOW_SECONDS = '60';

  const contactEnquiry = fresh('../netlify/functions/public-contact-enquiry.js');
  const event = {
    httpMethod: 'POST',
    headers: {
      origin: 'https://hmj-global.com',
      'x-nf-client-connection-ip': '203.0.113.12',
    },
    body: JSON.stringify({}),
  };

  const first = await contactEnquiry.handler(event);
  const second = await contactEnquiry.handler(event);

  assert.equal(first.statusCode, 400);
  assert.equal(second.statusCode, 429);
  assert.match(JSON.parse(second.body).error, /too many requests/i);
});

test('chatbot-chat rate limits repeated requests before attempting a second OpenAI call', async () => {
  process.env.CHATBOT_RATE_LIMIT_MAX = '1';
  process.env.CHATBOT_RATE_LIMIT_WINDOW_SECONDS = '60';
  delete process.env.OPENAI_API_KEY;

  const chatbotChat = fresh('../netlify/functions/chatbot-chat.js');
  const event = {
    httpMethod: 'POST',
    headers: {
      'x-nf-client-connection-ip': '203.0.113.13',
    },
    body: JSON.stringify({
      sessionId: 'chat-rate-limit',
      message: 'Help me find a role',
      context: {
        route: '/jobs.html',
        pageCategory: 'jobs',
      },
    }),
  };

  const first = await chatbotChat.handler(event);
  const second = await chatbotChat.handler(event);

  assert.equal(first.statusCode, 503);
  assert.equal(second.statusCode, 429);
  assert.equal(JSON.parse(second.body).error, 'rate_limited');
});

test('supabase export stays callable and fails loudly instead of exposing a nullable client', () => {
  const supabaseModule = fresh('../netlify/functions/_supabase.js');

  assert.equal(typeof supabaseModule.supabase, 'object');
  assert.throws(() => supabaseModule.supabase.from('jobs'), /supabase_init_failed/);
});
