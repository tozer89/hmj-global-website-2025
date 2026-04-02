const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(process.cwd(), 'js', 'hmj-analytics.js'), 'utf8');

async function createAnalyticsDom(fetchImpl) {
  const dom = new JSDOM('<!doctype html><html><head><title>Home</title></head><body></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = fetchImpl;
      window.console = console;
      window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
    },
  });

  dom.window.eval(source);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return dom;
}

function readQueue(window) {
  return JSON.parse(window.localStorage.getItem('hmj.analytics.queue:v1') || '[]');
}

test('hmj analytics keeps queued events when ingest returns a recoverable 202 warning', async () => {
  let fetchCalls = 0;
  const dom = await createAnalyticsDom(async () => {
    fetchCalls += 1;
    return {
      ok: false,
      status: 202,
      json: async () => ({
        ok: false,
        accepted: 0,
        code: 'analytics_schema_mismatch',
      }),
    };
  });

  const queueBefore = readQueue(dom.window);
  assert.ok(queueBefore.length >= 1, 'page bootstrap should queue initial analytics events');

  const result = await dom.window.HMJAnalytics.flush();
  const queueAfter = readQueue(dom.window);

  assert.equal(result, false);
  assert.equal(fetchCalls, 1);
  assert.equal(queueAfter.length, queueBefore.length);

  dom.window.close();
});

test('hmj analytics clears queued events after a successful ingest response', async () => {
  const dom = await createAnalyticsDom(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      accepted: 3,
    }),
  }));

  const queueBefore = readQueue(dom.window);
  assert.ok(queueBefore.length >= 1, 'page bootstrap should queue initial analytics events');

  const result = await dom.window.HMJAnalytics.flush();
  const queueAfter = readQueue(dom.window);

  assert.equal(result, true);
  assert.equal(queueAfter.length, 0);

  dom.window.close();
});
