const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPromptFacts,
  hasEnoughSourceMaterial,
  sanitiseShareSpec,
  enrichJobSpec,
} = require('../netlify/functions/_job-spec-enrichment.js');

test('buildPromptFacts compacts job fields into a safe prompt payload', () => {
  const facts = buildPromptFacts({
    title: ' Senior Planner ',
    status: 'live',
    sectionLabel: 'Critical Infrastructure',
    discipline: 'Planning',
    type: 'permanent',
    locationText: 'Frankfurt, Germany',
    payText: '£65,000 - £80,000 per year',
    overview: ' Lead planning across a live programme. ',
    responsibilities: [' Own programme controls ', ' Client reporting '],
    requirements: ['P6', 'Hyperscale delivery'],
    tags: ['P6', 'Planning'],
    benefits: ['Travel support'],
    customer: 'Hyperscale client',
  });

  assert.equal(facts.title, 'Senior Planner');
  assert.equal(facts.section, 'Critical Infrastructure');
  assert.deepEqual(facts.responsibilities, ['Own programme controls', 'Client reporting']);
  assert.deepEqual(facts.requirements, ['P6', 'Hyperscale delivery']);
  assert.deepEqual(facts.tags, ['P6', 'Planning']);
});

test('hasEnoughSourceMaterial requires a reasonable amount of source content', () => {
  assert.equal(hasEnoughSourceMaterial({ title: 'Thin role', tags: ['QA'] }), false);
  assert.equal(
    hasEnoughSourceMaterial({
      title: 'QA Lead',
      overview: 'Drive turnover quality, punch closure, and handover readiness on a complex live pharma build.',
    }),
    true
  );
});

test('sanitiseShareSpec trims and normalises model output safely', () => {
  const spec = sanitiseShareSpec({
    overview: '  Strong external summary.  ',
    responsibilities: [' Lead package delivery ', 'Lead package delivery', ' Client reporting '],
    requirements: ['P6', 'Hyperscale delivery'],
  }, {
    model: 'gpt-5-mini',
    source: 'openai',
    generatedAt: '2026-03-15T12:00:00Z',
  });

  assert.deepEqual(spec, {
    enhanced: true,
    source: 'openai',
    model: 'gpt-5-mini',
    generatedAt: '2026-03-15T12:00:00Z',
    overview: 'Strong external summary.',
    responsibilities: ['Lead package delivery', 'Client reporting'],
    requirements: ['P6', 'Hyperscale delivery'],
  });
});

test('enrichJobSpec returns structured share spec content from the Responses API', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';

  let requestBody = null;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({
        id: 'resp_job_spec_1',
        status: 'completed',
        output: [{
          status: 'completed',
          content: [{
            type: 'output_text',
            text: JSON.stringify({
              overview: 'Join HMJ Global to support a complex critical infrastructure programme, leading planning cadence, stakeholder reporting, and delivery certainty across the project lifecycle.',
              responsibilities: [
                'Lead integrated programme planning across key work packages.',
                'Maintain reporting rhythm with project and client stakeholders.',
                'Track progress, risks, and recovery actions against milestones.',
                'Support delivery teams with accurate planning insight.',
              ],
              requirements: [
                'Strong Primavera P6 planning capability.',
                'Experience on mission critical or major project environments.',
                'Able to communicate clearly with site, commercial, and client teams.',
                'Comfortable driving programme discipline in a live delivery setting.',
              ],
            }),
          }],
        }],
      }),
    };
  };

  try {
    const result = await enrichJobSpec({
      title: 'Senior Planner',
      status: 'live',
      sectionLabel: 'Critical Infrastructure',
      discipline: 'Planning',
      type: 'permanent',
      locationText: 'Frankfurt, Germany',
      overview: 'Lead planning across a hyperscale programme.',
      responsibilities: ['Own programme controls', 'Client reporting'],
      requirements: ['Primavera P6', 'Hyperscale experience'],
      tags: ['P6', 'Planning', 'Mission Critical'],
    }, { fetchImpl });

    assert.equal(requestBody.model, 'gpt-5-mini');
    assert.equal(requestBody.text.format.type, 'json_schema');
    assert.equal(result.ok, true);
    assert.equal(result.shareSpec.enhanced, true);
    assert.equal(result.shareSpec.source, 'openai');
    assert.match(result.shareSpec.overview, /HMJ Global/);
    assert.equal(result.shareSpec.responsibilities.length, 4);
    assert.equal(result.shareSpec.requirements.length, 4);
  } finally {
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
});

test('enrichJobSpec fails softly when source content is too thin', async () => {
  const result = await enrichJobSpec({
    title: 'QA Lead',
    tags: ['QA'],
  }, {
    fetchImpl: async () => {
      throw new Error('fetch should not be called');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'insufficient_source_content');
});
