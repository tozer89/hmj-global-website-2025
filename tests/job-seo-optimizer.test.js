const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFallbackSeoSuggestion,
  optimiseJobSeo,
  sanitiseSeoSuggestion,
  toSeoDbPayload,
  fromSeoRow,
} = require('../netlify/functions/_job-seo-optimizer.js');

test('buildFallbackSeoSuggestion produces a clean SEO pack from job facts', () => {
  const suggestion = buildFallbackSeoSuggestion({
    title: 'Electrical Supervisor - DC',
    sectionLabel: 'Critical Infrastructure',
    type: 'contract',
    locationText: 'Frankfurt, Germany',
    overview: 'Lead electrical delivery on a live data centre programme.',
    responsibilities: ['Drive site coordination', 'Manage subcontractors'],
    requirements: ['Data centre experience', 'Electrical trade background'],
  });

  assert.equal(suggestion.optimized_title, 'Electrical Supervisor - Data Centre - Frankfurt, Germany');
  assert.match(suggestion.meta_title, /HMJ Glob/i);
  assert.match(suggestion.meta_description, /Frankfurt, Germany/);
  assert.equal(suggestion.slug_hint, 'electrical-supervisor-data-centre-frankfurt-germany');
  assert.equal(suggestion.schema_ready, false);
  assert.match(suggestion.schema_missing_fields.join(' '), /date posted/i);
});

test('optimiseJobSeo uses the Responses API when OpenAI is configured', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';

  let requestBody = null;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({
        output: [{
          content: [{
            type: 'output_text',
            text: JSON.stringify({
              optimized_title: 'Electrical Supervisor - Data Centre - Frankfurt',
              meta_title: 'Electrical Supervisor - Frankfurt | HMJ Global',
              meta_description: 'Electrical Supervisor role in Frankfurt, Germany for a live data centre programme with HMJ Global.',
              slug_hint: 'electrical-supervisor-data-centre-frankfurt',
              sector_focus: 'Data Centre',
              optimized_overview: 'HMJ Global is recruiting an Electrical Supervisor for a live data centre programme in Frankfurt, Germany.',
              optimized_responsibilities: ['Lead electrical package coordination'],
              optimized_requirements: ['Strong live project supervision background'],
              schema_missing_fields: ['salary'],
            }),
          }],
        }],
      }),
    };
  };

  try {
    const result = await optimiseJobSeo({
      id: 'job-1',
      title: 'Electrical Supervisor',
      sectionLabel: 'Critical Infrastructure',
      type: 'contract',
      locationText: 'Frankfurt, Germany',
      overview: 'Lead electrical delivery on a live data centre programme.',
    }, { fetchImpl });

    assert.equal(requestBody.model, 'gpt-5-mini');
    assert.equal(requestBody.text.format.type, 'json_schema');
    assert.equal(result.source, 'openai');
    assert.equal(result.suggestion.optimized_title, 'Electrical Supervisor - Data Centre - Frankfurt');
    assert.equal(result.suggestion.schema_ready, false);
  } finally {
    if (originalKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test('toSeoDbPayload and fromSeoRow preserve the SEO suggestion shape', () => {
  const input = sanitiseSeoSuggestion({
    optimized_title: 'CSA Engineer - Amsterdam',
    meta_title: 'CSA Engineer - Amsterdam | HMJ Global',
    meta_description: 'CSA Engineer role in Amsterdam supporting mission critical delivery.',
    slug_hint: 'csa-engineer-amsterdam',
    sector_focus: 'Data Centre',
    optimized_overview: 'HMJ Global is recruiting a CSA Engineer in Amsterdam.',
    optimized_responsibilities: ['Own package coordination'],
    optimized_requirements: ['CSA delivery background'],
    schema_missing_fields: ['salary'],
  }, {
    source: 'openai',
    model: 'gpt-5-mini',
    generatedAt: '2026-03-16T11:30:00.000Z',
  });

  const row = toSeoDbPayload('job-77', input, { source: 'openai', model: 'gpt-5-mini' });
  const output = fromSeoRow({ ...row, created_at: '2026-03-16T11:30:00.000Z' });

  assert.equal(row.job_id, 'job-77');
  assert.equal(output.optimized_title, input.optimized_title);
  assert.deepEqual(output.optimized_responsibilities, input.optimized_responsibilities);
  assert.equal(output.source, 'openai');
});
