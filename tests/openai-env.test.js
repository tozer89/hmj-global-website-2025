'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { hasUsableOpenAiApiKey, isPlaceholderOpenAiApiKey } = require('../lib/openai-env.js');
const { callOpenAiFormatter } = require('../lib/cv-formatter-core.js');

function withOpenAiKey(value, fn) {
  const original = process.env.OPENAI_API_KEY;
  if (value == null) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (original == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
    });
}

test('placeholder OpenAI keys are rejected before request attempts', async () => {
  assert.equal(isPlaceholderOpenAiApiKey('YOUR_OPENAI_API_KEY'), true);
  assert.equal(isPlaceholderOpenAiApiKey('sk-REPLACE_WITH_YOUR_KEY'), true);
  assert.equal(hasUsableOpenAiApiKey('sk-REPLACE_WITH_YOUR_KEY'), false);
  assert.equal(hasUsableOpenAiApiKey('sk-real-looking-key'), true);

  await withOpenAiKey('sk-REPLACE_WITH_YOUR_KEY', async () => {
    const result = await callOpenAiFormatter({
      candidateFileName: 'candidate.docx',
      candidateText: 'David Castle QAQC Lead employment history',
      jobSpecText: '',
      candidateReference: 'HMJ-TEST1234',
      options: {},
      requestFetch: async () => {
        throw new Error('fetch should not be called when the OpenAI key is a placeholder');
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'openai_key_missing');
    assert.deepEqual(result.attempts, []);
  });
});
