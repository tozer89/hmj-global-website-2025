'use strict';

const { hasUsableOpenAiApiKey } = require('../../lib/openai-env.js');

const fetchImpl = typeof fetch === 'function'
  ? fetch.bind(globalThis)
  : (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  return maxLength && maxLength > 0 ? text.slice(0, maxLength) : text;
}

function cleanList(value, maxItems = 8, maxItemLength = 220) {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|,|\u2022/)
      : [];

  const seen = new Set();
  const output = [];

  items.forEach((entry) => {
    const cleaned = trimString(String(entry || '').replace(/^[-*•\s]+/, ''), maxItemLength);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(cleaned);
  });

  return output.slice(0, maxItems);
}

function safeJsonParse(value) {
  if (!trimString(value)) return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function extractOutputText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (trimString(payload.output_text, 12000)) return trimString(payload.output_text, 12000);

  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks = [];
  output.forEach((item) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    content.forEach((part) => {
      const text = trimString(part?.text || part?.output_text || part?.summary, 12000);
      if (text) chunks.push(text);
    });
  });

  return trimString(chunks.join('\n'), 12000);
}

function stripJsonCodeFences(text) {
  const trimmed = trimString(text, 12000);
  if (!trimmed) return '';
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? trimString(match[1], 12000) : trimmed;
}

function parseModelJson(text) {
  const direct = trimString(text, 12000);
  if (!direct) return null;
  const candidates = [direct];
  const stripped = stripJsonCodeFences(direct);
  if (stripped && stripped !== direct) candidates.push(stripped);

  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    candidates.push(stripped.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    if (parsed && typeof parsed === 'object') return parsed;
  }
  return null;
}

function hasEnoughSourceMaterial(job = {}) {
  const overview = trimString(job.overview, 2000);
  const responsibilities = cleanList(job.responsibilities, 10, 220);
  const requirements = cleanList(job.requirements, 10, 220);
  const tags = cleanList(job.tags, 8, 80);
  return overview.length >= 40 || responsibilities.length >= 2 || requirements.length >= 2 || tags.length >= 3;
}

function buildPromptFacts(job = {}) {
  return {
    title: trimString(job.title, 160),
    status: trimString(job.status, 40) || 'live',
    section: trimString(job.sectionLabel || job.section, 120),
    discipline: trimString(job.discipline, 120),
    employmentType: trimString(job.type, 80),
    location: trimString(job.locationText || job.location_text, 160),
    pay: trimString(job.payText || '', 160),
    overview: trimString(job.overview, 2400),
    responsibilities: cleanList(job.responsibilities, 10, 220),
    requirements: cleanList(job.requirements, 10, 220),
    tags: cleanList(job.tags, 10, 80),
    benefits: cleanList(job.benefits, 8, 120),
    customer: trimString(job.customer, 160),
  };
}

function buildSpecSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['overview', 'responsibilities', 'requirements'],
    properties: {
      overview: { type: 'string' },
      responsibilities: {
        type: 'array',
        items: { type: 'string' },
      },
      requirements: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  };
}

function sanitiseShareSpec(raw, meta = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const overview = trimString(input.overview, 1800);
  const responsibilities = cleanList(input.responsibilities, 8, 220);
  const requirements = cleanList(input.requirements, 8, 220);

  if (!overview && !responsibilities.length && !requirements.length) {
    return null;
  }

  return {
    enhanced: true,
    source: trimString(meta.source || 'openai', 40),
    model: trimString(meta.model, 120),
    generatedAt: meta.generatedAt || new Date().toISOString(),
    overview,
    responsibilities,
    requirements,
  };
}

async function enrichJobSpec(job = {}, options = {}) {
  if (!hasEnoughSourceMaterial(job)) {
    return {
      ok: false,
      error: 'insufficient_source_content',
      requested: true,
    };
  }

  const apiKey = trimString(process.env.OPENAI_API_KEY, 240);
  if (!hasUsableOpenAiApiKey(apiKey)) {
    return {
      ok: false,
      error: 'openai_key_missing',
      requested: true,
    };
  }

  const model = trimString(process.env.OPENAI_JOB_SPEC_MODEL, 120) || 'gpt-5-mini';
  const requestFetch = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetchImpl;
  const facts = buildPromptFacts(job);
  const requestBody = {
    model,
    max_output_tokens: 900,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: [
              'You are HMJ Global’s recruitment content assistant.',
              'Rewrite the supplied role facts into a polished external job specification.',
              'Keep the tone premium, precise, professional, and candidate-facing.',
              'Do not invent salary, location, client names, sponsorship, certifications, remote policy, rotation, project scope, or benefits.',
              'You may expand shorthand into clearer candidate-facing wording only when it is a direct restatement of the supplied facts.',
              'For example, turn terse inputs such as electrician, commissioning, site delivery, HV, LV, data centre, or pharma into clearer plain-English capability statements without inventing specific licences, cards, or approvals that were not supplied.',
              'If a fact is missing, keep the wording general rather than fabricating detail.',
              'Return JSON only.',
            ].join(' '),
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [
              'Create a stronger shareable job spec using only the facts below.',
              'Requirements:',
              '- overview: one polished paragraph, approximately 120 to 190 words.',
              '- responsibilities: 5 to 7 concise bullet-style lines.',
              '- requirements: 5 to 7 concise bullet-style lines.',
              '- Keep the content faithful to the source facts.',
              '- Prefer plain English over shorthand when you can do so safely from the supplied facts.',
              '',
              `Role facts: ${JSON.stringify(facts, null, 2)}`,
            ].join('\n'),
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'hmj_job_spec_enrichment',
        schema: buildSpecSchema(),
        strict: true,
      },
    },
  };

  if (model.toLowerCase().startsWith('gpt-5')) {
    requestBody.reasoning = { effort: 'low' };
  }

  const response = await requestFetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const rawText = await response.text();
  const payload = safeJsonParse(rawText) || {};
  if (!response.ok) {
    return {
      ok: false,
      requested: true,
      error: trimString(payload?.error?.message || payload?.message || `openai_http_${response.status}`, 240),
      model,
      status: response.status,
    };
  }

  const parsed = parseModelJson(extractOutputText(payload));
  const shareSpec = sanitiseShareSpec(parsed, {
    model,
    source: 'openai',
    generatedAt: new Date().toISOString(),
  });

  if (!shareSpec) {
    return {
      ok: false,
      requested: true,
      error: 'openai_empty_response',
      model,
    };
  }

  return {
    ok: true,
    requested: true,
    shareSpec,
    model,
  };
}

module.exports = {
  buildPromptFacts,
  hasEnoughSourceMaterial,
  sanitiseShareSpec,
  enrichJobSpec,
};
