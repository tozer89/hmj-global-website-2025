'use strict';

const { isMissingTableError, isSchemaError, slugify } = require('./_jobs-helpers.js');

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
  if (trimString(payload.output_text, 24000)) return trimString(payload.output_text, 24000);

  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks = [];
  output.forEach((item) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    content.forEach((part) => {
      const text = trimString(part?.text || part?.output_text || part?.summary, 24000);
      if (text) chunks.push(text);
    });
  });

  return trimString(chunks.join('\n'), 24000);
}

function stripJsonCodeFences(text) {
  const trimmed = trimString(text, 24000);
  if (!trimmed) return '';
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? trimString(match[1], 24000) : trimmed;
}

function parseModelJson(text) {
  const direct = trimString(text, 24000);
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

function toSentenceCase(text) {
  const value = trimString(text, 240);
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toTitleCase(text) {
  return trimString(text, 240)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normaliseLocation(text) {
  return trimString(text, 160)
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ');
}

function expandTitleAbbreviations(text) {
  return trimString(text, 180)
    .replace(/\bDC\b/gi, 'Data Centre')
    .replace(/\bHV\b/g, 'HV')
    .replace(/\bLV\b/g, 'LV')
    .replace(/\bCSA\b/g, 'CSA')
    .replace(/\bMEP\b/g, 'MEP');
}

function detectSector(job = {}) {
  const haystack = [
    job.section,
    job.sectionLabel,
    job.discipline,
    job.title,
    job.overview,
    ...(Array.isArray(job.tags) ? job.tags : []),
  ].join(' ').toLowerCase();

  if (/data centre|datacenter|hyperscale|mission critical|dc\b/.test(haystack)) return 'Data Centre';
  if (/pharma|gmp|cleanroom|cqv|life sciences/.test(haystack)) return 'Life Sciences & Pharma';
  if (/substation|hv|lv|grid|energy|power/.test(haystack)) return 'Energy & Substations';
  if (/commission/.test(haystack)) return 'Commissioning';
  if (/construction|site|civils|commercial/.test(haystack)) return 'Construction';
  if (/engineering|mechanical|electrical|automation/.test(haystack)) return 'Engineering';
  return trimString(job.sectionLabel || job.section, 80);
}

function detectLocationLabel(job = {}) {
  return normaliseLocation(job.locationText || job.location_text || '');
}

function buildOptimizedTitle(job = {}) {
  const rawTitle = expandTitleAbbreviations(job.title || '');
  const sector = detectSector(job);
  const location = detectLocationLabel(job);
  const titleLower = rawTitle.toLowerCase();
  const parts = [rawTitle];

  if (sector && sector !== 'Construction' && !titleLower.includes(sector.toLowerCase())) {
    parts.push(sector);
  }
  if (location && !titleLower.includes(location.toLowerCase())) {
    parts.push(location);
  }
  return trimString(parts.filter(Boolean).join(' - '), 120);
}

function buildEmploymentLabel(job = {}) {
  const value = trimString(job.type || '', 60).toLowerCase();
  if (value === 'fixed-term') return 'fixed-term';
  if (value === 'contract') return 'contract';
  if (value === 'permanent') return 'permanent';
  return value;
}

function buildOverviewSentence(job = {}) {
  const role = trimString(job.title, 120) || 'specialist role';
  const location = detectLocationLabel(job);
  const sector = detectSector(job);
  const type = buildEmploymentLabel(job);
  const segments = [`HMJ Global is recruiting for a ${role.toLowerCase()}`];
  if (sector) segments.push(`supporting ${sector.toLowerCase()} delivery`);
  if (location) segments.push(`in ${location}`);
  if (type) segments.push(`on a ${type} basis`);
  return toSentenceCase(`${segments.join(' ')}.`);
}

function summariseSchemaMissing(job = {}) {
  const missing = [];
  if (!trimString(job.title, 180)) missing.push('title');
  if (!trimString(job.overview, 2200) && !cleanList(job.responsibilities).length && !cleanList(job.requirements).length) missing.push('description');
  if (!detectLocationLabel(job)) missing.push('location');
  if (!buildEmploymentLabel(job)) missing.push('employment type');
  if (!trimString(job.createdAt || job.created_at || '', 80)) missing.push('date posted');
  if (!trimString(job.applyUrl || job.apply_url || '', 300)) missing.push('application URL');
  return missing;
}

function buildMetaDescription(job = {}, optimizedTitle = '') {
  const role = trimString(optimizedTitle || job.title, 120) || 'technical recruitment role';
  const location = detectLocationLabel(job);
  const sector = detectSector(job);
  const type = buildEmploymentLabel(job);
  const payText = trimString(job.payText || '', 120);
  const overview = trimString(job.overview, 260);

  const pieces = [role];
  if (location) pieces.push(location);
  if (sector) pieces.push(`${sector} recruitment`);
  if (type) pieces.push(type);
  if (payText) pieces.push(payText);

  let description = trimString(pieces.join(' | '), 156);
  if (description.length < 120 && overview) {
    description = trimString(`${description}. ${overview}`, 156);
  }
  if (!description) {
    description = trimString(`${role}. Explore specialist HMJ Global opportunities across technical, engineering, construction and mission-critical delivery.`, 156);
  }
  return description;
}

function buildFallbackSeoSuggestion(job = {}) {
  const optimizedTitle = buildOptimizedTitle(job);
  const responsibilities = cleanList(job.responsibilities, 8, 220);
  const requirements = cleanList(job.requirements, 8, 220);
  const sectorFocus = detectSector(job);
  const schemaMissingFields = summariseSchemaMissing(job);
  const openingSentence = buildOverviewSentence(job);
  const sourceOverview = trimString(job.overview, 2200);
  const optimizedOverview = sourceOverview
    ? trimString(
      sourceOverview.toLowerCase().startsWith(openingSentence.toLowerCase())
        ? sourceOverview
        : `${openingSentence} ${sourceOverview}`,
      1800
    )
    : openingSentence;

  return {
    optimized_title: optimizedTitle || trimString(job.title, 120),
    meta_title: trimString(`${optimizedTitle || trimString(job.title, 120) || 'HMJ Global role'} | HMJ Global`, 68),
    meta_description: buildMetaDescription(job, optimizedTitle),
    slug_hint: slugify(optimizedTitle || job.title || ''),
    sector_focus: sectorFocus || '',
    optimized_overview: optimizedOverview,
    optimized_responsibilities: responsibilities,
    optimized_requirements: requirements,
    schema_missing_fields: schemaMissingFields,
    schema_ready: schemaMissingFields.length === 0,
  };
}

function buildSeoFacts(job = {}) {
  const suggestion = buildFallbackSeoSuggestion(job);
  return {
    title: trimString(job.title, 180),
    discipline: trimString(job.discipline, 120),
    section: trimString(job.sectionLabel || job.section, 120),
    employmentType: buildEmploymentLabel(job),
    location: detectLocationLabel(job),
    payText: trimString(job.payText, 120),
    overview: trimString(job.overview, 2800),
    responsibilities: cleanList(job.responsibilities, 10, 220),
    requirements: cleanList(job.requirements, 10, 220),
    tags: cleanList(job.tags, 10, 80),
    benefits: cleanList(job.benefits, 8, 120),
    customer: trimString(job.customer, 160),
    fallbackSuggestion: suggestion,
  };
}

function buildSeoSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'optimized_title',
      'meta_title',
      'meta_description',
      'slug_hint',
      'sector_focus',
      'optimized_overview',
      'optimized_responsibilities',
      'optimized_requirements',
      'schema_missing_fields',
    ],
    properties: {
      optimized_title: { type: 'string' },
      meta_title: { type: 'string' },
      meta_description: { type: 'string' },
      slug_hint: { type: 'string' },
      sector_focus: { type: 'string' },
      optimized_overview: { type: 'string' },
      optimized_responsibilities: { type: 'array', items: { type: 'string' } },
      optimized_requirements: { type: 'array', items: { type: 'string' } },
      schema_missing_fields: { type: 'array', items: { type: 'string' } },
    },
  };
}

function sanitiseSeoSuggestion(raw, meta = {}, fallbackJob = {}) {
  const fallback = buildFallbackSeoSuggestion(fallbackJob);
  const input = raw && typeof raw === 'object' ? raw : {};
  const optimizedTitle = trimString(input.optimized_title || fallback.optimized_title, 120);
  const metaTitle = trimString(input.meta_title || `${optimizedTitle || fallback.optimized_title} | HMJ Global`, 68);
  const metaDescription = trimString(input.meta_description || fallback.meta_description, 156);
  const slugHint = slugify(input.slug_hint || optimizedTitle || fallback.slug_hint || fallbackJob.title || '');
  const sectorFocus = trimString(input.sector_focus || fallback.sector_focus, 80);
  const optimizedOverview = trimString(input.optimized_overview || fallback.optimized_overview, 1800);
  const optimizedResponsibilities = cleanList(input.optimized_responsibilities || fallback.optimized_responsibilities, 8, 220);
  const optimizedRequirements = cleanList(input.optimized_requirements || fallback.optimized_requirements, 8, 220);
  const schemaMissingFields = cleanList(input.schema_missing_fields || fallback.schema_missing_fields, 8, 80);

  return {
    optimized_title: optimizedTitle || fallback.optimized_title,
    meta_title: metaTitle || fallback.meta_title,
    meta_description: metaDescription || fallback.meta_description,
    slug_hint: slugHint || fallback.slug_hint,
    sector_focus: sectorFocus || fallback.sector_focus,
    optimized_overview: optimizedOverview || fallback.optimized_overview,
    optimized_responsibilities: optimizedResponsibilities.length ? optimizedResponsibilities : fallback.optimized_responsibilities,
    optimized_requirements: optimizedRequirements.length ? optimizedRequirements : fallback.optimized_requirements,
    schema_missing_fields: schemaMissingFields,
    schema_ready: schemaMissingFields.length === 0,
    source: trimString(meta.source || 'heuristic', 40),
    model: trimString(meta.model, 120),
    generated_at: meta.generatedAt || new Date().toISOString(),
  };
}

async function optimiseJobSeo(job = {}, options = {}) {
  const fallback = sanitiseSeoSuggestion(null, {
    source: 'heuristic',
    model: '',
    generatedAt: new Date().toISOString(),
  }, job);
  const apiKey = trimString(process.env.OPENAI_API_KEY, 240);
  if (!apiKey) {
    return {
      ok: true,
      source: 'heuristic',
      suggestion: fallback,
      error: 'openai_key_missing',
    };
  }

  const facts = buildSeoFacts(job);
  const model = trimString(process.env.OPENAI_JOB_SEO_MODEL, 120) || 'gpt-5-mini';
  const requestFetch = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetchImpl;

  const requestBody = {
    model,
    max_output_tokens: 1200,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: [
              'You are HMJ Global’s recruitment SEO assistant.',
              'Improve job listing search clarity without fabricating information.',
              'Optimise for professional job search queries, especially role + sector + location.',
              'Keep titles natural, commercially credible, and concise.',
              'Do not invent salary, certifications, project names, rota, sponsorship, client identity, benefits, or scope.',
              'You may expand obvious shorthand safely when it is clearly supported by the supplied facts.',
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
              'Review the job facts and create an SEO-ready suggestion pack for HMJ Global.',
              'Requirements:',
              '- optimized_title: clear job title prioritising role, sector, and location where available.',
              '- meta_title: keep under 68 characters when possible.',
              '- meta_description: keep under 156 characters when possible.',
              '- slug_hint: readable lowercase slug, no domain or leading slash.',
              '- sector_focus: short sector label.',
              '- optimized_overview: concise improved opening paragraph using only supplied facts.',
              '- optimized_responsibilities and optimized_requirements: clean concise lists.',
              '- schema_missing_fields: list only genuinely missing JobPosting essentials from the facts.',
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
        name: 'hmj_job_seo_suggestion',
        schema: buildSeoSchema(),
        strict: true,
      },
    },
  };

  if (model.toLowerCase().startsWith('gpt-5')) {
    requestBody.reasoning = { effort: 'low' };
  }

  try {
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
        ok: true,
        source: 'heuristic',
        suggestion: fallback,
        error: trimString(payload?.error?.message || payload?.message || `openai_http_${response.status}`, 240),
        model,
      };
    }
    const parsed = parseModelJson(extractOutputText(payload));
    const suggestion = sanitiseSeoSuggestion(parsed, {
      source: 'openai',
      model,
      generatedAt: new Date().toISOString(),
    }, job);
    return {
      ok: true,
      source: 'openai',
      suggestion,
      model,
    };
  } catch (error) {
    return {
      ok: true,
      source: 'heuristic',
      suggestion: fallback,
      error: trimString(error?.message || 'openai_request_failed', 240),
      model,
    };
  }
}

function toSeoDbPayload(jobId, suggestion = {}, options = {}) {
  return {
    job_id: trimString(jobId, 120),
    optimized_title: trimString(suggestion.optimized_title, 120) || null,
    meta_title: trimString(suggestion.meta_title, 68) || null,
    meta_description: trimString(suggestion.meta_description, 156) || null,
    slug_hint: trimString(suggestion.slug_hint, 120) || null,
    sector_focus: trimString(suggestion.sector_focus, 80) || null,
    optimized_overview: trimString(suggestion.optimized_overview, 1800) || null,
    optimized_responsibilities: Array.isArray(suggestion.optimized_responsibilities) ? suggestion.optimized_responsibilities : [],
    optimized_requirements: Array.isArray(suggestion.optimized_requirements) ? suggestion.optimized_requirements : [],
    schema_missing_fields: Array.isArray(suggestion.schema_missing_fields) ? suggestion.schema_missing_fields : [],
    source: trimString(options.source || suggestion.source || 'heuristic', 40) || 'heuristic',
    model: trimString(options.model || suggestion.model, 120) || null,
    payload: suggestion,
    last_error: trimString(options.lastError, 240) || null,
    updated_at: new Date().toISOString(),
  };
}

function fromSeoRow(row = {}) {
  if (!row || typeof row !== 'object') return null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return sanitiseSeoSuggestion({
    optimized_title: row.optimized_title || payload.optimized_title,
    meta_title: row.meta_title || payload.meta_title,
    meta_description: row.meta_description || payload.meta_description,
    slug_hint: row.slug_hint || payload.slug_hint,
    sector_focus: row.sector_focus || payload.sector_focus,
    optimized_overview: row.optimized_overview || payload.optimized_overview,
    optimized_responsibilities: row.optimized_responsibilities || payload.optimized_responsibilities,
    optimized_requirements: row.optimized_requirements || payload.optimized_requirements,
    schema_missing_fields: row.schema_missing_fields || payload.schema_missing_fields,
  }, {
    source: row.source || payload.source || 'heuristic',
    model: row.model || payload.model || '',
    generatedAt: row.updated_at || row.created_at || payload.generated_at || new Date().toISOString(),
  });
}

async function fetchStoredSeoSuggestion(supabase, jobId) {
  if (!supabase || !jobId) return { suggestion: null, missingTable: false };
  const result = await supabase
    .from('job_seo_suggestions')
    .select('*')
    .eq('job_id', jobId)
    .maybeSingle();

  if (result.error) {
    if (isMissingTableError(result.error, 'job_seo_suggestions') || isSchemaError(result.error)) {
      return { suggestion: null, missingTable: true };
    }
    throw result.error;
  }

  return {
    suggestion: fromSeoRow(result.data),
    missingTable: false,
  };
}

async function upsertSeoSuggestion(supabase, jobId, suggestion, options = {}) {
  if (!supabase || !jobId || !suggestion) return { stored: false, missingTable: false };
  const payload = toSeoDbPayload(jobId, suggestion, options);
  const result = await supabase
    .from('job_seo_suggestions')
    .upsert(payload, { onConflict: 'job_id', ignoreDuplicates: false })
    .select('*')
    .single();

  if (result.error) {
    if (isMissingTableError(result.error, 'job_seo_suggestions') || isSchemaError(result.error)) {
      return { stored: false, missingTable: true };
    }
    throw result.error;
  }

  return {
    stored: true,
    missingTable: false,
    suggestion: fromSeoRow(result.data),
  };
}

module.exports = {
  buildSeoFacts,
  buildFallbackSeoSuggestion,
  optimiseJobSeo,
  sanitiseSeoSuggestion,
  fetchStoredSeoSuggestion,
  upsertSeoSuggestion,
  toSeoDbPayload,
  fromSeoRow,
};
