'use strict';

const { randomUUID } = require('node:crypto');
const {
  buildPayText,
  cleanArray,
  isMissingTableError,
  slugify,
  toPublicJob,
} = require('../netlify/functions/_jobs-helpers.js');

const fetchImpl = typeof fetch === 'function'
  ? fetch.bind(globalThis)
  : (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

const TEXT_EXTRACTABLE_EXTENSIONS = new Set(['pdf', 'docx']);
const LIMITED_TEXT_EXTENSIONS = new Set(['doc']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);
const SUPPORTED_EXTENSIONS = new Set([
  ...TEXT_EXTRACTABLE_EXTENSIONS,
  ...LIMITED_TEXT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
]);
const DEFAULT_MODEL = 'gpt-4.1-mini';
const FALLBACK_MODEL = 'gpt-5-mini';
const DEFAULT_UPLOAD_BUCKET = 'candidate-matcher-uploads';
const DEFAULT_HISTORY_LIMIT = 8;
const DEFAULT_EXTRACTION_TIMEOUT_MS = 60000;
const DEFAULT_JOBS_FETCH_TIMEOUT_MS = 8000;
const DEFAULT_STORAGE_TIMEOUT_MS = 10000;
const DEFAULT_HISTORY_TIMEOUT_MS = 10000;
const DEFAULT_OPENAI_TIMEOUT_MS = 60000;
const PDF_PARSE_NODE_ENGINE = '>=20.16.0 <21 || >=22.3.0';
const MAX_FILES = 6;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_NOTES_LENGTH = 5000;
const MAX_CANDIDATE_TEXT_CHARS = 24000;
const MAX_CANDIDATE_TEXT_HEAD_CHARS = 16000;
const MAX_CANDIDATE_TEXT_TAIL_CHARS = 6000;
const MAX_MATCHER_DOCUMENTS = 6;
const MAX_MATCHER_IMAGE_EVIDENCE = 4;
const MAX_MATCHER_JOBS = 8;
const MAX_JOB_SUMMARY_CHARS = 240;
const MAX_JOB_REQUIREMENT_ITEMS = 5;
const MAX_JOB_RESPONSIBILITY_ITEMS = 4;
const MAX_JOB_SKILL_ITEMS = 8;
const DEFAULT_OPENAI_MAX_OUTPUT_TOKENS = 2200;
const REPAIR_OPENAI_MAX_OUTPUT_TOKENS = 3200;
const HEAVY_MATCH_REQUEST_CHARS = 18000;
const MATCH_RUNS_TABLE = 'candidate_match_runs';
const MATCH_FILES_TABLE = 'candidate_match_files';
const MATCH_RUN_SELECT = 'id,created_at,updated_at,created_by,candidate_name,current_or_recent_title,seniority_level,primary_discipline,recruiter_notes,extracted_text_summary,candidate_summary_json,raw_result_json,best_match_job_id,best_match_job_slug,best_match_job_title,best_match_score,overall_recommendation,no_strong_match_reason,error_message,status,match_job_id,match_job_status,match_job_queued_at,match_job_started_at,match_job_completed_at,match_job_failed_at,match_job_last_error';
const MATCH_RESULT_SCHEMA_NAME = 'candidate_match_result';

function buildStringArraySchema(maxItems) {
  const schema = {
    type: 'array',
    items: { type: 'string' },
  };
  if (Number.isInteger(maxItems) && maxItems > 0) {
    schema.maxItems = maxItems;
  }
  return schema;
}

function buildClosedObjectSchema(properties) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

const MATCH_ITEM_SCHEMA = buildClosedObjectSchema({
  job_id: { type: 'string' },
  job_title: { type: 'string' },
  score: { type: 'number' },
  recommendation: {
    type: 'string',
    enum: ['shortlist', 'maybe', 'reject']
  },
  why_match: { type: 'string' },
  matched_skills: buildStringArraySchema(6),
  matched_qualifications: buildStringArraySchema(4),
  transferable_experience: buildStringArraySchema(4),
  gaps: buildStringArraySchema(4),
  follow_up_questions: buildStringArraySchema(4),
  uncertainty_notes: { type: 'string' },
});

const MATCH_RESULT_SCHEMA = {
  ...buildClosedObjectSchema({
    candidate_summary: buildClosedObjectSchema({
      name: { type: 'string' },
      current_or_recent_title: { type: 'string' },
      seniority_level: { type: 'string' },
      primary_discipline: { type: 'string' },
      sectors: buildStringArraySchema(5),
      locations: buildStringArraySchema(5),
      key_skills: buildStringArraySchema(8),
      key_qualifications: buildStringArraySchema(6),
      summary: { type: 'string' },
    }),
    top_matches: {
      type: 'array',
      maxItems: 4,
      items: { $ref: '#/$defs/match' }
    },
    other_matches: {
      type: 'array',
      maxItems: 4,
      items: { $ref: '#/$defs/match' }
    },
    overall_recommendation: { type: 'string' },
    general_follow_up_questions: buildStringArraySchema(6),
    no_strong_match_reason: { type: 'string' },
  }),
  $defs: {
    match: MATCH_ITEM_SCHEMA,
  }
};

function coded(statusCode, message, code, extra = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code || String(statusCode);
  if (extra && typeof extra === 'object') {
    Object.assign(error, extra);
  }
  return error;
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getEnvNumber(name, fallback) {
  const raw = trimString(process.env[name]);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPositiveTimeout(name, fallback) {
  const value = getEnvNumber(name, fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function uniqueStrings(values, maxItems = 0) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const trimmed = trimString(value);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (Number.isInteger(maxItems) && maxItems > 0 && result.length >= maxItems) {
      break;
    }
  }
  return result;
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function normaliseWhitespace(value) {
  return String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function decodeBase64(base64) {
  try {
    const raw = String(base64 || '').trim();
    const normalised = raw.replace(/^data:[^,]+,/, '').replace(/\s+/g, '');
    return Buffer.from(normalised, 'base64');
  } catch {
    return null;
  }
}

function getExtension(filename) {
  const name = trimString(filename).toLowerCase();
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index + 1);
}

function guessContentType(extension) {
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === 'doc') return 'application/msword';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  return 'application/octet-stream';
}

function normaliseContentType(value) {
  return trimString(value).toLowerCase().split(';')[0];
}

function inferExtensionFromMime(contentType) {
  const mime = normaliseContentType(contentType);
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (mime === 'application/msword') return 'doc';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/png') return 'png';
  return '';
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
    if (!current || typeof current !== 'object') {
      return null;
    }
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
      for (const propertyKey of propertyKeys) {
        if (!requiredSet.has(propertyKey)) {
          errors.push(`${formatSchemaPath(path)}.required is missing "${propertyKey}".`);
        }
      }
      for (const requiredKey of required) {
        if (!Object.prototype.hasOwnProperty.call(properties, requiredKey)) {
          errors.push(`${formatSchemaPath(path)}.required includes "${requiredKey}" but no matching property exists.`);
        }
      }
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

    for (const requiredKey of required) {
      if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
        errors.push(`${path}.${requiredKey} is required.`);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${path}.${key} is not allowed.`);
        }
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }
      errors.push(...validateJsonValueAgainstSchema(value[key], propertySchema, {
        rootSchema,
        path: `${path}.${key}`,
      }));
    }

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

  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${path} must be a finite number.`);
    }
    return errors;
  }

  return errors;
}

function validateMatcherResultAgainstSchema(result) {
  return validateJsonValueAgainstSchema(result, MATCH_RESULT_SCHEMA, {
    rootSchema: MATCH_RESULT_SCHEMA,
    path: '$',
  });
}

function ensureMatchResultSchemaValid() {
  const errors = validateStructuredOutputSchema(MATCH_RESULT_SCHEMA, {
    rootSchema: MATCH_RESULT_SCHEMA,
    path: '#',
  });
  if (!errors.length) return;
  throw coded(
    500,
    'Local matcher schema validation failed before calling OpenAI.',
    'openai_schema_definition_invalid',
    {
      details: {
        stage: 'openai',
        parse_stage: 'schema_definition',
        schema_name: MATCH_RESULT_SCHEMA_NAME,
        validation_errors: errors.slice(0, 12),
      }
    }
  );
}

function classifyCandidateFile({ filename, contentType }) {
  const name = trimString(filename);
  const fromName = getExtension(name);
  const fromMime = inferExtensionFromMime(contentType);
  const extension = SUPPORTED_EXTENSIONS.has(fromMime)
    ? fromMime
    : (SUPPORTED_EXTENSIONS.has(fromName) ? fromName : (fromName || fromMime));
  const mime = normaliseContentType(contentType) || guessContentType(extension);

  if (TEXT_EXTRACTABLE_EXTENSIONS.has(extension)) {
    return {
      extension,
      fileKind: extension,
      extractionMode: 'text',
      parserPath: extension,
      accepted: true,
      eligibilityLabel: 'Text extraction supported',
      warning: '',
      contentType: mime || guessContentType(extension),
    };
  }

  if (LIMITED_TEXT_EXTENSIONS.has(extension)) {
    return {
      extension,
      fileKind: 'doc',
      extractionMode: 'limited',
      parserPath: 'legacy-doc',
      accepted: true,
      eligibilityLabel: 'Accepted with limited extraction',
      warning: 'Legacy DOC uploads are accepted, but automatic extraction may be unavailable.',
      contentType: mime || guessContentType(extension),
    };
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return {
      extension,
      fileKind: 'image',
      extractionMode: 'image_only',
      parserPath: 'image-evidence',
      accepted: true,
      eligibilityLabel: 'Accepted as supporting image evidence',
      warning: 'Image files are included as supporting evidence and are not text-extracted in V1.',
      contentType: mime || guessContentType(extension),
    };
  }

  return {
    extension,
    fileKind: 'unsupported',
    extractionMode: 'unsupported',
    parserPath: 'none',
    accepted: false,
    eligibilityLabel: 'Unsupported for this matcher',
    warning: 'Unsupported file type. Accepted formats: PDF, DOCX, DOC, JPG, JPEG, PNG.',
    contentType: mime || guessContentType(extension),
  };
}

let mammothModule = null;
let mammothLoadError = null;
let pdfParseModule = null;
let pdfParseLoadError = null;

try {
  mammothModule = require('mammoth');
} catch (error) {
  mammothLoadError = error;
}

try {
  pdfParseModule = require('pdf-parse');
} catch (error) {
  pdfParseLoadError = error;
}

function getMammoth() {
  return mammothModule;
}

function getPdfParseModule() {
  return pdfParseModule;
}

function getLoadErrorSummary(error) {
  if (!error) return '';
  const code = trimString(error.code);
  const message = trimString(error.message);
  return [code, message].filter(Boolean).join(' ');
}

function parseNodeVersionParts(version) {
  const match = String(version || '').match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function isPdfParseRuntimeSupported(version = process.version) {
  const parts = parseNodeVersionParts(version);
  if (!parts) return true;
  if (parts.major === 20) {
    return parts.minor > 16 || (parts.minor === 16 && parts.patch >= 0);
  }
  if (parts.major === 22) {
    return parts.minor > 3 || (parts.minor === 3 && parts.patch >= 0);
  }
  return parts.major > 22;
}

function getPdfRuntimeCompatibilityNote() {
  if (isPdfParseRuntimeSupported(process.version)) return '';
  return ` Current Node runtime ${process.version} does not satisfy pdf-parse engine ${PDF_PARSE_NODE_ENGINE}.`;
}

function isSlowPrimaryMatchModel(model) {
  const safeModel = trimString(model).toLowerCase();
  return safeModel === 'gpt-5.4'
    || safeModel === 'gpt-5'
    || safeModel === 'gpt-5-large';
}

function shouldPreferFastMatcherModel(requestMetrics, configuredPrimary) {
  if (!isSlowPrimaryMatchModel(configuredPrimary)) return false;
  return Number(requestMetrics?.request_payload_json_chars) >= HEAVY_MATCH_REQUEST_CHARS
    || Number(requestMetrics?.candidate_text_chars) >= MAX_CANDIDATE_TEXT_HEAD_CHARS
    || Number(requestMetrics?.live_jobs_sent_count) >= MAX_MATCHER_JOBS;
}

function resolveModelList(requestMetrics = null) {
  const configuredPrimary = trimString(process.env.OPENAI_CANDIDATE_MATCH_MODEL) || DEFAULT_MODEL;
  const configuredFallback = trimString(process.env.OPENAI_CANDIDATE_MATCH_FALLBACK_MODEL) || FALLBACK_MODEL;
  if (shouldPreferFastMatcherModel(requestMetrics, configuredPrimary)) {
    return uniqueStrings([
      DEFAULT_MODEL,
      configuredPrimary,
      configuredFallback,
    ]);
  }
  return uniqueStrings([
    configuredPrimary,
    configuredFallback,
  ]);
}

function compactTextForMatcher(text) {
  const normalised = normaliseWhitespace(text);
  if (!normalised) {
    return {
      text: '',
      truncated: false,
      source_chars: 0,
    };
  }

  if (normalised.length <= MAX_CANDIDATE_TEXT_CHARS) {
    return {
      text: normalised,
      truncated: false,
      source_chars: normalised.length,
    };
  }

  const head = trimString(normalised.slice(0, MAX_CANDIDATE_TEXT_HEAD_CHARS));
  const tail = trimString(normalised.slice(-MAX_CANDIDATE_TEXT_TAIL_CHARS));
  return {
    text: [head, '[Candidate evidence condensed for matcher speed.]', tail].filter(Boolean).join('\n\n'),
    truncated: true,
    source_chars: normalised.length,
  };
}

function buildMatcherDocumentSummary(documents) {
  return (Array.isArray(documents) ? documents : [])
    .slice(0, MAX_MATCHER_DOCUMENTS)
    .map((document) => ({
      name: trimString(document?.name),
      file_kind: trimString(document?.fileKind) || trimString(document?.extension),
      status: trimString(document?.status),
      extracted_text_chars: Number(document?.extractedTextLength) || 0,
      note: trimString(document?.error),
    }));
}

function buildMatcherImageEvidenceSummary(imageEvidence) {
  return (Array.isArray(imageEvidence) ? imageEvidence : [])
    .slice(0, MAX_MATCHER_IMAGE_EVIDENCE)
    .map((document) => ({
      name: trimString(document?.name),
      file_kind: trimString(document?.fileKind) || trimString(document?.extension) || 'image',
      note: trimString(document?.error) || 'Supporting image evidence included but not text-extracted.',
    }));
}

function compactJobForMatcher(job) {
  return {
    job_id: trimString(job?.job_id),
    title: trimString(job?.title),
    location: trimString(job?.location),
    employment_type: trimString(job?.employment_type),
    discipline: trimString(job?.discipline),
    summary: trimString(job?.summary).slice(0, MAX_JOB_SUMMARY_CHARS),
    required_skills: uniqueStrings(job?.required_skills, MAX_JOB_SKILL_ITEMS),
    requirements: uniqueStrings(job?.requirements, MAX_JOB_REQUIREMENT_ITEMS),
    responsibilities: uniqueStrings(job?.responsibilities, MAX_JOB_RESPONSIBILITY_ITEMS),
  };
}

const MATCHER_STOP_WORDS = new Set([
  'about', 'across', 'after', 'against', 'analysis', 'analyst', 'and', 'are', 'been', 'before', 'candidate',
  'clear', 'current', 'for', 'from', 'global', 'have', 'hmj', 'into', 'jobs', 'live', 'matching', 'notes',
  'recruiter', 'roles', 'that', 'the', 'their', 'them', 'this', 'with',
]);

function extractMatcherTerms(value) {
  return uniqueStrings(String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+/.# -]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !MATCHER_STOP_WORDS.has(token)));
}

function scoreLiveJobForMatcher(job, matcherTerms, recruiterTerms) {
  const jobText = [
    job?.title,
    job?.discipline,
    job?.location,
    job?.summary,
    ...(Array.isArray(job?.required_skills) ? job.required_skills : []),
    ...(Array.isArray(job?.requirements) ? job.requirements : []),
    ...(Array.isArray(job?.responsibilities) ? job.responsibilities : []),
  ].join(' ').toLowerCase();
  const titleText = trimString(job?.title).toLowerCase();
  let score = 0;

  for (const term of matcherTerms) {
    if (!term) continue;
    if (titleText.includes(term)) score += 8;
    else if (jobText.includes(term)) score += 3;
  }

  for (const term of recruiterTerms) {
    if (!term) continue;
    if (titleText.includes(term)) score += 6;
    else if (jobText.includes(term)) score += 2;
  }

  return score;
}

function selectLiveJobsForMatcher(candidatePayload, liveJobs) {
  const jobs = Array.isArray(liveJobs) ? liveJobs : [];
  if (jobs.length <= MAX_MATCHER_JOBS) {
    return {
      total_count: jobs.length,
      sent_count: jobs.length,
      jobs: jobs.map(compactJobForMatcher),
    };
  }

  const matcherTerms = extractMatcherTerms([
    candidatePayload?.candidate_text,
    candidatePayload?.evidence_summary?.preview_text,
  ].filter(Boolean).join(' '));
  const recruiterTerms = extractMatcherTerms(candidatePayload?.recruiter_notes);
  const ranked = jobs
    .map((job, index) => ({
      job,
      index,
      score: scoreLiveJobForMatcher(job, matcherTerms, recruiterTerms),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    });
  const selected = ranked.slice(0, MAX_MATCHER_JOBS).map((entry) => compactJobForMatcher(entry.job));
  return {
    total_count: jobs.length,
    sent_count: selected.length,
    jobs: selected,
  };
}

function estimateMatcherPayload(payload) {
  const candidate = payload?.candidate && typeof payload.candidate === 'object' ? payload.candidate : {};
  const liveJobs = Array.isArray(payload?.live_jobs) ? payload.live_jobs : [];
  return {
    candidate_text_chars: trimString(candidate?.candidate_text).length,
    candidate_text_source_chars: Number(candidate?.candidate_text_source_chars) || trimString(candidate?.candidate_text).length,
    candidate_payload_json_chars: JSON.stringify(candidate).length,
    live_jobs_total_count: Number(payload?.live_job_selection?.total_count) || liveJobs.length,
    live_jobs_sent_count: liveJobs.length,
    live_jobs_json_chars: JSON.stringify(liveJobs).length,
    request_payload_json_chars: JSON.stringify(payload).length,
  };
}

function buildMatcherOpenAIPayload(input) {
  const sourceCandidate = input?.candidate && typeof input.candidate === 'object' ? input.candidate : {};
  const compactedText = compactTextForMatcher(sourceCandidate?.candidate_text);
  const candidate = {
    recruiter_notes: sanitiseNotes(sourceCandidate?.recruiter_notes),
    candidate_text: compactedText.text,
    candidate_text_truncated: compactedText.truncated,
    candidate_text_source_chars: compactedText.source_chars,
    evidence_summary: {
      preview_text: trimString(sourceCandidate?.evidence_summary?.preview_text).slice(0, 800),
      files_text_read: Number(sourceCandidate?.evidence_summary?.files_text_read) || 0,
      files_attempted: Number(sourceCandidate?.evidence_summary?.files_attempted) || 0,
      image_evidence_count: Number(sourceCandidate?.evidence_summary?.image_evidence_count) || 0,
      failed_file_count: Number(sourceCandidate?.evidence_summary?.failed_file_count) || 0,
    },
    documents: buildMatcherDocumentSummary(sourceCandidate?.documents),
    image_evidence: buildMatcherImageEvidenceSummary(sourceCandidate?.image_evidence),
  };
  const selectedLiveJobs = selectLiveJobsForMatcher(candidate, input?.live_jobs);
  return {
    candidate,
    live_job_selection: {
      total_count: selectedLiveJobs.total_count,
      sent_count: selectedLiveJobs.sent_count,
      strategy: selectedLiveJobs.total_count > selectedLiveJobs.sent_count
        ? 'relevance_prefilter'
        : 'all_live_jobs',
    },
    live_jobs: selectedLiveJobs.jobs,
  };
}

function shouldSendReasoningControls(model) {
  return trimString(model).toLowerCase().startsWith('gpt-5');
}

function getUploadBucketName() {
  return trimString(process.env.CANDIDATE_MATCH_UPLOAD_BUCKET) || DEFAULT_UPLOAD_BUCKET;
}

function sanitiseNotes(value) {
  return trimString(value).slice(0, MAX_NOTES_LENGTH);
}

function buildStorageKey(runId, filename) {
  const ext = getExtension(filename) || 'bin';
  const safeName = String(filename || '')
    .replace(/[\\/]+/g, '-')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .trim();
  const stem = slugify(safeName.replace(/\.[^.]+$/, '')) || `document-${Date.now()}`;
  return `candidate-matcher/${runId}/${Date.now()}-${randomUUID().slice(0, 8)}-${stem}.${ext}`;
}

function summariseDocument(doc) {
  return {
    id: doc.id,
    name: doc.name,
    extension: doc.extension,
    contentType: doc.contentType,
    fileKind: doc.fileKind || '',
    extractionMode: doc.extractionMode || '',
    parserPath: doc.parserPath || '',
    eligibilityLabel: doc.eligibilityLabel || '',
    size: doc.size,
    sizeLabel: formatFileSize(doc.size),
    status: doc.status,
    extractedTextLength: doc.extractedTextLength || 0,
    error: doc.error || '',
    storageKey: doc.storageKey || '',
  };
}

function normaliseExtractionStatus(status) {
  return ['ok', 'image_only', 'unsupported', 'limited'].includes(status) ? 'completed' : 'failed';
}

function logMatcher(level, message, data) {
  const method = typeof console[level] === 'function' ? console[level].bind(console) : console.log.bind(console);
  if (data === undefined) {
    method(`[candidate-matcher] ${message}`);
    return;
  }
  method(`[candidate-matcher] ${message}`, data);
}

function describeDocumentForLogs(document) {
  return {
    id: document?.id,
    name: document?.name,
    extension: document?.extension,
    contentType: document?.contentType,
    fileKind: document?.fileKind || '',
    extractionMode: document?.extractionMode || '',
    parserPath: document?.parserPath || '',
    declaredSize: Number(document?.size) || 0,
    decodedBytes: document?.buffer ? document.buffer.byteLength : 0,
    storageKey: document?.storageKey || '',
    status: document?.status || '',
  };
}

function buildExtractionDiagnostics(documents) {
  return (Array.isArray(documents) ? documents : []).map((document) => ({
    file: document?.name || '',
    extension: document?.extension || '',
    content_type: document?.contentType || '',
    file_kind: document?.fileKind || '',
    extraction_mode: document?.extractionMode || '',
    parser_path: document?.parserPath || '',
    declared_size_bytes: Number(document?.size) || 0,
    decoded_size_bytes: document?.buffer ? document.buffer.byteLength : 0,
    status: document?.status || '',
    error: document?.error || '',
    storage_key: document?.storageKey || '',
  }));
}

async function withTimeout(task, timeoutMs, buildTimeoutError) {
  const limit = Number(timeoutMs);
  if (!Number.isFinite(limit) || limit <= 0) {
    return Promise.resolve().then(task);
  }

  let timer = null;
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(typeof buildTimeoutError === 'function' ? buildTimeoutError() : buildTimeoutError);
      }, limit);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function prepareCandidateFiles(rawFiles) {
  const input = Array.isArray(rawFiles) ? rawFiles : [];
  if (!input.length) {
    throw coded(400, 'Upload at least one candidate document before analysing.', 'no_files_uploaded');
  }
  if (input.length > MAX_FILES) {
    throw coded(
      400,
      `Upload up to ${MAX_FILES} documents at a time for this matcher flow.`,
      'too_many_files'
    );
  }

  logMatcher('info', 'Preparing candidate upload payload', {
    fileCount: input.length,
  });

  let totalBytes = 0;
  const documents = input.map((raw, index) => {
    const name = trimString(raw?.name) || `candidate-document-${index + 1}`;
    const classification = classifyCandidateFile({
      filename: name,
      contentType: raw?.contentType,
    });
    const extension = classification.extension;
    const contentType = classification.contentType || guessContentType(extension);
    const base = {
      id: randomUUID(),
      name,
      extension,
      contentType,
      fileKind: classification.fileKind,
      extractionMode: classification.extractionMode,
      parserPath: classification.parserPath,
      eligibilityLabel: classification.eligibilityLabel,
      size: Number(raw?.size) || 0,
      buffer: null,
      status: 'ready',
      error: '',
      storageKey: '',
      extractedText: '',
      extractedTextLength: 0,
    };

    if (!classification.accepted) {
      logMatcher('warn', 'Rejected candidate file during prepare', {
        file: name,
        contentType,
        extension,
        reason: classification.warning,
      });
      return {
        ...base,
        status: 'unsupported',
        error: classification.warning,
      };
    }

    const buffer = decodeBase64(raw?.data);
    if (!buffer || !buffer.length) {
      logMatcher('error', 'Candidate file decode failed during prepare', {
        file: name,
        contentType,
        extension,
        hasData: !!trimString(raw?.data),
      });
      return {
        ...base,
        status: 'failed',
        error: 'The file could not be decoded for analysis.',
      };
    }

    if (buffer.byteLength > MAX_FILE_BYTES) {
      return {
        ...base,
        size: buffer.byteLength,
        status: 'failed',
        error: `This file exceeds the ${formatFileSize(MAX_FILE_BYTES)} limit for V1 uploads.`,
      };
    }

    totalBytes += buffer.byteLength;

    logMatcher('info', 'Prepared candidate file buffer', {
      file: name,
      contentType,
      extension,
      fileKind: classification.fileKind,
      extractionMode: classification.extractionMode,
      parserPath: classification.parserPath,
      bytes: buffer.byteLength,
      validBuffer: Buffer.isBuffer(buffer),
    });

    return {
      ...base,
      size: buffer.byteLength,
      buffer,
    };
  });

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw coded(
      400,
      `The combined upload size exceeds the ${formatFileSize(MAX_TOTAL_BYTES)} V1 limit.`,
      'total_upload_too_large'
    );
  }

  return documents;
}

async function extractPdfText(buffer, options = {}) {
  const pdfModule = getPdfParseModule();
  const PDFParse = pdfModule && pdfModule.PDFParse;
  if (!PDFParse) {
    throw coded(
      500,
      `PDF extraction dependency is unavailable on the server.${pdfParseLoadError ? ` ${getLoadErrorSummary(pdfParseLoadError)}` : ''}${getPdfRuntimeCompatibilityNote()}`,
      'pdf_parser_unavailable'
    );
  }

  const timeoutMs = getPositiveTimeout(
    'CANDIDATE_MATCH_PDF_TIMEOUT_MS',
    Number(options.timeoutMs) || DEFAULT_EXTRACTION_TIMEOUT_MS
  );
  logMatcher('info', 'Starting PDF parse', {
    parser: 'pdf-parse',
    bytes: buffer?.byteLength || 0,
    node: process.version,
    timeoutMs,
    startedAt: new Date().toISOString(),
  });
  const parser = new PDFParse({ data: buffer });
  try {
    const parseStartedAt = Date.now();
    const result = await withTimeout(
      () => parser.getText(),
      timeoutMs,
      () => coded(
        504,
        `PDF extraction timed out after ${timeoutMs}ms.`,
        'pdf_extraction_timeout',
        {
          details: {
            stage: 'extraction',
            parser: 'pdf',
            timeout_ms: timeoutMs,
          }
        }
      )
    );
    const text = normaliseWhitespace(result?.text || '');
    logMatcher('info', 'PDF parse completed', {
      bytes: buffer?.byteLength || 0,
      extractedTextLength: text.length,
      durationMs: Date.now() - parseStartedAt,
      finishedAt: new Date().toISOString(),
    });
    return text;
  } finally {
    if (typeof parser.destroy === 'function') {
      await parser.destroy().catch(() => {});
    }
  }
}

async function extractDocxText(buffer, options = {}) {
  const mammoth = getMammoth();
  if (!mammoth || typeof mammoth.extractRawText !== 'function') {
    throw coded(
      500,
      `DOCX extraction dependency is unavailable on the server.${mammothLoadError ? ` ${getLoadErrorSummary(mammothLoadError)}` : ''}`,
      'docx_parser_unavailable'
    );
  }
  const timeoutMs = getPositiveTimeout(
    'CANDIDATE_MATCH_DOCX_TIMEOUT_MS',
    Number(options.timeoutMs) || DEFAULT_EXTRACTION_TIMEOUT_MS
  );
  logMatcher('info', 'Starting DOCX parse', {
    parser: 'mammoth',
    bytes: buffer?.byteLength || 0,
    timeoutMs,
    startedAt: new Date().toISOString(),
  });
  const parseStartedAt = Date.now();
  const result = await withTimeout(
    () => mammoth.extractRawText({ buffer }),
    timeoutMs,
    () => coded(
      504,
      `DOCX extraction timed out after ${timeoutMs}ms.`,
      'docx_extraction_timeout',
      {
        details: {
          stage: 'extraction',
          parser: 'docx',
          timeout_ms: timeoutMs,
        }
      }
    )
  );
  logMatcher('info', 'DOCX parse completed', {
    bytes: buffer?.byteLength || 0,
    durationMs: Date.now() - parseStartedAt,
    extractedTextLength: normaliseWhitespace(result?.value || '').length,
    finishedAt: new Date().toISOString(),
  });
  return normaliseWhitespace(result?.value || '');
}

async function extractCandidateDocuments(documents, options = {}) {
  const extractionStartedAt = Date.now();
  const genericTimeoutMs = getPositiveTimeout(
    'CANDIDATE_MATCH_EXTRACTION_TIMEOUT_MS',
    DEFAULT_EXTRACTION_TIMEOUT_MS
  );
  const pdfTimeoutMs = Number(options.pdfTimeoutMs) || genericTimeoutMs;
  const docxTimeoutMs = Number(options.docxTimeoutMs) || genericTimeoutMs;
  const processed = [];
  let totalBytesProcessed = 0;

  logMatcher('info', 'Extraction stage started', {
    fileCount: Array.isArray(documents) ? documents.length : 0,
    startedAt: new Date(extractionStartedAt).toISOString(),
    timeoutMs: genericTimeoutMs,
  });

  for (const document of documents) {
    logMatcher('info', 'Prepared candidate document', describeDocumentForLogs(document));
    if (document.status !== 'ready') {
      logMatcher('warn', 'Skipping candidate document before extraction', describeDocumentForLogs(document));
      processed.push(document);
      continue;
    }

    try {
      let text = '';
      const extractStartedAt = Date.now();
      const bytesForDocument = Number(document?.buffer?.byteLength) || 0;
      totalBytesProcessed += bytesForDocument;
      logMatcher('info', 'Beginning candidate extraction', describeDocumentForLogs(document));
      if (document.extractionMode === 'image_only') {
        logMatcher('info', 'Candidate file accepted as supporting image evidence', describeDocumentForLogs(document));
        processed.push({
          ...document,
          status: 'image_only',
          error: 'Supporting image evidence was included but not text-extracted in V1.',
        });
        continue;
      } else if (document.extension === 'pdf') {
        text = await extractPdfText(document.buffer, { timeoutMs: pdfTimeoutMs });
      } else if (document.extension === 'docx') {
        text = await extractDocxText(document.buffer, { timeoutMs: docxTimeoutMs });
      } else if (document.extension === 'doc') {
        logMatcher('warn', 'Legacy DOC extraction is not configured for this runtime', describeDocumentForLogs(document));
        processed.push({
          ...document,
          status: 'limited',
          error: 'Legacy DOC uploads are accepted, but automatic text extraction is not configured for this runtime yet.',
        });
        continue;
      }

      if (!text) {
        logMatcher('warn', 'Candidate extraction produced no readable text', describeDocumentForLogs(document));
        processed.push({
          ...document,
          status: 'failed',
          error: 'No readable text could be extracted from this document.',
        });
        continue;
      }

      logMatcher('info', 'Candidate extraction succeeded', {
        ...describeDocumentForLogs(document),
        extractedTextLength: text.length,
        durationMs: Date.now() - extractStartedAt,
        finishedAt: new Date().toISOString(),
      });
      processed.push({
        ...document,
        extractedText: text,
        extractedTextLength: text.length,
        status: 'ok',
      });
    } catch (error) {
      logMatcher('error', 'Candidate extraction failed', {
        ...describeDocumentForLogs(document),
        error: trimString(error?.message) || String(error),
      });
      processed.push({
        ...document,
        status: 'failed',
        error: trimString(error?.message) || 'Extraction failed unexpectedly.',
      });
    }
  }

  const successful = processed.filter((document) => document.status === 'ok' && document.extractedText);
  const failed = processed.filter((document) => document.status !== 'ok');
  const imageEvidence = processed.filter((document) => document.status === 'image_only');
  const combinedText = successful
    .map((document) => `Document: ${document.name}\n${document.extractedText}`)
    .join('\n\n');
  const normalisedCombinedText = normaliseWhitespace(combinedText);

  logMatcher('info', 'Completed candidate extraction stage', {
    fileCount: processed.length,
    successCount: successful.length,
    failureCount: failed.length,
    imageEvidenceCount: imageEvidence.length,
    combinedTextEmpty: !normalisedCombinedText,
    combinedTextLength: normalisedCombinedText.length,
    totalBytesProcessed,
    startedAt: new Date(extractionStartedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    totalElapsedMs: Date.now() - extractionStartedAt,
  });

  return {
    documents: processed,
    successful,
    failed,
    imageEvidence,
    successCount: successful.length,
    failureCount: failed.length,
    combinedText: normalisedCombinedText,
  };
}

function mapJobForMatcher(row) {
  const job = toPublicJob(row);
  const requirementLines = cleanArray(job.requirements);
  const tagSkills = cleanArray(job.tags || job.keywords);

  return {
    job_id: trimString(job.id),
    job_slug: trimString(row.slug),
    title: trimString(job.title),
    location: trimString(job.locationText),
    employment_type: trimString(job.type),
    published: job.published !== false,
    status: trimString(job.status || 'live').toLowerCase() || 'live',
    summary: trimString(job.overview),
    required_skills: uniqueStrings(tagSkills),
    required_qualifications: [],
    required_sector_experience: [],
    desirable_experience: [],
    salary: trimString(job.payText || buildPayText(job)),
    customer: trimString(job.customer),
    benefits: cleanArray(job.benefits),
    section: trimString(job.sectionLabel || job.section),
    discipline: trimString(job.discipline),
    responsibilities: cleanArray(job.responsibilities),
    requirements: requirementLines,
    public_metadata: {
      location_code: trimString(job.locationCode),
      pay_type: trimString(job.payType),
      tags: uniqueStrings(tagSkills),
      created_at: trimString(job.createdAt),
      updated_at: trimString(job.updatedAt),
    }
  };
}

async function fetchPublishedLiveJobs(supabase, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || getPositiveTimeout(
    'CANDIDATE_MATCH_JOBS_TIMEOUT_MS',
    DEFAULT_JOBS_FETCH_TIMEOUT_MS
  );
  const queryStartedAt = Date.now();
  logMatcher('info', 'Starting live jobs fetch', { timeoutMs });
  const { data, error } = await withTimeout(
    () => supabase
      .from('jobs')
      .select('*')
      .eq('published', true)
      .order('section', { ascending: true })
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .order('title', { ascending: true }),
    timeoutMs,
    () => coded(
      504,
      `Live jobs fetch timed out after ${timeoutMs}ms.`,
      'jobs_fetch_timeout',
      {
        details: {
          stage: 'jobs_fetch',
          timeout_ms: timeoutMs,
        }
      }
    )
  );

  if (error) throw error;
  const jobs = (Array.isArray(data) ? data : [])
    .map(mapJobForMatcher)
    .filter((job) => job.published && job.status === 'live');
  logMatcher('info', 'Completed live jobs fetch', {
    liveJobsCount: jobs.length,
    durationMs: Date.now() - queryStartedAt,
  });
  return jobs;
}

function buildSystemPrompt() {
  return [
    'You are a disciplined recruitment analyst for HMJ Global.',
    'Work only from the supplied candidate evidence and the supplied live jobs.',
    'Do not invent qualifications, certificates, clearances, sector history, or location flexibility that are not evidenced.',
    'Reward transferable experience when it is meaningfully adjacent, but avoid over-scoring weak matches.',
    'Recommendations must be commercially useful for a recruiter and should reflect both evidence and uncertainty.',
    'Use concise, practical language.'
  ].join(' ');
}

function buildUserPrompt(payload, options = {}) {
  const strictReminder = options.repairMode
    ? 'Return only one valid JSON object that matches the schema exactly. Do not add markdown fences, commentary, or wrapper keys.'
    : 'Return only the schema-compliant matcher object.';
  return [
    'Analyse this candidate against the supplied HMJ live jobs.',
    strictReminder,
    'Return exactly these top-level keys: candidate_summary, top_matches, other_matches, overall_recommendation, general_follow_up_questions, no_strong_match_reason.',
    'candidate_summary must include: name, current_or_recent_title, seniority_level, primary_discipline, sectors, locations, key_skills, key_qualifications, summary.',
    'Each match object in top_matches and other_matches must include: job_id, job_title, score, recommendation, why_match, matched_skills, matched_qualifications, transferable_experience, gaps, follow_up_questions, uncertainty_notes.',
    'Do not wrap the result in result, match, analysis, or candidate_match_result.',
    'Every schema field must be present even when empty. Use empty strings or empty arrays rather than omitting keys.',
    'The supplied live_jobs list may be a relevance-prefiltered shortlist from the full HMJ live job set. Rank only the supplied jobs.',
    'Scoring guidance:',
    '- 85-100: strong shortlist with clear evidence.',
    '- 65-84: maybe / conditional interest.',
    '- below 65: reject unless there is unusually strong transferable alignment.',
    '- If there are no strong roles, explain that clearly and keep the no_strong_match_reason populated.',
    '- Keep prose concise and operational. Use short phrase arrays rather than long sentences.',
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function extractResponseText(payload) {
  return extractOpenAIOutput(payload).text;
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
    text: textChunks.join('\n').trim(),
    refusals: uniqueStrings(refusalChunks),
    contentTypes: uniqueStrings(contentTypes),
    itemStatuses: uniqueStrings(itemStatuses),
  };
}

function stripJsonCodeFences(text) {
  const trimmed = trimString(text);
  if (!trimmed) return '';
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    return trimString(fencedMatch[1]);
  }
  return trimmed;
}

function extractBalancedJsonSlice(text) {
  const source = trimString(text);
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return '';
  return trimString(source.slice(start, end + 1));
}

function parseMatcherJsonText(text) {
  const candidates = [];
  const trimmed = trimString(text);
  if (trimmed) {
    candidates.push({ strategy: 'direct', text: trimmed });
    const fenceStripped = stripJsonCodeFences(trimmed);
    if (fenceStripped && fenceStripped !== trimmed) {
      candidates.push({ strategy: 'code_fence', text: fenceStripped });
    }
    const extracted = extractBalancedJsonSlice(fenceStripped || trimmed);
    if (extracted && !candidates.some((candidate) => candidate.text === extracted)) {
      candidates.push({ strategy: 'object_slice', text: extracted });
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

function looksLikeMatcherResult(value) {
  return !!(value
    && typeof value === 'object'
    && value.candidate_summary
    && Array.isArray(value.top_matches)
    && Array.isArray(value.other_matches));
}

function unwrapMatcherResult(value) {
  if (looksLikeMatcherResult(value)) {
    return { value, wrapperKey: '' };
  }

  for (const key of ['result', 'match', 'analysis', 'candidate_match_result']) {
    if (looksLikeMatcherResult(value?.[key])) {
      return { value: value[key], wrapperKey: key };
    }
  }

  return { value, wrapperKey: '' };
}

function summariseOpenAIResponse(payload, extracted, extra = {}) {
  const requestMetrics = extra.requestMetrics && typeof extra.requestMetrics === 'object'
    ? extra.requestMetrics
    : {};
  return {
    response_id: trimString(payload?.id),
    response_status: trimString(payload?.status),
    incomplete_reason: trimString(payload?.incomplete_details?.reason),
    content_types: uniqueStrings(extracted?.contentTypes),
    item_statuses: uniqueStrings(extracted?.itemStatuses),
    refusal_count: Array.isArray(extracted?.refusals) ? extracted.refusals.length : 0,
    output_text_length: trimString(extracted?.text).length,
    parser_strategy: trimString(extra.parserStrategy),
    wrapper_key: trimString(extra.wrapperKey),
    model: trimString(extra.model),
    max_output_tokens: Number.isFinite(Number(extra.maxOutputTokens)) ? Number(extra.maxOutputTokens) : null,
    repair_attempt: extra.repairMode === true,
    schema_name: MATCH_RESULT_SCHEMA_NAME,
    candidate_text_chars: Number(requestMetrics.candidate_text_chars) || 0,
    candidate_text_source_chars: Number(requestMetrics.candidate_text_source_chars) || 0,
    live_jobs_total_count: Number(requestMetrics.live_jobs_total_count) || 0,
    live_jobs_sent_count: Number(requestMetrics.live_jobs_sent_count) || 0,
    live_jobs_json_chars: Number(requestMetrics.live_jobs_json_chars) || 0,
    request_payload_json_chars: Number(requestMetrics.request_payload_json_chars) || 0,
  };
}

function parseOpenAIMatchResponse(payload, options = {}) {
  const extracted = extractOpenAIOutput(payload);
  const responseStatus = trimString(payload?.status).toLowerCase();
  const incompleteReason = trimString(payload?.incomplete_details?.reason);
  const baseSummary = summariseOpenAIResponse(payload, extracted, options);

  if (responseStatus === 'incomplete') {
    const reasonMessage = incompleteReason === 'max_output_tokens'
      ? `OpenAI returned incomplete structured output because max_output_tokens was reached (${options.maxOutputTokens || 'unknown'}).`
      : `OpenAI returned incomplete structured output${incompleteReason ? ` (${incompleteReason})` : ''}.`;
    throw coded(502, reasonMessage, 'openai_incomplete_output', {
      details: {
        stage: 'openai',
        parse_stage: 'incomplete',
        ...baseSummary,
      }
    });
  }

  if (extracted.refusals.length) {
    throw coded(502, 'OpenAI refused to produce recruiter matcher output for this run.', 'openai_refusal', {
      details: {
        stage: 'openai',
        parse_stage: 'refusal',
        ...baseSummary,
      }
    });
  }

  if (!trimString(extracted.text)) {
    throw coded(502, 'OpenAI returned an empty matcher response.', 'openai_empty_response', {
      details: {
        stage: 'openai',
        parse_stage: 'empty',
        ...baseSummary,
      }
    });
  }

  const parsed = parseMatcherJsonText(extracted.text);
  if (!parsed) {
    throw coded(502, 'OpenAI returned matcher output that could not be parsed as JSON.', 'openai_invalid_json', {
      details: {
        stage: 'openai',
        parse_stage: 'json_parse',
        ...baseSummary,
      }
    });
  }

  const unwrapped = unwrapMatcherResult(parsed.value);
  const rawValidationErrors = validateMatcherResultAgainstSchema(unwrapped.value);
  if (rawValidationErrors.length) {
    throw coded(502, 'OpenAI returned matcher JSON that did not match the expected schema.', 'openai_schema_invalid', {
      details: {
        stage: 'openai',
        parse_stage: 'schema_validation',
        ...summariseOpenAIResponse(payload, extracted, {
          ...options,
          parserStrategy: parsed.strategy,
          wrapperKey: unwrapped.wrapperKey,
        }),
        validation_errors: rawValidationErrors.slice(0, 8),
      }
    });
  }

  const sanitised = sanitiseAnalysisResult(unwrapped.value);
  const localValidationErrors = validateMatcherResultAgainstSchema(sanitised);
  if (localValidationErrors.length) {
    throw coded(500, 'Local matcher result validation failed after normalising the OpenAI response.', 'local_result_validation_failed', {
      details: {
        stage: 'openai',
        parse_stage: 'local_validation',
        ...summariseOpenAIResponse(payload, extracted, {
          ...options,
          parserStrategy: parsed.strategy,
          wrapperKey: unwrapped.wrapperKey,
        }),
        validation_errors: localValidationErrors.slice(0, 8),
      }
    });
  }

  return {
    result: sanitised,
    diagnostics: summariseOpenAIResponse(payload, extracted, {
      ...options,
      parserStrategy: parsed.strategy,
      wrapperKey: unwrapped.wrapperKey,
    }),
  };
}

function isRecoverableOpenAIOutputError(error) {
  return [
    'openai_incomplete_output',
    'openai_empty_response',
    'openai_invalid_json',
    'openai_schema_invalid',
  ].includes(trimString(error?.code));
}

function shouldRetryWithFallback(statusCode, details) {
  if (statusCode !== 400 && statusCode !== 404) return false;
  const haystack = JSON.stringify(details || {}).toLowerCase();
  return haystack.includes('model') || haystack.includes('access');
}

function sanitiseMatch(match) {
  return {
    job_id: trimString(match?.job_id),
    job_title: trimString(match?.job_title),
    score: Number.isFinite(Number(match?.score)) ? Number(match.score) : 0,
    recommendation: ['shortlist', 'maybe', 'reject'].includes(trimString(match?.recommendation))
      ? trimString(match.recommendation)
      : 'reject',
    why_match: trimString(match?.why_match),
    matched_skills: uniqueStrings(match?.matched_skills, 6),
    matched_qualifications: uniqueStrings(match?.matched_qualifications, 4),
    transferable_experience: uniqueStrings(match?.transferable_experience, 4),
    gaps: uniqueStrings(match?.gaps, 4),
    follow_up_questions: uniqueStrings(match?.follow_up_questions, 4),
    uncertainty_notes: trimString(match?.uncertainty_notes),
  };
}

function sanitiseAnalysisResult(result) {
  const candidateSummary = result?.candidate_summary || {};
  const topMatches = (Array.isArray(result?.top_matches) ? result.top_matches : [])
    .map(sanitiseMatch)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
  const topJobIds = new Set(topMatches.map((match) => match.job_id).filter(Boolean));
  const otherMatches = (Array.isArray(result?.other_matches) ? result.other_matches : [])
    .map(sanitiseMatch)
    .filter((match) => !topJobIds.has(match.job_id))
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  return {
    candidate_summary: {
      name: trimString(candidateSummary.name),
      current_or_recent_title: trimString(candidateSummary.current_or_recent_title),
      seniority_level: trimString(candidateSummary.seniority_level),
      primary_discipline: trimString(candidateSummary.primary_discipline),
      sectors: uniqueStrings(candidateSummary.sectors, 5),
      locations: uniqueStrings(candidateSummary.locations, 5),
      key_skills: uniqueStrings(candidateSummary.key_skills, 8),
      key_qualifications: uniqueStrings(candidateSummary.key_qualifications, 6),
      summary: trimString(candidateSummary.summary),
    },
    top_matches: topMatches,
    other_matches: otherMatches,
    overall_recommendation: trimString(result?.overall_recommendation),
    general_follow_up_questions: uniqueStrings(result?.general_follow_up_questions, 6),
    no_strong_match_reason: trimString(result?.no_strong_match_reason),
  };
}

function isOpenAISchemaRejection(statusCode, details) {
  if (statusCode !== 400) return false;
  const haystack = JSON.stringify(details || {}).toLowerCase();
  return haystack.includes('invalid schema for response_format')
    || (haystack.includes('response_format') && haystack.includes('schema'));
}

async function notifyMatcherStage(onStage, payload) {
  if (typeof onStage !== 'function') return;
  try {
    await onStage(payload);
  } catch (error) {
    logMatcher('warn', 'Failed to persist matcher stage update', {
      stage: trimString(payload?.stage),
      error: trimString(error?.message) || String(error),
    });
  }
}

async function callOpenAIForMatch(payload, options = {}) {
  const apiKey = trimString(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw coded(503, 'OpenAI API key missing on the server.', 'openai_key_missing', {
      details: {
        stage: 'configuration',
        config_key: 'OPENAI_API_KEY',
      }
    });
  }
  ensureMatchResultSchemaValid();

  const openAIPayload = buildMatcherOpenAIPayload(payload);
  const requestMetrics = estimateMatcherPayload(openAIPayload);
  const requestFetch = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetchImpl;
  const timeoutMs = Number(options.timeoutMs) || getPositiveTimeout('OPENAI_MATCH_TIMEOUT_MS', DEFAULT_OPENAI_TIMEOUT_MS);
  const models = resolveModelList(requestMetrics);
  const baseMaxOutputTokens = Math.max(800, getEnvNumber(
    'OPENAI_CANDIDATE_MATCH_MAX_OUTPUT_TOKENS',
    DEFAULT_OPENAI_MAX_OUTPUT_TOKENS
  ));
  const repairMaxOutputTokens = Math.max(REPAIR_OPENAI_MAX_OUTPUT_TOKENS, baseMaxOutputTokens + 800);
  const onStage = typeof options.onStage === 'function' ? options.onStage : null;

  let lastError = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const attempts = [
      { repairMode: false, maxOutputTokens: baseMaxOutputTokens },
      { repairMode: true, maxOutputTokens: repairMaxOutputTokens },
    ];

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const requestStartedAt = Date.now();
      const requestBody = {
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: buildSystemPrompt() }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: buildUserPrompt(openAIPayload, { repairMode: attempt.repairMode }) }],
          }
        ],
        max_output_tokens: attempt.maxOutputTokens,
        text: {
          format: {
            type: 'json_schema',
            name: MATCH_RESULT_SCHEMA_NAME,
            schema: MATCH_RESULT_SCHEMA,
            strict: true,
          }
        }
      };
      if (shouldSendReasoningControls(model)) {
        requestBody.reasoning = { effort: 'minimal' };
      }

      try {
        logMatcher('info', 'Starting OpenAI match request', {
          model,
          timeoutMs,
          candidateTextChars: requestMetrics.candidate_text_chars,
          candidateTextSourceChars: requestMetrics.candidate_text_source_chars,
          liveJobsTotalCount: requestMetrics.live_jobs_total_count,
          liveJobsSentCount: requestMetrics.live_jobs_sent_count,
          liveJobsJsonChars: requestMetrics.live_jobs_json_chars,
          requestPayloadJsonChars: requestMetrics.request_payload_json_chars,
          maxOutputTokens: attempt.maxOutputTokens,
          repairMode: attempt.repairMode,
        });
        await notifyMatcherStage(onStage, {
          stage: 'openai_thinking',
          stage_label: 'OpenAI analysing candidate against live roles',
          details: {
            model,
            timeout_ms: timeoutMs,
            repair_attempt: attempt.repairMode,
            max_output_tokens: attempt.maxOutputTokens,
            ...requestMetrics,
          },
        });
        const response = await requestFetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ ...requestBody, model }),
          signal: controller.signal,
        });

        const raw = await response.text();
        const parsed = safeJsonParse(raw);
        await notifyMatcherStage(onStage, {
          stage: 'openai_response_received',
          stage_label: 'OpenAI response received',
          details: {
            model,
            repair_attempt: attempt.repairMode,
            max_output_tokens: attempt.maxOutputTokens,
            openai_status: response.status,
            duration_ms: Date.now() - requestStartedAt,
            response_received: true,
            ...requestMetrics,
          },
        });

        if (!parsed || typeof parsed !== 'object') {
          throw coded(
            502,
            'OpenAI returned a non-JSON API response.',
            'openai_transport_invalid_json',
            {
              details: {
                stage: 'openai',
                model,
                openai_status: response.status,
                repair_attempt: attempt.repairMode,
                max_output_tokens: attempt.maxOutputTokens,
                response_received: true,
                ...requestMetrics,
              }
            }
          );
        }

        if (!response.ok) {
          logMatcher('warn', 'OpenAI match request returned non-OK status', {
            model,
            status: response.status,
            durationMs: Date.now() - requestStartedAt,
            repairMode: attempt.repairMode,
          });
          if (index < models.length - 1 && shouldRetryWithFallback(response.status, parsed || raw)) {
            lastError = coded(
              502,
              `OpenAI model ${model} was unavailable for this account, trying fallback.`,
              'openai_model_unavailable',
              { details: parsed || raw }
            );
            break;
          }

          if (isOpenAISchemaRejection(response.status, parsed || raw)) {
            throw coded(
              500,
              'OpenAI rejected the candidate matcher response schema.',
              'openai_schema_rejected',
              {
                details: {
                  stage: 'openai',
                  parse_stage: 'schema_request',
                  model,
                  openai_status: response.status,
                  schema_name: MATCH_RESULT_SCHEMA_NAME,
                  response_error: trimString(parsed?.error?.message) || trimString(parsed?.message),
                  response_body: parsed || raw,
                  response_received: true,
                  ...requestMetrics,
                }
              }
            );
          }

          throw coded(
            502,
            trimString(parsed?.error?.message) || trimString(parsed?.message) || `OpenAI request failed (${response.status}).`,
            'openai_request_failed',
            {
              details: {
                response_body: parsed || raw,
                openai_status: response.status,
                response_received: true,
                ...requestMetrics,
              },
              openaiStatus: response.status,
            }
          );
        }

        await notifyMatcherStage(onStage, {
          stage: 'parsing_result',
          stage_label: 'Validating structured result',
          details: {
            model,
            repair_attempt: attempt.repairMode,
            max_output_tokens: attempt.maxOutputTokens,
            response_received: true,
            ...requestMetrics,
          },
        });
        const parsedResult = parseOpenAIMatchResponse(parsed, {
          model,
          maxOutputTokens: attempt.maxOutputTokens,
          repairMode: attempt.repairMode,
          requestMetrics,
        });
        await notifyMatcherStage(onStage, {
          stage: 'structured_result_validated',
          stage_label: 'Structured result validated',
          details: {
            model,
            repair_attempt: attempt.repairMode,
            max_output_tokens: attempt.maxOutputTokens,
            response_received: true,
            parser_strategy: parsedResult.diagnostics.parser_strategy,
            ...requestMetrics,
          },
        });

        logMatcher('info', 'Completed OpenAI match request', {
          model,
          durationMs: Date.now() - requestStartedAt,
          maxOutputTokens: attempt.maxOutputTokens,
          repairMode: attempt.repairMode,
          responseStatus: parsedResult.diagnostics.response_status,
          parserStrategy: parsedResult.diagnostics.parser_strategy,
        });

        return {
          model,
          result: parsedResult.result,
          raw: parsed,
          diagnostics: parsedResult.diagnostics,
        };
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw coded(
            504,
            `OpenAI candidate matching timed out after ${timeoutMs}ms.`,
            'openai_timeout',
            {
              details: {
                stage: 'openai',
                match_stage: 'openai_thinking',
                match_stage_label: 'OpenAI analysing candidate against live roles',
                timeout_ms: timeoutMs,
                model,
                repair_attempt: attempt.repairMode,
                max_output_tokens: attempt.maxOutputTokens,
                response_received: false,
                ...requestMetrics,
              }
            }
          );
        }
        logMatcher('error', 'OpenAI match request failed', {
          model,
          durationMs: Date.now() - requestStartedAt,
          error: trimString(error?.message) || String(error),
          code: trimString(error?.code),
          repairMode: attempt.repairMode,
          maxOutputTokens: attempt.maxOutputTokens,
          details: error?.details || null,
        });
        lastError = error;

        if (isRecoverableOpenAIOutputError(error) && attemptIndex < attempts.length - 1) {
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }

      break;
    }
  }

  throw lastError || coded(502, 'OpenAI candidate matching failed.', 'openai_request_failed');
}

function buildCandidatePayload(extraction, recruiterNotes) {
  const evidence = buildPreparedEvidenceSummary({
    documents: extraction.documents,
    combinedText: extraction.combinedText,
  });
  return {
    recruiter_notes: sanitiseNotes(recruiterNotes),
    candidate_text: trimString(extraction.combinedText),
    evidence_summary: {
      preview_text: evidence.preview_text,
      files_attempted: evidence.files_attempted,
      files_text_read: evidence.files_text_read,
      image_evidence_count: evidence.image_evidence_count,
      failed_file_count: evidence.failed_count + evidence.limited_count + evidence.unsupported_count,
    },
    documents: extraction.documents.map(summariseDocument),
    image_evidence: (Array.isArray(extraction?.imageEvidence) ? extraction.imageEvidence : [])
      .map((document) => ({
        name: document.name,
        fileKind: document.fileKind,
        extension: document.extension,
        error: document.error || 'Supporting image evidence included but not text-extracted in V1.',
      })),
  };
}

function inferCandidateNameFromText(text) {
  const lines = String(text || '')
    .split(/\n+/)
    .map((line) => trimString(line))
    .filter(Boolean)
    .slice(0, 12);

  for (const line of lines) {
    if (line.length < 5 || line.length > 70) continue;
    if (/[0-9@/]/.test(line)) continue;
    if (/[,:;|]/.test(line)) continue;
    const lower = line.toLowerCase();
    if ([
      'curriculum vitae',
      'resume',
      'professional summary',
      'profile',
      'contact',
      'experience',
      'education',
      'skills',
    ].some((phrase) => lower.includes(phrase))) {
      continue;
    }
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    if (!words.every((word) => /^[A-Za-z'’-]+$/.test(word))) continue;
    if (!words.every((word) => /^[A-Z]/.test(word))) continue;
    return line;
  }

  return '';
}

function buildPreparedEvidenceSummary({ documents, combinedText }) {
  const allDocuments = (Array.isArray(documents) ? documents : []).map((document) => ({
    ...summariseDocument(document),
    status: trimString(document?.status) || trimString(summariseDocument(document).status),
  }));
  const previewText = trimString(combinedText).slice(0, 2400);
  const textFiles = allDocuments.filter((document) => document.status === 'ok');
  const imageEvidenceFiles = allDocuments.filter((document) => document.status === 'image_only');
  const limitedFiles = allDocuments.filter((document) => document.status === 'limited');
  const unsupportedFiles = allDocuments.filter((document) => document.status === 'unsupported');
  const failedFiles = allDocuments.filter((document) => document.status === 'failed');
  const inferredCandidateName = inferCandidateNameFromText(combinedText);
  return {
    inferred_candidate_name: inferredCandidateName,
    ready_for_match: textFiles.length > 0 && !!trimString(combinedText),
    files_attempted: allDocuments.length,
    files_text_read: textFiles.length,
    image_evidence_count: imageEvidenceFiles.length,
    limited_count: limitedFiles.length,
    unsupported_count: unsupportedFiles.length,
    failed_count: failedFiles.length,
    combined_text_length: trimString(combinedText).length,
    preview_text: previewText,
    text_files: textFiles,
    image_evidence_files: imageEvidenceFiles,
    limited_files: limitedFiles,
    unsupported_files: unsupportedFiles,
    failed_files: failedFiles,
    documents: allDocuments,
  };
}

function buildPreparationSnapshot({ extraction, documents, actorEmail, bucket }) {
  const evidence = buildPreparedEvidenceSummary({
    documents: extraction.documents,
    combinedText: extraction.combinedText,
  });
  return {
    prepared_at: new Date().toISOString(),
    combined_candidate_text: extraction.combinedText || '',
    preview_text: evidence.preview_text,
    ready_for_match: evidence.ready_for_match,
    counts: {
      files_attempted: evidence.files_attempted,
      files_text_read: evidence.files_text_read,
      image_evidence_count: evidence.image_evidence_count,
      limited_count: evidence.limited_count,
      unsupported_count: evidence.unsupported_count,
      failed_count: evidence.failed_count,
    },
    documents: extraction.documents.map(summariseDocument),
    image_evidence: (Array.isArray(extraction.imageEvidence) ? extraction.imageEvidence : [])
      .map((document) => ({
        name: document.name,
        content_type: document.contentType,
        file_kind: document.fileKind,
        note: document.error || 'Supporting image evidence included but not text-extracted in V1.',
      })),
    stored_files: (Array.isArray(documents) ? documents : [])
      .filter((document) => document.storageKey)
      .map((document) => ({
        name: document.name,
        storage_key: document.storageKey,
        storage_bucket: bucket || '',
        extraction_status: normaliseExtractionStatus(document.status),
      })),
    audit: {
      prepared_by_email: trimString(actorEmail) || null,
    },
  };
}

function buildPreparedRunPayload({ runId, actorEmail, recruiterNotes, extraction, documents, bucket }) {
  const nowIso = new Date().toISOString();
  const preparation = buildPreparationSnapshot({ extraction, documents, actorEmail, bucket });
  const evidence = buildPreparedEvidenceSummary({
    documents: extraction.documents,
    combinedText: extraction.combinedText,
  });

  return {
    id: runId,
    created_by: null,
    candidate_name: evidence.inferred_candidate_name || null,
    current_or_recent_title: null,
    seniority_level: null,
    primary_discipline: null,
    recruiter_notes: sanitiseNotes(recruiterNotes) || null,
    extracted_text_summary: evidence.preview_text || null,
    candidate_summary_json: {},
    raw_result_json: {
      preparation,
      audit: {
        created_by_email: trimString(actorEmail) || null,
      },
    },
    best_match_job_id: null,
    best_match_job_slug: null,
    best_match_job_title: null,
    best_match_score: null,
    overall_recommendation: null,
    no_strong_match_reason: evidence.ready_for_match
      ? null
      : 'No readable candidate text has been prepared for matching yet.',
    error_message: evidence.ready_for_match
      ? null
      : 'Prepared evidence is not yet ready for matching because no readable candidate text was extracted.',
    match_job_id: null,
    match_job_status: null,
    match_job_queued_at: null,
    match_job_started_at: null,
    match_job_completed_at: null,
    match_job_failed_at: null,
    match_job_last_error: null,
    updated_at: nowIso,
    status: evidence.ready_for_match ? 'pending' : 'failed',
  };
}

async function maybeStoreUploads({ supabase, documents, runId, userEmail, shouldStore, timeoutMs }) {
  if (!shouldStore) {
    return { stored: false, bucket: '', warnings: [] };
  }

  const bucket = getUploadBucketName();
  const uploadTimeoutMs = Number(timeoutMs) || getPositiveTimeout(
    'CANDIDATE_MATCH_STORAGE_TIMEOUT_MS',
    DEFAULT_STORAGE_TIMEOUT_MS
  );
  const warnings = [];
  const storable = documents.filter((document) => document.buffer && SUPPORTED_EXTENSIONS.has(document.extension));

  if (!storable.length) {
    return { stored: false, bucket, warnings };
  }

  for (const document of storable) {
    const storageKey = buildStorageKey(runId, document.name);
    logMatcher('info', 'Writing candidate upload to storage', {
      bucket,
      storageKey,
      contentType: document.contentType || guessContentType(document.extension),
      bytes: document.buffer ? document.buffer.byteLength : 0,
    });
    const upload = await withTimeout(
      () => supabase.storage.from(bucket).upload(storageKey, document.buffer, {
        contentType: document.contentType || guessContentType(document.extension),
        upsert: false,
        metadata: {
          uploaded_by: userEmail || '',
          original_name: document.name,
          match_run_id: runId,
        }
      }),
      uploadTimeoutMs,
      () => coded(
        504,
        `Storage upload timed out after ${uploadTimeoutMs}ms for ${document.name}.`,
        'storage_upload_timeout',
        {
          details: {
            stage: 'storage_upload',
            timeout_ms: uploadTimeoutMs,
            file: document.name,
            bucket,
            storage_key: storageKey,
          }
        }
      )
    );

    if (upload.error) {
      logMatcher('error', 'Candidate upload storage write failed', {
        bucket,
        storageKey,
        error: trimString(upload.error.message) || 'storage error',
      });
      if (isMissingTableError(upload.error, bucket) || /bucket/i.test(String(upload.error.message || ''))) {
        warnings.push(`Upload storage unavailable for ${document.name}.`);
        continue;
      }
      warnings.push(`Failed to store ${document.name}: ${upload.error.message || 'storage error'}`);
      continue;
    }

    logMatcher('info', 'Candidate upload stored', { bucket, storageKey });
    document.storageKey = storageKey;
  }

  return {
    stored: documents.some((document) => !!document.storageKey),
    bucket,
    warnings,
  };
}

function buildExtractedTextSummary(result, extraction) {
  const summary = trimString(result?.candidate_summary?.summary);
  const role = trimString(result?.candidate_summary?.current_or_recent_title);
  const parts = [
    summary,
    role ? `Recent title: ${role}` : '',
    extraction?.successCount ? `Readable docs: ${extraction.successCount}` : '',
  ].filter(Boolean);
  return parts.join(' | ').slice(0, 2000);
}

function buildSavedRunPayload({ runId, actorEmail, recruiterNotes, extraction, analysisResult, documents, liveJobs }) {
  const topMatch = Array.isArray(analysisResult?.top_matches) ? analysisResult.top_matches[0] : null;
  const topJob = Array.isArray(liveJobs)
    ? liveJobs.find((job) => trimString(job?.job_id) === trimString(topMatch?.job_id))
    : null;
  const candidateSummary = analysisResult?.candidate_summary && typeof analysisResult.candidate_summary === 'object'
    ? analysisResult.candidate_summary
    : {};
  const nowIso = new Date().toISOString();

  return {
    id: runId,
    created_by: null,
    candidate_name: trimString(candidateSummary.name) || null,
    current_or_recent_title: trimString(candidateSummary.current_or_recent_title) || null,
    seniority_level: trimString(candidateSummary.seniority_level) || null,
    primary_discipline: trimString(candidateSummary.primary_discipline) || null,
    recruiter_notes: sanitiseNotes(recruiterNotes) || null,
    extracted_text_summary: buildExtractedTextSummary(analysisResult, extraction) || null,
    candidate_summary_json: candidateSummary,
    raw_result_json: {
      result: analysisResult,
      extraction: {
        success_count: extraction.successCount,
        failure_count: extraction.failureCount,
        documents: extraction.documents.map(summariseDocument),
      },
      audit: {
        created_by_email: trimString(actorEmail) || null,
      },
      stored_files: documents
        .filter((document) => document.storageKey)
        .map((document) => ({
          name: document.name,
          storage_key: document.storageKey,
          extraction_status: normaliseExtractionStatus(document.status),
        })),
    },
    best_match_job_id: trimString(topMatch?.job_id) || null,
    best_match_job_slug: trimString(topJob?.job_slug || topJob?.public_metadata?.slug) || null,
    best_match_job_title: trimString(topMatch?.job_title) || trimString(topJob?.title) || null,
    best_match_score: Number.isFinite(Number(topMatch?.score)) ? Number(topMatch.score) : null,
    overall_recommendation: trimString(analysisResult?.overall_recommendation) || null,
    no_strong_match_reason: trimString(analysisResult?.no_strong_match_reason) || null,
    error_message: null,
    match_job_id: null,
    match_job_status: null,
    match_job_queued_at: null,
    match_job_started_at: null,
    match_job_completed_at: null,
    match_job_failed_at: null,
    match_job_last_error: null,
    updated_at: nowIso,
    status: 'completed',
  };
}

function buildSavedFilePayloads({ runId, documents, bucket }) {
  return documents
    .filter((document) => document.storageKey)
    .map((document) => ({
      match_run_id: runId,
      uploaded_by: null,
      original_filename: document.name,
      mime_type: document.contentType || guessContentType(document.extension),
      file_size_bytes: Number.isFinite(Number(document.size)) ? Number(document.size) : null,
      storage_bucket: bucket,
      storage_path: document.storageKey,
      extraction_status: normaliseExtractionStatus(document.status),
      extracted_text: document.status === 'ok' ? (document.extractedText || null) : null,
      extraction_error: document.status === 'ok' ? null : (trimString(document.error) || 'Extraction failed'),
    }));
}

async function saveMatchFiles({ supabase, runId, documents, bucket }) {
  const payload = buildSavedFilePayloads({ runId, documents, bucket });
  if (!payload.length) {
    return { saved: false, reason: 'no_uploaded_files', count: 0 };
  }

  const { data, error } = await supabase
    .from(MATCH_FILES_TABLE)
    .insert(payload)
    .select('id');

  if (error) {
    if (isMissingTableError(error, MATCH_FILES_TABLE)) {
      return { saved: false, reason: 'table_missing', count: 0 };
    }
    throw error;
  }

  return { saved: true, reason: null, count: Array.isArray(data) ? data.length : payload.length };
}

async function savePreparedRun({ supabase, runId, actorEmail, recruiterNotes, extraction, documents, bucket, timeoutMs }) {
  const saveTimeoutMs = Number(timeoutMs) || getPositiveTimeout(
    'CANDIDATE_MATCH_HISTORY_TIMEOUT_MS',
    DEFAULT_HISTORY_TIMEOUT_MS
  );
  const payload = buildPreparedRunPayload({
    runId,
    actorEmail,
    recruiterNotes,
    extraction,
    documents,
    bucket,
  });

  const { data, error } = await withTimeout(
    () => supabase
      .from(MATCH_RUNS_TABLE)
      .insert(payload)
      .select(MATCH_RUN_SELECT)
      .single(),
    saveTimeoutMs,
    () => coded(
      504,
      `Prepared evidence save timed out after ${saveTimeoutMs}ms.`,
      'prepare_save_timeout',
      {
        details: {
          stage: 'prepared_evidence_save',
          timeout_ms: saveTimeoutMs,
        }
      }
    )
  );

  if (error) {
    if (isMissingTableError(error, MATCH_RUNS_TABLE)) {
      return { saved: false, enabled: false, reason: 'table_missing', record: null, files: { saved: false, reason: 'table_missing', count: 0 } };
    }
    throw error;
  }

  const files = await withTimeout(
    () => saveMatchFiles({ supabase, runId, documents, bucket }),
    saveTimeoutMs,
    () => coded(
      504,
      `Prepared evidence file save timed out after ${saveTimeoutMs}ms.`,
      'prepare_files_save_timeout',
      {
        details: {
          stage: 'prepared_evidence_save',
          timeout_ms: saveTimeoutMs,
        }
      }
    )
  );

  return { saved: true, enabled: true, record: data, files };
}

function extractPreparedCombinedText(run, files) {
  const preparation = run?.raw_result_json?.preparation;
  const preparedText = trimString(preparation?.combined_candidate_text);
  if (preparedText) return preparedText;

  return normaliseWhitespace((Array.isArray(files) ? files : [])
    .map((file) => trimString(file?.extracted_text))
    .filter(Boolean)
    .join('\n\n'));
}

function buildPreparedEvidenceFromStored(run, files) {
  const preparation = run?.raw_result_json?.preparation && typeof run.raw_result_json.preparation === 'object'
    ? run.raw_result_json.preparation
    : {};
  const preparedDocs = Array.isArray(preparation.documents) ? preparation.documents : [];
  const fileRows = Array.isArray(files) ? files : [];
  const byName = fileRows.reduce((map, file) => {
    const key = trimString(file?.original_filename);
    if (key) map.set(key, file);
    return map;
  }, new Map());
  const docs = preparedDocs.length
    ? preparedDocs.map((document) => {
      const file = byName.get(trimString(document?.name));
      return {
        ...document,
        name: trimString(document?.name),
        extension: trimString(document?.extension),
        contentType: trimString(document?.contentType),
        fileKind: trimString(document?.fileKind),
        extractionMode: trimString(document?.extractionMode),
        parserPath: trimString(document?.parserPath),
        size: Number.isFinite(Number(document?.size)) ? Number(document.size) : (Number.isFinite(Number(file?.file_size_bytes)) ? Number(file.file_size_bytes) : 0),
        status: trimString(document?.status),
        error: trimString(document?.error),
        storageKey: trimString(document?.storageKey) || trimString(file?.storage_path),
        extractedTextLength: Number.isFinite(Number(document?.extractedTextLength)) ? Number(document.extractedTextLength) : 0,
      };
    })
    : fileRows.map((file) => ({
      id: trimString(file?.id),
      name: trimString(file?.original_filename),
      extension: inferExtensionFromMime(file?.mime_type) || getExtension(file?.original_filename),
      contentType: trimString(file?.mime_type),
      fileKind: classifyCandidateFile({ filename: file?.original_filename, contentType: file?.mime_type }).fileKind,
      extractionMode: classifyCandidateFile({ filename: file?.original_filename, contentType: file?.mime_type }).extractionMode,
      parserPath: '',
      size: Number.isFinite(Number(file?.file_size_bytes)) ? Number(file.file_size_bytes) : 0,
      status: trimString(file?.extraction_status) === 'completed'
        ? (trimString(file?.extracted_text) ? 'ok' : (classifyCandidateFile({ filename: file?.original_filename, contentType: file?.mime_type }).fileKind === 'image' ? 'image_only' : 'limited'))
        : 'failed',
      error: trimString(file?.extraction_error),
      storageKey: trimString(file?.storage_path),
      extractedTextLength: trimString(file?.extracted_text).length,
    }));

  return buildPreparedEvidenceSummary({
    documents: docs,
    combinedText: extractPreparedCombinedText(run, fileRows),
  });
}

function buildCandidatePayloadFromPreparedRun(run, recruiterNotes) {
  const files = Array.isArray(run?.files) ? run.files : [];
  const preparation = run?.raw_result_json?.preparation && typeof run.raw_result_json.preparation === 'object'
    ? run.raw_result_json.preparation
    : {};
  const combinedText = extractPreparedCombinedText(run, files);
  const imageEvidence = Array.isArray(preparation.image_evidence)
    ? preparation.image_evidence.map((document) => ({
      name: trimString(document?.name),
      fileKind: trimString(document?.file_kind) || 'image',
      extension: trimString(document?.extension) || 'image',
      error: trimString(document?.note),
    }))
    : files
      .filter((file) => classifyCandidateFile({ filename: file?.original_filename, contentType: file?.mime_type }).fileKind === 'image')
      .map((file) => ({
        name: trimString(file?.original_filename),
        fileKind: 'image',
        extension: inferExtensionFromMime(file?.mime_type) || getExtension(file?.original_filename) || 'image',
        error: trimString(file?.extraction_error) || 'Supporting image evidence included but not text-extracted in V1.',
      }));
  const extractedSummary = Array.isArray(preparation.documents)
    ? preparation.documents
    : files.map((file) => ({
      name: trimString(file?.original_filename),
      extension: inferExtensionFromMime(file?.mime_type) || getExtension(file?.original_filename),
      contentType: trimString(file?.mime_type),
      fileKind: classifyCandidateFile({ filename: file?.original_filename, contentType: file?.mime_type }).fileKind,
      size: Number.isFinite(Number(file?.file_size_bytes)) ? Number(file.file_size_bytes) : 0,
      status: trimString(file?.extraction_status) === 'completed' ? 'ok' : 'failed',
      extractedTextLength: trimString(file?.extracted_text).length,
      error: trimString(file?.extraction_error),
      storageKey: trimString(file?.storage_path),
    }));
  const preparedEvidence = buildPreparedEvidenceSummary({
    documents: extractedSummary,
    combinedText,
  });

  return {
    recruiter_notes: sanitiseNotes(recruiterNotes || run?.recruiter_notes),
    candidate_text: combinedText,
    evidence_summary: {
      preview_text: trimString(preparation.preview_text) || preparedEvidence.preview_text,
      files_attempted: preparedEvidence.files_attempted,
      files_text_read: preparedEvidence.files_text_read,
      image_evidence_count: preparedEvidence.image_evidence_count,
      failed_file_count: preparedEvidence.failed_count + preparedEvidence.limited_count + preparedEvidence.unsupported_count,
    },
    documents: extractedSummary,
    image_evidence: imageEvidence,
  };
}

function mergeMatchProgress(rawResultJson, updates = {}) {
  const raw = rawResultJson && typeof rawResultJson === 'object' ? { ...rawResultJson } : {};
  const existingMatch = raw.match && typeof raw.match === 'object'
    ? { ...raw.match }
    : {};
  const stage = trimString(updates.stage);
  const stageLabel = trimString(updates.stageLabel);
  const model = trimString(updates.model);
  const nowIso = trimString(updates.nowIso) || new Date().toISOString();
  const match = {
    ...existingMatch,
    job_id: trimString(updates.jobId) || trimString(existingMatch.job_id) || null,
    status: trimString(updates.status) || trimString(existingMatch.status) || null,
    stage: stage || trimString(existingMatch.stage) || null,
    stage_label: stageLabel || trimString(existingMatch.stage_label) || null,
    stage_updated_at: (stage || stageLabel) ? nowIso : (trimString(existingMatch.stage_updated_at) || null),
    model: model || trimString(existingMatch.model) || null,
    request_metrics: updates.requestMetrics || existingMatch.request_metrics || null,
    response_metrics: updates.responseMetrics || existingMatch.response_metrics || null,
    validation: updates.validation || existingMatch.validation || null,
    response_received: typeof updates.responseReceived === 'boolean'
      ? updates.responseReceived
      : existingMatch.response_received === true,
    error: updates.clearError
      ? null
      : (updates.errorSummary || existingMatch.error || null),
    matched_at: trimString(updates.matchedAt) || trimString(existingMatch.matched_at) || null,
    matched_by_email: trimString(updates.actorEmail) || trimString(existingMatch.matched_by_email) || null,
    live_jobs_count: Number.isFinite(Number(updates.liveJobsCount))
      ? Number(updates.liveJobsCount)
      : (Number.isFinite(Number(existingMatch.live_jobs_count)) ? Number(existingMatch.live_jobs_count) : null),
  };
  raw.match = match;
  return raw;
}

async function fetchRawResultJsonForRun({ supabase, runId, timeoutMs }) {
  const safeId = trimString(runId);
  if (!safeId) return {};
  const saveTimeoutMs = Number(timeoutMs) || getPositiveTimeout(
    'CANDIDATE_MATCH_HISTORY_TIMEOUT_MS',
    DEFAULT_HISTORY_TIMEOUT_MS
  );
  const { data, error } = await withTimeout(
    () => supabase
      .from(MATCH_RUNS_TABLE)
      .select('raw_result_json')
      .eq('id', safeId)
      .single(),
    saveTimeoutMs,
    () => coded(
      504,
      `Prepared run progress read timed out after ${saveTimeoutMs}ms.`,
      'prepared_run_progress_read_timeout'
    )
  );
  if (error) throw error;
  return data?.raw_result_json && typeof data.raw_result_json === 'object'
    ? data.raw_result_json
    : {};
}

function buildMatchedRunUpdate({
  existingRun,
  actorEmail,
  recruiterNotes,
  analysisResult,
  liveJobs,
  candidatePayload,
  model,
  diagnostics,
}) {
  const topMatch = Array.isArray(analysisResult?.top_matches) ? analysisResult.top_matches[0] : null;
  const topJob = Array.isArray(liveJobs)
    ? liveJobs.find((job) => trimString(job?.job_id) === trimString(topMatch?.job_id))
    : null;
  const candidateSummary = analysisResult?.candidate_summary && typeof analysisResult.candidate_summary === 'object'
    ? analysisResult.candidate_summary
    : {};
  const raw = existingRun?.raw_result_json && typeof existingRun.raw_result_json === 'object'
    ? { ...existingRun.raw_result_json }
    : {};
  const nowIso = new Date().toISOString();

  return {
    candidate_name: trimString(candidateSummary.name) || null,
    current_or_recent_title: trimString(candidateSummary.current_or_recent_title) || null,
    seniority_level: trimString(candidateSummary.seniority_level) || null,
    primary_discipline: trimString(candidateSummary.primary_discipline) || null,
    recruiter_notes: sanitiseNotes(recruiterNotes) || trimString(existingRun?.recruiter_notes) || null,
    extracted_text_summary: buildExtractedTextSummary(analysisResult, {
      successCount: Array.isArray(candidatePayload?.documents)
        ? candidatePayload.documents.filter((document) => trimString(document?.status) === 'ok').length
        : 0,
    }) || null,
    candidate_summary_json: candidateSummary,
    raw_result_json: mergeMatchProgress({
      ...raw,
      result: analysisResult,
    }, {
      jobId: trimString(existingRun?.match_job_id),
      status: 'completed',
      stage: 'completed',
      stageLabel: 'Match complete',
      nowIso,
      model,
      actorEmail,
      matchedAt: nowIso,
      liveJobsCount: Number(diagnostics?.live_jobs_sent_count) || (Array.isArray(liveJobs) ? liveJobs.length : 0),
      requestMetrics: diagnostics ? {
        candidate_text_chars: Number(diagnostics.candidate_text_chars) || 0,
        candidate_text_source_chars: Number(diagnostics.candidate_text_source_chars) || 0,
        live_jobs_total_count: Number(diagnostics.live_jobs_total_count) || (Array.isArray(liveJobs) ? liveJobs.length : 0),
        live_jobs_sent_count: Number(diagnostics.live_jobs_sent_count) || (Array.isArray(liveJobs) ? liveJobs.length : 0),
        live_jobs_json_chars: Number(diagnostics.live_jobs_json_chars) || 0,
        request_payload_json_chars: Number(diagnostics.request_payload_json_chars) || 0,
        max_output_tokens: Number(diagnostics.max_output_tokens) || null,
      } : null,
      responseMetrics: diagnostics ? {
        response_id: trimString(diagnostics.response_id),
        response_status: trimString(diagnostics.response_status),
        output_text_length: Number(diagnostics.output_text_length) || 0,
        parser_strategy: trimString(diagnostics.parser_strategy),
        wrapper_key: trimString(diagnostics.wrapper_key),
      } : null,
      validation: diagnostics ? {
        schema_name: trimString(diagnostics.schema_name),
      } : null,
      responseReceived: true,
      clearError: true,
    }),
    best_match_job_id: trimString(topMatch?.job_id) || null,
    best_match_job_slug: trimString(topJob?.job_slug || topJob?.public_metadata?.slug) || null,
    best_match_job_title: trimString(topMatch?.job_title) || trimString(topJob?.title) || null,
    best_match_score: Number.isFinite(Number(topMatch?.score)) ? Number(topMatch.score) : null,
    overall_recommendation: trimString(analysisResult?.overall_recommendation) || null,
    no_strong_match_reason: trimString(analysisResult?.no_strong_match_reason) || null,
    error_message: null,
    match_job_id: trimString(existingRun?.match_job_id) || null,
    match_job_status: 'completed',
    match_job_completed_at: nowIso,
    match_job_last_error: null,
    updated_at: nowIso,
    status: 'completed',
  };
}

async function updatePreparedRunWithMatch({ supabase, run, actorEmail, recruiterNotes, analysis, liveJobs, candidatePayload, timeoutMs }) {
  const saveTimeoutMs = Number(timeoutMs) || getPositiveTimeout(
    'CANDIDATE_MATCH_HISTORY_TIMEOUT_MS',
    DEFAULT_HISTORY_TIMEOUT_MS
  );
  const updatePayload = buildMatchedRunUpdate({
    existingRun: run,
    actorEmail,
    recruiterNotes,
    analysisResult: analysis.result,
    liveJobs,
    candidatePayload,
    model: analysis.model,
    diagnostics: analysis.diagnostics,
  });

  const { data, error } = await withTimeout(
    () => supabase
      .from(MATCH_RUNS_TABLE)
      .update(updatePayload)
      .eq('id', trimString(run?.id))
      .select(MATCH_RUN_SELECT)
      .single(),
    saveTimeoutMs,
    () => coded(
      504,
      `Match result save timed out after ${saveTimeoutMs}ms.`,
      'match_result_save_timeout',
      {
        details: {
          stage: 'history_save',
          timeout_ms: saveTimeoutMs,
        }
      }
    )
  );

  if (error) throw error;
  return data;
}

function summariseMatcherFailure(error) {
  const code = trimString(error?.code);
  const stage = trimString(error?.details?.stage_label || error?.details?.stage);
  const matchStage = trimString(error?.details?.match_stage_label || error?.details?.match_stage);
  const parseStage = trimString(error?.details?.parse_stage);
  const incompleteReason = trimString(error?.details?.incomplete_reason);
  const validationErrors = Array.isArray(error?.details?.validation_errors)
    ? error.details.validation_errors.map((value) => trimString(value)).filter(Boolean)
    : [];

  let userMessage = trimString(error?.message) || 'Matching failed.';
  if (code === 'openai_schema_definition_invalid' || code === 'openai_schema_rejected') {
    userMessage = 'Recruiter matching could not start because the AI response format is misconfigured.';
  } else if ([
    'openai_invalid_json',
    'openai_empty_response',
    'openai_refusal',
    'openai_schema_invalid',
    'openai_transport_invalid_json',
  ].includes(code)) {
    userMessage = 'Recruiter matching returned an unreadable AI response and did not save a result.';
  } else if (code === 'local_result_validation_failed') {
    userMessage = 'Recruiter matching returned data that could not be validated locally.';
  } else if (code === 'openai_incomplete_output') {
    userMessage = 'Recruiter matching stopped before the structured AI response completed.';
  } else if (code === 'openai_key_missing') {
    userMessage = 'Recruiter matching is not configured on this environment yet.';
  } else if (code === 'openai_timeout') {
    userMessage = 'Recruiter matching timed out before the AI response completed.';
  }

  const technicalParts = [];
  if (code) technicalParts.push(code);
  technicalParts.push(trimString(error?.message) || userMessage || 'Matching failed.');
  if (stage) technicalParts.push(`stage=${stage}`);
  if (matchStage) technicalParts.push(`match_stage=${matchStage}`);
  if (parseStage) technicalParts.push(`parse_stage=${parseStage}`);
  if (incompleteReason) technicalParts.push(`reason=${incompleteReason}`);
  if (validationErrors.length) {
    technicalParts.push(`validation=${validationErrors.slice(0, 3).join(' || ')}`);
  }

  return {
    code,
    userMessage,
    technicalMessage: technicalParts.join(' | ').slice(0, 1800),
  };
}

async function updatePreparedRunJobState({
  supabase,
  runId,
  recruiterNotes,
  jobId,
  status,
  stage,
  stageLabel,
  message,
  technicalMessage,
  details,
  timeoutMs,
}) {
  const safeId = trimString(runId);
  if (!safeId) return null;
  const safeStatus = trimString(status).toLowerCase();
  const nowIso = new Date().toISOString();
  const saveTimeoutMs = Number(timeoutMs) || getPositiveTimeout(
    'CANDIDATE_MATCH_HISTORY_TIMEOUT_MS',
    DEFAULT_HISTORY_TIMEOUT_MS
  );
  const patch = {
    updated_at: nowIso,
    recruiter_notes: sanitiseNotes(recruiterNotes) || undefined,
  };
  if (patch.recruiter_notes === undefined) delete patch.recruiter_notes;
  const rawResultJson = await fetchRawResultJsonForRun({
    supabase,
    runId: safeId,
    timeoutMs: saveTimeoutMs,
  }).catch(() => ({}));

  if (trimString(jobId)) patch.match_job_id = trimString(jobId);
  if (safeStatus === 'queued') {
    patch.status = 'processing';
    patch.error_message = null;
    patch.match_job_status = 'queued';
    patch.match_job_queued_at = nowIso;
    patch.match_job_started_at = null;
    patch.match_job_completed_at = null;
    patch.match_job_failed_at = null;
    patch.match_job_last_error = null;
    patch.raw_result_json = mergeMatchProgress(rawResultJson, {
      jobId,
      status: 'queued',
      stage: trimString(stage) || 'queued',
      stageLabel: trimString(stageLabel) || 'Match queued',
      nowIso,
      clearError: true,
      requestMetrics: details?.request_metrics || null,
      responseMetrics: null,
      validation: null,
      responseReceived: false,
    });
  } else if (safeStatus === 'running') {
    const existingMatchStatus = trimString(rawResultJson?.match?.status).toLowerCase();
    patch.status = 'processing';
    patch.error_message = null;
    patch.match_job_status = 'running';
    patch.match_job_started_at = existingMatchStatus === 'running' ? undefined : nowIso;
    patch.match_job_completed_at = null;
    patch.match_job_failed_at = null;
    patch.match_job_last_error = null;
    if (patch.match_job_started_at === undefined) delete patch.match_job_started_at;
    patch.raw_result_json = mergeMatchProgress(rawResultJson, {
      jobId,
      status: 'running',
      stage: trimString(stage) || trimString(rawResultJson?.match?.stage) || 'running',
      stageLabel: trimString(stageLabel) || trimString(rawResultJson?.match?.stage_label) || 'Background recruiter match running',
      nowIso,
      model: trimString(details?.model),
      clearError: true,
      requestMetrics: details?.request_metrics || null,
      responseMetrics: details?.response_metrics || null,
      validation: details?.validation || null,
      responseReceived: details?.response_received === true,
    });
  } else if (safeStatus === 'completed') {
    patch.status = 'completed';
    patch.error_message = null;
    patch.match_job_status = 'completed';
    patch.match_job_completed_at = nowIso;
    patch.match_job_failed_at = null;
    patch.match_job_last_error = null;
    patch.raw_result_json = mergeMatchProgress(rawResultJson, {
      jobId,
      status: 'completed',
      stage: trimString(stage) || 'completed',
      stageLabel: trimString(stageLabel) || 'Match complete',
      nowIso,
      model: trimString(details?.model),
      clearError: true,
      requestMetrics: details?.request_metrics || null,
      responseMetrics: details?.response_metrics || null,
      validation: details?.validation || null,
      responseReceived: details?.response_received === true,
      matchedAt: nowIso,
    });
  } else if (safeStatus === 'failed') {
    patch.status = 'failed';
    patch.error_message = trimString(message) || 'Matching failed.';
    patch.match_job_status = 'failed';
    patch.match_job_completed_at = null;
    patch.match_job_failed_at = nowIso;
    patch.match_job_last_error = trimString(technicalMessage) || trimString(message) || 'Matching failed.';
    patch.raw_result_json = mergeMatchProgress(rawResultJson, {
      jobId,
      status: 'failed',
      stage: trimString(stage) || trimString(rawResultJson?.match?.stage) || 'failed',
      stageLabel: trimString(stageLabel) || trimString(rawResultJson?.match?.stage_label) || 'Background recruiter match failed',
      nowIso,
      model: trimString(details?.model),
      errorSummary: trimString(technicalMessage) || trimString(message) || 'Matching failed.',
      requestMetrics: details?.request_metrics || null,
      responseMetrics: details?.response_metrics || null,
      validation: details?.validation || null,
      responseReceived: details?.response_received === true,
    });
  }

  const { data, error } = await withTimeout(
    () => supabase
      .from(MATCH_RUNS_TABLE)
      .update(patch)
      .eq('id', safeId)
      .select(MATCH_RUN_SELECT)
      .single(),
    saveTimeoutMs,
    () => coded(
      504,
      `Prepared run job state update timed out after ${saveTimeoutMs}ms.`,
      'prepared_run_job_update_timeout'
    )
  );

  if (error) throw error;
  return data;
}

async function markPreparedRunFailure({ supabase, runId, jobId, message, technicalMessage, error, timeoutMs }) {
  const safeId = trimString(runId);
  if (!safeId) return;
  const failure = summariseMatcherFailure(error || { message, details: { validation_errors: [] }, code: '' });
  await updatePreparedRunJobState({
    supabase,
    runId: safeId,
    jobId,
    status: 'failed',
    message: trimString(message) || failure.userMessage,
    technicalMessage: trimString(technicalMessage) || failure.technicalMessage,
    stage: trimString(error?.details?.match_stage || error?.details?.stage),
    stageLabel: trimString(error?.details?.match_stage_label),
    details: {
      model: trimString(error?.details?.model),
      request_metrics: error?.details && typeof error.details === 'object'
        ? {
          candidate_text_chars: Number(error.details.candidate_text_chars) || 0,
          candidate_text_source_chars: Number(error.details.candidate_text_source_chars) || 0,
          live_jobs_total_count: Number(error.details.live_jobs_total_count) || 0,
          live_jobs_sent_count: Number(error.details.live_jobs_sent_count) || 0,
          live_jobs_json_chars: Number(error.details.live_jobs_json_chars) || 0,
          request_payload_json_chars: Number(error.details.request_payload_json_chars) || 0,
          max_output_tokens: Number(error.details.max_output_tokens) || null,
        }
        : null,
      response_metrics: error?.details && typeof error.details === 'object'
        ? {
          response_id: trimString(error.details.response_id),
          response_status: trimString(error.details.response_status),
          openai_status: Number(error.details.openai_status) || null,
          output_text_length: Number(error.details.output_text_length) || 0,
        }
        : null,
      validation: error?.details && typeof error.details === 'object'
        ? {
          schema_name: trimString(error.details.schema_name),
          parse_stage: trimString(error.details.parse_stage),
          validation_errors: Array.isArray(error.details.validation_errors)
            ? error.details.validation_errors.slice(0, 6)
            : [],
        }
        : null,
      response_received: error?.details?.response_received === true,
    },
    timeoutMs,
  }).catch(() => {});
}

async function saveMatchRun({ supabase, runId, actorEmail, recruiterNotes, extraction, analysisResult, documents, bucket, liveJobs, enabled, timeoutMs }) {
  if (!enabled) {
    return { saved: false, enabled: false, reason: 'disabled' };
  }

  const saveTimeoutMs = Number(timeoutMs) || getPositiveTimeout(
    'CANDIDATE_MATCH_HISTORY_TIMEOUT_MS',
    DEFAULT_HISTORY_TIMEOUT_MS
  );

  const payload = buildSavedRunPayload({
    runId,
    actorEmail,
    recruiterNotes,
    extraction,
    analysisResult,
    documents,
    liveJobs,
  });

  const { data, error } = await withTimeout(
    () => supabase
      .from(MATCH_RUNS_TABLE)
      .insert(payload)
      .select('id,created_at,candidate_name,best_match_job_id,best_match_score,status')
      .single(),
    saveTimeoutMs,
    () => coded(
      504,
      `History save timed out after ${saveTimeoutMs}ms.`,
      'history_save_timeout',
      {
        details: {
          stage: 'history_save',
          timeout_ms: saveTimeoutMs,
        }
      }
    )
  );

  if (error) {
    if (isMissingTableError(error, MATCH_RUNS_TABLE)) {
      return { saved: false, enabled: false, reason: 'table_missing' };
    }
    throw error;
  }

  const files = await withTimeout(
    () => saveMatchFiles({ supabase, runId, documents, bucket }),
    saveTimeoutMs,
    () => coded(
      504,
      `History file save timed out after ${saveTimeoutMs}ms.`,
      'history_files_save_timeout',
      {
        details: {
          stage: 'history_save',
          timeout_ms: saveTimeoutMs,
        }
      }
    )
  );
  return { saved: true, enabled: true, record: data, files };
}

function normaliseHistoryRow(row, files) {
  const raw = row?.raw_result_json && typeof row.raw_result_json === 'object'
    ? row.raw_result_json
    : {};
  const result = raw.result && typeof raw.result === 'object' ? raw.result : {};
  const preparation = raw.preparation && typeof raw.preparation === 'object' ? raw.preparation : {};
  const matchMeta = raw.match && typeof raw.match === 'object' ? raw.match : {};
  const topMatch = Array.isArray(result.top_matches) ? result.top_matches[0] : null;
  const candidateSummary = row?.candidate_summary_json && typeof row.candidate_summary_json === 'object'
    ? row.candidate_summary_json
    : (result?.candidate_summary && typeof result.candidate_summary === 'object' ? result.candidate_summary : {});
  const fileRows = Array.isArray(files) ? files : [];
  const preparedEvidence = buildPreparedEvidenceFromStored({ raw_result_json: raw }, fileRows);

  return {
    id: trimString(row?.id),
    created_at: trimString(row?.created_at),
    updated_at: trimString(row?.updated_at),
    created_by: trimString(row?.created_by),
    candidate_name: trimString(row?.candidate_name) || trimString(candidateSummary?.name),
    file_names: fileRows.map((file) => trimString(file?.original_filename)).filter(Boolean),
    files: fileRows.map((file) => ({
      id: trimString(file?.id),
      original_filename: trimString(file?.original_filename),
      mime_type: trimString(file?.mime_type),
      file_size_bytes: Number.isFinite(Number(file?.file_size_bytes)) ? Number(file.file_size_bytes) : null,
      storage_bucket: trimString(file?.storage_bucket),
      storage_path: trimString(file?.storage_path),
      extraction_status: trimString(file?.extraction_status) || 'pending',
      extraction_error: trimString(file?.extraction_error),
    })),
    recruiter_notes: trimString(row?.recruiter_notes),
    extracted_text_summary: trimString(row?.extracted_text_summary),
    best_match_job_id: trimString(row?.best_match_job_id) || trimString(topMatch?.job_id),
    best_match_job_slug: trimString(row?.best_match_job_slug),
    best_match_score: Number.isFinite(Number(row?.best_match_score))
      ? Number(row.best_match_score)
      : (Number.isFinite(Number(topMatch?.score)) ? Number(topMatch.score) : null),
    best_match_job_title: trimString(row?.best_match_job_title) || trimString(topMatch?.job_title),
    current_or_recent_title: trimString(row?.current_or_recent_title) || trimString(candidateSummary?.current_or_recent_title),
    seniority_level: trimString(row?.seniority_level) || trimString(candidateSummary?.seniority_level),
    primary_discipline: trimString(row?.primary_discipline) || trimString(candidateSummary?.primary_discipline),
    overall_recommendation: trimString(row?.overall_recommendation) || trimString(result?.overall_recommendation),
    no_strong_match_reason: trimString(row?.no_strong_match_reason) || trimString(result?.no_strong_match_reason),
    error_message: trimString(row?.error_message),
    status: trimString(row?.status) || 'completed',
    match_job: {
      id: trimString(row?.match_job_id),
      status: trimString(row?.match_job_status),
      stage: trimString(matchMeta?.stage),
      stage_label: trimString(matchMeta?.stage_label),
      stage_updated_at: trimString(matchMeta?.stage_updated_at),
      model: trimString(matchMeta?.model),
      queued_at: trimString(row?.match_job_queued_at),
      started_at: trimString(row?.match_job_started_at),
      completed_at: trimString(row?.match_job_completed_at),
      failed_at: trimString(row?.match_job_failed_at),
      last_error: trimString(row?.match_job_last_error),
    },
    ready_for_match: preparation.ready_for_match === true || preparedEvidence.ready_for_match,
    has_result: !!(result && Object.keys(result).length),
    prepared_evidence: preparedEvidence,
    raw_result_json: raw,
  };
}

async function getMatchRun(supabase, runId) {
  const safeId = trimString(runId);
  if (!safeId) {
    throw coded(400, 'Prepared evidence ID is required before running a match.', 'prepared_run_id_missing');
  }

  const { data, error } = await supabase
    .from(MATCH_RUNS_TABLE)
    .select(MATCH_RUN_SELECT)
    .eq('id', safeId)
    .single();

  if (error) {
    if (isMissingTableError(error, MATCH_RUNS_TABLE)) {
      throw coded(503, 'Prepared evidence history is not configured in this environment.', 'history_table_missing');
    }
    throw error;
  }

  const filesResponse = await supabase
    .from(MATCH_FILES_TABLE)
    .select('id,match_run_id,original_filename,mime_type,file_size_bytes,storage_bucket,storage_path,extraction_status,extraction_error,extracted_text')
    .eq('match_run_id', safeId)
    .order('created_at', { ascending: true });

  if (filesResponse.error && !isMissingTableError(filesResponse.error, MATCH_FILES_TABLE)) {
    throw filesResponse.error;
  }

  return normaliseHistoryRow(data, Array.isArray(filesResponse.data) ? filesResponse.data : []);
}

async function listMatchRuns(supabase, limit = DEFAULT_HISTORY_LIMIT) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_HISTORY_LIMIT, 20));
  const { data, error } = await supabase
    .from(MATCH_RUNS_TABLE)
    .select(MATCH_RUN_SELECT)
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (error) {
    if (isMissingTableError(error, MATCH_RUNS_TABLE)) {
      return { enabled: false, runs: [] };
    }
    throw error;
  }

  const runs = Array.isArray(data) ? data : [];
  const runIds = runs.map((row) => trimString(row?.id)).filter(Boolean);
  let filesByRunId = new Map();

  if (runIds.length) {
    const filesResponse = await supabase
      .from(MATCH_FILES_TABLE)
      .select('id,match_run_id,original_filename,mime_type,file_size_bytes,storage_bucket,storage_path,extraction_status,extraction_error')
      .in('match_run_id', runIds)
      .order('created_at', { ascending: true });

    if (filesResponse.error) {
      if (!isMissingTableError(filesResponse.error, MATCH_FILES_TABLE)) {
        throw filesResponse.error;
      }
    } else {
      filesByRunId = (Array.isArray(filesResponse.data) ? filesResponse.data : []).reduce((map, row) => {
        const key = trimString(row?.match_run_id);
        if (!key) return map;
        const bucket = map.get(key) || [];
        bucket.push(row);
        map.set(key, bucket);
        return map;
      }, new Map());
    }
  }

  return {
    enabled: true,
    runs: runs.map((row) => normaliseHistoryRow(row, filesByRunId.get(trimString(row?.id)) || [])),
  };
}

module.exports = {
  MATCH_FILES_TABLE,
  MATCH_RESULT_SCHEMA,
  MATCH_RESULT_SCHEMA_NAME,
  MATCH_RUNS_TABLE,
  SUPPORTED_EXTENSIONS,
  buildCandidatePayloadFromPreparedRun,
  callOpenAIForMatch,
  buildPreparedEvidenceSummary,
  buildCandidatePayload,
  coded,
  extractCandidateDocuments,
  fetchPublishedLiveJobs,
  formatFileSize,
  getMatchRun,
  listMatchRuns,
  markPreparedRunFailure,
  maybeStoreUploads,
  parseMatcherJsonText,
  parseOpenAIMatchResponse,
  prepareCandidateFiles,
  savePreparedRun,
  saveMatchRun,
  sanitiseNotes,
  summariseMatcherFailure,
  summariseDocument,
  updatePreparedRunJobState,
  updatePreparedRunWithMatch,
  validateMatcherResultAgainstSchema,
  validateStructuredOutputSchema,
  withTimeout,
};
