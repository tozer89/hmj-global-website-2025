'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const JSZip = require('jszip');
const {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HorizontalPositionRelativeFrom,
  ImageRun,
  Packer,
  Paragraph,
  PageBreak,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextWrappingType,
  TextRun,
  VerticalPositionRelativeFrom,
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
const FORMATTER_VERIFIER_SCHEMA_NAME = 'hmj_premium_candidate_pack_review';
const BRAND_FONT = 'Calibri';
const BRAND_HEADING_FONT = 'Calibri Light';
const BRAND_LOGO_IMAGE_TYPE = 'png';
const BRAND_TEXT_COLOR = '333333';
const BRAND_PRIMARY_COLOR = '2F5496';
const BRAND_BORDER_COLOR = '9FB4DA';
const BRAND_MUTED_COLOR = '5E6B81';
const TEMPLATE_LOGO_PATH = path.join(__dirname, '..', 'assets', 'templates', 'cv-formatting', 'media', 'template-logo.png');
const PREMIUM_LOGO_PATH = path.join(__dirname, '..', 'assets', 'templates', 'cv-formatting', 'media', 'hmj-logo-premium.png');
const PREMIUM_HEADER_BAND_PATH = path.join(__dirname, '..', 'assets', 'templates', 'cv-formatting', 'media', 'premium-header-band.png');
const TEMPLATE_PAGE_MARGINS = Object.freeze({
  top: 1500,
  right: 850,
  bottom: 1134,
  left: 1701,
  header: 720,
  footer: 283,
  gutter: 0,
});
const HMJ_CONTACT_EMAIL = 'info@hmj-global.com';
const HMJ_CONTACT_PHONE = '0800 861 1230';
const HMJ_WEBSITE_URL = 'https://www.HMJ-Global.com';
const RECENT_HISTORY_WINDOW_YEARS = 5;
const COMMON_SECTION_HEADINGS = [
  'profile',
  'summary',
  'personal profile',
  'profile summary',
  'key skills',
  'skills',
  'core skills',
  'technical skills',
  'data centre skills',
  'project experience',
  'relevant project experience',
  'selected project experience',
  'selected data centre projects',
  'relevant data centre projects / experience',
  'qualifications',
  'qualifications & accreditations',
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
  'scope & role',
  'role alignment',
  'formatting notes',
  'warnings',
  'hmj global',
];
const fetchImpl = typeof fetch === 'function'
  ? fetch.bind(globalThis)
  : (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));
const DEFAULT_FORMAT_OPTIONS = Object.freeze({
  templatePreset: 'premium_candidate_pack',
  anonymiseMode: 'balanced',
  tailoringMode: 'balanced',
  coverPageMode: 'skip',
  outputNameMode: 'role_reference',
  includeRoleAlignment: false,
  includeFormattingNotes: false,
  includeWarnings: false,
  includeAdditionalInformation: true,
  preferAiAssist: true,
  candidateDisplayName: '',
  targetRoleOverride: '',
  recruiterInstructions: '',
});
const TEMPLATE_PRESETS = new Set([
  'premium_candidate_pack',
  'recruiter_standard',
  'data_centre_priority',
  'executive_summary',
]);
const ANONYMISE_MODES = new Set(['light', 'balanced', 'strict']);
const TAILORING_MODES = new Set(['balanced', 'job_first', 'cv_only']);
const COVER_PAGE_MODES = new Set(['full', 'condensed', 'skip']);
const OUTPUT_NAME_MODES = new Set(['role_reference', 'reference_only', 'source_reference']);
const GENERIC_CANDIDATE_FILE_NAME_PATTERN = /\b(?:candidate|cv|resume|profile|formatted|formatting|client\s*ready|export(?:ed)?|document|version|final|updated|upload(?:ed)?|brief|spec|job)\b/i;
const LIKELY_ROLE_TITLE_PATTERN = /\b(?:manager|engineer|electrician|improver|mate|supervisor|director|planner|coordinator|consultant|technician|lead|estimator|buyer|surveyor|designer|foreman|person|authority|inspector|officer|controller|auditor|specialist)\b/i;
const ROLE_TITLE_CAPTURE_PATTERN = /\b([A-Z][A-Za-z0-9&/+-]*(?:\s+[A-Z][A-Za-z0-9&/+-]*){0,7}\s(?:Manager|Engineer|Electrician|Improver|Mate|Supervisor|Director|Planner|Coordinator|Consultant|Technician|Lead|Estimator|Buyer|Surveyor|Designer|Foreman|Person|Authority|Inspector|Officer|Controller|Auditor|Specialist))\b/gi;
const DISPLAY_UPPERCASE_TOKENS = new Set([
  'QA', 'QC', 'QAQC', 'QA/QC', 'HV', 'LV', 'MV', 'SSOW', 'LOTO', 'ATS', 'UPS', 'MOD', 'ECS',
  'CSCS', 'SMSTS', 'IPAF', 'HNC', 'HND', 'C&G', 'MEP', 'CSA', 'SAP', 'BMS',
]);
const INTERNAL_CLIENT_TEXT_PATTERNS = [
  /\bcontent emphasis has been tuned\b/i,
  /\bpriority skills and projects have been reordered\b/i,
  /\ball statements remain grounded\b/i,
  /\bfallback formatting was used\b/i,
  /\bjob-spec tailoring was inferred\b/i,
  /\bai formatter fallback used\b/i,
  /\bfull name replaced with\b/i,
  /\bdirect contact details removed\b/i,
  /\bdob and precise postcode removed\b/i,
  /\brole alignment\b/i,
  /\bformatting notes\b/i,
  /\bwarnings\b/i,
];
const FOOTER_ARTIFACT_PATTERNS = [
  /\binfo@hmj-global\.com\b/i,
  /\bwww\.hmj-global\.com\b/i,
  /\b0800\s*861\s*1230\b/i,
  /^\s*hmj global\s*$/i,
];
const JOB_SPEC_STOPWORDS = new Set([
  'about', 'across', 'after', 'around', 'based', 'brief', 'build', 'candidate', 'client', 'contract',
  'coordination', 'delivery', 'experience', 'global', 'have', 'into', 'lead', 'level', 'location',
  'looking', 'manager', 'must', 'need', 'person', 'profile', 'project', 'required', 'requirements',
  'role', 'scope', 'skills', 'strong', 'support', 'their', 'they', 'this', 'through', 'with', 'work',
]);

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
    includeRoleAlignment: false,
    includeFormattingNotes: false,
    includeWarnings: false,
    includeAdditionalInformation: normaliseBoolean(raw.includeAdditionalInformation, DEFAULT_FORMAT_OPTIONS.includeAdditionalInformation),
    preferAiAssist: normaliseBoolean(raw.preferAiAssist, DEFAULT_FORMAT_OPTIONS.preferAiAssist),
    candidateDisplayName: trimString(raw.candidateDisplayName, 120),
    targetRoleOverride: trimString(raw.targetRoleOverride, 140),
    recruiterInstructions: trimString(raw.recruiterInstructions, 400),
  };
}

function normaliseWhitespace(value) {
  return trimString(String(value == null ? '' : value).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n'));
}

function fixCommonExtractionArtifacts(value) {
  let text = String(value == null ? '' : value);
  if (!text) return '';
  text = text
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[‐‑–—]/g, '-')
    .replace(/\bQAQC\b/gi, 'QA/QC')
    .replace(/\bC&\s+G\b/gi, 'C&G')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/([a-z0-9])([A-Z][a-z])/g, '$1 $2')
    .replace(/\)([A-Z])/g, ') $1')
    .replace(/([A-Za-z])\|([A-Za-z])/g, '$1 | $2')
    .replace(/\b([A-Z][a-z]{4,})(for)\b/g, '$1 $2')
    .replace(/[ \t]{2,}/g, ' ');
  return trimString(text);
}

function normaliseComparableText(value) {
  return fixCommonExtractionArtifacts(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isInternalFormatterText(value) {
  const text = fixCommonExtractionArtifacts(value);
  if (!text) return false;
  return INTERNAL_CLIENT_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

function isFooterArtifactText(value) {
  const text = fixCommonExtractionArtifacts(value);
  if (!text) return false;
  return FOOTER_ARTIFACT_PATTERNS.some((pattern) => pattern.test(text));
}

function isGeneratedCandidateReference(value) {
  return /^HMJ-[A-Z0-9]{6,12}$/i.test(trimString(value));
}

function isLowSignalClientLine(value) {
  const text = fixCommonExtractionArtifacts(value);
  if (!text) return true;
  return isInternalFormatterText(text)
    || isFooterArtifactText(text)
    || isGeneratedCandidateReference(text)
    || /^page \d+$/i.test(text);
}

function cleanClientFacingText(value, maxLength = 1400) {
  const text = fixCommonExtractionArtifacts(value);
  if (!text || isLowSignalClientLine(text)) return '';
  return trimString(text, maxLength);
}

async function withTimeout(taskFactory, timeoutMs, onTimeout) {
  const limit = Number(timeoutMs) || DEFAULT_OPENAI_TIMEOUT_MS;
  return await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        reject(typeof onTimeout === 'function' ? onTimeout() : new Error(`Timed out after ${limit}ms.`));
      } catch (error) {
        reject(error);
      }
    }, limit);

    Promise.resolve()
      .then(taskFactory)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

function splitIntoSentences(value) {
  return fixCommonExtractionArtifacts(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => trimString(part))
    .filter(Boolean);
}

function filterClientFacingItems(values, maxItems = 8, maxLength = 220) {
  const seen = new Set();
  const output = [];
  (Array.isArray(values) ? values : []).forEach((entry) => {
    const cleaned = cleanClientFacingText(entry, maxLength);
    if (!cleaned) return;
    const key = normaliseComparableText(cleaned);
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push(cleaned);
  });
  return output.slice(0, maxItems);
}

function prepareSourceTextForFormatting(text) {
  const lines = normaliseWhitespace(fixCommonExtractionArtifacts(text))
    .split('\n')
    .map((line) => trimString(line))
    .filter(Boolean);
  const output = [];
  lines.forEach((line) => {
    if (isLowSignalClientLine(line)) return;
    output.push(line);
  });
  return output.join('\n');
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
    const cleaned = trimString(fixCommonExtractionArtifacts(String(entry || '').replace(/^[-*•\s]+/, '')), maxItemLength);
    if (!cleaned) return;
    const key = normaliseComparableText(cleaned);
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
    const cleaned = trimString(fixCommonExtractionArtifacts(value), 240);
    if (!cleaned) return;
    const key = normaliseComparableText(cleaned);
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

function cleanCandidateDisplayName(value) {
  const text = fixCommonExtractionArtifacts(trimString(value, 120));
  if (!isLikelyPersonName(text)) return '';
  if (isLikelyTemplateArtifact(text) || cleanRoleTitle(text)) return '';
  return trimString(text, 120);
}

function normaliseDisplayCapitalisation(value) {
  const text = fixCommonExtractionArtifacts(value);
  if (!text) return '';
  return trimString(text.split(/\s+/).map((token) => token
    .split(/([/&()-])/)
    .map((part) => {
      if (!part || /^[\/&() -]$/.test(part)) return part;
      const upper = part.toUpperCase();
      if (upper === 'QAQC') return 'QA/QC';
      if (DISPLAY_UPPERCASE_TOKENS.has(upper) || /^[A-Z0-9]{1,4}$/.test(part)) return upper;
      return `${upper.charAt(0)}${upper.slice(1).toLowerCase()}`;
    })
    .join('')).join(' ').replace(/\s{2,}/g, ' '), 180);
}

function findLastRoleMatch(value) {
  const text = trimString(value, 240);
  if (!text) return null;
  const matches = Array.from(text.matchAll(new RegExp(ROLE_TITLE_CAPTURE_PATTERN.source, 'gi')));
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  return {
    raw: trimString(last[1], 180),
    text: normaliseDisplayCapitalisation(last[1]),
    index: Number.isInteger(last.index) ? last.index : text.toLowerCase().lastIndexOf(String(last[1] || '').toLowerCase()),
  };
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
  return /(?:\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b\s+)?\d{4}\s*(?:[–-]|to)\s*(?:(?:\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b\s+)?(?:present|\d{4}))/i.test(text)
    || /\b\d{1,2}\s*\/\s*\d{2,4}\s*(?:[–-]|to)\s*(?:present|\d{1,2}\s*\/\s*\d{2,4})\b/i.test(text)
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
    || text === 'candidate id'
    || text === 'scope & role';
}

function sanitizeLocation(value, anonymiseMode = DEFAULT_FORMAT_OPTIONS.anonymiseMode) {
  let text = trimString(value, 160);
  if (!text) return '';
  if (isLikelyTemplateArtifact(text)) return '';
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
    .replace(/\s*[|]+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[.,;:]+$/g, '')
    .trim();

  const roleMatch = findLastRoleMatch(text);
  if (roleMatch?.text) {
    return trimString(roleMatch.text, 140);
  }

  if (isLikelyRoleTitle(text)) {
    return trimString(normaliseDisplayCapitalisation(text), 140);
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

function roleKeywordFingerprint(value) {
  return uniqueStrings(
    trimString(value)
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => LIKELY_ROLE_TITLE_PATTERN.test(word) || ['electrical', 'mechanical', 'quantity', 'surveyor', 'project', 'construction', 'commercial', 'commissioning', 'engineer', 'manager'].includes(word)),
    8
  );
}

function rolesLookCompatible(a, b) {
  const left = roleKeywordFingerprint(a);
  const right = roleKeywordFingerprint(b);
  if (!left.length || !right.length) return false;
  return left.some((token) => right.includes(token));
}

function hasConflictingRoleMentions(value, primaryRole = '') {
  const referenceRole = cleanRoleTitle(primaryRole);
  if (!referenceRole) return false;
  const matches = Array.from(fixCommonExtractionArtifacts(value).matchAll(new RegExp(ROLE_TITLE_CAPTURE_PATTERN.source, 'gi')))
    .map((match) => cleanRoleTitle(match[1]))
    .filter(Boolean);
  if (!matches.length) return false;
  return uniqueStrings(matches, 6).some((role) => !rolesLookCompatible(role, referenceRole));
}

function derivePrimaryRole({ text, employmentHistory = [], fileRole = '', jobSpecRole = '', targetRoleOverride = '' }) {
  const scoreboard = new Map();
  const addCandidate = (role, score) => {
    const cleaned = cleanRoleTitle(role);
    if (!cleaned) return;
    const key = normaliseComparableText(cleaned);
    if (!key) return;
    const current = scoreboard.get(key) || { role: cleaned, score: 0 };
    current.score += Number(score) || 0;
    scoreboard.set(key, current);
  };

  if (targetRoleOverride) addCandidate(targetRoleOverride, 100);
  if (fileRole) addCandidate(fileRole, 3);
  if (jobSpecRole) addCandidate(jobSpecRole, 2);

  splitNonEmptyLines(text).forEach((line, index) => {
    const cleaned = cleanRoleTitle(line);
    if (!cleaned) return;
    addCandidate(cleaned, index < 6 ? 2 : 1);
  });

  (Array.isArray(employmentHistory) ? employmentHistory : []).forEach((entry, index) => {
    addCandidate(entry?.title, index === 0 ? 8 : 5);
  });

  const ranked = Array.from(scoreboard.values()).sort((a, b) => b.score - a.score);
  if (!ranked.length) return '';

  const dominant = ranked[0].role;
  if (targetRoleOverride) return cleanRoleTitle(targetRoleOverride) || trimString(targetRoleOverride, 140);
  if (jobSpecRole && rolesLookCompatible(jobSpecRole, dominant)) return cleanRoleTitle(jobSpecRole) || trimString(jobSpecRole, 140);
  return dominant;
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

function expandTwoDigitYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return 0;
  if (year >= 1000) return year;
  return year >= 80 ? 1900 + year : 2000 + year;
}

function extractDateRangeFromText(value) {
  const text = trimString(value, 220);
  if (!text) return '';
  const patterns = [
    /\b(?:\d{1,2}\s*\/\s*)?\d{2,4}\s*(?:[–-]|to)\s*(?:present|(?:\d{1,2}\s*\/\s*)?\d{2,4})\b/i,
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{2,4}\s*(?:[–-]|to)\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+)?(?:present|\d{2,4})\b/i,
    /\b\d{4}\s*(?:[–-]|to)\s*(?:present|\d{4})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return trimString(match[0], 120);
  }
  return '';
}

function removeDateRangeFromText(value, dateRange) {
  const text = trimString(value, 220);
  const safeDateRange = trimString(dateRange, 120);
  if (!text || !safeDateRange) return text;
  return trimString(
    text
      .replace(safeDateRange, '')
      .replace(/[|,;]\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
  );
}

function findDateRangeMatches(value) {
  const text = trimString(value, 480);
  if (!text) return [];
  return Array.from(text.matchAll(/\b(?:(?:\d{1,2}\s*\/\s*)?\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{2,4})\s*(?:[–-]|to)\s*(?:present|(?:\d{1,2}\s*\/\s*)?\d{2,4}|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{2,4}))\b/gi))
    .map((match) => ({
      text: trimString(match[0], 120),
      index: Number.isInteger(match.index) ? match.index : -1,
    }))
    .filter((match) => match.index >= 0 && match.text);
}

function looksLikeActionBullet(value) {
  const text = cleanClientFacingText(value, 220);
  if (!text) return false;
  if (looksLikeDateRange(text) || isLikelyTemplateArtifact(text) || cleanRoleTitle(text)) return false;
  if (text.split(/\s+/).length < 2 || text.length > 180) return false;
  if (/^[a-z]/.test(text)) return true;
  return /^(?:carry|create|implement|manage|managing|maintain|maintaining|work(?:ed|ing)?|obtain|verify|verified|start|starting|lead|leading|coordinate|coordinating|commission(?:ing)?|inspect(?:ion)?|walkdowns?|loto|qa\/?qc|equipment checklist|electrical|switch(?:ing|board)|busway|ups)/i.test(text);
}

function polishEmploymentBullet(value) {
  let text = cleanClientFacingText(value, 220);
  if (!text) return '';
  text = text
    .replace(/^[,.;:\s-]+/, '')
    .replace(/^commissioning,\s*/i, 'Commissioning ')
    .replace(/^systems,\s*/i, 'Integrated systems including ')
    .replace(/^qaqc\b/i, 'QA/QC')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) return '';
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function expandEmploymentHistoryLines(value) {
  const text = fixCommonExtractionArtifacts(value).replace(/\s*•\s*/g, '\n• ');
  const output = [];
  text.split('\n').map((line) => trimString(line)).filter(Boolean).forEach((line) => {
    const matches = findDateRangeMatches(line);
    if (matches.length <= 1) {
      output.push(line);
      return;
    }
    let cursor = 0;
    matches.forEach((match) => {
      const end = match.index + match.text.length;
      const fragment = trimString(line.slice(cursor, end), 320);
      if (fragment) output.push(fragment);
      cursor = end;
    });
    const trailing = trimString(line.slice(cursor), 320);
    if (trailing) output.push(trailing);
  });
  return output;
}

function buildInlineEmploymentEntry(value, fallbackTitle = '') {
  const text = fixCommonExtractionArtifacts(value);
  const dateMatch = findDateRangeMatches(text)[0];
  if (!dateMatch) return null;

  const prefix = trimString(text.slice(0, dateMatch.index), 240);
  const suffix = trimString(text.slice(dateMatch.index + dateMatch.text.length), 320);
  const roleMatch = findLastRoleMatch(prefix);
  const title = trimString(roleMatch?.text || cleanRoleTitle(fallbackTitle), 140);
  let company = prefix;

  if (roleMatch?.raw && Number.isInteger(roleMatch.index) && roleMatch.index >= 0) {
    company = trimString(prefix.slice(roleMatch.index + roleMatch.raw.length), 180);
  }

  company = trimString(company.replace(/^[-,|:;/\s]+/, ''), 180);
  if (!company && !title) {
    company = prefix;
  }

  const summary = (
    suffix && !looksLikeActionBullet(suffix) && !cleanRoleTitle(suffix)
      ? cleanClientFacingText(suffix, 240)
      : ''
  );
  const bullets = looksLikeActionBullet(suffix)
    ? [cleanClientFacingText(suffix.replace(/^[•*-]\s*/, ''), 180)]
    : [];

  if (!title && !company && !summary && !bullets.length) return null;

  return {
    dates: dateMatch.text,
    title,
    company,
    summary,
    bullets,
  };
}

function parseYearBounds(value) {
  const text = trimString(value, 160);
  if (!text) return { start: 0, end: 0, hasPresent: false };
  const monthYearMatch = text.match(/\b(?:\d{1,2}\s*\/\s*)?(\d{2,4})\s*(?:[–-]|to)\s*(present|(?:\d{1,2}\s*\/\s*)?(\d{2,4}))\b/i);
  if (monthYearMatch) {
    const start = expandTwoDigitYear(monthYearMatch[1]);
    const hasPresent = trimString(monthYearMatch[2]).toLowerCase() === 'present';
    const end = hasPresent ? new Date().getFullYear() : expandTwoDigitYear(monthYearMatch[3]);
    return {
      start: Number.isFinite(start) ? start : 0,
      end: Number.isFinite(end) ? end : 0,
      hasPresent,
    };
  }
  const yearMatches = Array.from(text.matchAll(/\b(19|20)\d{2}\b/g)).map((match) => Number(match[0]));
  const hasPresent = /\bpresent\b/i.test(text);
  const start = yearMatches[0] || 0;
  const end = hasPresent
    ? new Date().getFullYear()
    : (yearMatches[yearMatches.length - 1] || start || 0);
  return {
    start: Number.isFinite(start) ? start : 0,
    end: Number.isFinite(end) ? end : 0,
    hasPresent,
  };
}

function dedupeEmploymentHistory(entries) {
  const seen = new Set();
  const output = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const item = {
      dates: trimString(entry?.dates, 120),
      title: trimString(entry?.title, 140),
      company: trimString(entry?.company, 160),
      summary: cleanClientFacingText(entry?.summary, 700),
      bullets: filterClientFacingItems(entry?.bullets, 4, 220),
    };
    if (!item.title && !item.company && !item.summary) return;
    const key = normaliseComparableText([item.title, item.company, item.dates, item.summary].join(' | '));
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push(item);
  });
  return output;
}

function selectRecentEmploymentHistory(entries, windowYears = RECENT_HISTORY_WINDOW_YEARS) {
  const cleaned = dedupeEmploymentHistory(entries);
  if (!cleaned.length) return [];

  const dated = cleaned.map((entry) => ({
    entry,
    bounds: parseYearBounds(entry.dates),
  }));
  const datedEntries = dated.filter((item) => item.bounds.start || item.bounds.end);
  if (!datedEntries.length) {
    return cleaned.slice(0, 5);
  }

  const latestYear = Math.max(...datedEntries.map((item) => item.bounds.end || item.bounds.start));
  const cutoffYear = latestYear - Math.max(1, Number(windowYears) || RECENT_HISTORY_WINDOW_YEARS);
  const selected = [];
  let earliestIncludedYear = latestYear;

  dated.forEach((item, index) => {
    const { entry, bounds } = item;
    if (!selected.length) {
      selected.push({ entry, index });
      if (bounds.start) earliestIncludedYear = Math.min(earliestIncludedYear, bounds.start);
      return;
    }

    if (!(bounds.start || bounds.end)) {
      if (selected.length < 4) {
        selected.push({ entry, index });
      }
      return;
    }

    if ((bounds.end || bounds.start) > cutoffYear || earliestIncludedYear > cutoffYear) {
      selected.push({ entry, index });
      earliestIncludedYear = Math.min(earliestIncludedYear, bounds.start || bounds.end || earliestIncludedYear);
    }
  });

  return (selected.length ? selected : dated.slice(0, 5))
    .map((item) => item.entry)
    .slice(0, 6);
}

function buildJobSpecFocusTerms(jobSpecText, primaryRole = '', tailoringMode = DEFAULT_FORMAT_OPTIONS.tailoringMode) {
  const mode = normaliseEnum(tailoringMode, TAILORING_MODES, DEFAULT_FORMAT_OPTIONS.tailoringMode);
  const source = trimString([jobSpecText, primaryRole].filter(Boolean).join('\n'), 4000).toLowerCase();
  if (!source) return [];

  const keywordHits = [];
  [
    'data centre',
    'mission critical',
    'cleanroom',
    'pharmaceutical',
    'pharma',
    'electrical',
    'mechanical',
    'commissioning',
    'commercial',
    'quantity surveying',
    'mep',
    'csa',
    'fit-out',
    'brownfield',
    'greenfield',
    'permitting',
    'planning',
  ].forEach((keyword) => {
    if (source.includes(keyword)) keywordHits.push(keyword);
  });

  const wordHits = source
    .split(/[^a-z0-9+#/-]+/)
    .map((word) => trimString(word))
    .filter((word) => word.length >= 5 && !JOB_SPEC_STOPWORDS.has(word));

  const ordered = mode === 'job_first'
    ? keywordHits.concat(wordHits)
    : wordHits.concat(keywordHits);
  return uniqueStrings(ordered, 14);
}

function scoreTailoringRelevance(text, terms = [], primaryRole = '') {
  const cleaned = cleanClientFacingText(text, 260);
  if (!cleaned) return -100;
  const lower = cleaned.toLowerCase();
  let score = 0;

  if (primaryRole) {
    const roleLine = cleanRoleTitle(cleaned);
    if (roleLine) {
      score += rolesLookCompatible(roleLine, primaryRole) ? 6 : -8;
    }
  }

  terms.forEach((term) => {
    if (!term || !lower.includes(term.toLowerCase())) return;
    score += term.includes(' ') ? 4 : 2;
  });

  if (/\b(data centre|mission critical|cleanroom|pharma|commissioning|brownfield|fit-out|mep|csa)\b/i.test(cleaned)) {
    score += 2;
  }
  if (cleaned.length <= 150) score += 1;
  if (/[|]/.test(cleaned)) score -= 2;
  return score;
}

function prioritiseItemsForClientOutput(items, { jobSpecText = '', primaryRole = '', tailoringMode = DEFAULT_FORMAT_OPTIONS.tailoringMode, maxItems = 6 } = {}) {
  const safeItems = filterClientFacingItems(items, 24, 220)
    .filter((item) => {
      if (primaryRole && normaliseComparableText(item) === normaliseComparableText(primaryRole)) return false;
      const itemRole = cleanRoleTitle(item);
      if (!itemRole || !primaryRole) return true;
      return rolesLookCompatible(itemRole, primaryRole);
    });
  if (!safeItems.length) return [];

  const terms = buildJobSpecFocusTerms(jobSpecText, primaryRole, tailoringMode);
  if (!terms.length || normaliseEnum(tailoringMode, TAILORING_MODES, DEFAULT_FORMAT_OPTIONS.tailoringMode) === 'cv_only') {
    return safeItems.slice(0, maxItems);
  }

  return safeItems
    .map((item, index) => ({
      item,
      index,
      score: scoreTailoringRelevance(item, terms, primaryRole),
    }))
    .sort((left, right) => (right.score - left.score) || (left.index - right.index))
    .map((entry) => entry.item)
    .slice(0, maxItems);
}

function collectProjectEvidenceFromHistory(entries) {
  const evidence = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const companyContext = trimString(removeDateRangeFromText(entry?.company || '', entry?.dates || ''), 90);
    const withContext = (value, maxLength = 220) => {
      const cleaned = cleanClientFacingText(value, maxLength);
      if (!cleaned) return '';
      if (!companyContext) return cleaned;
      const comparableCompany = normaliseComparableText(companyContext);
      if (comparableCompany && normaliseComparableText(cleaned).includes(comparableCompany)) return cleaned;
      return trimString(`${companyContext}: ${cleaned}`, maxLength);
    };
    splitIntoSentences(entry?.summary || '').forEach((sentence) => {
      const cleaned = cleanClientFacingText(sentence, 220);
      if (!cleaned) return;
      if (!/\b(data centre|mission critical|cleanroom|pharma|commissioning|brownfield|fit-out|mep|csa|commercial|electrical|qa\/?qc|walkdown|switch(?:board|gear)|busway|ups|hv\/lv|testing)\b/i.test(cleaned)) {
        return;
      }
      evidence.push(withContext(cleaned));
    });
    (Array.isArray(entry?.bullets) ? entry.bullets : []).forEach((bullet) => {
      const cleaned = cleanClientFacingText(bullet, 180);
      if (!cleaned) return;
      if (!/\b(data centre|mission critical|cleanroom|pharma|commissioning|commercial|electrical|qa\/?qc|walkdown|switch(?:board|gear)|busway|ups|hv\/lv|testing|handover|closeout)\b/i.test(cleaned)) {
        return;
      }
      evidence.push(withContext(cleaned));
    });
  });
  return filterClientFacingItems(evidence, 8, 220);
}

function isWeakProjectEvidenceItem(value, primaryRole = '') {
  const text = cleanClientFacingText(value, 220);
  if (!text) return true;
  if (text.split(/\s+/).length <= 4) return true;
  if (/^(?:edition|engineering\.|professional training|c&g|bsc|msc|hnc|hnd)\b/i.test(text)) return true;
  if (/\b(?:passport|eligible to work|right to work|visa|relocation\/travel)\b/i.test(text)) return true;
  if (/[|]/.test(text) && looksLikeDateRange(text.split('|').slice(-1)[0])) return true;
  if (primaryRole) {
    const comparable = normaliseComparableText(text);
    const comparableRole = normaliseComparableText(primaryRole);
    if (comparable === comparableRole) return true;
    if (comparable.startsWith(`${comparableRole} with`)) return true;
    if (/\b\d{1,2}\+ years\b/i.test(text) && rolesLookCompatible(text, primaryRole)) return true;
  }
  return false;
}

function isUsefulAdditionalInformationItem(value) {
  const text = cleanClientFacingText(value, 180);
  if (!text) return false;
  if (cleanRoleTitle(text) || isLikelyRoleTitle(text)) return false;
  return /\b(?:driving licence|driving license|travel|relocation|notice period|languages?|english|french|german|dutch|spanish|italian|polish)\b/i.test(text);
}

function shouldRewriteSummary(summary, primaryRole = '') {
  const text = cleanClientFacingText(summary, 1200);
  if (!text || text.length < 80) return true;
  if (isInternalFormatterText(text) || isFooterArtifactText(text)) return true;
  if (/[|]{2,}/.test(text) || /[A-Za-z][|][A-Za-z]/.test(text)) return true;
  if (/[|]/.test(text) && looksLikeDateRange(text.split('|').slice(-1)[0])) return true;
  if (/\bcontent emphasis has been tuned\b|\ball statements remain grounded\b/i.test(text)) return true;
  if (primaryRole) {
    const escapedRole = primaryRole.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const roleMentions = text.match(new RegExp(escapedRole, 'gi'));
    if (Array.isArray(roleMentions) && roleMentions.length > 2) return true;
    const recentProjectMatch = text.match(/Recent project exposure includes ([^.]+)\./i);
    if (recentProjectMatch && normaliseComparableText(recentProjectMatch[1]).includes(normaliseComparableText(primaryRole))) {
      return true;
    }
  }
  return false;
}

function refineClientFacingSummary(summary, context = {}) {
  const cleaned = cleanClientFacingText(toClientReadyVoice(summary), 1100);
  if (!cleaned || shouldRewriteSummary(cleaned, context.role)) {
    return fallbackProfileParagraph('', context);
  }
  return trimString(cleaned, 950);
}

function collectAdditionalInformation(text) {
  const lines = splitNonEmptyLines(text).filter((line) => (
    /\b(?:driving licence|driving license|full uk driving|willing to travel|available to travel|open to relocation|open to travel|notice period|languages?)\b/i.test(line)
  ));
  return filterClientFacingItems(lines, 6, 180);
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
    bullets.push(`Experience aligns with ${joinHumanList(matchedThemes.slice(0, 3))} requirements.`);
  }
  if (Array.isArray(relevantProjects) && relevantProjects.length) {
    bullets.push(`Relevant project evidence includes ${joinHumanList(relevantProjects.slice(0, 2))}.`);
  }
  if (Array.isArray(keySkills) && keySkills.length) {
    bullets.push(`Key strengths include ${joinHumanList(keySkills.slice(0, 4))}.`);
  }

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
  const role = trimString(context.role, 140);
  const location = trimString(context.location, 120);
  const yearsExperience = Number(context.yearsExperience) || 0;
  const sectors = uniqueStrings(context.sectors, 5);
  const keySkills = uniqueStrings(context.keySkills, 6);
  const qualifications = uniqueStrings(context.qualifications, 4);
  const relevantProjects = uniqueStrings(context.relevantProjects, 4);
  const summaryProject = relevantProjects.find((item) => !keySkills.some((skill) => normaliseComparableText(skill) === normaliseComparableText(item))) || relevantProjects[0] || '';
  const cleanedSummaryProject = trimString(String(summaryProject || '').replace(/[.]+$/g, ''), 220);
  const summarySkills = summaryProject
    ? keySkills.filter((item) => normaliseComparableText(item) !== normaliseComparableText(summaryProject))
    : keySkills;

  const sentences = [];
  const introFragments = [];
  introFragments.push(role ? `The candidate is an experienced ${role}` : 'The candidate is an experienced construction professional');
  if (location) introFragments.push(`based in ${location}`);
  if (yearsExperience > 0) introFragments.push(`with ${yearsExperience}+ years of relevant experience`);
  let intro = trimString(introFragments.join(' '), 220);
  if (intro && !/[.!?]$/.test(intro)) intro = `${intro}.`;
  if (intro) sentences.push(intro);

  if (sectors.length) {
    sentences.push(`Experience spans ${joinHumanList(sectors.slice(0, 4))} environments.`);
  }

  if (cleanedSummaryProject) {
    sentences.push(`Recent project exposure includes ${cleanedSummaryProject}.`);
  }

  if (summarySkills.length) {
    sentences.push(`Key strengths include ${joinHumanList(summarySkills.slice(0, 4))}.`);
  }

  if (qualifications.length) {
    sentences.push(`Qualifications include ${joinHumanList(qualifications.slice(0, 2))}.`);
  }

  return trimString(sentences.join(' '), 950);
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
  const lines = filterClientFacingItems(cleanList(section, 12, 200), 12, 200)
    .filter((line) => !looksLikeDateRange(line) && !isLikelyTemplateArtifact(line) && !isLikelyRoleTitle(line));
  if (lines.length) return lines;

  return filterClientFacingItems(
    splitNonEmptyLines(text).filter((line) => (
      /\b(?:degree|diploma|nvq|gcse|bsc|msc|meng|apprenticeship|certified|certificate|edition|smsts|ipaf|ecs|cscs|dbs|am2)\b/i.test(line)
    )),
    10
  );
}

function collectKeySkills(text) {
  const section = collectHeadingSection(text, ['Key Skills', 'Skills', 'Core Skills', 'Technical Skills', 'Data Centre Skills']);
  const explicit = filterClientFacingItems(
    cleanList(section, 18, 180)
      .flatMap((line) => {
        const cleaned = cleanClientFacingText(line, 180);
        if (!cleaned) return [];
        if (/[;|]/.test(cleaned)) {
          return cleaned.split(/[;|]+/).map((item) => cleanClientFacingText(item, 180)).filter(Boolean);
        }
        const commaParts = cleaned.split(/\s*,\s*/).map((item) => cleanClientFacingText(item, 120)).filter(Boolean);
        const shouldSplitCommaList = commaParts.length >= 3
          && !/[()]/.test(cleaned)
          && commaParts.every((item) => item.split(/\s+/).length <= 4);
        return shouldSplitCommaList ? commaParts : [cleaned];
      })
      .filter((line) => !isLikelyTemplateArtifact(line) && !isLikelyRoleTitle(line) && !/\b(?:eligible to work|passport)\b/i.test(line)),
    12,
    180
  );
  if (explicit.length) return explicit;

  const matches = splitNonEmptyLines(text).filter((line) => (
    !isLikelyRoleTitle(line)
    && /\b(?:coordination|construction|commercial|electrical|containment|testing|commissioning|cost control|project management|contracts|design|health and safety|fault finding|revit|autocad|primavera|negotiation|leadership|budget|mep|csa)\b/i.test(line)
  ));
  return filterClientFacingItems(matches, 10, 180);
}

function collectRelevantProjects(text, jobSpecText, employmentHistory = [], context = {}) {
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
  const primaryRole = trimString(context.primaryRole, 140);
  const historyEvidence = collectProjectEvidenceFromHistory(employmentHistory)
    .filter((item) => !isWeakProjectEvidenceItem(item, primaryRole));
  if (historyEvidence.length >= 2) {
    return historyEvidence.slice(0, 5);
  }
  const lines = splitNonEmptyLines(text).filter((line) => {
    const lower = line.toLowerCase();
    if (line.length > 180) return false;
    if (isLikelyTemplateArtifact(line)) return false;
    if (/\b(?:degree|bsc|msc|certificate|qualification|accreditation|hnc|hnd|edition|training)\b/i.test(line)) return false;
    if (/^[a-z]/.test(line)) return false;
    if (hasConflictingRoleMentions(line, primaryRole)) return false;
    const lineRole = cleanRoleTitle(line);
    if (lineRole && primaryRole && !rolesLookCompatible(lineRole, primaryRole)) return false;
    if (isLikelyRoleTitle(line) && !rolesLookCompatible(line, primaryRole || line)) return false;
    if (/\b(?:eligible to work|passport|qualification|candidate id|hmj global)\b/i.test(line)) return false;
    if (keywords.some((keyword) => lower.includes(keyword))) return true;
    if (roleHint && roleHint.length < 180) {
      const words = roleHint.split(/\s+/).filter((word) => word.length > 4).slice(0, 6);
      return words.some((word) => lower.includes(word));
    }
    return false;
  });
  const summaryEvidence = [];
  (Array.isArray(employmentHistory) ? employmentHistory : []).forEach((entry) => {
    splitIntoSentences(entry?.summary || '').forEach((sentence) => {
      if (sentence.length < 30) return;
      if (!keywords.some((keyword) => sentence.toLowerCase().includes(keyword))) return;
      summaryEvidence.push(sentence);
    });
  });
  return filterClientFacingItems(historyEvidence.concat(lines).concat(summaryEvidence), 5, 220)
    .filter((item) => !isWeakProjectEvidenceItem(item, primaryRole))
    .slice(0, 5);
}

function collectEmploymentHistory(text) {
  const section = collectHeadingSection(text, ['Employment History', 'Experience', 'Professional Experience', 'Career History']);
  const lines = splitNonEmptyLines(section).flatMap((line) => expandEmploymentHistoryLines(line));
  if (!lines.length) return [];

  const entries = [];
  let current = null;
  const pushCurrent = () => {
    if (!current) return;
    entries.push(current);
    current = null;
  };

  lines.forEach((line) => {
    if (isInternalFormatterText(line) || isFooterArtifactText(line) || isLikelyTemplateArtifact(line)) return;
    const normalisedLine = fixCommonExtractionArtifacts(line);
    const inlineEntry = buildInlineEmploymentEntry(normalisedLine, current?.title || '');
    if (inlineEntry) {
      if (
        current
        && current.title
        && !current.company
        && !current.summary
        && !(current.bullets || []).length
        && (!inlineEntry.title || rolesLookCompatible(inlineEntry.title, current.title))
      ) {
        current = {
          ...inlineEntry,
          title: inlineEntry.title || current.title,
        };
      } else {
        pushCurrent();
        current = inlineEntry;
      }
      return;
    }

    const pipeSegments = normalisedLine.split('|').map((part) => trimString(part, 140)).filter(Boolean);
    if (pipeSegments.length >= 2 && looksLikeDateRange(pipeSegments[pipeSegments.length - 1])) {
      pushCurrent();
      current = {
        dates: trimString(pipeSegments[pipeSegments.length - 1], 120),
        title: trimString(cleanRoleTitle(pipeSegments[0]) || normaliseDisplayCapitalisation(pipeSegments[0]), 140),
        company: trimString(pipeSegments.slice(1, -1).join(' | '), 160),
        summary: '',
        bullets: [],
      };
      return;
    }

    if (isLikelyRoleTitle(normalisedLine)) {
      pushCurrent();
      current = {
        dates: '',
        title: trimString(cleanRoleTitle(normalisedLine) || normaliseDisplayCapitalisation(normalisedLine), 140),
        company: '',
        summary: '',
        bullets: [],
      };
      return;
    }

    if (!current) {
      current = {
        dates: '',
        title: cleanRoleTitle(normalisedLine) || '',
        company: '',
        summary: cleanRoleTitle(normalisedLine) ? '' : normalisedLine,
        bullets: [],
      };
      return;
    }

    if (!current.title) {
      current.title = trimString(cleanRoleTitle(normalisedLine) || normaliseDisplayCapitalisation(normalisedLine), 140);
      return;
    }

    if (
      !current.company
      && normalisedLine.length <= 120
      && !/[.:]/.test(normalisedLine)
      && !/[|]/.test(normalisedLine)
      && !isLikelyRoleTitle(normalisedLine)
    ) {
      current.company = normalisedLine;
      return;
    }

    if (/^[•*-]\s*/.test(normalisedLine)) {
      current.bullets.push(cleanClientFacingText(normalisedLine.replace(/^[•*-]\s*/, ''), 220));
      return;
    }

    if (looksLikeActionBullet(normalisedLine)) {
      current.bullets.push(cleanClientFacingText(normalisedLine, 220));
      return;
    }

    current.summary = trimString(fixCommonExtractionArtifacts(`${current.summary} ${normalisedLine}`), 900);
  });
  pushCurrent();

  return normaliseEmploymentEntries(entries)
    .filter((entry) => entry.title || entry.company || entry.summary || entry.bullets.length)
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
    if (looksLikeActionBullet(entry)) return false;
    if (/\b(?:commissioning|delivery|experience|project|manager|engineer|electrician|skills?|qualifications?|summary|profile)\b/i.test(entry)) return false;
    return /^[A-Za-z][A-Za-z\s,.'-]{1,60}$/.test(entry);
  }) || '';
  return sanitizeLocation(line, anonymiseMode);
}

function resolveCandidateIdentity({ explicitName = '', guessedName = '', rawLocation = '', text = '', role = '', anonymiseMode = DEFAULT_FORMAT_OPTIONS.anonymiseMode } = {}) {
  const displayName = cleanCandidateDisplayName(explicitName)
    || cleanCandidateDisplayName(guessedName)
    || cleanCandidateDisplayName(rawLocation)
    || cleanCandidateDisplayName(findLineAfterLabel(text, ['Name', 'Candidate Name']));

  let location = sanitizeLocation(rawLocation, anonymiseMode);
  if (displayName && location && normaliseComparableText(displayName) === normaliseComparableText(location)) {
    location = '';
  }
  if (location && isLikelyPersonName(location)) {
    location = '';
  }
  if (!location) {
    const inferred = guessFallbackLocation(text, {
      candidateName: displayName,
      role,
      anonymiseMode,
    });
    if (inferred && !isLikelyPersonName(inferred)) {
      location = inferred;
    }
  }

  return {
    candidateName: displayName,
    location: trimString(location, 120),
  };
}

function cleanEmploymentSummary(value, entry = {}) {
  let text = cleanClientFacingText(value, 700);
  if (!text) return '';

  const title = trimString(entry.title, 140);
  if (title && normaliseComparableText(text).startsWith(normaliseComparableText(title))) {
    text = trimString(text.slice(title.length), 700);
  }

  const currentDate = extractDateRangeFromText(entry.dates || entry.company || '');
  const allRanges = Array.from(text.matchAll(/\b(?:\d{1,2}\s*\/\s*)?\d{2,4}\s*(?:[–-]|to)\s*(?:present|(?:\d{1,2}\s*\/\s*)?\d{2,4})\b/gi)).map((match) => trimString(match[0], 120));
  if (allRanges.length > 1) {
    const firstForeignRange = allRanges.find((range) => normaliseComparableText(range) !== normaliseComparableText(currentDate));
    if (firstForeignRange) {
      const index = text.toLowerCase().indexOf(firstForeignRange.toLowerCase());
      if (index > 0) {
        text = trimString(text.slice(0, index), 700);
      }
    }
  }

  text = text
    .replace(/\b(?:candidate id|hmj global|client-ready candidate profile|candidate profile)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (text.split(/\s+/).length < 4) {
    return '';
  }

  return trimString(text, 700);
}

function normaliseEmploymentEntries(entries) {
  return dedupeEmploymentHistory(
    (Array.isArray(entries) ? entries : []).map((entry) => {
      let title = trimString(cleanRoleTitle(entry?.title) || normaliseDisplayCapitalisation(cleanClientFacingText(entry?.title, 140)), 140);
      let company = trimString(cleanClientFacingText(entry?.company, 180), 180);
      let dates = extractDateRangeFromText(entry?.dates) || trimString(entry?.dates, 120) || extractDateRangeFromText(company);
      let summary = cleanEmploymentSummary(entry?.summary, { title, company, dates });

      if (dates && company) {
        company = removeDateRangeFromText(company, dates);
      }
      if (!dates && summary) {
        dates = extractDateRangeFromText(summary);
        if (dates) {
          summary = cleanEmploymentSummary(removeDateRangeFromText(summary, dates), { title, company, dates });
        }
      }

      if (!company && summary && summary.length <= 120 && !/[.]/.test(summary)) {
        company = summary;
        summary = '';
      }

      const bullets = filterClientFacingItems((entry?.bullets || []).map((item) => polishEmploymentBullet(item)), 4, 220)
        .filter((item) => normaliseComparableText(item) !== normaliseComparableText(summary))
        .filter((item) => !looksLikeDateRange(item))
        .filter((item) => !cleanRoleTitle(item))
        .filter((item) => item.split(/\s+/).length >= 3);

      return {
        dates: trimString(dates, 120),
        title,
        company: trimString(company, 160),
        summary,
        bullets,
      };
    })
      .filter((entry) => entry.title || entry.company || entry.summary || entry.bullets.length)
  );
}

function redactPersonalIdentifiers(value, context = {}) {
  let text = trimString(value);
  if (!text) return '';
  const protectedDateRanges = [];

  const candidateName = trimString(context.candidateName);
  const candidateReference = trimString(context.candidateReference);
  const anonymiseMode = normaliseEnum(
    context?.formatOptions?.anonymiseMode || context?.anonymiseMode,
    ANONYMISE_MODES,
    DEFAULT_FORMAT_OPTIONS.anonymiseMode
  );

  text = text.replace(
    /\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+)?\d{4}\s*(?:[–-]|to)\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+)?(?:present|\d{4})\b/gi,
    (match) => {
      const token = `__HMJ_DATE_RANGE_${protectedDateRanges.length}__`;
      protectedDateRanges.push(match);
      return token;
    }
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
    .replace(/\b(?:passport|national insurance|ni number|national id|driving licence number)\b[:\s-]*[A-Z0-9 -]{4,}\b/gi, '')
    .replace(/\b[A-Za-z]+\s+passport\b/gi, '')
    .replace(/\b(?:eligible|right)\s+to\s+work\b[^,.;\n]*/gi, '');

  if (anonymiseMode === 'strict') {
    text = text
      .replace(/\b(?:mr|mrs|ms|miss|dr)\.?\s+/gi, '')
      .replace(/\b(?:address|located at|based at)\b[:\s-]*[^,.;\n]+/gi, '');
  }

  text = text.replace(/__HMJ_DATE_RANGE_(\d+)__/g, (_match, index) => protectedDateRanges[Number(index)] || '');

  text = text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/^[,;\s]+|[,;\s]+$/g, '')
    .trim();

  return trimString(text, 1400);
}

function sanitiseStructuredProfile(raw, context = {}) {
  const formatOptions = normaliseFormatOptions(context.formatOptions);
  const identity = resolveCandidateIdentity({
    explicitName: formatOptions.candidateDisplayName || raw?.candidate_name || context.candidateName,
    guessedName: context.candidateName,
    rawLocation: raw?.sanitized_location || raw?.location,
    role: raw?.target_role || raw?.display_title || context.jobSpecRole || context.fileRole,
    text: `${trimString(raw?.profile, 600)}\n${(Array.isArray(raw?.employment_history) ? raw.employment_history : []).map((entry) => `${entry?.title || ''} ${entry?.company || ''} ${entry?.summary || ''}`).join('\n')}`,
    anonymiseMode: formatOptions.anonymiseMode,
  });
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
  const location = trimString(identity.location, 120);
  const profile = cleanClientFacingText(
    redactPersonalIdentifiers(trimString(raw?.profile, 1800), { ...context, formatOptions }),
    1800
  );

  const redactions = uniqueStrings(
    cleanList(raw?.redactions_applied, 10, 180).concat([
      'Direct contact details removed.',
      'DOB and precise postcode removed where detected.',
      formatOptions.anonymiseMode === 'strict' ? 'Strict anonymisation mode applied to titles and address-style references.' : '',
    ]),
    8
  );

  return {
    candidateName: identity.candidateName,
    candidateReference,
    targetRole: trimString(targetRole || context.fileRole || 'Client-Ready Candidate Profile', 140),
    location,
    interviewAvailability: redactPersonalIdentifiers(trimString(raw?.interview_availability || raw?.availability, 120), { ...context, formatOptions }),
    languages: filterClientFacingItems(toArray(raw?.languages).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 6, 120),
    profile,
    roleAlignment: [],
    relevantProjects: filterClientFacingItems(toArray(raw?.relevant_projects).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 5, 220),
    keySkills: filterClientFacingItems(toArray(raw?.key_skills).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 10, 180),
    qualifications: filterClientFacingItems(toArray(raw?.qualifications).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 8, 180),
    accreditations: filterClientFacingItems(toArray(raw?.accreditations).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 6, 180),
    employmentHistory: normaliseEmploymentEntries((Array.isArray(raw?.employment_history) ? raw.employment_history : [])
      .map((entry) => ({
        dates: redactPersonalIdentifiers(trimString(entry?.dates, 120), { ...context, formatOptions }),
        title: redactPersonalIdentifiers(trimString(entry?.title, 140), { ...context, formatOptions }),
        company: redactPersonalIdentifiers(trimString(entry?.company, 160), { ...context, formatOptions }),
        summary: redactPersonalIdentifiers(trimString(entry?.summary, 900), { ...context, formatOptions }),
        bullets: filterClientFacingItems((entry?.bullets || []).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 4, 220),
      }))
      .map((entry) => ({
        dates: cleanClientFacingText(entry.dates, 120),
        title: trimString(cleanRoleTitle(entry.title) || cleanClientFacingText(entry.title, 140), 140),
        company: cleanClientFacingText(entry.company, 160),
        summary: cleanClientFacingText(entry.summary, 700),
        bullets: filterClientFacingItems(entry.bullets, 4, 220),
      }))).slice(0, 8),
    additionalInformation: filterClientFacingItems(toArray(raw?.additional_information).map((value) => redactPersonalIdentifiers(value, { ...context, formatOptions })), 6, 180),
    redactionsApplied: redactions,
    warnings: cleanList(raw?.warnings, 8, 220),
  };
}

function finaliseStructuredProfile(profile, context = {}) {
  const formatOptions = normaliseFormatOptions(context.formatOptions);
  const recentEmploymentHistory = selectRecentEmploymentHistory(profile.employmentHistory, RECENT_HISTORY_WINDOW_YEARS);
  const primaryRole = trimString(
    cleanRoleTitle(formatOptions.targetRoleOverride)
      || cleanRoleTitle(profile.targetRole)
      || derivePrimaryRole({
        text: [
          profile.targetRole,
          profile.profile,
          ...(profile.keySkills || []),
          ...(profile.relevantProjects || []),
        ].join('\n'),
        employmentHistory: recentEmploymentHistory,
        fileRole: context.fileRole,
        jobSpecRole: context.jobSpecRole,
        targetRoleOverride: formatOptions.targetRoleOverride,
      })
      || profile.targetRole,
    140
  );
  const evidenceText = [
    profile.profile,
    ...(profile.relevantProjects || []),
    ...(profile.keySkills || []),
    ...recentEmploymentHistory.map((entry) => `${entry.title} ${entry.summary}`),
  ].join('\n');
  const relevantProjects = prioritiseItemsForClientOutput(
    []
      .concat(profile.relevantProjects || [])
      .concat(collectProjectEvidenceFromHistory(recentEmploymentHistory)),
    {
      jobSpecText: context.jobSpecText,
      primaryRole,
      tailoringMode: formatOptions.tailoringMode,
      maxItems: 5,
    }
  ).filter((item) => !isWeakProjectEvidenceItem(item, primaryRole)).slice(0, 5);
  const keySkills = prioritiseItemsForClientOutput(profile.keySkills, {
    jobSpecText: context.jobSpecText,
    primaryRole,
    tailoringMode: formatOptions.tailoringMode,
    maxItems: formatOptions.templatePreset === 'executive_summary' ? 8 : 10,
  });
  const qualifications = filterClientFacingItems(profile.qualifications, 8, 180);
  const accreditations = filterClientFacingItems(profile.accreditations, 6, 180)
    .filter((item) => !qualifications.some((existing) => normaliseComparableText(existing) === normaliseComparableText(item)));
  const candidateName = cleanCandidateDisplayName(formatOptions.candidateDisplayName || profile.candidateName || context.candidateName);
  const location = (
    candidateName && normaliseComparableText(candidateName) === normaliseComparableText(profile.location)
      ? ''
      : sanitizeLocation(profile.location, formatOptions.anonymiseMode)
  );
  const rebuiltSummary = refineClientFacingSummary(profile.profile, {
    role: primaryRole,
    location,
    yearsExperience: estimateYearsExperience(evidenceText, recentEmploymentHistory),
    sectors: collectSectorHints(evidenceText),
    keySkills,
    qualifications: qualifications.concat(accreditations),
    relevantProjects,
  });

  return {
    ...profile,
    candidateName,
    targetRole: primaryRole || profile.targetRole,
    location,
    profile: rebuiltSummary,
    keySkills,
    relevantProjects,
    qualifications,
    accreditations,
    employmentHistory: normaliseEmploymentEntries(recentEmploymentHistory),
    additionalInformation: filterClientFacingItems(profile.additionalInformation, 6, 180)
      .filter((item) => isUsefulAdditionalInformationItem(item))
      .slice(0, 4),
    roleAlignment: trimString(context.jobSpecText) ? prioritiseItemsForClientOutput(profile.roleAlignment, {
      jobSpecText: context.jobSpecText,
      primaryRole,
      tailoringMode: formatOptions.tailoringMode,
      maxItems: 4,
    }) : [],
    warnings: uniqueStrings(profile.warnings, 8),
  };
}

function buildFallbackProfile({ candidateText, jobSpecText, candidateFileName, options = {} }) {
  const formatOptions = normaliseFormatOptions(options);
  const preparedCandidateText = prepareSourceTextForFormatting(candidateText);
  const guessedCandidateName = guessCandidateName(candidateFileName, preparedCandidateText);
  const candidateReference = generateCandidateReference(candidateFileName, preparedCandidateText);
  const rawPosition = findLineAfterLabel(preparedCandidateText, ['Position', 'Role', 'Title']);
  const rawCandidateId = findLineAfterLabel(preparedCandidateText, ['Candidate ID']);
  const fileRole = (
    rawPosition
      && guessedCandidateName
      && trimString(rawPosition).toLowerCase() === trimString(guessedCandidateName).toLowerCase()
      && rawCandidateId
      && trimString(rawCandidateId).toLowerCase() !== trimString(guessedCandidateName).toLowerCase()
  ) ? rawCandidateId : rawPosition;
  const jobSpecRole = cleanRoleTitle(buildRoleHints(jobSpecText)) || buildRoleHints(jobSpecText);
  const rawLocation = findLineAfterLabel(preparedCandidateText, ['Location', 'Based', 'Address']);
  const rawAvailability = findLineAfterLabel(preparedCandidateText, ['Availability to Interview', 'Availability']);
  const inferredRole = splitNonEmptyLines(preparedCandidateText).find((line) => {
    const lower = line.toLowerCase();
    if (!isLikelyRoleTitle(line)) return false;
    if (guessedCandidateName && lower === trimString(guessedCandidateName).toLowerCase()) return false;
    return true;
  }) || '';
  const employmentHistory = normaliseEmploymentEntries(collectEmploymentHistory(preparedCandidateText));
  const dominantRole = derivePrimaryRole({
    text: preparedCandidateText,
    employmentHistory,
    fileRole: fileRole || rawPosition || inferredRole,
    jobSpecRole,
    targetRoleOverride: formatOptions.targetRoleOverride,
  });
  const targetRole = trimString(
    dominantRole
      || cleanRoleTitle(formatOptions.targetRoleOverride)
      || formatOptions.targetRoleOverride
      || cleanRoleTitle(fileRole)
      || fileRole
      || guessedCandidateName
      || fileBaseName(candidateFileName),
    140
  );
  const profileRole = trimString(cleanRoleTitle(dominantRole || fileRole || rawPosition || inferredRole || targetRole) || dominantRole || fileRole || rawPosition || inferredRole || targetRole, 140);
  const identity = resolveCandidateIdentity({
    explicitName: formatOptions.candidateDisplayName,
    guessedName: guessedCandidateName,
    rawLocation,
    text: preparedCandidateText,
    role: profileRole,
    anonymiseMode: formatOptions.anonymiseMode,
  });
  const candidateName = identity.candidateName;
  const displayLocation = trimString(identity.location, 120);
  const safeAvailability = (
    !rawAvailability
      || isLikelyTemplateArtifact(rawAvailability)
      || trimString(rawAvailability).toLowerCase() === trimString(candidateReference).toLowerCase()
      || (candidateName && trimString(rawAvailability).toLowerCase() === trimString(candidateName).toLowerCase())
  ) ? '' : trimString(rawAvailability, 120);
  const recentEmploymentHistory = selectRecentEmploymentHistory(employmentHistory, RECENT_HISTORY_WINDOW_YEARS);
  const qualifications = collectQualifications(preparedCandidateText);
  const keySkills = collectKeySkills(preparedCandidateText);
  const relevantProjects = collectRelevantProjects(preparedCandidateText, jobSpecText, recentEmploymentHistory, {
    primaryRole: profileRole,
  });
  const yearsExperience = estimateYearsExperience(preparedCandidateText, employmentHistory);
  const sectors = collectSectorHints(preparedCandidateText);

  return finaliseStructuredProfile(sanitiseStructuredProfile({
    candidate_name: candidateName,
    target_role: targetRole,
    sanitized_location: displayLocation,
    interview_availability: safeAvailability,
    languages: collectLanguages(preparedCandidateText),
    profile: fallbackProfileParagraph(preparedCandidateText, {
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
      candidateText: preparedCandidateText,
      jobSpecText,
      keySkills,
      relevantProjects,
    }),
    relevant_projects: relevantProjects,
    key_skills: keySkills,
    qualifications,
    accreditations: qualifications.filter((line) => /\b(?:ipaf|smsts|ecs|cscs|dbs|edition|certified|certificate|licensed|card)\b/i.test(line)),
    employment_history: recentEmploymentHistory,
    additional_information: uniqueStrings(
      filterClientFacingItems(cleanList(collectHeadingSection(preparedCandidateText, ['Additional Information']), 6, 180), 6, 180)
        .concat(collectAdditionalInformation(preparedCandidateText)),
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
  }), {
    jobSpecText,
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
      'candidate_name',
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
      candidate_name: { type: 'string' },
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
              'Transform recruiter-uploaded CV content into a polished, premium, client-ready candidate submission pack.',
              'Use only facts present in the supplied CV and optional job specification.',
              'Do not invent projects, employers, dates, qualifications, clearances, languages, or sector experience.',
              'Choose one credible primary role only. If the uploaded brief conflicts with the candidate evidence, prefer the candidate evidence and keep the output commercially honest.',
              'If the candidate lacks a requirement in the job spec, keep the wording adjacent and transferable rather than overstating fit.',
              'Remove or generalise direct personal identifiers: email, phone, street address, full postcode, LinkedIn URLs, DOB, passport or ID numbers.',
              'Keep the candidate name only in candidate_name if it is confidently available from the source. Do not repeat direct contact details anywhere.',
              'Do not place the candidate name inside location fields or metadata labels.',
              'Keep company and project history unless it is a direct personal identifier.',
              'Prefer concise recruiter-grade wording and keep chronology faithful to the source.',
              'Do not include internal system notes, processing commentary, confidence explanations, or recruiter-only instructions in any client-facing field.',
              'Do not repeat the target role phrase unnecessarily, and do not merge content from conflicting roles into one narrative.',
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
              '- candidate_name: exact candidate name only when confidently available from the source; otherwise leave blank.',
              '- target_role: short role title for the output, grounded in the candidate evidence.',
              '- sanitized_location: keep city, region, or country only.',
              '- interview_availability: only if explicitly available from the source; otherwise leave blank.',
              '- profile: one polished paragraph, 80 to 130 words, written for a client and easy to scan.',
              '- role_alignment: 2 to 4 bullets only if a job spec was uploaded; otherwise return an empty array.',
              '- relevant_projects: 3 to 5 concise bullets focused on the strongest matching recent projects or experience.',
              '- key_skills: 6 to 10 concise recruiter-facing bullets with no duplication.',
              '- qualifications and accreditations: factual lists only.',
              '- employment_history: prioritise the most recent five years when that history is available, keep it recent-first, and use concise summaries with no fabricated detail.',
              '- redactions_applied: explain what personal details were removed or generalised.',
              '- warnings: list important source limitations only; do not use warnings for stylistic or system commentary.',
              '- Never include formatting notes, processing notes, or phrases such as "content emphasis has been tuned" or "all statements remain grounded".',
              '- Never output headings or labels such as "Candidate profile" or "Client-ready candidate profile".',
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
    let message = trimString(best?.error) || matcherCore.summariseNoReadableTextFailure(extracted.documents);
    if (trimString(best?.failureCode) === 'docx_no_text' && trimString(best?.extension).toLowerCase() === 'docx') {
      message = 'This Word file contains no readable body text. It appears to be an image/template-based document rather than a candidate CV or job spec.';
    }
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
    children: [
      new TextRun({
        text: trimString(text),
        font: BRAND_FONT,
        color: BRAND_TEXT_COLOR,
        size: 22,
      }),
    ],
    bullet: { level: Number(indentLevel) || 0 },
    spacing: { after: 70, line: 285 },
    indent: { left: 240, hanging: 120 },
    keepLines: true,
  });
}

function textParagraph(text, options = {}) {
  return new Paragraph({
    children: [
      new TextRun({
        text: trimString(text),
        bold: options.bold === true,
        italics: options.italics === true,
        color: options.color || BRAND_TEXT_COLOR,
        font: options.font || BRAND_FONT,
        size: options.size || 24,
      }),
    ],
    alignment: options.alignment || AlignmentType.LEFT,
    spacing: options.spacing || { after: 120, line: 320 },
    indent: options.indent,
    keepNext: options.keepNext === true,
    keepLines: options.keepLines === true,
  });
}

function labelledCellParagraph(text, { bold = false } = {}) {
  return new Paragraph({
    children: [
      new TextRun({
        text: trimString(text),
        bold,
        color: BRAND_TEXT_COLOR,
        font: BRAND_FONT,
        size: 24,
      }),
    ],
    spacing: { after: 80, line: 300 },
  });
}

function tableBorders() {
  return {
    top: { style: BorderStyle.SINGLE, color: BRAND_BORDER_COLOR, size: 2 },
    bottom: { style: BorderStyle.SINGLE, color: BRAND_BORDER_COLOR, size: 2 },
    left: { style: BorderStyle.SINGLE, color: BRAND_BORDER_COLOR, size: 2 },
    right: { style: BorderStyle.SINGLE, color: BRAND_BORDER_COLOR, size: 2 },
    insideHorizontal: { style: BorderStyle.SINGLE, color: BRAND_BORDER_COLOR, size: 1 },
    insideVertical: { style: BorderStyle.SINGLE, color: BRAND_BORDER_COLOR, size: 1 },
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
    columnWidths: [3200, 7200],
    layout: TableLayoutType.FIXED,
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
        color: BRAND_PRIMARY_COLOR,
        font: BRAND_HEADING_FONT,
        size: 30,
      }),
    ],
    spacing: { before: 220, after: 80 },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        color: BRAND_BORDER_COLOR,
        size: 3,
      },
    },
    keepNext: true,
    keepLines: true,
  });
}

function loadLogoBuffer() {
  const candidates = [
    PREMIUM_LOGO_PATH,
    TEMPLATE_LOGO_PATH,
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

function loadHeaderBandBuffer() {
  if (fs.existsSync(PREMIUM_HEADER_BAND_PATH)) {
    return fs.readFileSync(PREMIUM_HEADER_BAND_PATH);
  }
  return null;
}

function createBrandedHeader(logoBuffer) {
  const children = [];
  if (logoBuffer) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 0 },
        children: [
          new ImageRun({
            data: logoBuffer,
            type: BRAND_LOGO_IMAGE_TYPE,
            docProperties: {
              id: '101',
              name: 'HMJHeaderLogo',
              description: 'HMJ Global header logo',
            },
            transformation: { width: 98, height: 38 },
          }),
        ],
      })
    );
  }
  return new Header({ children });
}

function createBrandedFooter() {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 50, after: 0 },
      border: {
        top: {
          style: BorderStyle.SINGLE,
          color: BRAND_BORDER_COLOR,
          size: 2,
        },
      },
      children: [
        new ExternalHyperlink({
          link: `mailto:${HMJ_CONTACT_EMAIL}`,
          children: [
            new TextRun({
              text: HMJ_CONTACT_EMAIL,
              style: 'Hyperlink',
              font: BRAND_FONT,
              size: 15,
            }),
          ],
        }),
        new TextRun({
          text: '  |  ',
          color: BRAND_MUTED_COLOR,
          font: BRAND_FONT,
          size: 15,
        }),
        new TextRun({
          text: HMJ_CONTACT_PHONE,
          color: BRAND_MUTED_COLOR,
          font: BRAND_FONT,
          size: 15,
        }),
        new TextRun({
          text: '  |  ',
          color: BRAND_MUTED_COLOR,
          font: BRAND_FONT,
          size: 15,
        }),
        new ExternalHyperlink({
          link: HMJ_WEBSITE_URL,
          children: [
            new TextRun({
              text: 'www.HMJ-Global.com',
              style: 'Hyperlink',
              font: BRAND_FONT,
              size: 15,
            }),
          ],
        }),
      ],
    }),
  ];
  return new Footer({ children });
}

function safeFileNameToken(value, fallback = 'Client Ready CV', maxLength = 60) {
  const cleaned = trimString(value || fallback)
    .replace(/[^\w\s-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return trimString(cleaned || fallback, maxLength);
}

function appendBulletSection(children, title, items, maxItems) {
  const safeItems = filterClientFacingItems(items, maxItems || 10, 220);
  if (!safeItems.length) return;
  children.push(sectionHeading(title));
  safeItems.forEach((item) => children.push(bulletParagraph(item, 0)));
}

function appendEmploymentHistorySection(children, entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  children.push(sectionHeading('Employment History'));
  entries.forEach((entry) => {
    if (entry.title) {
      children.push(textParagraph(entry.title, {
        bold: true,
        size: 25,
        spacing: { before: 90, after: 24 },
        keepNext: true,
        keepLines: true,
      }));
    }
    const metaLine = [trimString(entry.company, 160), trimString(entry.dates, 120)].filter(Boolean).join(' | ');
    if (metaLine) {
      children.push(textParagraph(metaLine, {
        color: BRAND_PRIMARY_COLOR,
        size: 18,
        spacing: { after: 45 },
        keepNext: true,
      }));
    }
    if (entry.summary) {
      children.push(textParagraph(entry.summary, {
        size: 22,
        spacing: { after: 55, line: 305 },
      }));
    }
    entry.bullets.forEach((item) => children.push(bulletParagraph(item, 0)));
  });
}

function appendQualificationsSection(children, profile) {
  const items = filterClientFacingItems([].concat(profile.qualifications || [], profile.accreditations || []), 8, 180);
  if (!items.length) return;
  children.push(sectionHeading('Qualifications & Certifications'));
  items.forEach((item) => children.push(bulletParagraph(item, 0)));
}

function buildCandidateSubtitle(profile) {
  const subtitleParts = [];
  if ((profile.keySkills || []).some((item) => /\bqa\/?qc|qaqc|quality\b/i.test(item))) {
    subtitleParts.push('Electrical QA/QC');
  }
  if ((profile.keySkills || []).some((item) => /\bcommission/i.test(item))) {
    subtitleParts.push('Commissioning');
  }
  if ((profile.relevantProjects || []).some((item) => /\bdata cent(?:re|er)|mission critical\b/i.test(item))) {
    subtitleParts.push('Data Centre');
  }
  if ((profile.relevantProjects || []).some((item) => /\bpharma|pharmaceutical|cleanroom\b/i.test(item))) {
    subtitleParts.push('Pharma');
  }
  if (
    (profile.keySkills || []).some((item) => /\belectrical\b/i.test(item))
    && !subtitleParts.some((item) => /electrical qa\/qc/i.test(item))
  ) {
    subtitleParts.unshift('Electrical');
  }
  return uniqueStrings(subtitleParts, 4).join(' / ');
}

function premiumDividerParagraph() {
  return new Paragraph({
    spacing: { before: 40, after: 140 },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        color: BRAND_BORDER_COLOR,
        size: 3,
      },
    },
  });
}

function buildHeaderChildren(profile, options = {}) {
  const formatOptions = normaliseFormatOptions(options);
  const children = [];
  if (formatOptions.templatePreset === 'premium_candidate_pack') {
    const headerBandBuffer = loadHeaderBandBuffer();
    const logoBuffer = loadLogoBuffer();
    if (headerBandBuffer) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 210 },
        children: [
          new ImageRun({
            data: headerBandBuffer,
            type: BRAND_LOGO_IMAGE_TYPE,
            docProperties: {
              id: '201',
              name: 'HMJPremiumHeaderBand',
              description: 'HMJ branded premium header band',
            },
            transformation: { width: 620, height: 122 },
          }),
        ],
      }));
    } else if (logoBuffer) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 180 },
        children: [
          new ImageRun({
            data: logoBuffer,
            type: BRAND_LOGO_IMAGE_TYPE,
            docProperties: {
              id: '202',
              name: 'HMJPremiumLogo',
              description: 'HMJ Global logo',
            },
            transformation: { width: 205, height: 72 },
          }),
        ],
      }));
    }

    if (profile.candidateName) {
      children.push(textParagraph(profile.candidateName.toUpperCase(), {
        alignment: AlignmentType.CENTER,
        bold: true,
        font: BRAND_HEADING_FONT,
        color: BRAND_PRIMARY_COLOR,
        size: 40,
        spacing: { after: 45, line: 360 },
        keepNext: true,
      }));
    }

    children.push(textParagraph(profile.targetRole, {
      alignment: AlignmentType.CENTER,
      bold: true,
      font: BRAND_HEADING_FONT,
      color: BRAND_TEXT_COLOR,
      size: 28,
      spacing: { after: 40, line: 340 },
      keepNext: true,
    }));

    const subtitle = buildCandidateSubtitle(profile);
    if (subtitle) {
      children.push(textParagraph(subtitle, {
        alignment: AlignmentType.CENTER,
        color: BRAND_MUTED_COLOR,
        size: 18,
        spacing: { after: 65 },
        keepNext: true,
      }));
    }

    const premiumMeta = [
      profile.location,
      profile.interviewAvailability,
    ].filter(Boolean).join('   |   ');
    if (premiumMeta) {
      children.push(textParagraph(premiumMeta, {
        alignment: AlignmentType.CENTER,
        color: BRAND_MUTED_COLOR,
        size: 17,
        spacing: { after: 115 },
        keepNext: true,
      }));
    }

    children.push(premiumDividerParagraph());
    return children;
  }

  if (formatOptions.coverPageMode !== 'skip') {
    children.push(textParagraph('Candidate profile', {
      bold: true,
      color: BRAND_PRIMARY_COLOR,
      size: 16,
      spacing: { after: 30 },
    }));
  }
  children.push(
    textParagraph(profile.targetRole, {
      bold: true,
      font: BRAND_HEADING_FONT,
      color: BRAND_PRIMARY_COLOR,
      size: 34,
      spacing: { after: 70 },
    })
  );
  children.push(
    textParagraph(
      [
        `Candidate ID: ${profile.candidateReference}`,
        profile.location ? `Location: ${profile.location}` : '',
      ].filter(Boolean).join('   |   '),
      {
        color: BRAND_PRIMARY_COLOR,
        size: 18,
        spacing: { after: 180 },
      }
    )
  );

  if (formatOptions.coverPageMode === 'full') {
    const snapshot = filterClientFacingItems(
      []
        .concat(profile.keySkills || [])
        .concat(profile.relevantProjects || [])
        .concat(profile.qualifications || []),
      4,
      180
    );
    if (snapshot.length) {
      children.push(sectionHeading('Snapshot'));
      snapshot.forEach((item) => children.push(bulletParagraph(item, 0)));
    }
  }

  return children;
}

function applyTemplateSections(children, profile, options = {}) {
  const formatOptions = normaliseFormatOptions(options);
  const sectionPlans = {
    premium_candidate_pack: [
      () => children.push(sectionHeading('Executive Summary')),
      () => children.push(textParagraph(profile.profile, { size: 23, spacing: { after: 135, line: 320 } })),
      () => appendBulletSection(children, 'Core Strengths', profile.keySkills, 8),
      () => appendBulletSection(children, 'Key Project Experience', profile.relevantProjects, 5),
      () => appendEmploymentHistorySection(children, profile.employmentHistory),
      () => appendQualificationsSection(children, profile),
    ],
    recruiter_standard: [
      () => children.push(sectionHeading('Profile Summary')),
      () => children.push(textParagraph(profile.profile, { size: 24, spacing: { after: 160, line: 340 } })),
      () => appendBulletSection(children, 'Key Skills', profile.keySkills, 10),
      () => appendBulletSection(children, 'Project Experience', profile.relevantProjects, 5),
      () => appendEmploymentHistorySection(children, profile.employmentHistory),
      () => appendQualificationsSection(children, profile),
    ],
    data_centre_priority: [
      () => children.push(sectionHeading('Profile Summary')),
      () => children.push(textParagraph(profile.profile, { size: 24, spacing: { after: 160, line: 340 } })),
      () => appendBulletSection(children, 'Project Experience', profile.relevantProjects, 5),
      () => appendBulletSection(children, 'Key Skills', profile.keySkills, 10),
      () => appendEmploymentHistorySection(children, profile.employmentHistory),
      () => appendQualificationsSection(children, profile),
    ],
    executive_summary: [
      () => children.push(sectionHeading('Profile Summary')),
      () => children.push(textParagraph(profile.profile, { size: 24, spacing: { after: 160, line: 340 } })),
      () => appendBulletSection(children, 'Key Skills', profile.keySkills, 8),
      () => appendBulletSection(children, 'Project Experience', profile.relevantProjects, 4),
      () => appendEmploymentHistorySection(children, profile.employmentHistory),
      () => appendQualificationsSection(children, profile),
    ],
  };

  (sectionPlans[formatOptions.templatePreset] || sectionPlans.recruiter_standard).forEach((runSection) => runSection());

  if (formatOptions.includeAdditionalInformation) {
    appendBulletSection(children, 'Additional Information', profile.additionalInformation, 6);
  }
}

async function buildClientReadyDocx(profile, options = {}) {
  const formatOptions = normaliseFormatOptions(options);
  const logoBuffer = loadLogoBuffer();
  const defaultHeader = formatOptions.templatePreset === 'premium_candidate_pack'
    ? new Header({ children: [] })
    : createBrandedHeader(logoBuffer);
  const defaultFooter = createBrandedFooter();
  const sectionChildren = buildHeaderChildren(profile, formatOptions);
  applyTemplateSections(sectionChildren, profile, formatOptions);

  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: BRAND_FONT,
            color: BRAND_TEXT_COLOR,
            size: 24,
          },
          paragraph: {},
        },
        title: {
          run: {
            font: BRAND_HEADING_FONT,
            color: BRAND_PRIMARY_COLOR,
            size: 40,
          },
        },
        heading1: {
          run: {
            font: BRAND_HEADING_FONT,
            color: BRAND_PRIMARY_COLOR,
            size: 40,
          },
        },
        heading2: {
          run: {
            font: BRAND_HEADING_FONT,
            color: BRAND_PRIMARY_COLOR,
            size: 32,
          },
        },
        heading3: {
          run: {
            font: BRAND_HEADING_FONT,
            color: BRAND_PRIMARY_COLOR,
            size: 28,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: TEMPLATE_PAGE_MARGINS,
          },
        },
        headers: { default: defaultHeader },
        footers: { default: defaultFooter },
        children: sectionChildren,
      },
    ],
  });
  return Packer.toBuffer(document);
}

function extractWordTextFromXml(xml) {
  const text = String(xml || '')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');
  return trimString(text, 12000);
}

async function buildDocxVerificationSnapshot(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml').async('string');
  const headerNames = Object.keys(zip.files).filter((name) => /^word\/header\d+\.xml$/.test(name));
  const footerNames = Object.keys(zip.files).filter((name) => /^word\/footer\d+\.xml$/.test(name));
  const headerXml = (await Promise.all(headerNames.map((name) => zip.file(name).async('string')))).join('\n');
  const footerXml = (await Promise.all(footerNames.map((name) => zip.file(name).async('string')))).join('\n');
  const documentText = extractWordTextFromXml(documentXml);
  const headerText = extractWordTextFromXml(headerXml);
  const footerText = extractWordTextFromXml(footerXml);
  const mediaNames = Object.keys(zip.files).filter((name) => name.startsWith('word/media/') && !zip.files[name].dir);

  return {
    documentXml,
    headerXml,
    footerXml,
    documentText,
    headerText,
    footerText,
    mediaNames,
    hasPremiumHeaderBand: mediaNames.length > 0 && /<w:drawing>/.test(documentXml),
    hasLogoImage: mediaNames.length > 0 || /<w:drawing>/.test(headerXml),
    headingSequence: [
      'Executive Summary',
      'Core Strengths',
      'Key Project Experience',
      'Employment History',
      'Qualifications & Certifications',
      'Additional Information',
      'Profile Summary',
      'Key Skills',
      'Project Experience',
      'Qualifications',
    ].filter((heading) => documentText.includes(heading)),
  };
}

function buildVerifierSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'outcome',
      'confidence_score',
      'professionalism_score',
      'reasons',
      'remediation_suggestions',
    ],
    properties: {
      outcome: {
        type: 'string',
        enum: ['pass', 'fail'],
      },
      confidence_score: { type: 'number' },
      professionalism_score: { type: 'number' },
      reasons: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      remediation_suggestions: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    },
  };
}

function validateVerifierResultAgainstSchema(result) {
  const schema = buildVerifierSchema();
  return validateJsonValueAgainstSchema(result, schema, {
    rootSchema: schema,
    path: '$',
  });
}

function parseOpenAiVerifierResponse(payload, options = {}) {
  const extracted = extractOpenAIOutput(payload);
  const responseStatus = trimString(payload?.status).toLowerCase();
  const incompleteReason = trimString(payload?.incomplete_details?.reason);
  const baseSummary = summariseOpenAiFormatterResponse(payload, extracted, options);

  if (responseStatus === 'incomplete') {
    throw coded(502, `OpenAI returned incomplete verifier output${incompleteReason ? ` (${incompleteReason})` : ''}.`, 'openai_incomplete_output', {
      details: {
        stage: 'openai',
        parse_stage: 'incomplete',
        ...baseSummary,
        schema_name: FORMATTER_VERIFIER_SCHEMA_NAME,
      },
    });
  }
  if (extracted.refusals.length) {
    throw coded(502, 'OpenAI refused to review the premium candidate pack.', 'openai_refusal', {
      details: {
        stage: 'openai',
        parse_stage: 'refusal',
        ...baseSummary,
        schema_name: FORMATTER_VERIFIER_SCHEMA_NAME,
      },
    });
  }
  const parsed = parseFormatterJsonText(extracted.text);
  if (!parsed) {
    throw coded(502, 'OpenAI returned verifier output that could not be parsed as JSON.', 'openai_invalid_json', {
      details: {
        stage: 'openai',
        parse_stage: 'json_parse',
        ...baseSummary,
        schema_name: FORMATTER_VERIFIER_SCHEMA_NAME,
      },
    });
  }
  const validationErrors = validateVerifierResultAgainstSchema(parsed.value);
  if (validationErrors.length) {
    throw coded(502, 'OpenAI returned verifier JSON that did not match the expected schema.', 'openai_schema_invalid', {
      details: {
        stage: 'openai',
        parse_stage: 'schema_validation',
        ...baseSummary,
        schema_name: FORMATTER_VERIFIER_SCHEMA_NAME,
        validation_errors: validationErrors.slice(0, 8),
      },
    });
  }
  return parsed.value;
}

function buildOpenAiVerifierRequestBody({ model, profile, snapshot }) {
  const body = {
    model,
    max_output_tokens: 1200,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: [
              'You are HMJ Global’s premium candidate pack QA reviewer.',
              'Review the structured profile plus document-output diagnostics and decide if the document is safe for direct client submission.',
              'Fail the pack if the candidate name is not dominant on page 1, if branding is missing, if banned/internal headings remain, if section order is weak, if duplication is obvious, or if employment history looks malformed.',
              'Be strict and commercially realistic.',
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
            text: JSON.stringify({
              required_checks: {
                candidate_name_prominent: true,
                branded_header_present: true,
                banned_sections_removed: ['Candidate profile', 'Client-ready candidate profile'],
                section_order_expected: ['Executive Summary', 'Core Strengths', 'Key Project Experience', 'Employment History', 'Qualifications & Certifications'],
                footer_contact_details_required: [HMJ_CONTACT_EMAIL, HMJ_CONTACT_PHONE, 'www.HMJ-Global.com'],
              },
              profile: {
                candidate_name: profile.candidateName || '',
                target_role: profile.targetRole || '',
                location: profile.location || '',
                profile_summary: profile.profile || '',
                key_skills: profile.keySkills || [],
                relevant_projects: profile.relevantProjects || [],
                employment_history: profile.employmentHistory || [],
                qualifications: [].concat(profile.qualifications || [], profile.accreditations || []),
              },
              document_snapshot: {
                heading_sequence: snapshot.headingSequence,
                has_premium_header_band: snapshot.hasPremiumHeaderBand,
                has_logo_image: snapshot.hasLogoImage,
                footer_text: snapshot.footerText,
                media_count: snapshot.mediaNames.length,
                top_text_excerpt: trimString(snapshot.documentText, 2200),
              },
            }, null, 2),
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: FORMATTER_VERIFIER_SCHEMA_NAME,
        schema: buildVerifierSchema(),
        strict: true,
      },
    },
  };
  if (model.toLowerCase().startsWith('gpt-5')) {
    body.reasoning = { effort: 'low' };
  }
  return body;
}

async function callOpenAiCandidatePackVerifier({ profile, snapshot, requestFetch = fetchImpl }) {
  const apiKey = trimString(process.env.OPENAI_API_KEY, 240);
  if (!apiKey) {
    return { ok: false, code: 'openai_key_missing', error: 'openai_key_missing', attempts: [] };
  }

  const verifierModels = uniqueStrings(
    [
      trimString(process.env.OPENAI_CV_VERIFY_MODEL, 120),
      ...String(process.env.OPENAI_CV_VERIFY_FALLBACK_MODELS || '')
        .split(',')
        .map((entry) => trimString(entry, 120))
        .filter(Boolean),
      ...buildOpenAiModelSequence(),
    ],
    4
  );

  const attempts = [];
  let lastFailure = null;

  for (const model of verifierModels) {
    try {
      const response = await withTimeout(
        () => requestFetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(buildOpenAiVerifierRequestBody({ model, profile, snapshot })),
        }),
        DEFAULT_OPENAI_TIMEOUT_MS,
        () => coded(504, 'OpenAI verifier request timed out.', 'openai_timeout')
      );

      const payloadText = await response.text();
      const payload = safeJsonParse(payloadText);
      if (!response.ok) {
        const message = sanitiseOpenAiErrorMessage(
          trimString(payload?.error?.message, 240) || trimString(payloadText, 240) || `OpenAI request failed with status ${response.status}.`
        );
        const failure = {
          ok: false,
          status: response.status,
          code: response.status === 401 || /authentication failed/i.test(message) ? 'openai_authentication_failed' : 'openai_request_failed',
          error: message,
          model,
        };
        attempts.push(failure);
        lastFailure = failure;
        if (!shouldRetryAiAttempt(failure)) break;
        continue;
      }

      const parsed = parseOpenAiVerifierResponse(payload, {
        model,
        schemaName: FORMATTER_VERIFIER_SCHEMA_NAME,
      });
      const success = {
        ok: true,
        model,
        data: parsed,
      };
      attempts.push(success);
      return { ...success, attempts };
    } catch (error) {
      const failure = {
        ok: false,
        status: Number(error?.status) || Number(error?.statusCode) || null,
        code: trimString(error?.code) || 'openai_request_failed',
        error: sanitiseOpenAiErrorMessage(trimString(error?.message) || 'OpenAI verifier request failed.'),
        model,
      };
      attempts.push(failure);
      lastFailure = failure;
      if (!shouldRetryAiAttempt(failure)) break;
    }
  }

  return {
    ok: false,
    code: trimString(lastFailure?.code) || 'openai_request_failed',
    error: trimString(lastFailure?.error) || 'OpenAI verifier request failed.',
    model: trimString(lastFailure?.model) || '',
    attempts,
  };
}

async function verifyPremiumCandidatePack({ profile, buffer, options = {}, requestFetch = fetchImpl }) {
  const formatOptions = normaliseFormatOptions(options);
  if (formatOptions.templatePreset !== 'premium_candidate_pack') {
    return {
      passed: true,
      blockingFailure: false,
      deterministic: {
        passed: true,
        confidence: 1,
        reasons: ['Premium verifier skipped for non-premium template presets.'],
        remediationSuggestions: [],
        snapshot: {},
      },
      ai: {
        status: 'skipped',
        passed: true,
        confidence: null,
        professionalismScore: null,
        reasons: [],
        remediationSuggestions: [],
        model: '',
        attempts: [],
      },
    };
  }
  const snapshot = await buildDocxVerificationSnapshot(buffer);
  const issues = [];
  const remediation = [];
  const expectedHeadings = ['Executive Summary', 'Core Strengths', 'Key Project Experience', 'Employment History', 'Qualifications & Certifications'];
  const combinedText = `${snapshot.documentText}\n${snapshot.headerText}\n${snapshot.footerText}`;

  const nameIndex = profile.candidateName ? snapshot.documentText.indexOf(profile.candidateName.toUpperCase()) : -1;
  const roleIndex = snapshot.documentText.indexOf(profile.targetRole || '');
  if (!profile.candidateName) {
    issues.push('Candidate name is missing, so page 1 cannot present the person as the main title.');
    remediation.push('Provide or recover the candidate name before generating the premium pack.');
  } else if (nameIndex === -1 || (roleIndex !== -1 && nameIndex > roleIndex)) {
    issues.push('Candidate name is not leading the document before the role title.');
    remediation.push('Keep the candidate name as the first dominant title on page 1.');
  }

  if (!snapshot.hasPremiumHeaderBand && !snapshot.hasLogoImage) {
    issues.push('HMJ branding assets were not injected into the top of the document.');
    remediation.push('Ensure the premium header band or HMJ logo asset is available to the document builder.');
  }

  if (/Candidate profile|Client-ready candidate profile/i.test(combinedText)) {
    issues.push('Internal or templated profile labels are still visible in the client document.');
    remediation.push('Remove system-style labels from the page-1 title block and section headings.');
  }

  if (profile.candidateName && new RegExp(`Location:\\s*${profile.candidateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(combinedText)) {
    issues.push('The candidate name is still leaking into the location field.');
    remediation.push('Separate display-name extraction from location extraction before rendering.');
  }

  const headingIndexes = expectedHeadings.map((heading) => snapshot.documentText.indexOf(heading));
  if (headingIndexes.some((index) => index === -1) || headingIndexes.some((index, idx) => idx > 0 && index < headingIndexes[idx - 1])) {
    issues.push('The client-facing section order is incomplete or out of sequence.');
    remediation.push('Render sections in the order Executive Summary, Core Strengths, Key Project Experience, Employment History, then Qualifications.');
  }

  if (!snapshot.footerText.includes(HMJ_CONTACT_EMAIL) || !snapshot.footerText.includes(HMJ_CONTACT_PHONE) || !snapshot.footerText.includes('www.HMJ-Global.com')) {
    issues.push('The footer contact block is incomplete.');
    remediation.push('Keep the email, telephone number, and website link together in the footer.');
  }

  const duplicateLines = splitNonEmptyLines(snapshot.documentText)
    .map((line) => normaliseComparableText(line))
    .filter(Boolean);
  const duplicateKeys = duplicateLines.filter((line, index) => duplicateLines.indexOf(line) !== index);
  if (duplicateKeys.length > 3) {
    issues.push('The output still contains too many duplicate line fragments.');
    remediation.push('Deduplicate repeated summary or role lines before layout.');
  }

  const malformedEmploymentEntries = (profile.employmentHistory || []).filter((entry) => {
    const rangeCount = Array.from(`${entry.company || ''} ${entry.summary || ''}`.matchAll(/\b(?:\d{1,2}\s*\/\s*)?\d{2,4}\s*(?:[–-]|to)\s*(?:present|(?:\d{1,2}\s*\/\s*)?\d{2,4})\b/gi)).length;
    return rangeCount > 1;
  });
  if (malformedEmploymentEntries.length) {
    issues.push('One or more employment entries still contain merged date ranges or compressed role history.');
    remediation.push('Split or trim merged employment fragments before rendering them into the client pack.');
  }

  const incompleteEmploymentEntries = (profile.employmentHistory || []).filter((entry) => {
    const hasDates = !!extractDateRangeFromText(entry?.dates || '');
    const hasContent = !!trimString(entry?.company || entry?.summary || '') || (Array.isArray(entry?.bullets) && entry.bullets.length > 0);
    return !trimString(entry?.title) || !hasDates || !hasContent;
  });
  if (incompleteEmploymentEntries.length) {
    issues.push('One or more employment entries are still incomplete, with missing dates, titles, or supporting detail.');
    remediation.push('Require each employment entry to resolve into a role title, employer or project line, date range, and concise supporting content.');
  }

  const weakProjectEvidence = (profile.relevantProjects || []).filter((item) => {
    if (isWeakProjectEvidenceItem(item, profile.targetRole)) return true;
    return /\b(?:degree|bsc|msc|hnc|hnd|edition|professional training|qualification)\b/i.test(item);
  });
  if (weakProjectEvidence.length) {
    issues.push('Key project experience still contains weak or non-project evidence.');
    remediation.push('Build project experience from clean employment-history evidence instead of qualifications or wrapped source fragments.');
  }

  const deterministic = {
    passed: issues.length === 0,
    confidence: Math.max(0.45, 0.94 - (issues.length * 0.11)),
    reasons: issues.length ? issues : ['Deterministic premium-pack checks passed.'],
    remediationSuggestions: remediation,
    snapshot: {
      headingSequence: snapshot.headingSequence,
      hasPremiumHeaderBand: snapshot.hasPremiumHeaderBand,
      hasLogoImage: snapshot.hasLogoImage,
      mediaCount: snapshot.mediaNames.length,
    },
  };

  let ai = {
    status: 'skipped',
    passed: true,
    confidence: null,
    professionalismScore: null,
    reasons: [],
    remediationSuggestions: [],
    model: '',
    attempts: [],
  };

  if (deterministic.passed && formatOptions.templatePreset === 'premium_candidate_pack') {
    const aiResult = await callOpenAiCandidatePackVerifier({
      profile,
      snapshot,
      requestFetch,
    });
    if (aiResult.ok) {
      ai = {
        status: 'completed',
        passed: aiResult.data.outcome === 'pass',
        confidence: Number(aiResult.data.confidence_score) || null,
        professionalismScore: Number(aiResult.data.professionalism_score) || null,
        reasons: cleanList(aiResult.data.reasons, 6, 240),
        remediationSuggestions: cleanList(aiResult.data.remediation_suggestions, 6, 240),
        model: trimString(aiResult.model),
        attempts: aiResult.attempts,
      };
    } else if (['openai_key_missing', 'openai_authentication_failed'].includes(trimString(aiResult.code))) {
      ai = {
        ...ai,
        status: 'unavailable',
        reasons: [sanitiseOpenAiErrorMessage(aiResult.error)],
        attempts: aiResult.attempts,
      };
    } else {
      ai = {
        ...ai,
        status: 'error',
        reasons: [sanitiseOpenAiErrorMessage(aiResult.error)],
        attempts: aiResult.attempts,
      };
    }
  }

  return {
    passed: deterministic.passed && ai.passed,
    blockingFailure: !deterministic.passed || (ai.status === 'completed' && !ai.passed),
    deterministic,
    ai,
  };
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
  const candidateText = trimString(prepareSourceTextForFormatting(candidateExtraction.text));
  const uploadedJobSpecText = trimString(prepareSourceTextForFormatting(jobSpecExtraction?.text || ''));
  const jobSpecText = formatOptions.tailoringMode === 'cv_only' ? '' : uploadedJobSpecText;
  const candidateName = trimString(formatOptions.candidateDisplayName, 120) || guessCandidateName(candidateFile?.name, candidateText);
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
      profile = finaliseStructuredProfile(sanitiseStructuredProfile(ai.data, {
        candidateName,
        candidateReference,
        jobSpecRole,
        fileRole,
        formatOptions,
      }), {
        jobSpecText,
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
  const verification = await verifyPremiumCandidatePack({
    profile,
    buffer,
    options: formatOptions,
    requestFetch,
  });

  if (verification.blockingFailure) {
    const reasons = []
      .concat(verification.deterministic?.reasons || [])
      .concat(verification.ai?.status === 'completed' ? (verification.ai.reasons || []) : [])
      .filter(Boolean);
    const error = coded(
      422,
      reasons[0] || 'The premium candidate-pack verifier rejected this output.',
      'cv_verification_failed',
      {
        details: {
          stage: 'verification',
          verification,
        },
      }
    );
    throw error;
  }

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
      candidateName: profile.candidateName || candidateName || '',
      redactionsApplied: profile.redactionsApplied,
      warnings: profile.warnings,
      verification,
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
  callOpenAiCandidatePackVerifier,
  formatClientReadyCv,
  generateCandidateReference,
  guessCandidateName,
  redactPersonalIdentifiers,
  sanitiseStructuredProfile,
  sanitizeLocation,
  summariseExtraction,
  verifyPremiumCandidatePack,
};
