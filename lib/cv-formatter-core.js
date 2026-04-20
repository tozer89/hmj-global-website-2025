'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
} = require('docx');

const matcherCore = require('./candidate-matcher-core.js');

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const AI_BACKUP_MODEL = 'gpt-5-mini';
const MAX_INPUT_CHARS = 32000;
const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 2400;
const REPAIR_OPENAI_MAX_OUTPUT_TOKENS = 3400;
const DEFAULT_OPENAI_TIMEOUT_MS = 45000;
const FORMATTER_SCHEMA_NAME = 'hmj_client_ready_cv';
const COMMON_SECTION_HEADINGS = [
  'profile',
  'summary',
  'personal profile',
  'key skills',
  'skills',
  'core skills',
  'technical skills',
  'data centre skills',
  'qualifications',
  'other qualifications',
  'certifications',
  'professional memberships & certifications',
  'professional memberships and certifications',
  'employment history',
  'experience',
  'professional experience',
  'career history',
  'education',
  'additional information',
  'languages',
  'language',
  'position',
  'candidate id',
  'location',
  'availability to interview',
  'availability',
];
const fetchImpl = typeof fetch === 'function'
  ? fetch.bind(globalThis)
  : (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));
const DEFAULT_FORMAT_OPTIONS = Object.freeze({
  templatePreset: 'recruiter_standard',
  anonymiseMode: 'balanced',
  tailoringMode: 'balanced',
  coverPageMode: 'full',
  outputNameMode: 'role_reference',
  includeRoleAlignment: true,
  includeFormattingNotes: true,
  includeWarnings: true,
  includeAdditionalInformation: true,
  preferAiAssist: true,
  targetRoleOverride: '',
  recruiterInstructions: '',
});
const TEMPLATE_PRESETS = new Set([
  'recruiter_standard',
  'data_centre_priority',
  'executive_summary',
]);
const ANONYMISE_MODES = new Set(['light', 'balanced', 'strict']);
const TAILORING_MODES = new Set(['balanced', 'job_first', 'cv_only']);
const COVER_PAGE_MODES = new Set(['full', 'condensed', 'skip']);
const OUTPUT_NAME_MODES = new Set(['role_reference', 'reference_only', 'source_reference']);
const GENERIC_CANDIDATE_FILE_NAME_PATTERN = /\b(?:candidate|cv|resume|profile|formatted|formatting|client\s*ready|export(?:ed)?|document|version|final|updated|upload(?:ed)?|brief|spec|job)\b/i;
const LIKELY_ROLE_TITLE_PATTERN = /\b(?:manager|engineer|electrician|supervisor|director|planner|coordinator|consultant|technician|lead|estimator|buyer|surveyor)\b/i;

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  return maxLength && maxLength > 0 ? text.slice(0, maxLength) : text;
}

function normaliseBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function normaliseEnum(value, allowed, fallback) {
  const text = trimString(value).toLowerCase();
  if (!text || !allowed.has(text)) return fallback;
  return text;
}

function normaliseFormatOptions(raw = {}) {
  return {
    templatePreset: normaliseEnum(raw.templatePreset, TEMPLATE_PRESETS, DEFAULT_FORMAT_OPTIONS.templatePreset),
    anonymiseMode: normaliseEnum(raw.anonymiseMode, ANONYMISE_MODES, DEFAULT_FORMAT_OPTIONS.anonymiseMode),
    tailoringMode: normaliseEnum(raw.tailoringMode, TAILORING_MODES, DEFAULT_FORMAT_OPTIONS.tailoringMode),
    coverPageMode: normaliseEnum(raw.coverPageMode, COVER_PAGE_MODES, DEFAULT_FORMAT_OPTIONS.coverPageMode),
    outputNameMode: normaliseEnum(raw.outputNameMode, OUTPUT_NAME_MODES, DEFAULT_FORMAT_OPTIONS.outputNameMode),
    includeRoleAlignment: normaliseBoolean(raw.includeRoleAlignment, DEFAULT_FORMAT_OPTIONS.includeRoleAlignment),
    includeFormattingNotes: normaliseBoolean(raw.includeFormattingNotes, DEFAULT_FORMAT_OPTIONS.includeFormattingNotes),
    includeWarnings: normaliseBoolean(raw.includeWarnings, DEFAULT_FORMAT_OPTIONS.includeWarnings),
    includeAdditionalInformation: normaliseBoolean(raw.includeAdditionalInformation, DEFAULT_FORMAT_OPTIONS.includeAdditionalInformation),
    preferAiAssist: normaliseBoolean(raw.preferAiAssist, DEFAULT_FORMAT_OPTIONS.preferAiAssist),
    targetRoleOverride: trimString(raw.targetRoleOverride, 140),
    recruiterInstructions: trimString(raw.recruiterInstructions, 400),
  };
}

function normaliseWhitespace(value) {
  return trimString(String(value == null ? '' : value).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n'));
}

function stripCodeFences(value) {
  const text = trimString(value);
  if (!text) return '';
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? trimString(match[1]) : text;
}

function safeJsonParse(value) {
  const text = trimString(value);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function coded(statusCode, message, code, extra = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = trimString(code) || String(statusCode);
  if (extra && typeof extra === 'object') {
    Object.assign(error, extra);
  }
  return error;
}

function formatSchemaPath(path) {
  return path || '#';
}

function resolveSchemaRef(rootSchema, ref) {
  const safeRef = trimString(ref);
  if (!safeRef.startsWith('#/')) return null;
  const parts = safeRef
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current = rootSchema;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return null;
    current = current[part];
  }
  return current || null;
}

function validateStructuredOutputSchema(schema, options = {}) {
  const rootSchema = options.rootSchema || schema;
  const path = options.path || '#';
  const errors = [];

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [`${formatSchemaPath(path)} must be a schema object.`];
  }

  if (typeof schema.$ref === 'string') {
    const resolved = resolveSchemaRef(rootSchema, schema.$ref);
    if (!resolved) {
      return [`${formatSchemaPath(path)} has an unresolved $ref (${schema.$ref}).`];
    }
    return validateStructuredOutputSchema(resolved, {
      rootSchema,
      path: schema.$ref,
    });
  }

  if (schema.$defs && typeof schema.$defs === 'object' && !Array.isArray(schema.$defs)) {
    for (const [key, definition] of Object.entries(schema.$defs)) {
      errors.push(...validateStructuredOutputSchema(definition, {
        rootSchema,
        path: `${formatSchemaPath(path)}.$defs.${key}`,
      }));
    }
  }

  if (schema.type === 'object') {
    const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? schema.properties
      : null;
    if (!properties) {
      errors.push(`${formatSchemaPath(path)}.properties must be an object.`);
      return errors;
    }

    const propertyKeys = Object.keys(properties);
    const required = Array.isArray(schema.required) ? schema.required : null;
    if (!required) {
      errors.push(`${formatSchemaPath(path)}.required must be an array including every property key.`);
    } else {
      const requiredSet = new Set(required);
      propertyKeys.forEach((propertyKey) => {
        if (!requiredSet.has(propertyKey)) {
          errors.push(`${formatSchemaPath(path)}.required is missing "${propertyKey}".`);
        }
      });
      required.forEach((requiredKey) => {
        if (!Object.prototype.hasOwnProperty.call(properties, requiredKey)) {
          errors.push(`${formatSchemaPath(path)}.required includes "${requiredKey}" but no matching property exists.`);
        }
      });
    }

    if (schema.additionalProperties !== false) {
      errors.push(`${formatSchemaPath(path)}.additionalProperties must be false.`);
    }

    for (const [propertyKey, propertySchema] of Object.entries(properties)) {
      errors.push(...validateStructuredOutputSchema(propertySchema, {
        rootSchema,
        path: `${formatSchemaPath(path)}.properties.${propertyKey}`,
      }));
    }
  } else if (schema.type === 'array') {
    if (!schema.items || typeof schema.items !== 'object' || Array.isArray(schema.items)) {
      errors.push(`${formatSchemaPath(path)}.items must be a schema object.`);
    } else {
      errors.push(...validateStructuredOutputSchema(schema.items, {
        rootSchema,
        path: `${formatSchemaPath(path)}.items`,
      }));
    }
  }

  return errors;
}

function validateJsonValueAgainstSchema(value, schema, options = {}) {
  const rootSchema = options.rootSchema || schema;
  const path = options.path || '$';
  const errors = [];

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return [`${path}: validator received an invalid schema.`];
  }

  if (typeof schema.$ref === 'string') {
    const resolved = resolveSchemaRef(rootSchema, schema.$ref);
    if (!resolved) {
      return [`${path}: unresolved schema reference ${schema.$ref}.`];
    }
    return validateJsonValueAgainstSchema(value, resolved, {
      rootSchema,
      path,
    });
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of: ${schema.enum.join(', ')}.`);
    return errors;
  }

  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [`${path} must be an object.`];
    }

    const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? schema.properties
      : {};
    const required = Array.isArray(schema.required) ? schema.required : [];

    required.forEach((requiredKey) => {
      if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
        errors.push(`${path}.${requiredKey} is required.`);
      }
    });

    if (schema.additionalProperties === false) {
      Object.keys(value).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${path}.${key} is not allowed.`);
        }
      });
    }

    Object.entries(properties).forEach(([key, propertySchema]) => {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return;
      errors.push(...validateJsonValueAgainstSchema(value[key], propertySchema, {
        rootSchema,
        path: `${path}.${key}`,
      }));
    });

    return errors;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return [`${path} must be an array.`];
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      errors.push(`${path} must not contain more than ${schema.maxItems} items.`);
    }
    value.forEach((item, index) => {
      errors.push(...validateJsonValueAgainstSchema(item, schema.items, {
        rootSchema,
        path: `${path}[${index}]`,
      }));
    });
    return errors;
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${path} must be a string.`);
    }
    return errors;
  }

  return errors;
}

function parseModelJson(value) {
  const direct = trimString(value);
  if (!direct) return null;
  const candidates = [direct];
  const stripped = stripCodeFences(direct);
  if (stripped && stripped !== direct) candidates.push(stripped);
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start !== -1 && end > start) {
    candidates.push(stripped.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    if (parsed && typeof parsed === 'object') return parsed;
  }
  return null;
}

function extractOutputText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (trimString(payload.output_text, 16000)) return trimString(payload.output_text, 16000);

  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks = [];
  output.forEach((item) => {
    const content = Array.isArray(item?.content) ? item.content : [];
    content.forEach((part) => {
      const text = trimString(part?.text || part?.output_text || part?.summary, 12000);
      if (text) chunks.push(text);
    });
  });

  return trimString(chunks.join('\n'), 16000);
}

function cleanList(value, maxItems = 8, maxItemLength = 220) {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|[•;]+/)
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

function uniqueStrings(values, maxItems = 12) {
  const seen = new Set();
  const output = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const cleaned = trimString(value, 240);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(cleaned);
  });
  return output.slice(0, maxItems);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return cleanList(value, 12, 240);
  return [];
}

function fileBaseName(fileName) {
  const name = trimString(fileName);
  if (!name) return 'candidate-cv';
  return name.replace(/\.[^.]+$/, '') || name;
}

function isLikelyPersonName(value) {
  const text = trimString(value, 120);
  if (!text || /\d/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[A-Z][A-Za-z.'-]+$/.test(word));
}

function looksGenericCandidateFileName(value) {
  const text = trimString(String(value || '').replace(/[_-]+/g, ' '), 120);
  if (!text) return false;
  return GENERIC_CANDIDATE_FILE_NAME_PATTERN.test(text);
}

function guessCandidateName(fileName, text) {
  const fromFile = trimString(fileBaseName(fileName).replace(/[_-]+/g, ' '), 120);
  const firstLine = splitNonEmptyLines(text)[0] || '';
  const fileLooksLikeName = isLikelyPersonName(fromFile) && !looksGenericCandidateFileName(fromFile);
  const firstLineLooksLikeName = isLikelyPersonName(firstLine);
  if (firstLineLooksLikeName && !fileLooksLikeName) return firstLine;
  if (fileLooksLikeName) return fromFile;
  if (firstLineLooksLikeName) return firstLine;
  return '';
}

function generateCandidateReference(fileName, text) {
  const seed = `${trimString(fileName)}::${trimString(text, 600)}`;
  const hash = createHash('sha1').update(seed || 'hmj-candidate').digest('hex').slice(0, 8).toUpperCase();
  return `HMJ-${hash}`;
}

function splitNonEmptyLines(text) {
  return normaliseWhitespace(text)
    .split('\n')
    .map((line) => trimString(line))
    .filter(Boolean);
}

function collectHeadingSection(text, headings) {
  const lines = splitNonEmptyLines(text);
  const normalisedHeadings = new Set(headings.map((heading) => trimString(heading).toLowerCase()));
  const commonHeadingSet = new Set(COMMON_SECTION_HEADINGS);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].toLowerCase();
    if (!normalisedHeadings.has(line)) continue;
    const collected = [];
    for (let inner = index + 1; inner < lines.length; inner += 1) {
      const candidate = lines[inner];
      if (normalisedHeadings.has(candidate.toLowerCase())) break;
      if (commonHeadingSet.has(candidate.toLowerCase())) break;
      collected.push(candidate);
    }
    if (collected.length) return collected.join('\n');
  }
  return '';
}

function findLineAfterLabel(text, labels) {
  const lines = splitNonEmptyLines(text);
  const candidates = labels.map((label) => trimString(label).toLowerCase());
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!candidates.includes(lines[index].toLowerCase())) continue;
    return trimString(lines[index + 1], 180);
  }
  return '';
}

function looksLikeDateRange(value) {
  const text = trimString(value);
  if (!text) return false;
  return /(?:\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b\s+)?\d{4}\s*(?:[–-]|to)\s*(?:present|\d{4})/i.test(text)
    || /^\d{4}\s*[–-]\s*(?:present|\d{4})$/i.test(text);
}

function looksLikeSectionHeading(value) {
  const text = trimString(value);
  if (!text) return false;
  return /^[A-Z][A-Za-z &/()'-]{2,40}$/.test(text)
    && !looksLikeDateRange(text)
    && text.split(' ').length <= 5;
}

function isLikelyRoleTitle(value) {
  const text = trimString(value, 120);
  if (!text || /[.,:;]/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 2
    && words.length <= 6
    && LIKELY_ROLE_TITLE_PATTERN.test(text)
    && !looksLikeDateRange(text)
    && !isLikelyTemplateArtifact(text);
}

function isLikelyTemplateArtifact(value) {
  const text = trimString(value).replace(/:\s*$/g, '').replace(/\s+/g, ' ').toLowerCase();
  if (!text) return false;
  return COMMON_SECTION_HEADINGS.includes(text)
    || text === 'relevant data centre'
    || text === 'relevant data centre projects / experience'
    || text === 'projects / experience'
    || text === 'qualifications & accreditations'
    || text === 'candidate id';
}

function sanitizeLocation(value, anonymiseMode = DEFAULT_FORMAT_OPTIONS.anonymiseMode) {
  let text = trimString(value, 160);
  if (!text) return '';
  text = text
    .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, '')
    .replace(/\b\d{5}(?:-\d{4})?\b/g, '')
    .replace(/\b(?:flat|suite|unit|floor)\b[^,]*/gi, '')
    .replace(/\b\d{1,4}\s+[A-Za-z][^,]*/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,+/g, ',')
    .replace(/^,\s*|\s*,\s*$|^\s*-\s*|\s*-\s*$/g, '')
    .trim();
  const mode = normaliseEnum(anonymiseMode, ANONYMISE_MODES, DEFAULT_FORMAT_OPTIONS.anonymiseMode);
  if (text.includes(',')) {
    const parts = text.split(',').map((part) => trimString(part)).filter(Boolean);
    if (parts.length > 2 || mode === 'strict') {
      const keep = mode === 'light' ? 3 : mode === 'strict' ? 1 : 2;
      text = parts.slice(-keep).join(', ');
    }
  }
  return trimString(text, 120);
}

function cleanRoleTitle(value) {
  let text = trimString(value, 180);
  if (!text) return '';

  text = text
    .replace(/^(?:job title|role|position|title)\s*[:\-]\s*/i, '')
    .replace(/\b(?:required|needed|wanted|sought|vacancy|opportunity)\b.*$/i, '')
    .replace(/\b(?:for|on|within)\b\s+(?:a|an|the)?\s*(?:mission critical|data centre|cleanroom|pharma|industrial|commercial|project|programme|program|contract)\b.*$/i, '')
    .replace(/\b(?:in|across)\b\s+[A-Z][A-Za-z .,'/-]+$/g, '')
    .replace(/\s*[–-]\s*(?:contract|permanent|freelance|interim|temp|uk|ireland|europe|benelux|nordics|remote|hybrid).*/i, '')
    .replace(/[|/]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[.,;:]+$/g, '')
    .trim();

  const roleMatch = text.match(/\b([A-Z][A-Za-z&/+-]*(?:\s+[A-Z][A-Za-z&/+-]*){0,6}\s(?:Manager|Engineer|Electrician|Supervisor|Director|Planner|Coordinator|Consultant|Technician|Lead|Estimator|Buyer|Surveyor|Designer|Specialist|Foreman))\b/i);
  if (roleMatch) {
    return trimString(roleMatch[1], 140);
  }

  if (isLikelyRoleTitle(text)) {
    return trimString(text, 140);
  }

  return '';
}

function buildRoleHints(jobSpecText) {
  const lines = splitNonEmptyLines(jobSpecText);
  const firstUseful = lines.find((line) => line.length <= 110 && !/^(job spec|job description|overview|summary)$/i.test(line)) || '';
  const titleFromLabel = findLineAfterLabel(jobSpecText, ['Job Title', 'Role', 'Position', 'Title']);
  const roleLine = lines.find((line) => !!cleanRoleTitle(line)) || '';
  return trimString(cleanRoleTitle(titleFromLabel) || cleanRoleTitle(roleLine) || cleanRoleTitle(firstUseful) || firstUseful, 120);
}

function joinHumanList(values, conjunction = 'and') {
  const items = uniqueStrings(values, 6);
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

function estimateYearsExperience(text, employmentHistory = []) {
  const explicitMatches = Array.from(String(text || '').matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 45);
  if (explicitMatches.length) {
    return Math.max(...explicitMatches);
  }

  const years = [];
  (Array.isArray(employmentHistory) ? employmentHistory : []).forEach((entry) => {
    const dates = trimString(entry?.dates);
    const match = dates.match(/(\d{4})\s*(?:[–-]|to)\s*(present|\d{4})/i);
    if (!match) return;
    const start = Number(match[1]);
    const end = String(match[2]).toLowerCase() === 'present' ? new Date().getFullYear() : Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
    years.push(end - start);
  });

  if (years.length) {
    return Math.max(...years);
  }

  return 0;
}

function collectSectorHints(text) {
  const lower = String(text || '').toLowerCase();
  const sectors = [];
  [
    'data centre',
    'mission critical',
    'cleanroom',
    'pharma',
    'industrial',
    'commercial',
    'domestic',
    'manufacturing',
    'power',
    'energy',
    'semiconductor',
    'fit-out',
    'commissioning',
  ].forEach((keyword) => {
    if (lower.includes(keyword)) sectors.push(keyword);
  });
  return uniqueStrings(sectors, 5);
}

function collectAdditionalInformation(text) {
  const lines = splitNonEmptyLines(text).filter((line) => (
    /\b(?:driving licence|driving license|full uk driving|willing to travel|available to travel|eligible to work|right to work|notice period|visa|languages?)\b/i.test(line)
  ));
  return uniqueStrings(lines, 6);
}

function buildFallbackRoleAlignment({ candidateText, jobSpecText, keySkills, relevantProjects }) {
  if (!trimString(jobSpecText)) return [];

  const cvLower = candidateText.toLowerCase();
  const jobLower = jobSpecText.toLowerCase();
  const bullets = [];

  const matchedThemes = [
    'data centre',
    'mission critical',
    'commissioning',
    'electrical',
    'mechanical',
    'construction',
    'cleanroom',
    'pharma',
    'mep',
    'csa',
    'qa',
    'qaqc',
    'planning',
    'permitting',
  ].filter((theme) => cvLower.includes(theme) && jobLower.includes(theme));

  if (matchedThemes.length) {
    bullets.push(`CV evidence aligns with ${joinHumanList(matchedThemes.slice(0, 3))} requirements from the uploaded brief.`);
  }
  if (Array.isArray(relevantProjects) && relevantProjects.length) {
    bullets.push(`Relevant source evidence includes ${joinHumanList(relevantProjects.slice(0, 2))}.`);
  }
  if (Array.isArray(keySkills) && keySkills.length) {
    bullets.push(`Key skills have been ordered toward ${joinHumanList(keySkills.slice(0, 4))}.`);
  }
  bullets.push('All tailoring remains grounded in the uploaded CV evidence only.');

  return uniqueStrings(bullets, 4);
}

function toClientReadyVoice(value) {
  let text = trimString(value, 1600);
  if (!text) return '';
  text = text
    .replace(/\bI have\b/gi, 'Brings')
    .replace(/\bI've\b/gi, 'Has')
    .replace(/\bI am\b/gi, 'Is')
    .replace(/\bI was\b/gi, 'Has been')
    .replace(/\bI possess\b/gi, 'Brings')
    .replace(/\bI currently\b/gi, 'Currently')
    .replace(/\bmy\b/gi, 'their')
    .replace(/\bme\b/gi, 'them')
    .replace(/\bmyself\b/gi, 'the candidate')
    .replace(/\bI\b/gi, 'The candidate')
    .replace(/\bThe candidate have\b/gi, 'The candidate has')
    .replace(/\bThe candidate has got\b/gi, 'The candidate has')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return trimString(text, 1600);
}

function fallbackProfileParagraph(text, context = {}) {
  const explicitProfile = collectHeadingSection(text, ['Profile', 'Summary', 'Personal Profile']);
  const lines = splitNonEmptyLines(text);
  const paragraphs = [];
  let current = [];
  normaliseWhitespace(text).split('\n').forEach((line) => {
    const cleaned = trimString(line);
    if (!cleaned) {
      if (current.length) paragraphs.push(current.join(' '));
      current = [];
      return;
    }
    if (looksLikeSectionHeading(cleaned)) {
      if (current.length) paragraphs.push(current.join(' '));
      current = [];
      return;
    }
    current.push(cleaned);
  });
  if (current.length) paragraphs.push(current.join(' '));
  const candidateName = trimString(context.candidateName, 120);
  const role = trimString(context.role, 140);
  const location = trimString(context.location, 120);
  const yearsExperience = Number(context.yearsExperience) || 0;
  const sectors = uniqueStrings(context.sectors, 5);
  const keySkills = uniqueStrings(context.keySkills, 6);
  const qualifications = uniqueStrings(context.qualifications, 4);
  const relevantProjects = uniqueStrings(context.relevantProjects, 4);
  const filteredLines = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (candidateName && lower === candidateName.toLowerCase()) return false;
    if (role && lower === role.toLowerCase()) return false;
    if (location && lower === location.toLowerCase()) return false;
    return !isLikelyTemplateArtifact(line);
  });
  const structuredSummary = trimString((() => {
    const fragments = [];
    if (role) fragments.push(role);
    if (location) fragments.push(`based in ${location}`);
    const experienceLine = filteredLines.find((line) => line.length > 12) || '';
    if (experienceLine) {
      const cleanExperience = trimString(experienceLine.replace(/[.]+$/g, ''), 240);
      if (cleanExperience) {
        fragments.push(
          /^(with|bringing|offering|covering|focused on)\b/i.test(cleanExperience)
            ? cleanExperience
            : `with ${cleanExperience}`
        );
      }
    }
    let sentence = trimString(fragments.join(' '), 400);
    if (sentence && !/[.!?]$/.test(sentence)) sentence = `${sentence}.`;
    return sentence;
  })(), 400);
  const selected = structuredSummary
    || paragraphs.find((paragraph) => paragraph.length > 180)
    || paragraphs[0]
    || filteredLines.slice(0, 6).join(' ')
    || lines.slice(0, 6).join(' ');

  const narrative = [
    trimString((() => {
      const fragments = [];
      fragments.push(role ? `The candidate is an experienced ${role}` : 'The candidate is an experienced construction professional');
      if (location) fragments.push(`based in ${location}`);
      if (yearsExperience > 0) {
        fragments.push(`with ${yearsExperience}+ years of relevant experience`);
      }
      let sentence = trimString(fragments.join(' '), 220);
      if (sentence && !/[.!?]$/.test(sentence)) sentence = `${sentence}.`;
      return sentence;
    })(), 240),
    sectors.length ? `Brings delivery exposure across ${joinHumanList(sectors)} environments.` : '',
    relevantProjects.length ? `Relevant source evidence includes ${joinHumanList(relevantProjects.slice(0, 2))}.` : '',
    keySkills.length ? `Key strengths include ${joinHumanList(keySkills.slice(0, 4))}.` : '',
    qualifications.length ? `Qualifications include ${joinHumanList(qualifications.slice(0, 3))}.` : '',
    trimString(toClientReadyVoice(explicitProfile || selected), 600),
  ].filter(Boolean).join(' ');

  return trimString(narrative || toClientReadyVoice(selected), 1400);
}

function collectQualifications(text) {
  const section = collectHeadingSection(text, [
    'Qualifications',
    'Other Qualifications',
    'Professional Memberships & Certifications',
    'Professional Memberships and Certifications',
    'Certifications',
    'Education',
  ]);
  const lines = cleanList(section, 12, 200).filter((line) => !looksLikeDateRange(line) && !isLikelyTemplateArtifact(line));
  if (lines.length) return lines;

  return uniqueStrings(
    splitNonEmptyLines(text).filter((line) => (
      /\b(?:degree|diploma|nvq|gcse|bsc|msc|meng|apprenticeship|certified|certificate|edition|smsts|ipaf|ecs|cscs|dbs|am2)\b/i.test(line)
    )),
    10
  );
}

function collectKeySkills(text) {
  const section = collectHeadingSection(text, ['Key Skills', 'Skills', 'Core Skills', 'Technical Skills', 'Data Centre Skills']);
  const explicit = uniqueStrings(
    cleanList(section, 18, 180)
      .flatMap((line) => {
        const parts = String(line).split(/[,|]+/).map((item) => trimString(item, 180)).filter(Boolean);
        return parts.length > 1 ? parts : [trimString(line, 180)];
      })
      .filter((line) => !isLikelyTemplateArtifact(line) && !isLikelyRoleTitle(line)),
    14
  );
  if (explicit.length) return explicit;

  const matches = splitNonEmptyLines(text).filter((line) => (
    !isLikelyRoleTitle(line)
    && /\b(?:coordination|construction|commercial|electrical|containment|testing|commissioning|cost control|project management|contracts|design|health and safety|fault finding|revit|autocad|primavera|negotiation|leadership|budget|mep|csa)\b/i.test(line)
  ));
  return uniqueStrings(matches, 10);
}

function collectRelevantProjects(text, jobSpecText) {
  const keywords = [
    'data centre',
    'mission critical',
    'commissioning',
    'industrial',
    'pharma',
    'electrical',
    'construction',
    'fit-out',
    'retrofit',
    'mep',
    'csa',
  ];
  const roleHint = trimString(jobSpecText).toLowerCase();
  const lines = splitNonEmptyLines(text).filter((line) => {
    const lower = line.toLowerCase();
    if (line.length > 180) return false;
    if (isLikelyTemplateArtifact(line)) return false;
    if (isLikelyRoleTitle(line)) return false;
    if (keywords.some((keyword) => lower.includes(keyword))) return true;
    if (roleHint && roleHint.length < 180) {
      const words = roleHint.split(/\s+/).filter((word) => word.length > 4).slice(0, 6);
      return words.some((word) => lower.includes(word));
    }
    return false;
  });
  return uniqueStrings(lines, 6);
}

function collectEmploymentHistory(text) {
  const section = collectHeadingSection(text, ['Employment History', 'Experience', 'Professional Experience', 'Career History']);
  const lines = splitNonEmptyLines(section);
  if (!lines.length) return [];

  const entries = [];
  let current = null;
  lines.forEach((line) => {
    if (looksLikeDateRange(line)) {
      if (current) entries.push(current);
      current = { dates: line, title: '', company: '', summary: '', bullets: [] };
      return;
    }
    if (!current) {
      current = { dates: '', title: line, company: '', summary: '', bullets: [] };
      return;
    }
    if (!current.title) {
      current.title = line;
      return;
    }
    if (!current.company && line.length <= 120 && !/[.:]/.test(line)) {
      current.company = line;
      return;
    }
    if (/^[•*-]\s*/.test(line)) {
      current.bullets.push(trimString(line.replace(/^[•*-]\s*/, ''), 220));
      return;
    }
    current.summary = trimString(`${current.summary} ${line}`, 900);
  });
  if (current) entries.push(current);

  return entries
    .map((entry) => ({
      dates: trimString(entry.dates, 120),
      title: trimString(entry.title, 140),
      company: trimString(entry.company, 160),
      summary: trimString(entry.summary, 900),
      bullets: cleanList(entry.bullets, 4, 220),
    }))
    .filter((entry) => entry.title || entry.company || entry.summary)
    .slice(0, 8);
}

function collectLanguages(text) {
  const section = collectHeadingSection(text, ['Languages', 'Language']);
  const direct = cleanList(section, 6, 120);
  if (direct.length) return direct;
  const match = text.match(/\b(?:English|French|German|Spanish|Greek|Italian|Dutch|Swedish|Polish|Arabic|Portuguese|Mandarin)\b[^.\n]{0,80}/gi);
  return uniqueStrings(match || [], 5);
}

function guessFallbackLocation(text, context = {}) {
  const candidateName = trimString(context.candidateName).toLowerCase();
  const role = trimString(context.role).toLowerCase();
  const anonymiseMode = context.anonymiseMode || DEFAULT_FORMAT_OPTIONS.anonymiseMode;
  const line = splitNonEmptyLines(text).find((entry) => {
    const lower = entry.toLowerCase();
    if (!entry) return false;
    if (candidateName && lower === candidateName) return false;
    if (role && lower === role) return false;
    if (isLikelyTemplateArtifact(entry) || isLikelyRoleTitle(entry) || looksLikeDateRange(entry)) return false;
    if (/\b(?:commissioning|delivery|experience|project|manager|engineer|electrician|skills?|qualifications?|summary|profile)\b/i.test(entry)) return false;
    return /^[A-Za-z][A-Za-z\s,.'-]{1,60}$/.test(entry);
  }) || '';
  return sanitizeLocation(line, anonymiseMode);
}

function redactPersonalIdentifiers(value, context = {}) {
  let text = trimString(value);
  if (!text) return '';

  const candidateName = trimString(context.candidateName);
  const candidateReference = trimString(context.candidateReference);
  const anonymiseMode = normaliseEnum(
    context?.formatOptions?.anonymiseMode || context?.anonymiseMode,
    ANONYMISE_MODES,
    DEFAULT_FORMAT_OPTIONS.anonymiseMode
  );
  if (candidateName) {
    const escaped = candidateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, 'gi'), candidateReference || 'Candidate');
  }

  text = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/\b(?:https?:\/\/|www\.)\S+\b/gi, '')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '')
    .replace(/\b(?:dob|d\.o\.b|date of birth)\b[:\s-]*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/gi, '')
    .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, '')
    .replace(/\b\d{5}(?:-\d{4})?\b/g, '')
    .replace(/\b(?:passport|national insurance|ni number|national id|driving licence number)\b[:\s-]*[A-Z0-9 -]{4,}\b/gi, '');

  if (anonymiseMode === 'strict') {
    text = text
      .replace(/\b(?:mr|mrs|ms|miss|dr)\.?\s+/gi, '')
      .replace(/\b(?:address|located at|based at)\b[:\s-]*[^,.;\n]+/gi, '');
  }

  text = text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/^[,;\s]+|[,;\s]+$/g, '')
    .trim();

  return trimString(text, 1400);
}

function sanitiseStructuredProfile(raw, context = {}) {
  const formatOptions = normaliseFormatOptions(context.formatOptions);
  const targetRole = redactPersonalIdentifiers(
    trimString(
      formatOptions.targetRoleOverride
        || raw?.target_role
        || raw?.display_title
        || context.jobSpecRole
        || context.fileRole
        || 'Client-Ready Candidate Profile',
      140
    ),
    { ...context, formatOptions }
  );
  const candidateReference = trimString(context.candidateReference) || 'HMJ-CANDIDATE';
  const location = sanitizeLocation(
    redactPersonalIdentifiers(trimString(raw?.sanitized_location || raw?.location, 160), { ...context, formatOptions }),
    formatOptions.anonymiseMode
  );
  const profile = redactPersonalIdentifiers(trimString(raw?.profile, 1800), { ...context, formatOptions });

  const redactions = uniqueStrings(
    cleanList(raw?.redactions_applied, 10, 180).concat([
      'Full name replaced with HMJ candidate reference.',
      'Direct contact details removed.',
      'DOB and precise postcode removed where detected.',
      formatOptions.anonymiseMode === 'strict' ? 'Strict anonymisation mode applied to titles and address-style references.' : '',
    ]),
    8
  );

  return {
    candidateReference,
    targetRole: trimString(targetRole || context.fileRole || 'Client-Ready Candidate Profile', 140),
    location,
    interviewAvailability: redactPersonalIdentifiers(trimString(raw?.interview_availability || raw?.availability, 120), { ...context, formatOptions }),
    languages: cleanList(toArray(raw?.languages).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 6, 120),
    profile,
    roleAlignment: cleanList(toArray(raw?.role_alignment).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 6, 220),
    relevantProjects: cleanList(toArray(raw?.relevant_projects).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 6, 220),
    keySkills: cleanList(toArray(raw?.key_skills).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 12, 180),
    qualifications: cleanList(toArray(raw?.qualifications).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 10, 180),
    accreditations: cleanList(toArray(raw?.accreditations).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 10, 180),
    employmentHistory: (Array.isArray(raw?.employment_history) ? raw.employment_history : [])
      .map((entry) => ({
        dates: redactPersonalIdentifiers(trimString(entry?.dates, 120), { ...context, formatOptions }),
        title: redactPersonalIdentifiers(trimString(entry?.title, 140), { ...context, formatOptions }),
        company: redactPersonalIdentifiers(trimString(entry?.company, 160), { ...context, formatOptions }),
        summary: redactPersonalIdentifiers(trimString(entry?.summary, 900), { ...context, formatOptions }),
        bullets: cleanList((entry?.bullets || []).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 4, 220),
      }))
      .filter((entry) => entry.title || entry.company || entry.summary)
      .slice(0, 8),
    additionalInformation: cleanList(toArray(raw?.additional_information).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 8, 180),
    redactionsApplied: redactions,
    warnings: cleanList(raw?.warnings, 8, 220),
  };
}

function buildFallbackProfile({ candidateText, jobSpecText, candidateFileName, options = {} }) {
  const formatOptions = normaliseFormatOptions(options);
  const candidateName = guessCandidateName(candidateFileName, candidateText);
  const candidateReference = generateCandidateReference(candidateFileName, candidateText);
  const rawPosition = findLineAfterLabel(candidateText, ['Position', 'Role', 'Title']);
  const rawCandidateId = findLineAfterLabel(candidateText, ['Candidate ID']);
  const fileRole = (
    rawPosition
      && candidateName
      && trimString(rawPosition).toLowerCase() === trimString(candidateName).toLowerCase()
      && rawCandidateId
      && trimString(rawCandidateId).toLowerCase() !== trimString(candidateName).toLowerCase()
  ) ? rawCandidateId : rawPosition;
  const jobSpecRole = cleanRoleTitle(buildRoleHints(jobSpecText)) || buildRoleHints(jobSpecText);
  const targetRole = trimString(
    cleanRoleTitle(formatOptions.targetRoleOverride)
      || formatOptions.targetRoleOverride
      || jobSpecRole
      || cleanRoleTitle(fileRole)
      || fileRole
      || candidateName
      || fileBaseName(candidateFileName),
    140
  );
  const rawLocation = findLineAfterLabel(candidateText, ['Location', 'Based', 'Address']);
  const rawAvailability = findLineAfterLabel(candidateText, ['Availability to Interview', 'Availability']);
  const safeLocation = isLikelyTemplateArtifact(rawLocation) ? '' : sanitizeLocation(rawLocation, formatOptions.anonymiseMode);
  const safeAvailability = (
    !rawAvailability
      || isLikelyTemplateArtifact(rawAvailability)
      || trimString(rawAvailability).toLowerCase() === trimString(candidateReference).toLowerCase()
      || (candidateName && trimString(rawAvailability).toLowerCase() === trimString(candidateName).toLowerCase())
  ) ? '' : trimString(rawAvailability, 120);
  const inferredRole = splitNonEmptyLines(candidateText).find((line) => {
    const lower = line.toLowerCase();
    if (!isLikelyRoleTitle(line)) return false;
    if (candidateName && lower === trimString(candidateName).toLowerCase()) return false;
    return true;
  }) || '';
  const profileRole = trimString(cleanRoleTitle(fileRole || rawPosition || inferredRole || targetRole) || fileRole || rawPosition || inferredRole || targetRole, 140);
  const displayLocation = safeLocation || guessFallbackLocation(candidateText, {
    candidateName,
    role: profileRole,
    anonymiseMode: formatOptions.anonymiseMode,
  });
  const employmentHistory = collectEmploymentHistory(candidateText);
  const qualifications = collectQualifications(candidateText);
  const relevantProjects = collectRelevantProjects(candidateText, jobSpecText);
  const keySkills = collectKeySkills(candidateText);
  const yearsExperience = estimateYearsExperience(candidateText, employmentHistory);
  const sectors = collectSectorHints(candidateText);

  return sanitiseStructuredProfile({
    target_role: targetRole,
    sanitized_location: displayLocation,
    interview_availability: safeAvailability,
    languages: collectLanguages(candidateText),
    profile: fallbackProfileParagraph(candidateText, {
      candidateName,
      role: profileRole,
      location: displayLocation,
      yearsExperience,
      sectors,
      keySkills,
      qualifications,
      relevantProjects,
    }),
    role_alignment: buildFallbackRoleAlignment({
      candidateText,
      jobSpecText,
      keySkills,
      relevantProjects,
    }),
    relevant_projects: relevantProjects,
    key_skills: keySkills,
    qualifications,
    accreditations: qualifications.filter((line) => /\b(?:ipaf|smsts|ecs|cscs|dbs|edition|certified|certificate|licensed|card)\b/i.test(line)),
    employment_history: employmentHistory,
    additional_information: uniqueStrings(
      cleanList(collectHeadingSection(candidateText, ['Additional Information']), 6, 180)
        .concat(collectAdditionalInformation(candidateText)),
      6
    ),
    warnings: [
      'Fallback formatting was used, so section ordering and wording were derived from extracted text rather than structured AI output.',
      jobSpecText ? 'Job-spec tailoring was inferred from the uploaded brief.' : 'No job spec was uploaded, so the output was tuned from the CV alone.',
      formatOptions.recruiterInstructions ? 'Additional recruiter instructions were applied where the extracted source supported them.' : '',
    ],
  }, {
    candidateName,
    candidateReference,
    jobSpecRole,
    fileRole,
    formatOptions,
  });
}

function buildFormatterSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'target_role',
      'sanitized_location',
      'interview_availability',
      'languages',
      'profile',
      'role_alignment',
      'relevant_projects',
      'key_skills',
      'qualifications',
      'accreditations',
      'employment_history',
      'additional_information',
      'redactions_applied',
      'warnings',
    ],
    properties: {
      target_role: { type: 'string' },
      sanitized_location: { type: 'string' },
      interview_availability: { type: 'string' },
      languages: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      profile: { type: 'string' },
      role_alignment: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      relevant_projects: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      key_skills: { type: 'array', items: { type: 'string' }, maxItems: 12 },
      qualifications: { type: 'array', items: { type: 'string' }, maxItems: 10 },
      accreditations: { type: 'array', items: { type: 'string' }, maxItems: 10 },
      employment_history: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['dates', 'title', 'company', 'summary', 'bullets'],
          properties: {
            dates: { type: 'string' },
            title: { type: 'string' },
            company: { type: 'string' },
            summary: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          },
        },
      },
      additional_information: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      redactions_applied: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      warnings: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    },
  };
}

function ensureFormatterSchemaValid() {
  const schema = buildFormatterSchema();
  const errors = validateStructuredOutputSchema(schema, {
    rootSchema: schema,
    path: '#',
  });
  if (!errors.length) return;
  throw coded(
    500,
    'Local CV formatter schema validation failed before calling OpenAI.',
    'openai_schema_definition_invalid',
    {
      details: {
        stage: 'openai',
        parse_stage: 'schema_definition',
        schema_name: FORMATTER_SCHEMA_NAME,
        validation_errors: errors.slice(0, 12),
      },
    }
  );
}

function validateFormatterResultAgainstSchema(result) {
  const schema = buildFormatterSchema();
  return validateJsonValueAgainstSchema(result, schema, {
    rootSchema: schema,
    path: '$',
  });
}

function extractOpenAIOutput(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      text: '',
      refusals: [],
      contentTypes: [],
      itemStatuses: [],
    };
  }

  const textChunks = [];
  const refusalChunks = [];
  const contentTypes = [];
  const itemStatuses = [];

  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    textChunks.push(payload.output_text.trim());
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const itemStatus = trimString(item?.status);
    if (itemStatus) itemStatuses.push(itemStatus);
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const contentType = trimString(part?.type);
      if (contentType) contentTypes.push(contentType);
      if (typeof part?.text === 'string' && part.text.trim()) {
        textChunks.push(part.text.trim());
      }
      const refusalText = trimString(part?.refusal) || trimString(part?.summary) || trimString(part?.text);
      if (contentType === 'refusal' && refusalText) {
        refusalChunks.push(refusalText);
      }
    }
  }

  return {
    text: trimString(textChunks.join('\n'), 24000),
    refusals: uniqueStrings(refusalChunks, 4),
    contentTypes: uniqueStrings(contentTypes, 8),
    itemStatuses: uniqueStrings(itemStatuses, 8),
  };
}

function extractBalancedJsonSlice(text) {
  const source = trimString(text, 24000);
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return '';
  return trimString(source.slice(start, end + 1), 24000);
}

function parseFormatterJsonText(text) {
  const candidates = [];
  const direct = trimString(text, 24000);
  if (direct) {
    candidates.push({ strategy: 'direct', text: direct });
    const stripped = stripCodeFences(direct);
    if (stripped && stripped !== direct) {
      candidates.push({ strategy: 'code_fence', text: stripped });
    }
    const sliced = extractBalancedJsonSlice(stripped || direct);
    if (sliced && !candidates.some((candidate) => candidate.text === sliced)) {
      candidates.push({ strategy: 'object_slice', text: sliced });
    }
  }

  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate.text);
    if (parsed && typeof parsed === 'object') {
      return {
        value: parsed,
        strategy: candidate.strategy,
      };
    }
  }

  return null;
}

function looksLikeFormatterResult(value) {
  return !!(value
    && typeof value === 'object'
    && typeof value.target_role === 'string'
    && typeof value.profile === 'string'
    && Array.isArray(value.key_skills));
}

function unwrapFormatterResult(value) {
  if (looksLikeFormatterResult(value)) {
    return { value, wrapperKey: '' };
  }

  for (const key of ['result', 'analysis', 'data', FORMATTER_SCHEMA_NAME, 'client_ready_cv', 'formatted_cv']) {
    if (looksLikeFormatterResult(value?.[key])) {
      return { value: value[key], wrapperKey: key };
    }
  }

  return { value, wrapperKey: '' };
}

function summariseOpenAiFormatterResponse(payload, extracted, extra = {}) {
  return {
    response_id: trimString(payload?.id),
    response_status: trimString(payload?.status),
    incomplete_reason: trimString(payload?.incomplete_details?.reason),
    content_types: uniqueStrings(extracted?.contentTypes, 8),
    item_statuses: uniqueStrings(extracted?.itemStatuses, 8),
    refusal_count: Array.isArray(extracted?.refusals) ? extracted.refusals.length : 0,
    output_text_length: trimString(extracted?.text).length,
    parser_strategy: trimString(extra.parserStrategy),
    wrapper_key: trimString(extra.wrapperKey),
    model: trimString(extra.model),
    max_output_tokens: Number(extra.maxOutputTokens) || null,
    repair_attempt: extra.repairMode === true,
    schema_name: FORMATTER_SCHEMA_NAME,
  };
}

function parseOpenAiFormatterResponse(payload, options = {}) {
  const extracted = extractOpenAIOutput(payload);
  const responseStatus = trimString(payload?.status).toLowerCase();
  const incompleteReason = trimString(payload?.incomplete_details?.reason);
  const baseSummary = summariseOpenAiFormatterResponse(payload, extracted, options);

  if (responseStatus === 'incomplete') {
    const reasonMessage = incompleteReason === 'max_output_tokens'
      ? `OpenAI returned incomplete CV formatter output because max_output_tokens was reached (${options.maxOutputTokens || 'unknown'}).`
      : `OpenAI returned incomplete CV formatter output${incompleteReason ? ` (${incompleteReason})` : ''}.`;
    throw coded(502, reasonMessage, 'openai_incomplete_output', {
      details: {
        stage: 'openai',
        parse_stage: 'incomplete',
        ...baseSummary,
      },
    });
  }

  if (extracted.refusals.length) {
    throw coded(502, 'OpenAI refused to produce CV formatter output for this run.', 'openai_refusal', {
      details: {
        stage: 'openai',
        parse_stage: 'refusal',
        ...baseSummary,
      },
    });
  }

  if (!trimString(extracted.text)) {
    throw coded(502, 'OpenAI returned an empty CV formatter response.', 'openai_empty_response', {
      details: {
        stage: 'openai',
        parse_stage: 'empty',
        ...baseSummary,
      },
    });
  }

  const parsed = parseFormatterJsonText(extracted.text);
  if (!parsed) {
    throw coded(502, 'OpenAI returned CV formatter output that could not be parsed as JSON.', 'openai_invalid_json', {
      details: {
        stage: 'openai',
        parse_stage: 'json_parse',
        ...baseSummary,
      },
    });
  }

  const unwrapped = unwrapFormatterResult(parsed.value);
  const validationErrors = validateFormatterResultAgainstSchema(unwrapped.value);
  if (validationErrors.length) {
    throw coded(502, 'OpenAI returned CV formatter JSON that did not match the expected schema.', 'openai_schema_invalid', {
      details: {
        stage: 'openai',
        parse_stage: 'schema_validation',
        ...summariseOpenAiFormatterResponse(payload, extracted, {
          ...options,
          parserStrategy: parsed.strategy,
          wrapperKey: unwrapped.wrapperKey,
        }),
        validation_errors: validationErrors.slice(0, 8),
      },
    });
  }

  return {
    result: unwrapped.value,
    diagnostics: summariseOpenAiFormatterResponse(payload, extracted, {
      ...options,
      parserStrategy: parsed.strategy,
      wrapperKey: unwrapped.wrapperKey,
    }),
  };
}

function isRecoverableOpenAiOutputError(error) {
  return [
    'openai_incomplete_output',
    'openai_empty_response',
    'openai_invalid_json',
    'openai_schema_invalid',
    'openai_transport_invalid_json',
  ].includes(trimString(error?.code));
}

function isOpenAISchemaRejection(statusCode, details) {
  if (statusCode !== 400) return false;
  const haystack = JSON.stringify(details || {}).toLowerCase();
  return haystack.includes('invalid schema for response_format')
    || (haystack.includes('response_format') && haystack.includes('schema'))
    || (haystack.includes('text.format') && haystack.includes('schema'));
}

function sanitiseOpenAiErrorMessage(message) {
  const text = trimString(message, 240);
  if (!text) return 'OpenAI request failed.';
  if (text === 'openai_key_missing') return 'OpenAI API key is missing on the server.';
  if (text === 'openai_timeout') return 'OpenAI request timed out.';
  if (/incorrect api key|api key missing|api key/i.test(text)) {
    return 'OpenAI authentication failed.';
  }
  return text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-key]');
}

function buildOpenAiModelSequence() {
  const primary = trimString(process.env.OPENAI_CV_FORMAT_MODEL, 120) || DEFAULT_MODEL;
  const configuredFallbacks = String(process.env.OPENAI_CV_FORMAT_FALLBACK_MODELS || '')
    .split(',')
    .map((entry) => trimString(entry, 120))
    .filter(Boolean);
  return uniqueStrings([primary, ...configuredFallbacks, DEFAULT_MODEL, AI_BACKUP_MODEL], 4);
}

function shouldRetryAiAttempt(result) {
  const code = trimString(result?.code);
  const message = trimString(result?.error).toLowerCase();
  const status = Number(result?.status) || 0;
  if (!message && !code) return false;
  if (
    code === 'openai_key_missing'
    || code === 'openai_authentication_failed'
    || message.includes('authentication failed')
    || message.includes('key_missing')
    || status === 401
    || status === 403
  ) {
    return false;
  }
  if (isRecoverableOpenAiOutputError(result)) return true;
  if (message.includes('request_failed')) return true;
  if (status === 404 || status === 408 || status === 409 || status === 429) return true;
  if (status >= 500) return true;
  if (status === 400 && /(model|reasoning|unsupported|unknown|invalid)/i.test(message)) return true;
  return false;
}

function buildOpenAiRequestBody({
  model,
  candidateFileName,
  candidateText,
  jobSpecText,
  candidateReference,
  formatOptions,
  repairMode = false,
  maxOutputTokens = DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
}) {
  const requestBody = {
    model,
    max_output_tokens: maxOutputTokens,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: [
              'You are HMJ Global’s client-ready CV formatting assistant.',
              'Transform recruiter-uploaded CV content into a polished, anonymised, client-ready profile.',
              'Use only facts present in the supplied CV and optional job specification.',
              'Do not invent projects, employers, dates, qualifications, clearances, languages, or sector experience.',
              'If the candidate lacks a requirement in the job spec, keep the wording adjacent and transferable rather than overstating fit.',
              'Remove or generalise direct personal identifiers: full name, email, phone, street address, full postcode, LinkedIn URLs, DOB, passport or ID numbers.',
              `Replace the candidate name with the reference ${candidateReference}.`,
              'Keep company and project history unless it is a direct personal identifier.',
              'Prefer concise recruiter-grade wording and keep chronology faithful to the source.',
              `Use the ${formatOptions.templatePreset.replace(/_/g, ' ')} presentation style.`,
              `Apply ${formatOptions.anonymiseMode} anonymisation.`,
              repairMode ? 'This is a repair attempt. Every schema field must be present even when empty. Do not add wrapper keys, prose, or markdown.' : '',
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
              'Create a client-ready HMJ CV package from the supplied material.',
              'Requirements:',
              '- target_role: short role title for the output.',
              '- sanitized_location: keep city, region, or country only.',
              '- interview_availability: only if explicitly available from the source; otherwise leave blank.',
              '- profile: one polished paragraph, 110 to 190 words.',
              '- role_alignment: 3 to 5 bullets only if a job spec was uploaded.',
              '- relevant_projects: 3 to 5 bullets focused on the strongest matching projects or experience.',
              '- key_skills: 6 to 10 concise recruiter-facing bullets.',
              '- qualifications and accreditations: factual lists only.',
              '- employment_history: keep the strongest chronology with concise summaries and no fabricated detail.',
              '- redactions_applied: explain what personal details were removed or generalised.',
              '- warnings: list any important confidence or source limitations.',
              repairMode ? '- Repair mode: return exactly one JSON object matching the schema and include empty strings or empty arrays instead of omitting keys.' : '',
              '',
              `Source CV file: ${trimString(candidateFileName, 180)}`,
              `Anonymisation mode: ${formatOptions.anonymiseMode}`,
              `Template preset: ${formatOptions.templatePreset}`,
              `Tailoring mode: ${formatOptions.tailoringMode}`,
              `Job spec uploaded: ${jobSpecText ? 'yes' : 'no'}`,
              `Target role override: ${formatOptions.targetRoleOverride || 'None provided'}`,
              `Additional recruiter instructions: ${formatOptions.recruiterInstructions || 'None provided'}`,
              '',
              'Candidate CV text:',
              trimString(candidateText, MAX_INPUT_CHARS),
              '',
              'Job specification text:',
              trimString(jobSpecText || 'No job specification provided.', MAX_INPUT_CHARS),
            ].join('\n'),
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: FORMATTER_SCHEMA_NAME,
        schema: buildFormatterSchema(),
        strict: true,
      },
    },
  };

  if (model.toLowerCase().startsWith('gpt-5')) {
    requestBody.reasoning = { effort: 'low' };
  }

  return requestBody;
}

async function requestOpenAiFormatter({
  model,
  candidateFileName,
  candidateText,
  jobSpecText,
  candidateReference,
  options = {},
  requestFetch = fetchImpl,
  repairMode = false,
  maxOutputTokens = DEFAULT_OPENAI_MAX_OUTPUT_TOKENS,
  timeoutMs = DEFAULT_OPENAI_TIMEOUT_MS,
}) {
  const apiKey = trimString(process.env.OPENAI_API_KEY, 240);
  if (!apiKey || /^YOUR_OPENAI_API_KEY$/i.test(apiKey)) {
    return {
      ok: false,
      error: sanitiseOpenAiErrorMessage('openai_key_missing'),
      code: 'openai_key_missing',
      status: 503,
      model,
    };
  }

  ensureFormatterSchemaValid();
  const formatOptions = normaliseFormatOptions(options);
  const requestBody = buildOpenAiRequestBody({
    model,
    candidateFileName,
    candidateText,
    jobSpecText,
    candidateReference,
    formatOptions,
    repairMode,
    maxOutputTokens,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await requestFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const rawText = await response.text();
    const payload = safeJsonParse(rawText);
    if (!payload || typeof payload !== 'object') {
      return {
        ok: false,
        error: 'OpenAI returned a non-JSON API response.',
        code: 'openai_transport_invalid_json',
        status: 502,
        model,
      };
    }
    if (!response.ok) {
      if (isOpenAISchemaRejection(response.status, payload || rawText)) {
        return {
          ok: false,
          error: 'OpenAI rejected the CV formatter response schema.',
          code: 'openai_schema_rejected',
          status: 500,
          model,
          details: {
            stage: 'openai',
            parse_stage: 'schema_request',
            schema_name: FORMATTER_SCHEMA_NAME,
            response_error: trimString(payload?.error?.message || payload?.message),
            response_body: payload,
          },
        };
      }
      return {
        ok: false,
        error: sanitiseOpenAiErrorMessage(payload?.error?.message || payload?.message || `openai_http_${response.status}`),
        code: response.status === 401 || response.status === 403 ? 'openai_authentication_failed' : 'openai_request_failed',
        status: response.status,
        model,
        details: payload,
      };
    }

    const parsed = parseOpenAiFormatterResponse(payload, {
      model,
      repairMode,
      maxOutputTokens,
    });
    return { ok: true, data: parsed.result, diagnostics: parsed.diagnostics, model };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return {
        ok: false,
        error: sanitiseOpenAiErrorMessage('openai_timeout'),
        code: 'openai_timeout',
        status: 504,
        model,
      };
    }
    return {
      ok: false,
      error: sanitiseOpenAiErrorMessage(error?.message || 'openai_request_failed'),
      code: trimString(error?.code) || 'openai_request_failed',
      status: Number(error?.statusCode) || Number(error?.status) || null,
      model,
      details: error?.details || null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenAiFormatter({
  candidateFileName,
  candidateText,
  jobSpecText,
  candidateReference,
  options = {},
  requestFetch = fetchImpl,
}) {
  const apiKey = trimString(process.env.OPENAI_API_KEY, 240);
  if (!apiKey || /^YOUR_OPENAI_API_KEY$/i.test(apiKey)) {
    return {
      ok: false,
      error: sanitiseOpenAiErrorMessage('openai_key_missing'),
      code: 'openai_key_missing',
      status: 503,
      attempts: [],
    };
  }

  const models = buildOpenAiModelSequence();
  const attempts = [];
  const timeoutMs = Math.max(10000, Number(process.env.OPENAI_CV_FORMAT_TIMEOUT_MS) || DEFAULT_OPENAI_TIMEOUT_MS);
  let lastFailure = {
    ok: false,
    error: sanitiseOpenAiErrorMessage('openai_request_failed'),
    code: 'openai_request_failed',
    model: models[0] || DEFAULT_MODEL,
  };

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const modelAttempts = [
      { repairMode: false, maxOutputTokens: DEFAULT_OPENAI_MAX_OUTPUT_TOKENS },
      { repairMode: true, maxOutputTokens: REPAIR_OPENAI_MAX_OUTPUT_TOKENS },
    ];

    for (let attemptIndex = 0; attemptIndex < modelAttempts.length; attemptIndex += 1) {
      const attempt = modelAttempts[attemptIndex];
      const result = await requestOpenAiFormatter({
        model,
        candidateFileName,
        candidateText,
        jobSpecText,
        candidateReference,
        options,
        requestFetch,
        repairMode: attempt.repairMode,
        maxOutputTokens: attempt.maxOutputTokens,
        timeoutMs,
      });
      attempts.push({
        model,
        ok: !!result.ok,
        status: Number(result.status) || null,
        error: result.ok ? '' : trimString(result.error, 240),
        code: trimString(result.code, 80),
        repairMode: attempt.repairMode,
        maxOutputTokens: attempt.maxOutputTokens,
      });
      if (result.ok) {
        return { ...result, attempts };
      }
      lastFailure = result;
      if (isRecoverableOpenAiOutputError(result) && attemptIndex < modelAttempts.length - 1) {
        continue;
      }
      break;
    }
    if (!shouldRetryAiAttempt(lastFailure)) break;
  }

  return {
    ok: false,
    error: trimString(lastFailure.error || 'openai_request_failed', 240),
    code: trimString(lastFailure.code) || 'openai_request_failed',
    status: Number(lastFailure.status) || null,
    model: trimString(lastFailure.model) || null,
    diagnostics: lastFailure.diagnostics || null,
    details: lastFailure.details || null,
    attempts,
  };
}

async function extractUploadedText(file, options = {}) {
  const prepared = matcherCore.prepareCandidateFiles([file]);
  const extracted = await matcherCore.extractCandidateDocuments(prepared, {
    enablePdfOcr: true,
    ocrFetchImpl: options.fetchImpl,
  });
  const best = extracted.successful[0] || extracted.documents[0];
  if (!best || best.status !== 'ok' || !trimString(best.extractedText)) {
    const message = trimString(best?.error) || matcherCore.summariseNoReadableTextFailure(extracted.documents);
    const error = matcherCore.coded(422, message || 'No readable text could be extracted from the uploaded document.', 'cv_text_unavailable');
    error.details = {
      documents: extracted.documents.map(matcherCore.summariseDocument),
    };
    throw error;
  }
  return {
    text: best.extractedText,
    document: best,
    extracted,
  };
}

function bulletParagraph(text, indentLevel) {
  return new Paragraph({
    text: trimString(text),
    bullet: { level: Number(indentLevel) || 0 },
    spacing: { after: 90, line: 300 },
  });
}

function textParagraph(text, options = {}) {
  return new Paragraph({
    children: [
      new TextRun({
        text: trimString(text),
        bold: options.bold === true,
        italics: options.italics === true,
        underline: options.underline === true ? { type: UnderlineType.SINGLE } : undefined,
        size: options.size || 24,
      }),
    ],
    alignment: options.alignment,
    spacing: options.spacing || { after: 120, line: 300 },
  });
}

function labelledCellParagraph(text, { bold = false } = {}) {
  return new Paragraph({
    children: [
      new TextRun({
        text: trimString(text),
        bold,
        size: 24,
      }),
    ],
    spacing: { after: 80, line: 300 },
  });
}

function tableBorders() {
  return {
    top: { style: BorderStyle.DOTTED, color: '4A4A4A', size: 1 },
    bottom: { style: BorderStyle.DOTTED, color: '4A4A4A', size: 1 },
    left: { style: BorderStyle.DOTTED, color: '4A4A4A', size: 1 },
    right: { style: BorderStyle.DOTTED, color: '4A4A4A', size: 1 },
    insideHorizontal: { style: BorderStyle.DOTTED, color: '4A4A4A', size: 1 },
    insideVertical: { style: BorderStyle.DOTTED, color: '4A4A4A', size: 1 },
  };
}

function coverCellChildren(value, maxItems) {
  if (Array.isArray(value)) {
    const items = cleanList(value, maxItems || 4, 180);
    if (!items.length) return [labelledCellParagraph('')];
    return items.map((item) => bulletParagraph(item, 0));
  }
  const text = trimString(value);
  return [labelledCellParagraph(text || '')];
}

function coverRow(label, value, opts = {}) {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 3200, type: WidthType.DXA },
        margins: { top: 120, bottom: 120, left: 100, right: 100 },
        children: [labelledCellParagraph(label, { bold: true })],
      }),
      new TableCell({
        width: { size: 7200, type: WidthType.DXA },
        margins: { top: 120, bottom: 120, left: 100, right: 100 },
        children: coverCellChildren(value, opts.maxItems),
      }),
    ],
  });
}

function hasDisplayableCoverValue(value) {
  if (Array.isArray(value)) return cleanList(value, 10, 180).length > 0;
  return !!trimString(value);
}

function buildCoverTable(profile, options = {}) {
  const formatOptions = normaliseFormatOptions(options);
  const rowSpecs = formatOptions.coverPageMode === 'condensed'
    ? [
        { label: 'Position', value: profile.targetRole },
        { label: 'Candidate ID', value: profile.candidateReference },
        { label: 'Location', value: profile.location },
        { label: 'Availability', value: profile.interviewAvailability },
        { label: 'Key Qualifications', value: profile.qualifications.concat(profile.accreditations), opts: { maxItems: 4 } },
      ]
    : [
        { label: 'Position', value: profile.targetRole },
        { label: 'Candidate ID', value: profile.candidateReference },
        { label: 'Location', value: profile.location },
        { label: 'Relevant Data Centre Projects / Experience', value: profile.relevantProjects, opts: { maxItems: 4 } },
        { label: 'Qualifications & Accreditations', value: profile.qualifications.concat(profile.accreditations), opts: { maxItems: 5 } },
        { label: 'Languages', value: profile.languages, opts: { maxItems: 4 } },
        { label: 'Availability to Interview', value: profile.interviewAvailability },
      ];
  const rows = rowSpecs
    .filter((row) => hasDisplayableCoverValue(row.value))
    .map((row) => coverRow(row.label, row.value, row.opts));

  return new Table({
    width: { size: 10400, type: WidthType.DXA },
    borders: tableBorders(),
    rows,
  });
}

function sectionHeading(title) {
  return new Paragraph({
    children: [
      new TextRun({
        text: trimString(title),
        bold: true,
        underline: { type: UnderlineType.SINGLE },
        size: 28,
      }),
    ],
    spacing: { before: 180, after: 160 },
  });
}

function loadLogoBuffer() {
  const candidates = [
    path.join(__dirname, '..', 'images', 'logo.png'),
    path.join(__dirname, '..', 'images', 'logo plain.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate);
    }
  }
  return null;
}

function createLogoParagraph(logoBuffer) {
  if (!logoBuffer) return new Paragraph({});
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 260 },
    children: [
      new ImageRun({
        data: logoBuffer,
        transformation: { width: 230, height: 72 },
      }),
    ],
  });
}

function safeFileNameToken(value, fallback = 'Client Ready CV', maxLength = 60) {
  const cleaned = trimString(value || fallback)
    .replace(/[^\w\s-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return trimString(cleaned || fallback, maxLength);
}

function appendBulletSection(children, title, items, maxItems) {
  const safeItems = cleanList(items, maxItems || 10, 220);
  if (!safeItems.length) return;
  children.push(sectionHeading(title));
  safeItems.forEach((item) => children.push(bulletParagraph(item, 0)));
}

function appendEmploymentHistorySection(children, entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  children.push(sectionHeading('Employment History'));
  entries.forEach((entry) => {
    if (entry.dates) children.push(textParagraph(entry.dates, { bold: true, size: 24, spacing: { after: 50 } }));
    if (entry.title) children.push(textParagraph(entry.title, { bold: true, size: 26, spacing: { after: 40 } }));
    if (entry.company) children.push(textParagraph(entry.company, { italics: true, size: 22, spacing: { after: 60 } }));
    if (entry.summary) children.push(textParagraph(entry.summary, { size: 24, spacing: { after: 100, line: 330 } }));
    entry.bullets.forEach((item) => children.push(bulletParagraph(item, 0)));
  });
}

function applyTemplateSections(children, profile, options = {}) {
  const formatOptions = normaliseFormatOptions(options);
  const includeRoleAlignment = formatOptions.includeRoleAlignment && profile.roleAlignment.length;
  const sectionPlans = {
    recruiter_standard: [
      () => includeRoleAlignment && appendBulletSection(children, 'Role Alignment', profile.roleAlignment, 6),
      () => appendBulletSection(children, 'Key Skills', profile.keySkills, 12),
      () => appendBulletSection(children, 'Relevant Project Experience', profile.relevantProjects, 6),
      () => appendBulletSection(children, 'Qualifications', profile.qualifications, 10),
      () => appendBulletSection(children, 'Accreditations', profile.accreditations, 10),
      () => appendEmploymentHistorySection(children, profile.employmentHistory),
    ],
    data_centre_priority: [
      () => appendBulletSection(children, 'Relevant Data Centre Projects / Experience', profile.relevantProjects, 6),
      () => includeRoleAlignment && appendBulletSection(children, 'Role Alignment', profile.roleAlignment, 6),
      () => appendBulletSection(children, 'Key Skills', profile.keySkills, 12),
      () => appendEmploymentHistorySection(children, profile.employmentHistory),
      () => appendBulletSection(children, 'Qualifications', profile.qualifications, 10),
      () => appendBulletSection(children, 'Accreditations', profile.accreditations, 10),
    ],
    executive_summary: [
      () => appendBulletSection(children, 'Key Skills Snapshot', profile.keySkills, 10),
      () => includeRoleAlignment && appendBulletSection(children, 'Role Alignment', profile.roleAlignment, 6),
      () => appendBulletSection(children, 'Selected Project Experience', profile.relevantProjects, 5),
      () => appendEmploymentHistorySection(children, profile.employmentHistory),
      () => appendBulletSection(children, 'Qualifications', profile.qualifications, 10),
      () => appendBulletSection(children, 'Accreditations', profile.accreditations, 10),
    ],
  };

  (sectionPlans[formatOptions.templatePreset] || sectionPlans.recruiter_standard).forEach((runSection) => runSection());

  if (formatOptions.includeAdditionalInformation) {
    appendBulletSection(children, 'Additional Information', profile.additionalInformation, 8);
  }
  if (formatOptions.includeFormattingNotes) {
    appendBulletSection(children, 'Formatting Notes', profile.redactionsApplied, 8);
  }
  if (formatOptions.includeWarnings) {
    appendBulletSection(children, 'Warnings', profile.warnings, 8);
  }
}

async function buildClientReadyDocx(profile, options = {}) {
  const formatOptions = normaliseFormatOptions(options);
  const logoBuffer = loadLogoBuffer();
  const sections = [];
  const bodyChildren = [
    createLogoParagraph(logoBuffer),
    textParagraph(profile.targetRole, {
      bold: true,
      size: 40,
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),
    textParagraph(profile.candidateReference, {
      alignment: AlignmentType.CENTER,
      size: 22,
      spacing: { after: 220 },
    }),
    sectionHeading(formatOptions.templatePreset === 'executive_summary' ? 'Executive Summary' : 'Profile'),
    textParagraph(profile.profile, { size: 24, spacing: { after: 160, line: 340 } }),
  ];

  applyTemplateSections(bodyChildren, profile, formatOptions);

  if (formatOptions.coverPageMode !== 'skip') {
    const coverChildren = [createLogoParagraph(logoBuffer)];
    if (formatOptions.coverPageMode === 'condensed') {
      coverChildren.push(
        textParagraph(profile.targetRole, {
          bold: true,
          size: 36,
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        }),
        textParagraph(profile.candidateReference, {
          alignment: AlignmentType.CENTER,
          size: 22,
          spacing: { after: 180 },
        })
      );
    }
    coverChildren.push(buildCoverTable(profile, formatOptions));

    sections.push({
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children: coverChildren,
    });
  }

  sections.push({
    properties: {
      page: {
        margin: { top: 720, right: 950, bottom: 720, left: 950 },
      },
    },
    children: bodyChildren,
  });

  const document = new Document({ sections });
  return Packer.toBuffer(document);
}

function buildOutputFileName(profile, options = {}, candidateFileName = '') {
  const formatOptions = normaliseFormatOptions(options);
  const roleTitle = safeFileNameToken(profile.targetRole || 'Client Ready CV');
  const sourceTitle = safeFileNameToken(fileBaseName(candidateFileName) || 'Source CV');
  const reference = safeFileNameToken(profile.candidateReference || 'HMJ-CANDIDATE', 'HMJ-CANDIDATE', 40);

  if (formatOptions.outputNameMode === 'reference_only') {
    return `${reference} Client CV.docx`;
  }
  if (formatOptions.outputNameMode === 'source_reference') {
    return `${sourceTitle} - ${reference}.docx`;
  }
  return `${roleTitle} - ${reference}.docx`;
}

function summariseExtraction(extraction) {
  const doc = extraction?.document || {};
  return {
    name: trimString(doc.name),
    contentType: trimString(doc.contentType),
    extension: trimString(doc.extension),
    parser: trimString(doc.extractionDiagnostics?.parser),
    extractionMode: trimString(doc.extractionMode),
    textChars: Number(doc.extractedTextLength) || 0,
    selectedTextSource: trimString(doc.selectedTextSource || doc.extractionDiagnostics?.selectedTextSource),
  };
}

async function formatClientReadyCv({
  candidateFile,
  jobSpecFile = null,
  options = {},
  requestFetch = fetchImpl,
}) {
  const formatOptions = normaliseFormatOptions(options);
  const candidateExtraction = await extractUploadedText(candidateFile, { fetchImpl: requestFetch });
  const jobSpecExtraction = jobSpecFile ? await extractUploadedText(jobSpecFile, { fetchImpl: requestFetch }) : null;
  const candidateText = trimString(candidateExtraction.text);
  const uploadedJobSpecText = trimString(jobSpecExtraction?.text || '');
  const jobSpecText = formatOptions.tailoringMode === 'cv_only' ? '' : uploadedJobSpecText;
  const candidateName = guessCandidateName(candidateFile?.name, candidateText);
  const candidateReference = generateCandidateReference(candidateFile?.name, candidateText);
  const jobSpecRole = buildRoleHints(jobSpecText);
  const fileRole = cleanRoleTitle(findLineAfterLabel(candidateText, ['Position', 'Role', 'Title']));

  let profile = null;
  let source = 'fallback';
  let model = '';
  let warnings = [];
  let aiAttempts = [];
  let aiDiagnostics = null;
  let aiFailureCode = '';
  let aiFailureMessage = '';
  let aiRequested = formatOptions.preferAiAssist !== false;

  if (uploadedJobSpecText && formatOptions.tailoringMode === 'cv_only') {
    warnings.push('A job spec was uploaded but tailoring mode was set to CV only, so the brief was not applied.');
  }
  if (!uploadedJobSpecText && formatOptions.tailoringMode === 'job_first') {
    warnings.push('Job-first tailoring was requested without a job spec upload, so the formatter used the CV only.');
  }

  if (formatOptions.preferAiAssist !== false) {
    const ai = await callOpenAiFormatter({
      candidateFileName: candidateFile?.name,
      candidateText,
      jobSpecText,
      candidateReference,
      options: formatOptions,
      requestFetch,
    });
    aiAttempts = Array.isArray(ai.attempts) ? ai.attempts : [];
    if (ai.ok) {
      aiDiagnostics = ai.diagnostics || null;
      profile = sanitiseStructuredProfile(ai.data, {
        candidateName,
        candidateReference,
        jobSpecRole,
        fileRole,
        formatOptions,
      });
      source = 'openai';
      model = trimString(ai.model);
      if (aiAttempts.length > 1) {
        warnings.push(`AI formatter completed using backup model ${model || 'unknown model'} after ${aiAttempts.length} attempts.`);
      }
    } else {
      aiFailureCode = trimString(ai.code, 80);
      aiFailureMessage = trimString(ai.error, 220);
      aiDiagnostics = ai.diagnostics || ai.details || null;
      const aiMessage = trimString(ai.error || 'formatter_unavailable', 180).replace(/[.]+$/g, '');
      const attemptText = aiAttempts.length ? ` after ${aiAttempts.length} AI attempts` : '';
      warnings.push(`AI formatter fallback used${attemptText}: ${aiMessage}.`);
    }
  }

  if (!profile) {
    profile = buildFallbackProfile({
      candidateText,
      jobSpecText,
      candidateFileName: candidateFile?.name,
      options: formatOptions,
    });
  }

  profile.warnings = uniqueStrings(profile.warnings.concat(warnings), 8);
  const buffer = await buildClientReadyDocx(profile, formatOptions);

  return {
    ok: true,
    source,
    model: model || null,
    profile,
    buffer,
    contentType: DOCX_MIME_TYPE,
    fileName: buildOutputFileName(profile, formatOptions, candidateFile?.name),
    analysis: {
      candidateFile: summariseExtraction(candidateExtraction),
      jobSpecFile: jobSpecExtraction ? summariseExtraction(jobSpecExtraction) : null,
      candidateReference: profile.candidateReference,
      targetRole: profile.targetRole,
      tailoredToJobSpec: !!jobSpecText,
      optionsUsed: formatOptions,
      aiAttempts,
      ai: {
        requested: aiRequested,
        attempted: aiRequested,
        succeeded: source === 'openai',
        failureCode: aiFailureCode || null,
        failureMessage: aiFailureMessage || null,
        diagnostics: aiDiagnostics,
      },
      redactionsApplied: profile.redactionsApplied,
      warnings: profile.warnings,
    },
    aiAttempts,
  };
}

module.exports = {
  DOCX_MIME_TYPE,
  buildClientReadyDocx,
  buildFallbackProfile,
  buildOutputFileName,
  callOpenAiFormatter,
  formatClientReadyCv,
  generateCandidateReference,
  guessCandidateName,
  redactPersonalIdentifiers,
  sanitiseStructuredProfile,
  sanitizeLocation,
  summariseExtraction,
};
