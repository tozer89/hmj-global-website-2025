'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { slugify } = require('../netlify/functions/_jobs-helpers.js');
const candidateMatcherCore = require('./candidate-matcher-core.js');
const { parseCsv, stringifyCsv } = require('./simple-csv.js');
const { parseYaml } = require('./simple-yaml.js');

const WORKFLOW_VERSION = 1;
const ROLE_INPUTS_DIR = 'inputs';
const ROLE_OUTPUTS_DIR = 'outputs';
const ROLE_RECORDS_DIR = 'records';
const ROLE_DRAFTS_DIR = 'drafts';
const ROLE_CVS_DIR = 'cvs';
const DEFAULT_ROLE_FILE = 'job-spec.yaml';
const DEFAULT_CANDIDATES_FILE = 'candidates.json';
const DEFAULT_CANDIDATES_CSV_FILE = 'candidates.csv';
const DEFAULT_OPERATOR_OVERRIDES_FILE = 'operator-overrides.json';
const DEFAULT_ROLE_CONFIG_FILE = 'role-config.json';
const DEFAULT_CANDIDATE_EXPORT_FILE = 'candidate-review-export.csv';
const DEFAULT_RUN_SUMMARY_FILE = 'run-summary.json';
const DEFAULT_IMPORT_HISTORY_FILE = 'import-history.json';
const DEFAULT_BULK_CV_IMPORT_HISTORY_FILE = 'bulk-cv-import-history.json';
const DEFAULT_RUN_HISTORY_FILE = 'run-history.json';
const DEFAULT_RECONCILE_SUMMARY_FILE = 'reconcile-summary.json';
const DEFAULT_PORT = 4287;
const BULK_CV_MAX_FILES = 20;
const BULK_CV_MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const BULK_CV_ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'txt', 'doc']);
const PREVIEW_CLASSIFICATIONS = ['strong_open', 'maybe_open', 'low_priority', 'reject'];
const SHORTLIST_STATUSES = ['strong_shortlist', 'possible_shortlist', 'do_not_progress'];
const OPERATOR_DECISIONS = ['manual_screened', 'hold', 'do_not_progress', 'contacted', 'awaiting_reply', 'closed'];
const SHORTLIST_BUCKETS = ['primary', 'backup', 'hold', 'do_not_progress'];
const RECRUITER_CONFIDENCE_LEVELS = ['low', 'medium', 'high'];
const CONTACT_LIFECYCLE_STAGES = ['contacted', 'awaiting_reply', 'closed'];
const LIFECYCLE_STAGES = [
  'preview_only',
  'strong_open',
  'maybe_open',
  'low_priority',
  'reject',
  'cv_reviewed',
  'strong_shortlist',
  'possible_shortlist',
  'do_not_progress',
  'outreach_ready',
  'outreach_drafted',
  'contacted',
  'awaiting_reply',
  'closed',
];
const ROLE_WORKFLOW_STATES = [
  'gathering_candidates',
  'screening_in_progress',
  'shortlist_in_progress',
  'shortlist_target_reached',
  'outreach_ready',
  'outreach_in_progress',
  'awaiting_candidate_replies',
  'role_paused',
  'role_closed',
];
const REQUIRED_CSV_COLUMNS = ['source', 'search_variant'];
const ROLE_LOCK_FILE = '.role-run-lock.json';
const ROLE_LOCK_STALE_MS = 30 * 60 * 1000;
const HISTORY_ENTRY_LIMIT = 40;

const TITLE_SYNONYM_MAP = {
  'site manager': ['construction manager', 'project manager', 'works manager'],
  'construction manager': ['site manager', 'project manager', 'package manager'],
  'project manager': ['construction manager', 'site manager', 'contracts manager'],
  'electrical supervisor': ['electrical site supervisor', 'electrical foreman', 'site supervisor'],
  'commissioning engineer': ['commissioning manager', 'electrical commissioning engineer', 'ica engineer'],
  'quantity surveyor': ['commercial manager', 'cost manager', 'senior quantity surveyor'],
  'planner': ['project planner', 'project controls planner', 'senior planner'],
  'commercial manager': ['quantity surveyor', 'senior quantity surveyor', 'cost manager'],
};

const SECTOR_SYNONYM_MAP = {
  'data centre': ['data center', 'mission critical', 'hyperscale', 'colocation'],
  'mission critical': ['data centre', 'data center', 'hyperscale'],
  pharma: ['pharmaceutical', 'life sciences', 'biopharma', 'gmp'],
  'life sciences': ['pharma', 'pharmaceutical', 'biotech', 'cleanroom'],
  cleanroom: ['clean room', 'gmp', 'aseptic', 'controlled environment'],
  substation: ['power', 'hv', 'transmission', 'distribution'],
  energy: ['power', 'hv', 'substation', 'grid'],
};

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function normaliseWhitespace(value, maxLength) {
  return trimString(String(value == null ? '' : value).replace(/\s+/g, ' '), maxLength);
}

function uniqueStrings(values, maxItems = 0, maxLength = 160) {
  const output = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const cleaned = normaliseWhitespace(value, maxLength);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(cleaned);
  });
  if (Number.isInteger(maxItems) && maxItems > 0) {
    return output.slice(0, maxItems);
  }
  return output;
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function ensureRoleWorkspaceStructure(roleDir) {
  ensureDir(roleDir);
  ensureDir(path.join(roleDir, ROLE_INPUTS_DIR));
  ensureDir(path.join(roleDir, ROLE_OUTPUTS_DIR));
  ensureDir(path.join(roleDir, ROLE_RECORDS_DIR));
  ensureDir(path.join(roleDir, ROLE_DRAFTS_DIR));
  ensureDir(path.join(roleDir, ROLE_CVS_DIR));
}

function createWorkflowError(message, options = {}) {
  const error = new Error(message);
  error.code = options.code || 'workflow_error';
  error.statusCode = options.statusCode || 400;
  if (options.details !== undefined) error.details = options.details;
  return error;
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(readTextFile(filePath));
  } catch {
    return fallback;
  }
}

function readJsonFileStrict(filePath, label = 'JSON file') {
  try {
    return JSON.parse(readTextFile(filePath));
  } catch (error) {
    throw createWorkflowError(`${label} is not valid JSON at ${filePath}.`, {
      code: 'invalid_json',
      statusCode: 400,
      details: { filePath, cause: error?.message || String(error) },
    });
  }
}

function atomicWriteFile(filePath, text) {
  ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, String(text == null ? '' : text), 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function writeJsonFile(filePath, value) {
  atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextFile(filePath, text) {
  atomicWriteFile(filePath, text);
}

function appendJsonLine(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function historyFilePath(roleDir, fileName) {
  return path.join(roleDir, ROLE_OUTPUTS_DIR, fileName);
}

function readHistoryEntries(roleDir, fileName) {
  const data = readJsonFile(historyFilePath(roleDir, fileName), []);
  return Array.isArray(data) ? data : [];
}

function writeHistoryEntries(roleDir, fileName, entries) {
  writeJsonFile(historyFilePath(roleDir, fileName), entries.slice(-HISTORY_ENTRY_LIMIT));
}

function limitHistoryIds(values, maxItems = 25) {
  const ids = uniqueStrings(values, maxItems, 120);
  return {
    count: uniqueStrings(values, 0, 120).length,
    ids,
    truncated: uniqueStrings(values, 0, 120).length > ids.length,
  };
}

function appendHistoryEntry(roleDir, fileName, entry) {
  const existing = readHistoryEntries(roleDir, fileName);
  existing.push(entry);
  writeHistoryEntries(roleDir, fileName, existing);
  return entry;
}

function previewExcerpt(value, maxLength = 420) {
  return trimString(normaliseWhitespace(value, maxLength + 20), maxLength);
}

function listValue(value) {
  if (Array.isArray(value)) return uniqueStrings(value, 0, 220);
  return trimString(value, 220);
}

function filenameStem(fileName) {
  const base = path.basename(trimString(fileName, 240));
  const extension = path.extname(base);
  return extension ? base.slice(0, -extension.length) : base;
}

function safeUploadFileName(fileName, fallbackExtension = '') {
  const stem = slugify(filenameStem(fileName).toLowerCase()).replace(/^-+|-+$/g, '') || 'uploaded-cv';
  const extension = trimString(path.extname(fileName).slice(1).toLowerCase(), 16) || trimString(fallbackExtension, 16);
  return extension ? `${stem}.${extension}` : stem;
}

function titleCaseSlug(value) {
  return trimString(value, 160)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normaliseIdentityKeyPart(value) {
  return slugify(trimString(value, 120).toLowerCase()).replace(/^-+|-+$/g, '');
}

function extractEmailFromText(text) {
  const match = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return trimString(match?.[0], 240);
}

function splitCvLines(text) {
  return String(text || '')
    .split(/\r?\n+/)
    .map((line) => normaliseWhitespace(line, 160))
    .filter(Boolean)
    .slice(0, 40);
}

function looksLikeCvSectionHeading(line) {
  const lowered = trimString(line, 160).toLowerCase();
  if (!lowered) return false;
  return [
    'profile',
    'summary',
    'professional summary',
    'experience',
    'employment history',
    'work history',
    'education',
    'qualifications',
    'skills',
    'projects',
    'references',
    'contact',
    'details',
    'curriculum vitae',
    'cv',
  ].includes(lowered);
}

function looksLikeCandidateNameLine(line) {
  const text = trimString(line, 120);
  if (!text || text.length < 5 || text.length > 60) return false;
  if (/@|https?:\/\/|\d{3,}/i.test(text)) return false;
  if (looksLikeCvSectionHeading(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[A-Za-z'’.-]+$/.test(word));
}

function inferCandidateNameFromCvText(text, fallbackFileName = '') {
  const lines = splitCvLines(text);
  const matchedLine = lines.find((line) => looksLikeCandidateNameLine(line));
  if (matchedLine) return trimString(matchedLine, 160);

  const email = extractEmailFromText(text);
  if (email) {
    const localPart = trimString(email.split('@')[0], 120).replace(/[._-]+/g, ' ');
    if (localPart) return titleCaseSlug(localPart);
  }

  return titleCaseSlug(filenameStem(fallbackFileName));
}

function looksLikeTitleLine(line, candidateName = '') {
  const text = trimString(line, 140);
  if (!text || text.length < 4 || text.length > 80) return false;
  if (/@|https?:\/\/|\d{3,}/i.test(text)) return false;
  if (looksLikeCvSectionHeading(text)) return false;
  if (candidateName && text.toLowerCase() === candidateName.toLowerCase()) return false;
  return /(manager|engineer|supervisor|surveyor|planner|director|coordinator|lead|technician|foreman|consultant|estimator|electrician|commercial|package|construction|commissioning|site)/i.test(text);
}

function inferCandidateTitleFromCvText(text, candidateName = '') {
  const lines = splitCvLines(text);
  const titleLine = lines.find((line) => looksLikeTitleLine(line, candidateName));
  return trimString(titleLine, 160);
}

function inferCandidateLocationFromCvText(text) {
  const lines = splitCvLines(text).slice(0, 12);
  const locationLine = lines.find((line) => {
    if (/@|https?:\/\/|\d{3,}/i.test(line)) return false;
    return /\b(?:London|Leeds|Bradford|Manchester|Birmingham|Bristol|Glasgow|Edinburgh|Dublin|Belfast|Liverpool|Sheffield|Nottingham|Cardiff|Reading|Oxford|Cambridge|Milton Keynes|Newcastle|Luton|Slough|Watford|Kent|Surrey|Yorkshire|Midlands|Scotland|Wales)\b/i.test(line);
  });
  return trimString(locationLine, 160);
}

function summariseBulkCvText(text) {
  const cleaned = normaliseWhitespace(text, 2000);
  if (!cleaned) return '';
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  const excerpt = sentences.length
    ? sentences.slice(0, 3).join(' ')
    : cleaned;
  return trimString(excerpt, 680);
}

function buildBulkCvFingerprint(buffer) {
  return createHash('sha1').update(buffer).digest('hex');
}

function buildBulkCvIdentityKey(candidate = {}) {
  return [
    normaliseIdentityKeyPart(candidate.email),
    normaliseIdentityKeyPart(candidate.candidate_name),
    normaliseIdentityKeyPart(candidate.current_title),
    normaliseIdentityKeyPart(candidate.location),
  ].filter(Boolean).join('|');
}

function findMatchingCandidateForBulkCv(existingCandidates, candidate) {
  const emailKey = normaliseIdentityKeyPart(candidate.email);
  if (emailKey) {
    const byEmail = (existingCandidates || []).find((entry) => normaliseIdentityKeyPart(entry.email) === emailKey);
    if (byEmail) return byEmail;
  }

  const identityKey = buildBulkCvIdentityKey(candidate);
  if (identityKey) {
    const byIdentity = (existingCandidates || []).find((entry) => buildBulkCvIdentityKey(entry) === identityKey);
    if (byIdentity) return byIdentity;
  }

  return null;
}

function buildBulkCvCandidateId(candidate, existingCandidates, reservedIds = new Set()) {
  const matched = findMatchingCandidateForBulkCv(existingCandidates, candidate);
  if (matched?.candidate_id) return matched.candidate_id;

  const base = [
    normaliseIdentityKeyPart(candidate.candidate_name),
    normaliseIdentityKeyPart(candidate.current_title),
  ].filter(Boolean).join('-') || normaliseIdentityKeyPart(filenameStem(candidate.cv_file || candidate.source_reference_id || 'bulk-cv'));

  let nextId = `bulkcv-${base || 'candidate'}`;
  let suffix = 2;
  while (reservedIds.has(nextId)) {
    nextId = `bulkcv-${base || 'candidate'}-${suffix}`;
    suffix += 1;
  }
  return nextId;
}

function bulkCvOcrEnabled() {
  return !!trimString(process.env.OPENAI_API_KEY, 200);
}

function buildBulkCvCandidate({
  roleDir,
  existingCandidates,
  reservedIds,
  relativePath,
  extractedText,
  documentResult,
  originalFileName,
  importedAt,
}) {
  const candidateName = inferCandidateNameFromCvText(extractedText, originalFileName);
  const currentTitle = inferCandidateTitleFromCvText(extractedText, candidateName);
  const email = extractEmailFromText(extractedText);
  const location = inferCandidateLocationFromCvText(extractedText);
  const matched = findMatchingCandidateForBulkCv(existingCandidates, {
    candidate_name: candidateName,
    current_title: currentTitle,
    email,
    location,
  });
  const candidateId = matched?.candidate_id || buildBulkCvCandidateId({
    candidate_name: candidateName,
    current_title: currentTitle,
    email,
    location,
    cv_file: relativePath,
    source_reference_id: originalFileName,
  }, existingCandidates, reservedIds);
  const summaryText = summariseBulkCvText(extractedText);
  const extractionParser = trimString(documentResult?.extractionDiagnostics?.parser || documentResult?.parser, 80);
  const textSource = trimString(documentResult?.selectedTextSource || documentResult?.extractionDiagnostics?.selectedTextSource, 80);
  const ocrUsed = textSource === 'ocr_pdf_text';

  return normaliseCandidateInput({
    ...(matched && !/^bulkcv-/i.test(trimString(matched.source, 80))
      ? {
        source: matched.source,
        search_variant: matched.search_variant,
        search_name: matched.search_name,
        boolean_used: matched.boolean_used,
        source_url: matched.source_url,
        source_reference_id: matched.source_reference_id,
      }
      : {
        source: 'Bulk CV Upload',
        search_variant: 'bulk_cv',
        search_name: 'Bulk CV upload',
        boolean_used: '',
        source_url: '',
        source_reference_id: trimString(originalFileName, 160),
      }),
    candidate_id: candidateId,
    import_method: 'bulk_cv_upload',
    imported_at: importedAt,
    found_at: importedAt,
    candidate_name: candidateName,
    email: email || trimString(matched?.email, 240),
    current_title: currentTitle || trimString(matched?.current_title, 160),
    headline: currentTitle ? `${candidateName || titleCaseSlug(filenameStem(originalFileName))} | ${currentTitle}` : '',
    location: location || trimString(matched?.location, 160),
    summary_text: summaryText,
    preview_notes: uniqueStrings([
      `Bulk CV upload from ${path.basename(originalFileName)}`,
      extractionParser ? `Parser: ${extractionParser}` : '',
      textSource ? `Selected text source: ${textSource}` : '',
      ocrUsed ? 'OCR fallback recovered the PDF text for this upload.' : '',
    ], 4, 220).join(' | '),
    cv_file: relativePath,
    cv_text: trimString(extractedText, 40000),
    cv_extraction_summary: uniqueStrings([
      `Uploaded via bulk CV batch.`,
      extractionParser ? `Parser ${extractionParser}.` : '',
      textSource ? `Text source ${textSource}.` : '',
      ocrUsed ? 'OCR fallback was used.' : '',
    ], 4, 180).join(' '),
  });
}

function buildBulkCvUploadFileResult({
  fileName,
  savedRelativePath,
  status,
  candidateId = '',
  candidateName = '',
  extractionResult = null,
  errorMessage = '',
  failureCode = '',
}) {
  const documentResult = extractionResult?.documents?.[0] || null;
  const diagnostics = documentResult?.extractionDiagnostics || null;
  const selectedTextSource = trimString(documentResult?.selectedTextSource || diagnostics?.selectedTextSource, 80);
  const parser = trimString(diagnostics?.parser || documentResult?.parserPath, 80);
  const textChars = Number(documentResult?.extractedTextLength) || Number(diagnostics?.normalizedTextLength) || 0;
  const ocrTriggered = diagnostics?.ocrTriggered === true;

  return {
    file_name: trimString(fileName, 240),
    saved_path: trimString(savedRelativePath, 400),
    status: trimString(status, 40),
    candidate_id: trimString(candidateId, 120),
    candidate_name: trimString(candidateName, 160),
    parser,
    selected_text_source: selectedTextSource,
    ocr_triggered: ocrTriggered,
    text_usable: documentResult?.textUsable === true,
    text_characters: textChars,
    failure_code: trimString(failureCode || documentResult?.failureCode, 120),
    error: trimString(errorMessage || documentResult?.error, 320),
  };
}

async function withRoleLock(roleDir, operation, callback) {
  ensureRoleWorkspaceStructure(roleDir);
  const lockPath = path.join(roleDir, ROLE_OUTPUTS_DIR, ROLE_LOCK_FILE);
  let lockInfo = null;

  while (!lockInfo) {
    const candidateLock = {
      pid: process.pid,
      started_at: nowIso(),
      operation: trimString(operation, 120) || 'workflow_operation',
    };
    try {
      fs.writeFileSync(lockPath, `${JSON.stringify(candidateLock, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      lockInfo = candidateLock;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = readJsonFile(lockPath, {});
      const startedAtMs = Date.parse(existing?.started_at || '');
      const staleByAge = !Number.isFinite(startedAtMs) || (Date.now() - startedAtMs) > ROLE_LOCK_STALE_MS;
      const staleByPid = !safePidIsRunning(Number(existing?.pid));
      if (!(staleByAge || staleByPid)) {
        throw createWorkflowError(`Role is already being processed for ${path.basename(roleDir)}.`, {
          code: 'role_busy',
          statusCode: 409,
          details: {
            roleDir,
            operation: existing?.operation || '',
            started_at: existing?.started_at || '',
            pid: existing?.pid || null,
          },
        });
      }
      try {
        fs.unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError;
      }
    }
  }

  try {
    return await callback({
      lockPath,
      operation: lockInfo.operation,
      startedAt: lockInfo.started_at,
      pid: lockInfo.pid,
    });
  } finally {
    const existing = readJsonFile(lockPath, null);
    if (existing?.pid === process.pid && existing?.operation === lockInfo.operation) {
      try {
        fs.unlinkSync(lockPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
}

function relPath(rootPath, targetPath) {
  return path.relative(rootPath, targetPath).replace(/\\/g, '/');
}

function nowIso() {
  return new Date().toISOString();
}

function normaliseIsoDate(value) {
  const text = trimString(value, 40);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toISOString();
}

function safePidIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    return false;
  }
}

function splitListString(value) {
  if (Array.isArray(value)) return value;
  if (!trimString(value)) return [];
  return String(value).split(/\r?\n|,|;|\||\u2022/);
}

function cleanArray(value, maxItems = 12, maxLength = 160) {
  return uniqueStrings(splitListString(value), maxItems, maxLength);
}

function flattenText(parts) {
  return normaliseWhitespace((Array.isArray(parts) ? parts : [parts]).filter(Boolean).join(' '), 40000);
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = trimString(value, 20).toLowerCase();
  if (!text) return null;
  if (['true', 'yes', 'y', '1'].includes(text)) return true;
  if (['false', 'no', 'n', '0'].includes(text)) return false;
  return null;
}

function compareValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneJsonValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normaliseLifecycleStage(value) {
  const stage = trimString(value, 40);
  return LIFECYCLE_STAGES.includes(stage) ? stage : '';
}

function normalisePreviewClassification(value) {
  const stage = trimString(value, 40);
  return PREVIEW_CLASSIFICATIONS.includes(stage) ? stage : '';
}

function normaliseShortlistStatus(value) {
  const status = trimString(value, 40);
  return SHORTLIST_STATUSES.includes(status) ? status : '';
}

function normaliseOperatorDecision(value) {
  const decision = trimString(value, 80);
  return OPERATOR_DECISIONS.includes(decision) ? decision : '';
}

function normaliseShortlistBucket(value) {
  const bucket = trimString(value, 40);
  return SHORTLIST_BUCKETS.includes(bucket) ? bucket : '';
}

function normaliseRecruiterConfidence(value) {
  const confidence = trimString(value, 20).toLowerCase();
  return RECRUITER_CONFIDENCE_LEVELS.includes(confidence) ? confidence : '';
}

function containsPhrase(haystack, phrase) {
  const source = trimString(haystack).toLowerCase();
  const target = trimString(phrase).toLowerCase();
  if (!source || !target) return false;
  if (source.includes(target)) return true;
  const tokens = target
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9/+-]+/g, ''))
    .filter((token) => token.length > 2 && !['and', 'the', 'for', 'with', 'into', 'from'].includes(token));
  return tokens.length >= 2 && tokens.every((token) => source.includes(token));
}

function countMatches(haystack, terms) {
  return uniqueStrings(terms).filter((term) => containsPhrase(haystack, term));
}

function quoteBooleanTerm(term) {
  const text = normaliseWhitespace(term, 120);
  if (!text) return '';
  if (/^[A-Za-z0-9/+-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function joinBooleanTerms(terms, operator = 'OR') {
  const cleaned = uniqueStrings(terms).map(quoteBooleanTerm).filter(Boolean);
  if (!cleaned.length) return '';
  if (cleaned.length === 1) return cleaned[0];
  return `(${cleaned.join(` ${operator} `)})`;
}

function buildSearchBoolean({ titles, mustAll = [], mustAny = [], noneOf = [] }) {
  const clauses = [];
  const titleClause = joinBooleanTerms(titles, 'OR');
  if (titleClause) clauses.push(titleClause);
  uniqueStrings(mustAll).forEach((term) => {
    const quoted = quoteBooleanTerm(term);
    if (quoted) clauses.push(quoted);
  });
  const anyClause = joinBooleanTerms(mustAny, 'OR');
  if (anyClause) clauses.push(anyClause);
  const noneClause = joinBooleanTerms(noneOf, 'OR');
  if (noneClause) clauses.push(`NOT ${noneClause}`);
  return clauses.join(' AND ');
}

function expandSynonyms(values, synonymMap) {
  const output = [];
  uniqueStrings(values).forEach((value) => {
    output.push(value);
    const lowerValue = value.toLowerCase();
    Object.entries(synonymMap).forEach(([key, synonyms]) => {
      if (lowerValue.includes(key)) {
        output.push(...synonyms);
      }
    });
  });
  return uniqueStrings(output, 32, 160);
}

function inferFunctionFamily(title) {
  const lowerTitle = trimString(title).toLowerCase();
  if (!lowerTitle) return '';
  if (/(quantity surveyor|commercial manager|cost manager)/.test(lowerTitle)) return 'commercial';
  if (/(planner|planning)/.test(lowerTitle)) return 'planning';
  if (/(site manager|construction manager|project manager|works manager)/.test(lowerTitle)) return 'site_delivery';
  if (/(engineer|commissioning|supervisor|foreman)/.test(lowerTitle)) return 'engineering_delivery';
  return lowerTitle.split(/\s+/)[0] || '';
}

function deriveRoleId(raw) {
  const explicit = trimString(raw.role_id, 80);
  if (explicit) return explicit;
  const title = trimString(raw?.role_summary?.canonical_title, 160);
  return title ? slugify(title).toUpperCase() : `HMJ-${Date.now()}`;
}

function normaliseJobSpecIntake(raw = {}) {
  const roleSummary = raw.role_summary && typeof raw.role_summary === 'object' ? raw.role_summary : {};
  const titleMapping = raw.title_mapping && typeof raw.title_mapping === 'object' ? raw.title_mapping : {};
  const mustHave = raw.must_have && typeof raw.must_have === 'object' ? raw.must_have : {};
  const niceToHave = raw.nice_to_have && typeof raw.nice_to_have === 'object' ? raw.nice_to_have : {};
  const rejectionRules = raw.rejection_rules && typeof raw.rejection_rules === 'object' ? raw.rejection_rules : {};
  const qualitySignals = raw.quality_signals && typeof raw.quality_signals === 'object' ? raw.quality_signals : {};
  const judgmentAreas = raw.candidate_judgment_areas && typeof raw.candidate_judgment_areas === 'object' ? raw.candidate_judgment_areas : {};
  const outreach = raw.outreach && typeof raw.outreach === 'object' ? raw.outreach : {};

  const canonicalTitle = trimString(roleSummary.canonical_title, 160);
  const directTitles = uniqueStrings([canonicalTitle, ...cleanArray(titleMapping.direct_titles, 12, 120)], 12, 120);
  const adjacentTitles = uniqueStrings(cleanArray(titleMapping.adjacent_titles, 12, 120), 12, 120);
  const seniorityVariants = uniqueStrings(cleanArray(titleMapping.seniority_variants, 12, 120), 12, 120);
  const titleSynonyms = expandSynonyms([...directTitles, ...adjacentTitles], TITLE_SYNONYM_MAP);
  const sectorTerms = uniqueStrings([
    ...cleanArray(mustHave.sector_or_project_context, 8, 120),
    ...cleanArray(niceToHave.sectors, 8, 120),
  ], 16, 120);

  return {
    version: WORKFLOW_VERSION,
    roleId: deriveRoleId(raw),
    clientName: trimString(raw.client_name, 160),
    consultant: trimString(raw.consultant, 120) || 'Joe',
    dateOpened: trimString(raw.date_opened, 40) || nowIso().slice(0, 10),
    title: {
      canonical: canonicalTitle,
      directTitles,
      adjacentTitles,
      seniorityVariants,
      misleadingExclusions: cleanArray(titleMapping.misleading_titles_to_exclude, 12, 120),
      synonyms: titleSynonyms,
      functionFamily: inferFunctionFamily(canonicalTitle),
    },
    location: {
      base: trimString(roleSummary.location_base, 160),
      radiusMiles: Number(roleSummary.radius_miles) || null,
      remotePolicy: trimString(roleSummary.remote_hybrid_onsite, 80),
      relocationConsidered: roleSummary.relocation_considered === true,
      drivingLicenceRequired: roleSummary.driving_licence_required === true,
    },
    compensation: {
      salaryMin: Number(roleSummary.salary_min) || null,
      salaryMax: Number(roleSummary.salary_max) || null,
      salaryNotes: trimString(roleSummary.salary_notes, 160),
      employmentType: trimString(roleSummary.employment_type, 80),
    },
    mustHave: {
      skills: cleanArray(mustHave.skills, 12, 120),
      qualifications: cleanArray(mustHave.tools_or_qualifications, 10, 120),
      sectors: uniqueStrings(expandSynonyms(sectorTerms, SECTOR_SYNONYM_MAP), 20, 120),
    },
    preferred: {
      skills: cleanArray(niceToHave.skills, 12, 120),
      sectors: uniqueStrings(expandSynonyms(cleanArray(niceToHave.sectors, 10, 120), SECTOR_SYNONYM_MAP), 16, 120),
      qualifications: cleanArray(niceToHave.qualifications, 10, 120),
    },
    exclusions: {
      hardDisqualifiers: cleanArray(rejectionRules.hard_disqualifiers, 12, 200),
      titles: uniqueStrings([
        ...cleanArray(rejectionRules.excluded_titles, 12, 120),
        ...cleanArray(titleMapping.misleading_titles_to_exclude, 12, 120),
      ], 20, 120),
      contexts: cleanArray(rejectionRules.excluded_contexts, 12, 120),
      sectors: cleanArray(rejectionRules.excluded_sectors, 12, 120),
      locations: cleanArray(rejectionRules.unacceptable_location_patterns, 12, 120),
    },
    qualitySignals: {
      preferredEmployers: cleanArray(qualitySignals.preferred_employers_or_project_types, 10, 120),
      evidenceOfScale: cleanArray(qualitySignals.evidence_of_scale, 8, 120),
      evidenceOfOutcomes: cleanArray(qualitySignals.evidence_of_outcomes, 8, 120),
      stabilityExpectations: cleanArray(qualitySignals.stability_expectations, 8, 120),
    },
    judgment: {
      directMatchDefinition: trimString(judgmentAreas.direct_match_definition, 220),
      transferableMatchDefinition: trimString(judgmentAreas.transferable_match_definition, 220),
      locationMobilityDefinition: trimString(judgmentAreas.location_mobility_definition, 220),
      workHistoryDefinition: trimString(judgmentAreas.work_history_definition, 220),
      appetiteSignals: cleanArray(judgmentAreas.appetite_relevance_signals, 8, 140),
      followUpQuestions: cleanArray(judgmentAreas.follow_up_questions_needed, 8, 160),
    },
    outreach: {
      roleHook: trimString(outreach.role_hook, 220),
      likelyMotivators: cleanArray(outreach.likely_motivators, 8, 120),
      draftQuestions: cleanArray(outreach.draft_questions, 8, 160),
    },
    notes: trimString(raw.notes, 1200),
  };
}

function validateJobSpec(job) {
  const issues = [];
  if (!trimString(job?.roleId, 80)) issues.push('role_id is required.');
  if (!trimString(job?.title?.canonical, 160)) issues.push('role_summary.canonical_title is required.');
  if (!trimString(job?.location?.base, 160)) issues.push('role_summary.location_base is required.');
  if (!(job?.mustHave?.skills || []).length) issues.push('At least one must_have.skills entry is required.');
  if (!(job?.title?.directTitles || []).length) issues.push('At least one direct title is required.');
  return issues;
}

function validateRoleSlug(roleId) {
  const raw = trimString(roleId, 120);
  if (!raw) {
    throw createWorkflowError('A role id is required.', {
      code: 'missing_role_id',
      statusCode: 400,
    });
  }
  const safe = slugify(raw || '').toLowerCase();
  if (!safe) {
    throw createWorkflowError(`Role id "${raw}" could not be converted into a usable slug.`, {
      code: 'invalid_role_id',
      statusCode: 400,
    });
  }
  return safe;
}

function buildDefaultRoleConfig() {
  return {
    shortlist_target_size: 10,
    max_previews_per_run: 0,
    max_cv_reviews_per_run: 0,
    shortlist_mode: 'balanced',
    minimum_shortlist_score: 45,
    minimum_draft_score: 60,
    must_have_weighting: 1,
    preferred_weighting: 1,
    reject_on_missing_must_have: false,
    location_strictness: 'balanced',
    adjacent_title_looseness: 'balanced',
    sector_strictness: 'balanced',
    continue_until_target_reached: false,
  };
}

function normalisePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) return fallback;
  return numeric;
}

function normaliseRatio(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Number(numeric.toFixed(2));
}

function normaliseEnum(value, allowed, fallback) {
  const text = trimString(value, 40);
  return allowed.includes(text) ? text : fallback;
}

function normaliseRoleConfig(input = {}) {
  const defaults = buildDefaultRoleConfig();
  return {
    shortlist_target_size: normalisePositiveInteger(input.shortlist_target_size, defaults.shortlist_target_size),
    max_previews_per_run: normalisePositiveInteger(input.max_previews_per_run, defaults.max_previews_per_run),
    max_cv_reviews_per_run: normalisePositiveInteger(input.max_cv_reviews_per_run, defaults.max_cv_reviews_per_run),
    shortlist_mode: normaliseEnum(input.shortlist_mode, ['strict', 'balanced', 'broad'], defaults.shortlist_mode),
    minimum_shortlist_score: normalisePositiveInteger(input.minimum_shortlist_score, defaults.minimum_shortlist_score),
    minimum_draft_score: normalisePositiveInteger(input.minimum_draft_score, defaults.minimum_draft_score),
    must_have_weighting: normaliseRatio(input.must_have_weighting, defaults.must_have_weighting),
    preferred_weighting: normaliseRatio(input.preferred_weighting, defaults.preferred_weighting),
    reject_on_missing_must_have: asBoolean(input.reject_on_missing_must_have) === true,
    location_strictness: normaliseEnum(input.location_strictness, ['strict', 'balanced', 'flexible'], defaults.location_strictness),
    adjacent_title_looseness: normaliseEnum(input.adjacent_title_looseness, ['strict', 'balanced', 'wide'], defaults.adjacent_title_looseness),
    sector_strictness: normaliseEnum(input.sector_strictness, ['strict', 'balanced', 'flexible'], defaults.sector_strictness),
    continue_until_target_reached: asBoolean(input.continue_until_target_reached) === true,
  };
}

function validateRoleConfig(config) {
  const issues = [];
  if (config.minimum_draft_score < config.minimum_shortlist_score) {
    issues.push('minimum_draft_score cannot be lower than minimum_shortlist_score.');
  }
  if (config.shortlist_target_size === 0) {
    issues.push('shortlist_target_size must be greater than 0.');
  }
  if (config.max_previews_per_run && config.max_previews_per_run < config.max_cv_reviews_per_run) {
    issues.push('max_previews_per_run should not be lower than max_cv_reviews_per_run.');
  }
  return issues;
}

function buildDefaultOperatorReview() {
  return {
    classification: '',
    decision: '',
    shortlist_status: '',
    shortlist_bucket: '',
    ranking_pin: false,
    outreach_ready_override: null,
    lifecycle_stage: '',
    manual_notes: '',
    strengths: [],
    concerns: [],
    follow_up_questions: [],
    override_reason: '',
    availability_notes: '',
    appetite_notes: '',
    compensation_notes: '',
    location_mobility_notes: '',
    manual_screening_summary: '',
    recommended_next_step: '',
    recruiter_confidence: '',
    final_manual_rationale: '',
    contact_log: [],
    created_at: '',
    updated_at: '',
    updated_by: '',
    history: [],
  };
}

function normaliseOperatorReviewState(input = {}) {
  const base = buildDefaultOperatorReview();
  const outreachReady = Object.prototype.hasOwnProperty.call(input, 'outreach_ready_override')
    ? asBoolean(input.outreach_ready_override)
    : Object.prototype.hasOwnProperty.call(input, 'outreach_ready')
      ? asBoolean(input.outreach_ready)
      : null;

  return {
    ...base,
    classification: normalisePreviewClassification(input.classification),
    decision: normaliseOperatorDecision(input.decision || input.operator_decision),
    shortlist_status: normaliseShortlistStatus(input.shortlist_status),
    shortlist_bucket: normaliseShortlistBucket(input.shortlist_bucket),
    ranking_pin: asBoolean(input.ranking_pin) === true,
    outreach_ready_override: outreachReady,
    lifecycle_stage: normaliseLifecycleStage(input.lifecycle_stage),
    manual_notes: trimString(input.manual_notes || input.notes, 2000),
    strengths: cleanArray(input.strengths, 10, 220),
    concerns: cleanArray(input.concerns, 10, 220),
    follow_up_questions: cleanArray(input.follow_up_questions, 10, 220),
    override_reason: trimString(input.override_reason || input.reason, 240),
    availability_notes: trimString(input.availability_notes, 220),
    appetite_notes: trimString(input.appetite_notes, 220),
    compensation_notes: trimString(input.compensation_notes, 220),
    location_mobility_notes: trimString(input.location_mobility_notes || input.location_notes, 220),
    manual_screening_summary: trimString(input.manual_screening_summary, 2200),
    recommended_next_step: trimString(input.recommended_next_step, 220),
    recruiter_confidence: normaliseRecruiterConfidence(input.recruiter_confidence),
    final_manual_rationale: trimString(input.final_manual_rationale, 2200),
    contact_log: Array.isArray(input.contact_log)
      ? input.contact_log.map((entry) => ({
        at: normaliseIsoDate(entry?.at) || nowIso(),
        actor: trimString(entry?.actor, 80) || 'operator',
        stage: normaliseLifecycleStage(entry?.stage),
        note: trimString(entry?.note, 600),
        message_summary: trimString(entry?.message_summary, 1000),
      })).filter((entry) => CONTACT_LIFECYCLE_STAGES.includes(entry.stage))
      : [],
    created_at: trimString(input.created_at, 40),
    updated_at: trimString(input.updated_at, 40),
    updated_by: trimString(input.updated_by, 80),
    history: Array.isArray(input.history)
      ? input.history.map((entry) => ({
        at: trimString(entry?.at, 40),
        actor: trimString(entry?.actor, 80),
        stage: normaliseLifecycleStage(entry?.stage),
        changed_fields: cleanArray(entry?.changed_fields, 12, 80),
        summary: trimString(entry?.summary, 240),
        reason: trimString(entry?.reason, 240),
      }))
      : [],
  };
}

function candidateOperatorDefaults(candidate = {}) {
  return normaliseOperatorReviewState({
    classification: candidate?.operator_override?.classification,
    decision: candidate?.operator_decision,
    override_reason: candidate?.operator_override?.reason,
    manual_notes: candidate?.audit_notes,
    strengths: candidate?.operator_strengths,
    concerns: candidate?.operator_concerns,
    follow_up_questions: candidate?.operator_follow_up_questions,
    availability_notes: candidate?.availability_notes,
    appetite_notes: candidate?.appetite_notes,
    compensation_notes: candidate?.compensation_notes,
    location_mobility_notes: candidate?.location_mobility_notes,
    manual_screening_summary: candidate?.manual_screening_summary,
    recommended_next_step: candidate?.recommended_next_step,
    recruiter_confidence: candidate?.recruiter_confidence,
    final_manual_rationale: candidate?.final_manual_rationale,
    shortlist_bucket: candidate?.shortlist_bucket,
    ranking_pin: candidate?.ranking_pin,
    shortlist_status: candidate?.shortlist_status,
    outreach_ready: candidate?.outreach_ready,
    lifecycle_stage: candidate?.lifecycle_stage,
  });
}

function mergeOperatorReviewState(candidate = {}, storedOverride = {}) {
  const embedded = candidateOperatorDefaults(candidate);
  const stored = normaliseOperatorReviewState(storedOverride);
  return {
    ...embedded,
    ...stored,
    strengths: stored.strengths.length ? stored.strengths : embedded.strengths,
    concerns: stored.concerns.length ? stored.concerns : embedded.concerns,
    follow_up_questions: stored.follow_up_questions.length ? stored.follow_up_questions : embedded.follow_up_questions,
    shortlist_bucket: stored.shortlist_bucket || embedded.shortlist_bucket,
    ranking_pin: stored.ranking_pin === true || embedded.ranking_pin === true,
    history: stored.history,
  };
}

function mergeCandidateWithOperatorState(candidate = {}, operatorReview = {}) {
  const merged = {
    ...candidate,
    operator_decision: operatorReview.decision || candidate.operator_decision || '',
    audit_notes: operatorReview.manual_notes || candidate.audit_notes || '',
    operator_override: {
      classification: operatorReview.classification || candidate?.operator_override?.classification || '',
      reason: operatorReview.override_reason || candidate?.operator_override?.reason || '',
    },
  };
  return merged;
}

function normaliseCandidateInput(candidate = {}) {
  return {
    candidate_id: trimString(candidate.candidate_id || candidate.candidate_identifier || candidate.profile_id, 80),
    profile_id: trimString(candidate.profile_id, 80),
    source: trimString(candidate.source, 80) || 'CV-Library',
    source_reference_id: trimString(candidate.source_reference_id || candidate.profile_id, 120),
    source_url: trimString(candidate.source_url, 1200),
    search_variant: trimString(candidate.search_variant, 40),
    search_name: trimString(candidate.search_name, 160),
    boolean_used: trimString(candidate.boolean_used, 2000),
    found_at: normaliseIsoDate(candidate.found_at),
    imported_at: normaliseIsoDate(candidate.imported_at),
    import_method: trimString(candidate.import_method, 120),
    candidate_name: trimString(candidate.candidate_name || candidate.name || candidate.display_name, 160),
    email: trimString(candidate.email || candidate.email_address, 240),
    current_title: trimString(candidate.current_title || candidate.title, 160),
    headline: trimString(candidate.headline, 220),
    location: trimString(candidate.location, 160),
    location_tags: cleanArray(candidate.location_tags, 8, 80),
    mobility: trimString(candidate.mobility, 160),
    salary_text: trimString(candidate.salary_text || candidate.compensation, 120),
    sector_tags: cleanArray(candidate.sector_tags || candidate.sectors, 12, 80),
    summary_text: trimString(candidate.summary_text || candidate.preview_text || candidate.preview || candidate.summary, 4000),
    last_updated: trimString(candidate.last_updated, 40),
    opened_profile: asBoolean(candidate.opened_profile) === true,
    cv_file: trimString(candidate.cv_file, 500),
    cv_text: trimString(candidate.cv_text, 40000),
    cv_extraction_summary: trimString(candidate.cv_extraction_summary, 500),
    preview_notes: trimString(candidate.preview_notes, 500),
    audit_notes: trimString(candidate.audit_notes, 800),
    operator_override: {
      classification: trimString(candidate?.operator_override?.classification || candidate.operator_override_classification, 40),
      reason: trimString(candidate?.operator_override?.reason || candidate.operator_override_reason, 240),
    },
    operator_decision: trimString(candidate.operator_decision, 80),
    operator_strengths: cleanArray(candidate.operator_strengths, 10, 220),
    operator_concerns: cleanArray(candidate.operator_concerns, 10, 220),
    operator_follow_up_questions: cleanArray(candidate.operator_follow_up_questions, 10, 220),
    availability_notes: trimString(candidate.availability_notes, 220),
    appetite_notes: trimString(candidate.appetite_notes, 220),
    compensation_notes: trimString(candidate.compensation_notes, 220),
    location_mobility_notes: trimString(candidate.location_mobility_notes, 220),
    manual_screening_summary: trimString(candidate.manual_screening_summary, 2200),
    recommended_next_step: trimString(candidate.recommended_next_step, 220),
    recruiter_confidence: normaliseRecruiterConfidence(candidate.recruiter_confidence),
    final_manual_rationale: trimString(candidate.final_manual_rationale, 2200),
    shortlist_bucket: normaliseShortlistBucket(candidate.shortlist_bucket),
    ranking_pin: asBoolean(candidate.ranking_pin) === true,
    shortlist_status: trimString(candidate.shortlist_status, 40),
    outreach_ready: asBoolean(candidate.outreach_ready),
    lifecycle_stage: normaliseLifecycleStage(candidate.lifecycle_stage),
  };
}

function validateCandidateInput(candidate, index) {
  const issues = [];
  const label = candidate.candidate_id || candidate.candidate_name || candidate.current_title || `candidate ${index + 1}`;
  if (!trimString(candidate.source, 80)) issues.push(`Candidate ${label}: source is required.`);
  if (!trimString(candidate.search_variant, 40)) issues.push(`Candidate ${label}: search_variant is required.`);
  if (!(trimString(candidate.candidate_name, 160) || trimString(candidate.current_title, 160) || trimString(candidate.headline, 220) || trimString(candidate.summary_text, 4000))) {
    issues.push(`Candidate ${label}: at least one of candidate_name, current_title, headline, or summary_text is required.`);
  }
  if (candidate.operator_override?.classification && !normalisePreviewClassification(candidate.operator_override.classification)) {
    issues.push(`Candidate ${label}: operator override classification "${candidate.operator_override.classification}" is invalid.`);
  }
  if (candidate.shortlist_status && !normaliseShortlistStatus(candidate.shortlist_status)) {
    issues.push(`Candidate ${label}: shortlist_status "${candidate.shortlist_status}" is invalid.`);
  }
  if (candidate.shortlist_bucket && !normaliseShortlistBucket(candidate.shortlist_bucket)) {
    issues.push(`Candidate ${label}: shortlist_bucket "${candidate.shortlist_bucket}" is invalid.`);
  }
  if (candidate.lifecycle_stage && !normaliseLifecycleStage(candidate.lifecycle_stage)) {
    issues.push(`Candidate ${label}: lifecycle_stage "${candidate.lifecycle_stage}" is invalid.`);
  }
  if (candidate.operator_decision && !normaliseOperatorDecision(candidate.operator_decision)) {
    issues.push(`Candidate ${label}: operator_decision "${candidate.operator_decision}" is invalid.`);
  }
  return issues;
}

function normaliseCandidateBatch(records, options = {}) {
  const issues = [];
  const identifiers = new Map();
  const normalised = (Array.isArray(records) ? records : []).map((entry, index) => {
    const candidate = normaliseCandidateInput(entry);
    if (!candidate.candidate_id) {
      candidate.candidate_id = buildCandidateIdentifier(candidate, index);
    }
    validateCandidateInput(candidate, index).forEach((issue) => issues.push(issue));
    const existingIndex = identifiers.get(candidate.candidate_id);
    if (existingIndex != null) {
      issues.push(`Candidate id "${candidate.candidate_id}" is duplicated at rows ${existingIndex + 1} and ${index + 1}.`);
    } else {
      identifiers.set(candidate.candidate_id, index);
    }
    return candidate;
  });

  if (issues.length) {
    throw createWorkflowError(options.message || 'Candidate input validation failed.', {
      code: options.code || 'invalid_candidate_batch',
      statusCode: 400,
      details: { issues },
    });
  }

  return normalised;
}

function csvRowToCandidate(row = {}) {
  return normaliseCandidateInput({
    candidate_id: row.candidate_id || row.candidate_identifier || row.profile_id,
    source: row.source,
    source_reference_id: row.source_reference_id || row.profile_id,
    source_url: row.source_url,
    search_variant: row.search_variant,
    search_name: row.search_name,
    boolean_used: row.boolean_used,
    found_at: row.found_at,
    imported_at: row.imported_at,
    import_method: row.import_method,
    candidate_name: row.candidate_name || row.name,
    email: row.email || row.email_address,
    current_title: row.current_title || row.title,
    headline: row.headline,
    location: row.location,
    mobility: row.mobility,
    salary_text: row.salary_text || row.compensation,
    sector_tags: row.sector_tags || row.sectors,
    summary_text: row.summary_text || row.preview_text || row.preview || row.summary,
    last_updated: row.last_updated,
    opened_profile: row.opened_profile,
    cv_file: row.cv_file,
    cv_text: row.cv_text,
    preview_notes: row.preview_notes,
    audit_notes: row.audit_notes,
    operator_override_classification: row.operator_override_classification || row.classification_override,
    operator_override_reason: row.operator_override_reason || row.override_reason,
    operator_decision: row.operator_decision,
    operator_strengths: row.operator_strengths,
    operator_concerns: row.operator_concerns,
    operator_follow_up_questions: row.operator_follow_up_questions,
    availability_notes: row.availability_notes,
    appetite_notes: row.appetite_notes,
    compensation_notes: row.compensation_notes,
    shortlist_status: row.shortlist_status,
    outreach_ready: row.outreach_ready,
    lifecycle_stage: row.lifecycle_stage,
  });
}

function validateCandidateCsvHeaders(rows) {
  const headers = Object.keys(rows[0] || {});
  const missing = REQUIRED_CSV_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) {
    throw createWorkflowError(`Candidate preview CSV is missing required column(s): ${missing.join(', ')}.`, {
      code: 'invalid_candidate_csv',
      statusCode: 400,
      details: { missing, headers },
    });
  }
}

function mergeImportedCandidate(existing = {}, incoming = {}, importTimestamp = '', importMethod = '') {
  const preserved = { ...existing };
  const incomingEntries = Object.entries(incoming || {});
  incomingEntries.forEach(([key, value]) => {
    if (key === 'candidate_id') return;
    if (Array.isArray(value)) {
      if (value.length) {
        preserved[key] = value;
      } else if (!(key in preserved)) {
        preserved[key] = [];
      }
      return;
    }
    if (typeof value === 'boolean') {
      if (value === true || !(key in preserved)) {
        preserved[key] = value;
      }
      return;
    }
    if (value != null && value !== '') {
      preserved[key] = value;
    }
  });
  return normaliseCandidateInput({
    ...preserved,
    candidate_id: incoming.candidate_id || existing.candidate_id || '',
    imported_at: incoming.imported_at || existing.imported_at || importTimestamp,
    import_method: incoming.import_method || existing.import_method || importMethod,
  });
}

function parseCandidateImportText(filePath, text) {
  const extension = trimString(path.extname(filePath).slice(1).toLowerCase(), 16);
  if (extension === 'csv') {
    let rows;
    try {
      rows = parseCsv(text);
    } catch (error) {
      throw createWorkflowError(`Candidate preview CSV could not be parsed at ${filePath}.`, {
        code: 'invalid_candidate_csv',
        statusCode: 400,
        details: { cause: error?.message || String(error) },
      });
    }
    if (!rows.length) {
      throw createWorkflowError(`Candidate preview CSV is empty: ${filePath}`, {
        code: 'empty_candidate_csv',
        statusCode: 400,
      });
    }
    validateCandidateCsvHeaders(rows);
    return normaliseCandidateBatch(rows.map(csvRowToCandidate), {
      message: 'Candidate preview CSV validation failed.',
      code: 'invalid_candidate_csv',
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw createWorkflowError(`Candidate preview JSON is not valid at ${filePath}.`, {
      code: 'invalid_candidate_json',
      statusCode: 400,
      details: { cause: error?.message || String(error) },
    });
  }
  if (!Array.isArray(parsed)) {
    throw createWorkflowError('Candidate import JSON must contain an array of preview records.', {
      code: 'invalid_candidate_json',
      statusCode: 400,
    });
  }
  return normaliseCandidateBatch(parsed, {
    message: 'Candidate preview JSON validation failed.',
    code: 'invalid_candidate_json',
  });
}

function buildLocationNotes(job) {
  const notes = [];
  if (job.location.base) notes.push(`Primary base: ${job.location.base}`);
  if (job.location.radiusMiles) notes.push(`Suggested radius: ${job.location.radiusMiles} miles`);
  if (job.location.remotePolicy) notes.push(`Working pattern: ${job.location.remotePolicy}`);
  if (job.location.relocationConsidered) notes.push('Relocation can be considered if otherwise strong.');
  return notes;
}

function previewThresholds(roleConfig = buildDefaultRoleConfig()) {
  if (roleConfig.shortlist_mode === 'strict') {
    return { strong_open: 72, maybe_open: 46, low_priority: 28 };
  }
  if (roleConfig.shortlist_mode === 'broad') {
    return { strong_open: 56, maybe_open: 32, low_priority: 18 };
  }
  return { strong_open: 65, maybe_open: 40, low_priority: 25 };
}

function generateSearchPack(job, roleConfig = buildDefaultRoleConfig()) {
  const directTitles = uniqueStrings([...job.title.directTitles, ...job.title.seniorityVariants], 16, 120);
  const broadTitles = uniqueStrings([...job.title.directTitles, ...job.title.adjacentTitles, ...job.title.synonyms], 24, 120);
  const sectorTerms = uniqueStrings([...job.mustHave.sectors, ...job.preferred.sectors], 16, 120);
  const mustHaveAny = uniqueStrings([...job.mustHave.skills, ...job.mustHave.qualifications], 16, 120);
  const exclusionTerms = uniqueStrings([
    ...job.exclusions.titles,
    ...job.exclusions.contexts,
    ...job.exclusions.sectors,
  ], 20, 120);

  const broad = {
    variant: 'broad',
    boolean: buildSearchBoolean({
      titles: broadTitles,
      mustAny: uniqueStrings([...mustHaveAny.slice(0, 3), ...sectorTerms.slice(0, 3)], 6, 120),
      noneOf: exclusionTerms,
    }),
    titles: broadTitles,
    mustHaveAny: uniqueStrings([...mustHaveAny.slice(0, 3), ...sectorTerms.slice(0, 3)], 6, 120),
    exclusions: exclusionTerms,
    filters: {
      minimumMatch: '0%',
      submittedSince: '14 days',
      radiusMiles: job.location.radiusMiles || null,
    },
  };

  const medium = {
    variant: 'medium',
    boolean: buildSearchBoolean({
      titles: uniqueStrings([...directTitles, ...job.title.adjacentTitles.slice(0, 4)], 18, 120),
      mustAll: job.mustHave.skills.slice(0, 2),
      mustAny: uniqueStrings([...job.mustHave.skills.slice(2), ...job.mustHave.qualifications, ...sectorTerms.slice(0, 4)], 8, 120),
      noneOf: exclusionTerms,
    }),
    titles: uniqueStrings([...directTitles, ...job.title.adjacentTitles.slice(0, 4)], 18, 120),
    mustHaveAll: job.mustHave.skills.slice(0, 2),
    mustHaveAny: uniqueStrings([...job.mustHave.skills.slice(2), ...job.mustHave.qualifications, ...sectorTerms.slice(0, 4)], 8, 120),
    exclusions: exclusionTerms,
    filters: {
      minimumMatch: '25%',
      submittedSince: '28 days',
      radiusMiles: job.location.radiusMiles || null,
    },
  };

  const narrow = {
    variant: 'narrow',
    boolean: buildSearchBoolean({
      titles: directTitles.length ? directTitles : broadTitles.slice(0, 6),
      mustAll: uniqueStrings([...job.mustHave.skills.slice(0, 3), ...job.mustHave.qualifications.slice(0, 2)], 5, 120),
      mustAny: sectorTerms.slice(0, 3),
      noneOf: exclusionTerms,
    }),
    titles: directTitles.length ? directTitles : broadTitles.slice(0, 6),
    mustHaveAll: uniqueStrings([...job.mustHave.skills.slice(0, 3), ...job.mustHave.qualifications.slice(0, 2)], 5, 120),
    mustHaveAny: sectorTerms.slice(0, 3),
    exclusions: exclusionTerms,
    filters: {
      minimumMatch: '50%',
      submittedSince: '2 months',
      radiusMiles: job.location.radiusMiles || null,
    },
  };

  return {
    version: WORKFLOW_VERSION,
    roleId: job.roleId,
    title: job.title.canonical,
    primaryBoolean: medium.boolean,
    titleSynonymPack: job.title.synonyms,
    sectorSynonymPack: sectorTerms,
    exclusionString: joinBooleanTerms(exclusionTerms, 'OR'),
    locationNotes: buildLocationNotes(job),
    searchPriority: [
      'Start with medium for the default live search.',
      'Use narrow when the brief is strict or the live result set is noisy.',
      'Use broad only when medium yields too few relevant previews.',
    ],
    operatorNotes: uniqueStrings([
      'Use CV-Library hide-recently-viewed on repeat sourcing cycles.',
      'Start with the medium variant, then widen to broad only if yield is weak.',
      'Use saved searches and Watchdogs once the live query produces relevant previews.',
      `Role shortlist mode is currently set to ${roleConfig.shortlist_mode}.`,
      job.location.drivingLicenceRequired ? 'Apply driving licence filter where relevant.' : '',
    ], 8, 160),
    variants: {
      broad,
      medium,
      narrow,
    },
  };
}

function scoreLocation(job, previewText, candidate, roleConfig = buildDefaultRoleConfig()) {
  const notes = [];
  let score = 0;
  if (!job.location.base) {
    return { score: 0, notes };
  }
  if (containsPhrase(previewText, job.location.base)) {
    score += 10;
    notes.push(`Location matches ${job.location.base}.`);
  } else if (containsPhrase(previewText, 'relocation') || containsPhrase(previewText, 'travel') || containsPhrase(previewText, 'nationwide')) {
    score += job.location.relocationConsidered
      ? (roleConfig.location_strictness === 'strict' ? 6 : 8)
      : (roleConfig.location_strictness === 'flexible' ? 6 : 4);
    notes.push('Location is not exact but mobility or travel is mentioned.');
  } else if (Array.isArray(candidate.location_tags) && candidate.location_tags.some((entry) => containsPhrase(job.location.base, entry) || containsPhrase(entry, job.location.base))) {
    score += 8;
    notes.push('Location tags suggest a workable match.');
  } else {
    notes.push('No clear evidence that the location is workable from preview data.');
  }
  return { score, notes };
}

function classifyPreview(score, hardReject, missingCriticalInfo, roleConfig = buildDefaultRoleConfig()) {
  const thresholds = previewThresholds(roleConfig);
  if (hardReject.length) return 'reject';
  if (score >= thresholds.strong_open) return 'strong_open';
  if (score >= thresholds.maybe_open) return 'maybe_open';
  if (score >= thresholds.low_priority) return 'low_priority';
  return 'reject';
}

function scorePreviewCandidate(job, candidate = {}, roleConfig = buildDefaultRoleConfig()) {
  const previewText = flattenText([
    candidate.current_title,
    candidate.headline,
    candidate.summary_text,
    Array.isArray(candidate.sector_tags) ? candidate.sector_tags.join(' ') : '',
    candidate.location,
    candidate.mobility,
    candidate.salary_text,
  ]);

  const directTitleMatches = countMatches(previewText, job.title.directTitles);
  const adjacentTitleMatches = countMatches(previewText, job.title.adjacentTitles);
  const skillMatches = countMatches(previewText, job.mustHave.skills);
  const qualificationMatches = countMatches(previewText, job.mustHave.qualifications);
  const sectorMatches = countMatches(previewText, job.mustHave.sectors);
  const excludedTitleMatches = countMatches(previewText, job.exclusions.titles);
  const excludedSectorMatches = countMatches(previewText, job.exclusions.sectors);

  const breakdown = [];
  const reasons = [];
  const hardReject = [];
  const missingCriticalInfo = [];
  let totalScore = 0;

  if (directTitleMatches.length) {
    totalScore += 25;
    breakdown.push({ label: 'title_function_fit', score: 25, evidence: directTitleMatches });
    reasons.push(`Direct title evidence: ${directTitleMatches.join(', ')}.`);
  } else if (adjacentTitleMatches.length) {
    const adjacentScore = roleConfig.adjacent_title_looseness === 'strict'
      ? 8
      : roleConfig.adjacent_title_looseness === 'wide'
        ? 16
        : 12;
    totalScore += adjacentScore;
    breakdown.push({ label: 'adjacent_role_fit', score: adjacentScore, evidence: adjacentTitleMatches });
    reasons.push(`Adjacent title evidence: ${adjacentTitleMatches.join(', ')}.`);
  } else {
    missingCriticalInfo.push('No clear direct or adjacent title match in preview.');
  }

  if (skillMatches.length || qualificationMatches.length) {
    const skillScore = Math.round(Math.min(18, (skillMatches.length * 6) + (qualificationMatches.length * 4)) * roleConfig.must_have_weighting);
    totalScore += skillScore;
    breakdown.push({
      label: 'core_skill_alignment',
      score: skillScore,
      evidence: [...skillMatches, ...qualificationMatches],
    });
    reasons.push(`Must-have evidence found: ${[...skillMatches, ...qualificationMatches].join(', ')}.`);
  } else {
    if (roleConfig.reject_on_missing_must_have) {
      hardReject.push('No must-have skill evidence visible in preview.');
    } else {
      missingCriticalInfo.push('No must-have skill evidence visible in preview.');
    }
  }

  if (sectorMatches.length) {
    const sectorMultiplier = roleConfig.sector_strictness === 'strict'
      ? 1.2
      : roleConfig.sector_strictness === 'flexible'
        ? 0.8
        : 1;
    const sectorScore = Math.round(Math.min(12, sectorMatches.length * 4) * sectorMultiplier);
    totalScore += sectorScore;
    breakdown.push({ label: 'sector_project_relevance', score: sectorScore, evidence: sectorMatches });
    reasons.push(`Sector or project relevance: ${sectorMatches.join(', ')}.`);
  }

  const locationScore = scoreLocation(job, previewText, candidate, roleConfig);
  if (locationScore.score) {
    totalScore += locationScore.score;
    breakdown.push({ label: 'location_mobility_fit', score: locationScore.score, evidence: locationScore.notes });
    reasons.push(...locationScore.notes);
  } else {
    missingCriticalInfo.push(...locationScore.notes);
  }

  if (containsPhrase(previewText, 'senior') || containsPhrase(previewText, 'lead') || containsPhrase(previewText, 'manager')) {
    totalScore += 6;
    breakdown.push({ label: 'seniority_fit', score: 6, evidence: ['Preview suggests senior or lead ownership.'] });
  }

  if (containsPhrase(previewText, 'years') || containsPhrase(previewText, 'since') || containsPhrase(previewText, 'long-term')) {
    totalScore += 4;
    breakdown.push({ label: 'stability_signal', score: 4, evidence: ['Preview includes some tenure signal.'] });
  }

  if (containsPhrase(previewText, 'available') || containsPhrase(previewText, 'immediately') || containsPhrase(previewText, 'open to')) {
    totalScore += 4;
    breakdown.push({ label: 'appetite_signal', score: 4, evidence: ['Preview suggests current availability or openness.'] });
  }

  if (excludedTitleMatches.length) {
    totalScore -= 20;
    hardReject.push(`Excluded title pattern matched: ${excludedTitleMatches.join(', ')}.`);
  }
  if (excludedSectorMatches.length) {
    totalScore -= 15;
    hardReject.push(`Excluded sector pattern matched: ${excludedSectorMatches.join(', ')}.`);
  }
  if (job.compensation.salaryMin && containsPhrase(previewText, '£') && candidate.salary_text) {
    const numbers = String(candidate.salary_text).match(/\d[\d,]*/g) || [];
    const parsed = numbers.map((entry) => Number(String(entry).replace(/,/g, ''))).filter((entry) => Number.isFinite(entry));
    const highest = parsed.length ? Math.max(...parsed) : null;
    if (highest && highest < (job.compensation.salaryMin * 0.7)) {
      totalScore -= 10;
      reasons.push('Preview salary appears materially below the expected band.');
    }
  }

  const suggestedClassification = classifyPreview(totalScore, hardReject, missingCriticalInfo, roleConfig);
  const override = candidate.operator_override && typeof candidate.operator_override === 'object'
    ? candidate.operator_override
    : null;
  const finalClassification = trimString(override?.classification, 40) || suggestedClassification;
  const overrideApplied = finalClassification !== suggestedClassification;

  return {
    suggestedClassification,
    finalClassification,
    overrideApplied,
    overrideReason: trimString(override?.reason, 240),
    totalScore,
    scoreBreakdown: breakdown,
    reasons: uniqueStrings([...hardReject, ...reasons, ...missingCriticalInfo], 14, 220),
    hardRejectReasons: hardReject,
    missingCriticalInfo: uniqueStrings(missingCriticalInfo, 8, 220),
    confidence: previewText.length > 320 ? 'medium' : 'low',
    recommendedProfileOpen: finalClassification === 'strong_open' || finalClassification === 'maybe_open',
    recommendedCvDownload: finalClassification === 'strong_open',
    evidence: {
      directTitleMatches,
      adjacentTitleMatches,
      skillMatches,
      qualificationMatches,
      sectorMatches,
    },
  };
}

function findEvidenceSentences(text, terms, limit = 4) {
  const sentences = String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normaliseWhitespace(sentence, 320))
    .filter(Boolean);
  const matches = [];
  sentences.forEach((sentence) => {
    if (matches.length >= limit) return;
    if (uniqueStrings(terms).some((term) => containsPhrase(sentence, term))) {
      matches.push(sentence);
    }
  });
  return uniqueStrings(matches, limit, 320);
}

function assessWorkHistory(text) {
  const source = String(text || '');
  const dateRanges = source.match(/\b(?:19|20)\d{2}\b\s*[-–]\s*(?:present|current|\b(?:19|20)\d{2}\b)/gi) || [];
  const signals = [];
  let score = 0;
  if (dateRanges.length >= 3) {
    score += 8;
    signals.push('CV contains multiple dated role entries, which helps assess continuity.');
  } else if (dateRanges.length >= 1) {
    score += 4;
    signals.push('CV contains at least one dated role entry.');
  } else {
    signals.push('Work history chronology is not obvious from the extracted text.');
  }
  if (containsPhrase(source, 'contract')) {
    score -= 2;
    signals.push('Contract wording appears in the CV; tenure should be checked in context.');
  }
  return {
    score: Math.max(0, score),
    signals,
  };
}

function buildFollowUpQuestions(job, candidate, review) {
  const questions = [];
  if (!containsPhrase(review.sourceText, job.location.base) && !containsPhrase(review.sourceText, 'relocation')) {
    questions.push(`Is ${job.location.base || 'the role location'} workable for you day to day?`);
  }
  if (!containsPhrase(review.sourceText, 'available') && !containsPhrase(review.sourceText, 'notice')) {
    questions.push('What is your current availability or notice period?');
  }
  if (job.compensation.salaryMin && !containsPhrase(review.sourceText, '£') && !containsPhrase(review.sourceText, 'rate')) {
    questions.push('What salary or rate range would you be looking for?');
  }
  if (job.location.drivingLicenceRequired && !containsPhrase(review.sourceText, 'driving') && !containsPhrase(review.sourceText, 'licence')) {
    questions.push('Do you hold a current driving licence?');
  }
  return uniqueStrings([...questions, ...job.judgment.followUpQuestions], 8, 180);
}

function reviewFullCv(job, candidate, cvText, roleConfig = buildDefaultRoleConfig()) {
  const sourceText = flattenText([
    candidate.current_title,
    candidate.headline,
    candidate.summary_text,
    cvText,
  ]);
  const directTitleMatches = countMatches(sourceText, job.title.directTitles);
  const adjacentTitleMatches = countMatches(sourceText, job.title.adjacentTitles);
  const skillMatches = countMatches(sourceText, job.mustHave.skills);
  const qualificationMatches = countMatches(sourceText, job.mustHave.qualifications);
  const sectorMatches = countMatches(sourceText, job.mustHave.sectors);
  const preferredMatches = countMatches(sourceText, [...job.preferred.skills, ...job.preferred.qualifications, ...job.preferred.sectors]);
  const excludedMatches = countMatches(sourceText, [...job.exclusions.titles, ...job.exclusions.sectors, ...job.exclusions.contexts]);
  const locationScore = scoreLocation(job, sourceText, candidate, roleConfig);
  const workHistory = assessWorkHistory(sourceText);
  const highlights = findEvidenceSentences(sourceText, [...job.mustHave.skills, ...job.mustHave.qualifications, ...job.mustHave.sectors, ...job.title.directTitles], 6);

  let score = 0;
  const breakdown = [];
  const strengths = [];
  const gaps = [];
  const uncertaintyNotes = [];

  if (directTitleMatches.length) {
    score += 25;
    breakdown.push({ label: 'title_function_fit', score: 25, evidence: directTitleMatches });
    strengths.push(`Direct title evidence: ${directTitleMatches.join(', ')}.`);
  } else if (adjacentTitleMatches.length) {
    const adjacentScore = roleConfig.adjacent_title_looseness === 'strict'
      ? 10
      : roleConfig.adjacent_title_looseness === 'wide'
        ? 18
        : 14;
    score += adjacentScore;
    breakdown.push({ label: 'adjacent_role_fit', score: adjacentScore, evidence: adjacentTitleMatches });
    strengths.push(`Transferable title evidence: ${adjacentTitleMatches.join(', ')}.`);
  } else {
    gaps.push('No clear direct or adjacent title evidence in the CV text.');
  }

  if (skillMatches.length || qualificationMatches.length) {
    const skillScore = Math.round(Math.min(20, (skillMatches.length * 5) + (qualificationMatches.length * 4)) * roleConfig.must_have_weighting);
    score += skillScore;
    breakdown.push({ label: 'must_have_experience', score: skillScore, evidence: [...skillMatches, ...qualificationMatches] });
    strengths.push(`Relevant must-have evidence: ${[...skillMatches, ...qualificationMatches].join(', ')}.`);
  } else {
    if (roleConfig.reject_on_missing_must_have) {
      gaps.push('Missing must-have experience is configured as a rejection for this role.');
      score -= 20;
    } else {
      gaps.push('Must-have experience is not evidenced strongly enough in the CV text.');
    }
  }

  if (sectorMatches.length) {
    const sectorScore = Math.min(15, sectorMatches.length * 5);
    score += sectorScore;
    breakdown.push({ label: 'sector_project_relevance', score: sectorScore, evidence: sectorMatches });
    strengths.push(`Sector evidence: ${sectorMatches.join(', ')}.`);
  } else if (job.mustHave.sectors.length) {
    gaps.push('Sector or project context is not clearly evidenced.');
  }

  if (locationScore.score) {
    score += locationScore.score;
    breakdown.push({ label: 'location_mobility_fit', score: locationScore.score, evidence: locationScore.notes });
  } else {
    uncertaintyNotes.push(...locationScore.notes);
  }

  if (containsPhrase(sourceText, 'lead') || containsPhrase(sourceText, 'manage') || containsPhrase(sourceText, 'manager')) {
    score += 8;
    breakdown.push({ label: 'seniority_scope', score: 8, evidence: ['CV text suggests ownership or leadership.'] });
  }

  score += workHistory.score;
  breakdown.push({ label: 'work_history_quality', score: workHistory.score, evidence: workHistory.signals });

  if (preferredMatches.length) {
    const preferredScore = Math.round(Math.min(8, preferredMatches.length * 2) * roleConfig.preferred_weighting);
    score += preferredScore;
    breakdown.push({ label: 'preferred_experience', score: preferredScore, evidence: preferredMatches });
  }

  if (excludedMatches.length) {
    score -= 18;
    gaps.push(`Excluded patterns appear in the CV text: ${excludedMatches.join(', ')}.`);
  }

  const shortlistRecommendation = (score >= Math.max(roleConfig.minimum_draft_score + 8, 70) && directTitleMatches.length) || score >= (roleConfig.minimum_draft_score + 18)
    ? 'strong'
    : score >= roleConfig.minimum_shortlist_score
      ? 'possible'
      : 'reject';

  if (!highlights.length) {
    uncertaintyNotes.push('The CV text produced limited extractable evidence, so the review should be treated cautiously.');
  }

  const followUpQuestions = buildFollowUpQuestions(job, candidate, { sourceText });
  const outreachReady = shortlistRecommendation !== 'reject'
    && !excludedMatches.length
    && score >= roleConfig.minimum_draft_score;

  return {
    totalScore: score,
    shortlistRecommendation,
    breakdown,
    extractedHighlights: highlights,
    strengths: uniqueStrings(strengths, 8, 220),
    gaps: uniqueStrings(gaps, 8, 220),
    uncertaintyNotes: uniqueStrings(uncertaintyNotes, 8, 220),
    followUpQuestions,
    outreachReady,
    candidateSuitabilitySummary: uniqueStrings([
      shortlistRecommendation === 'strong'
        ? 'Strong contact-worthiness based on the current extracted CV evidence.'
        : shortlistRecommendation === 'possible'
          ? 'Possible fit, but outreach should test a few unresolved points.'
          : 'Current CV evidence does not justify outreach.',
      strengths[0] || '',
      gaps[0] || '',
    ], 3, 220).join(' '),
  };
}

function buildOutreachDraft(job, candidate, review) {
  const firstName = trimString(candidate.first_name, 80)
    || trimString(candidate.candidate_name, 120).split(/\s+/)[0]
    || trimString(candidate.display_name, 120).split(/\s+/)[0]
    || 'there';
  const localPart = slugify((trimString(candidate.candidate_name, 120) || trimString(candidate.candidate_id, 80) || 'candidate').toLowerCase()).replace(/^-+|-+$/g, '');
  const email = trimString(candidate.email, 240) || (localPart ? `${localPart}@unknown.local` : '');
  const evidence = uniqueStrings([
    ...(review?.strengths || []),
    ...(review?.extractedHighlights || []),
  ], 2, 220);
  const roleDetails = uniqueStrings([
    job.title.canonical,
    job.location.base ? `Location: ${job.location.base}` : '',
    job.compensation.salaryNotes,
  ], 3, 120);
  const questions = uniqueStrings([
    ...(review?.followUpQuestions || []),
    ...(job.outreach.draftQuestions || []),
  ], 3, 180);

  const subject = `Potential fit for ${job.title.canonical || 'this HMJ role'}${job.location.base ? ` in ${job.location.base}` : ''}`;
  const body = [
    `Subject: ${subject}`,
    '',
    `Hi ${firstName},`,
    '',
    `I came across your background while sourcing for a ${job.title.canonical || 'role'}${job.location.base ? ` in ${job.location.base}` : ''} and thought it could be relevant based on:`,
    '',
    ...evidence.map((entry) => `- ${entry}`),
    '',
    'The role looks likely to suit someone with:',
    '',
    ...uniqueStrings([...job.mustHave.skills.slice(0, 2), ...job.mustHave.qualifications.slice(0, 2)], 2, 140)
      .map((entry) => `- ${entry}`),
    '',
    'Before I send over fuller details, the main things I wanted to sense-check are:',
    '',
    ...questions.map((entry, index) => `${index + 1}. ${entry}`),
    '',
    'If it is of interest, I can send a short outline of the opportunity.',
    '',
    `Best,`,
    job.consultant || 'Joe',
  ].join('\n');

  return {
    email,
    subject,
    body,
    evidencePoints: evidence,
    roleDetails,
    questions,
    whyContactedSummary: evidence[0]
      || review?.candidateSuitabilitySummary
      || `Background aligns with ${job.title.canonical || 'the current role'}.`,
  };
}

function buildSourceAudit(candidate = {}, previewReview = null) {
  const foundAt = normaliseIsoDate(candidate.found_at);
  const importedAt = normaliseIsoDate(candidate.imported_at);
  const auditParts = [
    trimString(candidate.source, 80) || 'CV-Library',
    foundAt ? `found ${foundAt}` : '',
    trimString(candidate.search_variant, 40) ? `via ${trimString(candidate.search_variant, 40)} search` : '',
    trimString(candidate.boolean_used, 240) ? `Boolean: ${trimString(candidate.boolean_used, 240)}` : '',
  ].filter(Boolean);
  return {
    source_name: trimString(candidate.source, 80) || 'CV-Library',
    source_reference_id: trimString(candidate.source_reference_id || candidate.profile_id, 120),
    source_url: trimString(candidate.source_url, 1200),
    found_at: foundAt,
    imported_at: importedAt,
    import_method: trimString(candidate.import_method, 120) || 'manual_entry',
    search_variant: trimString(candidate.search_variant, 40),
    search_name: trimString(candidate.search_name, 160),
    boolean_used: trimString(candidate.boolean_used, 2000),
    audit_string: auditParts.length
      ? `${auditParts[0]}${auditParts.slice(1).length ? `, ${auditParts.slice(1).join(', ')}` : ''}`
      : 'Source audit details are incomplete.',
    preview_assessed_at: trimString(previewReview?.assessed_at, 40),
  };
}

function latestContactEvent(record) {
  const entries = Array.isArray(record?.operator_review?.contact_log)
    ? record.operator_review.contact_log
    : [];
  return entries.length ? entries[entries.length - 1] : null;
}

function buildCandidateIdentifier(candidate, index) {
  return trimString(candidate.candidate_id, 80)
    || trimString(candidate.profile_id, 80)
    || slugify(trimString(candidate.candidate_name, 120) || trimString(candidate.current_title, 120) || `candidate-${index + 1}`);
}

function mapMachineShortlistToStage(shortlistRecommendation) {
  if (shortlistRecommendation === 'strong') return 'strong_shortlist';
  if (shortlistRecommendation === 'possible') return 'possible_shortlist';
  if (shortlistRecommendation === 'reject') return 'do_not_progress';
  return '';
}

function deriveShortlistStage(record) {
  return trimString(record?.operator_review?.shortlist_status, 40)
    || mapMachineShortlistToStage(trimString(record?.full_cv?.shortlist_recommendation, 40));
}

function deriveOutreachReady(record) {
  if (typeof record?.operator_review?.outreach_ready_override === 'boolean') {
    return record.operator_review.outreach_ready_override;
  }
  return record?.full_cv?.review_status === 'completed' && record?.full_cv?.outreach_ready === true;
}

function deriveLifecycleStage(record) {
  const operatorStage = normaliseLifecycleStage(record?.operator_review?.lifecycle_stage);
  if (operatorStage) return operatorStage;
  if (trimString(record?.operator_review?.decision, 80).toLowerCase() === 'do_not_progress') return 'do_not_progress';
  if (record?.outreach?.draft_path) return 'outreach_drafted';
  if (record?.outreach?.ready) return 'outreach_ready';
  const shortlistStage = deriveShortlistStage(record);
  if (shortlistStage) return shortlistStage;
  if (record?.full_cv?.review_status === 'completed') return 'cv_reviewed';
  return trimString(record?.preview_assessment?.finalClassification, 40) || 'preview_only';
}

function buildLifecycleHistory(record) {
  const history = [];
  const baseTime = trimString(record.updated_at, 40) || nowIso();
  if (record?.source_audit?.imported_at) {
    history.push({
      at: record.source_audit.imported_at,
      source: 'system',
      stage: 'preview_only',
      note: `Imported from ${record.source_audit.source_name || 'source'} via ${record.source_audit.import_method || 'manual_entry'}`,
    });
  }
  const previewStage = trimString(record?.preview_assessment?.finalClassification, 40);
  if (previewStage) {
    history.push({
      at: trimString(record?.preview_assessment?.assessed_at, 40) || baseTime,
      source: 'machine',
      stage: previewStage,
      note: 'Preview triage classification',
    });
  }
  if (record?.full_cv?.review_status === 'completed') {
    history.push({
      at: trimString(record?.full_cv?.reviewed_at, 40) || baseTime,
      source: 'machine',
      stage: 'cv_reviewed',
      note: 'Full CV reviewed',
    });
  }
  const shortlistStage = mapMachineShortlistToStage(trimString(record?.full_cv?.shortlist_recommendation, 40));
  if (shortlistStage) {
    history.push({
      at: trimString(record?.full_cv?.reviewed_at, 40) || baseTime,
      source: 'machine',
      stage: shortlistStage,
      note: 'Machine shortlist recommendation',
    });
  }
  if (record?.outreach?.ready) {
    history.push({
      at: trimString(record?.outreach?.drafted_at, 40) || baseTime,
      source: 'machine',
      stage: record.outreach.draft_path ? 'outreach_drafted' : 'outreach_ready',
      note: record.outreach.draft_path ? 'Draft outreach prepared' : 'Outreach readiness detected',
    });
  }
  (record?.operator_review?.history || []).forEach((entry) => {
    history.push({
      at: trimString(entry?.at, 40) || baseTime,
      source: trimString(entry?.actor, 80) || 'operator',
      stage: normaliseLifecycleStage(entry?.stage) || normaliseLifecycleStage(record?.operator_review?.lifecycle_stage),
      note: trimString(entry?.summary, 240),
      reason: trimString(entry?.reason, 240),
    });
  });
  (record?.operator_review?.contact_log || []).forEach((entry) => {
    history.push({
      at: trimString(entry?.at, 40) || baseTime,
      source: trimString(entry?.actor, 80) || 'operator',
      stage: normaliseLifecycleStage(entry?.stage),
      note: trimString(entry?.message_summary, 240) || trimString(entry?.note, 240) || 'Contact state updated',
      reason: trimString(entry?.note, 240),
    });
  });
  const currentStage = deriveLifecycleStage(record);
  if (!history.some((entry) => entry.stage === currentStage)) {
    history.push({
      at: trimString(record?.operator_review?.updated_at, 40) || baseTime,
      source: trimString(record?.operator_review?.updated_by, 80) ? 'operator' : 'machine',
      stage: currentStage,
      note: 'Current lifecycle stage',
    });
  }
  return history.filter((entry) => entry.stage);
}

function candidateNeedsOperatorReview(record) {
  const stage = deriveLifecycleStage(record);
  if (['reject', 'low_priority', 'do_not_progress', 'closed'].includes(stage)) return false;
  if (record?.operator_review?.updated_at) return false;
  return ['maybe_open', 'strong_open', 'possible_shortlist', 'strong_shortlist', 'outreach_ready', 'outreach_drafted'].includes(stage);
}

function buildRecordNextAction(record) {
  const stage = deriveLifecycleStage(record);
  if (record?.full_cv?.review_status === 'error') return 'Fix CV file or extraction issue, then rerun CV review';
  if (stage === 'strong_open' && !record?.full_cv?.downloaded) return 'Open profile and download CV';
  if (stage === 'maybe_open' && !record?.full_cv?.downloaded) return 'Manually review and decide whether to download the CV';
  if (['strong_shortlist', 'possible_shortlist'].includes(stage) && record?.full_cv?.review_status !== 'completed') {
    return 'Download CV and confirm shortlist before outreach';
  }
  if (['strong_shortlist', 'possible_shortlist', 'outreach_ready'].includes(stage) && !record?.outreach?.draft_path) {
    return 'Prepare draft outreach';
  }
  if (stage === 'outreach_drafted') return 'Send manually or update contact status';
  if (stage === 'contacted') return 'Await reply and update status';
  if (stage === 'awaiting_reply') return 'Chase or close manually when appropriate';
  if (stage === 'closed' || stage === 'do_not_progress' || stage === 'reject') return 'No further action';
  if (record?.operator_review?.shortlist_bucket === 'hold') return 'Hold candidate and revisit if the shortlist needs backfill';
  return 'Review candidate manually';
}

function decisionImpliedStage(decision) {
  if (['do_not_progress', 'contacted', 'awaiting_reply', 'closed'].includes(decision)) {
    return decision;
  }
  return '';
}

function validateLifecycleTransition(record, nextReview) {
  const issues = [];
  const currentStage = deriveLifecycleStage(record);
  const targetStage = nextReview.lifecycle_stage || decisionImpliedStage(nextReview.decision);
  const hasCompletedCv = record?.full_cv?.review_status === 'completed';
  const hasOutreachContext = record?.outreach?.ready || ['strong_shortlist', 'possible_shortlist', 'outreach_ready', 'outreach_drafted', 'contacted', 'awaiting_reply'].includes(currentStage);
  const previewClassification = trimString(record?.preview_assessment?.finalClassification, 40);
  const hasManualShortlistContext = !!(
    trimString(nextReview.manual_screening_summary, 2200)
    || trimString(nextReview.final_manual_rationale, 2200)
    || trimString(nextReview.override_reason, 240)
    || (nextReview.strengths || []).length
    || trimString(nextReview.recommended_next_step, 220)
  );
  const allowManualPossibleShortlist = !hasCompletedCv
    && previewClassification !== 'reject'
    && currentStage !== 'reject'
    && trimString(nextReview.classification, 40) !== 'reject'
    && hasManualShortlistContext
    && nextReview.shortlist_status === 'possible_shortlist';

  if (nextReview.outreach_ready_override === true && !hasCompletedCv) {
    issues.push('Outreach cannot be forced ready before a completed CV review exists.');
  }
  if (nextReview.shortlist_status && !hasCompletedCv && !allowManualPossibleShortlist) {
    issues.push('Shortlist status cannot be set before a completed CV review exists.');
  }
  if (['primary', 'do_not_progress'].includes(nextReview.shortlist_bucket) && !hasCompletedCv) {
    issues.push(`Shortlist bucket ${nextReview.shortlist_bucket} requires a completed CV review.`);
  }
  if (nextReview.shortlist_bucket === 'backup' && !hasCompletedCv && !allowManualPossibleShortlist) {
    issues.push('Shortlist bucket backup requires a completed CV review or manual shortlist rationale.');
  }
  if (nextReview.shortlist_status === 'do_not_progress' && targetStage && !['do_not_progress', 'closed'].includes(targetStage)) {
    issues.push('Shortlist status do_not_progress can only be paired with lifecycle do_not_progress or closed.');
  }
  if (nextReview.shortlist_bucket === 'do_not_progress' && nextReview.shortlist_status && nextReview.shortlist_status !== 'do_not_progress') {
    issues.push('Shortlist bucket do_not_progress requires shortlist_status do_not_progress or no shortlist status.');
  }
  if (nextReview.shortlist_bucket === 'hold' && nextReview.shortlist_status === 'do_not_progress') {
    issues.push('Shortlist bucket hold cannot be paired with shortlist_status do_not_progress.');
  }
  if (nextReview.classification === 'reject' && nextReview.shortlist_status && nextReview.shortlist_status !== 'do_not_progress') {
    issues.push('A rejected preview classification cannot be paired with a shortlist status.');
  }

  if (targetStage) {
    if (PREVIEW_CLASSIFICATIONS.includes(targetStage) && hasCompletedCv) {
      issues.push('Lifecycle cannot be moved back to a preview-only stage after CV review is complete.');
    }
    if (['strong_shortlist', 'outreach_ready', 'outreach_drafted'].includes(targetStage) && !hasCompletedCv) {
      issues.push(`Lifecycle stage ${targetStage} requires a completed CV review.`);
    }
    if (targetStage === 'possible_shortlist' && !hasCompletedCv && !allowManualPossibleShortlist) {
      issues.push('Lifecycle stage possible_shortlist requires a completed CV review or manual shortlist rationale.');
    }
    if (targetStage === 'contacted' && !hasOutreachContext) {
      issues.push('Lifecycle stage contacted requires shortlist or outreach readiness first.');
    }
    if (targetStage === 'awaiting_reply' && !['contacted', 'awaiting_reply'].includes(currentStage)) {
      issues.push('Lifecycle stage awaiting_reply can only follow contacted.');
    }
    if (targetStage === 'closed' && currentStage === 'preview_only') {
      issues.push('Lifecycle stage closed cannot be set before a candidate has entered the workflow.');
    }
  }

  if (nextReview.decision) {
    const implied = decisionImpliedStage(nextReview.decision);
    if (implied && nextReview.lifecycle_stage && nextReview.lifecycle_stage !== implied && !(nextReview.decision === 'manual_screened' || nextReview.decision === 'hold')) {
      issues.push(`Operator decision ${nextReview.decision} conflicts with lifecycle stage ${nextReview.lifecycle_stage}.`);
    }
  }

  return issues;
}

function createCandidateReviewRecord({
  job,
  roleDir,
  candidate,
  index,
  previewReview,
  fullCvReview,
  outreachDraft,
  cvInfo,
  operatorReview,
  processingError,
}) {
  const now = nowIso();
  const candidateId = buildCandidateIdentifier(candidate, index);
  const manualReview = normaliseOperatorReviewState(operatorReview);
  const sourceAudit = buildSourceAudit(candidate, previewReview);
  const record = {
    version: WORKFLOW_VERSION,
    candidate_id: candidateId,
    role_id: job.roleId,
    source: trimString(candidate.source, 80) || 'CV-Library',
    source_audit: sourceAudit,
    search_used: {
      variant: trimString(candidate.search_variant, 40),
      name: trimString(candidate.search_name, 160),
      boolean_used: trimString(candidate.boolean_used, 2000),
    },
    candidate_name: trimString(candidate.candidate_name, 160),
    email: trimString(candidate.email, 240),
    current_title: trimString(candidate.current_title, 160),
    location: trimString(candidate.location, 160),
    preview: {
      headline: trimString(candidate.headline, 220),
      summary_text: trimString(candidate.summary_text, 4000),
      sector_tags: uniqueStrings(candidate.sector_tags, 8, 80),
      mobility: trimString(candidate.mobility, 160),
      salary_text: trimString(candidate.salary_text, 120),
      notes: trimString(candidate.preview_notes, 500),
      last_updated: trimString(candidate.last_updated, 40),
      opened_profile: candidate.opened_profile === true,
      source_reference_id: trimString(candidate.source_reference_id, 120),
      source_url: trimString(candidate.source_url, 1200),
    },
    preview_assessment: {
      ...previewReview,
      assessed_at: trimString(previewReview?.assessed_at, 40) || now,
    },
    full_cv: fullCvReview
      ? {
        downloaded: !!cvInfo?.downloaded,
        cv_file: cvInfo?.relativePath || '',
        extraction_summary: cvInfo?.summary || '',
        review_status: 'completed',
        reviewed_at: now,
        score: fullCvReview.totalScore,
        shortlist_recommendation: fullCvReview.shortlistRecommendation,
        strengths: fullCvReview.strengths,
        gaps: fullCvReview.gaps,
        follow_up_questions: fullCvReview.followUpQuestions,
        extracted_highlights: fullCvReview.extractedHighlights,
        uncertainty_notes: fullCvReview.uncertaintyNotes,
        suitability_summary: fullCvReview.candidateSuitabilitySummary,
        outreach_ready: fullCvReview.outreachReady,
      }
      : {
        downloaded: !!cvInfo?.downloaded,
        cv_file: cvInfo?.relativePath || '',
        review_status: processingError ? 'error' : cvInfo?.downloaded ? 'pending' : 'not_downloaded',
        reviewed_at: processingError ? now : '',
        error_message: processingError || '',
      },
    outreach: outreachDraft
      ? {
        ready: true,
        email: outreachDraft.email,
        subject: outreachDraft.subject,
        draft_path: '',
        drafted_at: now,
        evidence_points: outreachDraft.evidencePoints,
        questions: outreachDraft.questions,
        why_contacted_summary: outreachDraft.whyContactedSummary,
      }
      : {
        ready: false,
        email: trimString(candidate.email, 240),
      },
    operator_review: manualReview,
    operator_decision: manualReview.decision || trimString(candidate.operator_decision, 80) || '',
    audit_notes: manualReview.manual_notes || trimString(candidate.audit_notes, 800),
    created_at: now,
    updated_at: now,
  };

  record.outreach.ready = deriveOutreachReady(record);
  record.status = {
    preview_stage: trimString(record.preview_assessment.finalClassification, 40) || 'preview_only',
    shortlist_stage: deriveShortlistStage(record),
    current_stage: '',
    outreach_ready: record.outreach.ready,
    needs_operator_review: false,
    next_action: '',
  };
  record.status.current_stage = deriveLifecycleStage(record);
  record.status.needs_operator_review = candidateNeedsOperatorReview(record);
  record.status.next_action = buildRecordNextAction(record);
  record.lifecycle = {
    current_stage: record.status.current_stage,
    history: buildLifecycleHistory(record),
  };
  return record;
}

function refreshCandidateRecordState(record) {
  record.outreach.ready = deriveOutreachReady(record);
  record.status.preview_stage = trimString(record.preview_assessment.finalClassification, 40) || 'preview_only';
  record.status.shortlist_stage = deriveShortlistStage(record);
  record.status.outreach_ready = record.outreach.ready;
  record.status.current_stage = deriveLifecycleStage(record);
  record.status.needs_operator_review = candidateNeedsOperatorReview(record);
  record.status.next_action = buildRecordNextAction(record);
  record.lifecycle.current_stage = record.status.current_stage;
  record.lifecycle.history = buildLifecycleHistory(record);
  return record;
}

function stagePriority(stage) {
  const table = {
    strong_shortlist: 80,
    outreach_ready: 78,
    outreach_drafted: 77,
    contacted: 74,
    awaiting_reply: 72,
    possible_shortlist: 68,
    cv_reviewed: 60,
    strong_open: 52,
    maybe_open: 40,
    low_priority: 18,
    preview_only: 10,
    reject: -20,
    do_not_progress: -25,
    closed: -30,
  };
  return table[trimString(stage, 40)] ?? 0;
}

function buildRankingReasons(record) {
  const bucket = normaliseShortlistBucket(record?.operator_review?.shortlist_bucket);
  return uniqueStrings([
    bucket === 'primary' ? 'Pinned as primary shortlist' : '',
    bucket === 'backup' ? 'Marked as backup shortlist' : '',
    bucket === 'hold' ? 'Held for revisit later' : '',
    record?.operator_review?.ranking_pin ? 'Manually pinned' : '',
    ...(record?.full_cv?.strengths || []),
    ...(record?.preview_assessment?.reasons || []),
    ...(record?.full_cv?.extracted_highlights || []),
  ], 3, 220);
}

function calculateRankComponents(record, roleConfig = buildDefaultRoleConfig()) {
  const fullCvScore = Number(record?.full_cv?.score) || 0;
  const previewScore = Number(record?.preview_assessment?.totalScore) || 0;
  const baseScore = fullCvScore || previewScore;
  const shortlistBucket = normaliseShortlistBucket(record?.operator_review?.shortlist_bucket);
  const shortlistBoost = record?.status?.shortlist_stage === 'strong_shortlist'
    ? 18
    : record?.status?.shortlist_stage === 'possible_shortlist'
      ? 8
      : 0;
  const bucketBoost = shortlistBucket === 'primary'
    ? 16
    : shortlistBucket === 'backup'
      ? 7
      : shortlistBucket === 'hold'
        ? -10
        : shortlistBucket === 'do_not_progress'
          ? -35
          : 0;
  const draftBoost = record?.outreach?.draft_path ? 6 : record?.outreach?.ready ? 4 : 0;
  const emailPenalty = trimString(record?.email || record?.outreach?.email, 240) ? 0 : -4;
  const pinBoost = record?.operator_review?.ranking_pin === true ? 24 : 0;
  const stageBoost = stagePriority(record?.lifecycle?.current_stage);
  const total = Number((baseScore + stageBoost + shortlistBoost + bucketBoost + draftBoost + emailPenalty + pinBoost).toFixed(2));
  return {
    base_score: baseScore,
    stage_boost: stageBoost,
    shortlist_boost: shortlistBoost,
    bucket_boost: bucketBoost,
    draft_boost: draftBoost,
    email_penalty: emailPenalty,
    pin_boost: pinBoost,
    total,
  };
}

function calculateRankScore(record, roleConfig = buildDefaultRoleConfig()) {
  return calculateRankComponents(record, roleConfig).total;
}

function applyCandidateRanking(candidateRecords, roleConfig = buildDefaultRoleConfig()) {
  const sorted = [...candidateRecords].sort((left, right) => {
    const scoreDiff = calculateRankScore(right, roleConfig) - calculateRankScore(left, roleConfig);
    if (scoreDiff !== 0) return scoreDiff;
    return String(left.candidate_id || '').localeCompare(String(right.candidate_id || ''));
  });

  const positions = new Map();
  sorted.forEach((record, index) => {
    positions.set(record.candidate_id, index + 1);
  });

  candidateRecords.forEach((record) => {
    const components = calculateRankComponents(record, roleConfig);
    record.ranking = {
      position: positions.get(record.candidate_id) || 0,
      total_score: components.total,
      pinned: record?.operator_review?.ranking_pin === true || ['strong_shortlist', 'outreach_ready', 'outreach_drafted', 'contacted', 'awaiting_reply'].includes(record.lifecycle.current_stage),
      shortlist_bucket: normaliseShortlistBucket(record?.operator_review?.shortlist_bucket),
      breakdown: components,
      reasons: buildRankingReasons(record),
    };
  });

  return sorted;
}

function deriveRoleWorkflowState(metrics, roleConfig = buildDefaultRoleConfig()) {
  if ((metrics.lifecycle_counts?.awaiting_reply || 0) > 0) return 'awaiting_candidate_replies';
  if ((metrics.lifecycle_counts?.contacted || 0) > 0) return 'outreach_in_progress';
  if ((metrics.shortlist_progress?.strong_count || 0) >= roleConfig.shortlist_target_size) return 'shortlist_target_reached';
  if ((metrics.outreach_drafts_prepared || 0) > 0 || (metrics.viable_outreach_candidates || 0) > 0) return 'outreach_ready';
  if (((metrics.shortlist_counts?.strong || 0) + (metrics.shortlist_counts?.possible || 0)) > 0) return 'shortlist_in_progress';
  if ((metrics.cvs_downloaded || 0) > 0 || (metrics.operator_review_needed || 0) > 0) return 'screening_in_progress';
  return 'gathering_candidates';
}

function buildShortlistProgress(roleConfig, metrics) {
  const target = roleConfig.shortlist_target_size;
  const strong = metrics.shortlist_counts?.strong || 0;
  const possible = metrics.shortlist_counts?.possible || 0;
  const totalViable = strong + possible;
  const remainingStrongNeeded = Math.max(target - strong, 0);
  const remainingViableNeeded = Math.max(target - totalViable, 0);
  const status = strong >= target
    ? 'shortlist_target_reached'
    : totalViable > 0
      ? 'actively_building_shortlist'
      : 'waiting_for_more_source_candidates';
  return {
    target,
    strong_count: strong,
    possible_count: possible,
    total_viable_count: totalViable,
    remaining_strong_needed: remainingStrongNeeded,
    remaining_viable_needed: remainingViableNeeded,
    status,
    message: `Target ${target} shortlist candidates: currently ${strong} strong and ${possible} possible.`,
  };
}

function buildMetrics(job, candidateRecords, roleConfig = buildDefaultRoleConfig()) {
  const previewCounts = {
    strong_open: 0,
    maybe_open: 0,
    low_priority: 0,
    reject: 0,
  };
  const shortlistCounts = {
    strong: 0,
    possible: 0,
    reject: 0,
    pending: 0,
  };
  const lifecycleCounts = LIFECYCLE_STAGES.reduce((accumulator, stage) => ({
    ...accumulator,
    [stage]: 0,
  }), {});
  const shortlistBucketCounts = SHORTLIST_BUCKETS.reduce((accumulator, bucket) => ({
    ...accumulator,
    [bucket]: 0,
  }), {});
  const rejectReasonSummary = {};
  const nextActions = [];
  let profilesOpened = 0;
  let cvsDownloaded = 0;
  let viableOutreachCandidates = 0;
  let operatorOverrides = 0;
  let operatorUpdateEvents = 0;
  let shortlistTotal = 0;
  let outreachDraftsPrepared = 0;
  let operatorReviewNeeded = 0;

  candidateRecords.forEach((record) => {
    const previewClass = trimString(record?.preview_assessment?.finalClassification, 40);
    if (previewCounts[previewClass] !== undefined) previewCounts[previewClass] += 1;
    if (record?.preview?.opened_profile === true) profilesOpened += 1;
    const lifecycleStage = trimString(record?.lifecycle?.current_stage, 40);
    if (lifecycleCounts[lifecycleStage] !== undefined) lifecycleCounts[lifecycleStage] += 1;
    const shortlistBucket = normaliseShortlistBucket(record?.operator_review?.shortlist_bucket);
    if (shortlistBucketCounts[shortlistBucket] !== undefined) shortlistBucketCounts[shortlistBucket] += 1;
    if (record?.preview_assessment?.overrideApplied || record?.operator_review?.updated_at) operatorOverrides += 1;
    operatorUpdateEvents += Array.isArray(record?.operator_review?.history) ? record.operator_review.history.length : 0;
    if (record?.full_cv?.downloaded) cvsDownloaded += 1;
    const shortlist = trimString(record?.full_cv?.shortlist_recommendation, 40);
    if (shortlistCounts[shortlist] !== undefined) shortlistCounts[shortlist] += 1;
    if (record?.full_cv?.review_status === 'pending') shortlistCounts.pending += 1;
    if (record?.outreach?.ready) viableOutreachCandidates += 1;
    if (record?.outreach?.draft_path) outreachDraftsPrepared += 1;
    if (['strong_shortlist', 'possible_shortlist', 'outreach_ready', 'outreach_drafted', 'contacted', 'awaiting_reply'].includes(lifecycleStage)) {
      shortlistTotal += 1;
    }
    if (record?.status?.needs_operator_review) operatorReviewNeeded += 1;
    const rejectReasons = []
      .concat(record?.preview_assessment?.hardRejectReasons || [])
      .concat(previewClass === 'reject' ? record?.preview_assessment?.missingCriticalInfo || [] : [])
      .concat(record?.operator_review?.concerns || [])
      .filter(Boolean);
    rejectReasons.slice(0, 2).forEach((reason) => {
      rejectReasonSummary[reason] = (rejectReasonSummary[reason] || 0) + 1;
    });
    if (record?.status?.next_action && !nextActions.includes(record.status.next_action) && record.status.next_action !== 'No further action') {
      nextActions.push(record.status.next_action);
    }
  });

  const profilesReviewed = candidateRecords.length;
  const recommendedToOpen = previewCounts.strong_open + previewCounts.maybe_open;
  const shortlistRate = profilesReviewed ? Number((shortlistTotal / profilesReviewed).toFixed(3)) : 0;
  const outreachReadyRate = profilesReviewed ? Number((viableOutreachCandidates / profilesReviewed).toFixed(3)) : 0;

  const metrics = {
    role_id: job.roleId,
    profiles_reviewed: profilesReviewed,
    recommended_to_open: recommendedToOpen,
    profiles_opened: profilesOpened,
    cvs_downloaded: cvsDownloaded,
    viable_outreach_candidates: viableOutreachCandidates,
    outreach_drafts_prepared: outreachDraftsPrepared,
    preview_counts: previewCounts,
    shortlist_counts: shortlistCounts,
    shortlist_bucket_counts: shortlistBucketCounts,
    lifecycle_counts: lifecycleCounts,
    operator_overrides: operatorOverrides,
    operator_update_events: operatorUpdateEvents,
    operator_review_needed: operatorReviewNeeded,
    shortlist_rate: shortlistRate,
    outreach_ready_rate: outreachReadyRate,
    reject_reasons_summary: Object.entries(rejectReasonSummary)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([reason, count]) => ({ reason, count })),
    next_actions: nextActions.slice(0, 6),
    conversion: {
      reviewed_to_open_recommendation: profilesReviewed ? Number((recommendedToOpen / profilesReviewed).toFixed(3)) : 0,
      reviewed_to_cv_download: profilesReviewed ? Number((cvsDownloaded / profilesReviewed).toFixed(3)) : 0,
      reviewed_to_viable_outreach: profilesReviewed ? Number((viableOutreachCandidates / profilesReviewed).toFixed(3)) : 0,
      open_recommendation_to_cv_download: recommendedToOpen ? Number((cvsDownloaded / recommendedToOpen).toFixed(3)) : 0,
      cv_download_to_viable_outreach: cvsDownloaded ? Number((viableOutreachCandidates / cvsDownloaded).toFixed(3)) : 0,
      cv_download_to_shortlist: cvsDownloaded ? Number((shortlistTotal / cvsDownloaded).toFixed(3)) : 0,
      shortlist_to_outreach_ready: shortlistTotal ? Number((viableOutreachCandidates / shortlistTotal).toFixed(3)) : 0,
      manual_profiles_reviewed_per_viable_outreach_candidate: viableOutreachCandidates
        ? Number((profilesReviewed / viableOutreachCandidates).toFixed(2))
        : null,
    },
    shortlist_progress: buildShortlistProgress(roleConfig, {
      shortlist_counts: shortlistCounts,
      lifecycle_counts: lifecycleCounts,
    }),
    role_workflow_state: '',
  };
  metrics.role_workflow_state = deriveRoleWorkflowState(metrics, roleConfig);
  return metrics;
}

function markdownTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((column) => trimString(column.render(row), 300) || ' ').join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

function buildSearchPackMarkdown(job, searchPack) {
  const variants = ['broad', 'medium', 'narrow'].map((key) => searchPack.variants[key]);
  return [
    `# Search Pack`,
    '',
    `Role: ${job.title.canonical || job.roleId}`,
    '',
    `Primary Boolean:`,
    '',
    '```text',
    searchPack.primaryBoolean || '',
    '```',
    '',
    '## Variants',
    '',
    ...variants.flatMap((variant) => [
      `### ${variant.variant}`,
      '',
      '```text',
      variant.boolean || '',
      '```',
      '',
      `Filters: minimum match ${variant.filters.minimumMatch}, submitted since ${variant.filters.submittedSince}${variant.filters.radiusMiles ? `, radius ${variant.filters.radiusMiles} miles` : ''}.`,
      '',
    ]),
    '## Title Synonyms',
    '',
    `- ${searchPack.titleSynonymPack.join(', ') || 'None supplied'}`,
    '',
    '## Sector Synonyms',
    '',
    `- ${searchPack.sectorSynonymPack.join(', ') || 'None supplied'}`,
    '',
    '## Exclusions',
    '',
    `- ${searchPack.exclusionString || 'None supplied'}`,
    '',
    '## Search Priority',
    '',
    ...searchPack.searchPriority.map((entry, index) => `${index + 1}. ${entry}`),
    '',
    '## Operator Notes',
    '',
    ...searchPack.operatorNotes.map((entry) => `- ${entry}`),
    '',
  ].join('\n');
}

function buildMetricsMarkdown(job, metrics) {
  return [
    '# Funnel Metrics',
    '',
    `Role: ${job.title.canonical || job.roleId}`,
    '',
    `- Shortlist target: ${metrics.shortlist_progress.target}`,
    `- Shortlist progress: ${metrics.shortlist_progress.strong_count} strong / ${metrics.shortlist_progress.possible_count} possible`,
    `- Shortlist status: ${metrics.shortlist_progress.status}`,
    `- Role workflow state: ${metrics.role_workflow_state}`,
    `- Preview profiles processed: ${metrics.profiles_reviewed}`,
    `- Strong open: ${metrics.preview_counts.strong_open}`,
    `- Maybe open: ${metrics.preview_counts.maybe_open}`,
    `- Low priority: ${metrics.preview_counts.low_priority}`,
    `- Reject: ${metrics.preview_counts.reject}`,
    `- CVs reviewed: ${metrics.cvs_downloaded}`,
    `- Strong shortlist: ${metrics.shortlist_counts.strong}`,
    `- Possible shortlist: ${metrics.shortlist_counts.possible}`,
    `- Reject after CV review: ${metrics.shortlist_counts.reject}`,
    `- Outreach-ready candidates: ${metrics.viable_outreach_candidates}`,
    `- Outreach drafts prepared: ${metrics.outreach_drafts_prepared}`,
    `- Shortlist rate: ${metrics.shortlist_rate}`,
    `- Outreach-ready rate: ${metrics.outreach_ready_rate}`,
    `- Operator updates: ${metrics.operator_overrides} candidate(s), ${metrics.operator_update_events} update event(s)`,
    `- Operator review still needed: ${metrics.operator_review_needed}`,
    `- Profiles reviewed per outreach-ready candidate: ${metrics.conversion.manual_profiles_reviewed_per_viable_outreach_candidate ?? 'n/a'}`,
    '',
    '## Lifecycle Counts',
    '',
    ...Object.entries(metrics.lifecycle_counts)
      .filter(([, count]) => count)
      .map(([stage, count]) => `- ${stage}: ${count}`),
    '',
    '## Shortlist Buckets',
    '',
    ...Object.entries(metrics.shortlist_bucket_counts || {})
      .filter(([, count]) => count)
      .map(([bucket, count]) => `- ${bucket}: ${count}`),
    '',
    '## Conversion',
    '',
    `- Reviewed to open recommendation: ${metrics.conversion.reviewed_to_open_recommendation}`,
    `- Reviewed to CV download: ${metrics.conversion.reviewed_to_cv_download}`,
    `- CV download to shortlist: ${metrics.conversion.cv_download_to_shortlist}`,
    `- Shortlist to outreach-ready: ${metrics.conversion.shortlist_to_outreach_ready}`,
    '',
    '## Reject Reason Summary',
    '',
    ...(metrics.reject_reasons_summary.length
      ? metrics.reject_reasons_summary.map((entry) => `- ${entry.reason}: ${entry.count}`)
      : ['- No reject reasons recorded yet.']),
    '',
    '## Next Actions',
    '',
    ...(metrics.next_actions.length
      ? metrics.next_actions.map((entry) => `- ${entry}`)
      : ['- No immediate next actions.']),
    '',
  ].join('\n');
}

function buildOperatorReviewMarkdown(job, metrics, candidateRecords) {
  const previewRows = candidateRecords.map((record) => ({
    candidate: record.candidate_name || record.current_title || record.candidate_id,
    rank: record.ranking?.position || '',
    lifecycle: record.lifecycle.current_stage,
    classification: record.preview_assessment.finalClassification,
    score: record.preview_assessment.totalScore,
    shortlist: record.status.shortlist_stage || 'pending',
    bucket: record.operator_review.shortlist_bucket || '',
    decision: record.operator_decision || '',
    outreach: record.outreach.draft_path ? 'drafted' : record.outreach.ready ? 'ready' : 'not ready',
    contact: latestContactEvent(record)?.stage || '',
    nextAction: record.status.next_action,
  }));

  return [
    `# Operator Review`,
    '',
    `Role: ${job.title.canonical || job.roleId}`,
    '',
    `Profiles reviewed: ${metrics.profiles_reviewed}`,
    `Recommended to open: ${metrics.recommended_to_open}`,
    `CVs downloaded: ${metrics.cvs_downloaded}`,
    `Viable outreach candidates: ${metrics.viable_outreach_candidates}`,
    `Operator review still needed: ${metrics.operator_review_needed}`,
    `Manual profiles reviewed per viable outreach candidate: ${metrics.conversion.manual_profiles_reviewed_per_viable_outreach_candidate ?? 'n/a'}`,
    '',
    '## Preview Queue',
    '',
    markdownTable(previewRows, [
      { label: 'Candidate', render: (row) => row.candidate },
      { label: 'Rank', render: (row) => String(row.rank) },
      { label: 'Lifecycle', render: (row) => row.lifecycle },
      { label: 'Preview Class', render: (row) => row.classification },
      { label: 'Score', render: (row) => String(row.score) },
      { label: 'Shortlist', render: (row) => row.shortlist },
      { label: 'Bucket', render: (row) => row.bucket || ' ' },
      { label: 'Operator', render: (row) => row.decision || 'pending' },
      { label: 'Outreach', render: (row) => row.outreach },
      { label: 'Contact', render: (row) => row.contact || ' ' },
      { label: 'Next Action', render: (row) => row.nextAction },
    ]),
    '',
  ].join('\n');
}

function buildCandidateExportRows(candidateRecords) {
  return candidateRecords.map((record) => ({
    role_id: record.role_id,
    candidate_id: record.candidate_id,
    candidate_name: record.candidate_name,
    rank_position: record.ranking?.position || '',
    rank_score: record.ranking?.total_score || '',
    current_title: record.current_title,
    source: record.source,
    source_reference_id: record.source_audit?.source_reference_id || '',
    source_url: record.source_audit?.source_url || '',
    found_at: record.source_audit?.found_at || '',
    imported_at: record.source_audit?.imported_at || '',
    import_method: record.source_audit?.import_method || '',
    search_variant: record.search_used.variant,
    boolean_used: record.search_used.boolean_used || '',
    location: record.location,
    email: record.email || record.outreach.email || '',
    preview_classification: record.preview_assessment.finalClassification,
    preview_score: record.preview_assessment.totalScore,
    lifecycle_stage: record.lifecycle.current_stage,
    shortlist_status: record.status.shortlist_stage,
    shortlist_bucket: record.operator_review.shortlist_bucket || '',
    ranking_pin: record.operator_review.ranking_pin === true ? 'yes' : 'no',
    outreach_ready: record.outreach.ready ? 'yes' : 'no',
    outreach_draft_path: record.outreach.draft_path || '',
    latest_contact_stage: latestContactEvent(record)?.stage || '',
    latest_contact_at: latestContactEvent(record)?.at || '',
    latest_contact_note: latestContactEvent(record)?.note || '',
    operator_decision: record.operator_decision || '',
    operator_review_needed: record.status.needs_operator_review ? 'yes' : 'no',
    machine_strengths: (record.full_cv.strengths || []).join(' | '),
    operator_strengths: (record.operator_review.strengths || []).join(' | '),
    operator_concerns: (record.operator_review.concerns || []).join(' | '),
    follow_up_questions: uniqueStrings([
      ...(record.full_cv.follow_up_questions || []),
      ...(record.operator_review.follow_up_questions || []),
    ], 12, 220).join(' | '),
    availability_notes: record.operator_review.availability_notes || '',
    appetite_notes: record.operator_review.appetite_notes || '',
    compensation_notes: record.operator_review.compensation_notes || '',
    location_mobility_notes: record.operator_review.location_mobility_notes || '',
    manual_screening_summary: record.operator_review.manual_screening_summary || '',
    recommended_next_step: record.operator_review.recommended_next_step || '',
    recruiter_confidence: record.operator_review.recruiter_confidence || '',
    final_manual_rationale: record.operator_review.final_manual_rationale || '',
    next_action: record.status.next_action,
  }));
}

function buildCandidateImportChange(previousCandidate, nextCandidate, candidateId) {
  const changeFields = [
    ['candidate_name', 'Candidate name'],
    ['current_title', 'Current title'],
    ['headline', 'Headline'],
    ['summary_text', 'Preview text'],
    ['location', 'Location'],
    ['mobility', 'Mobility'],
    ['salary_text', 'Salary / rate'],
    ['sector_tags', 'Sector tags'],
    ['email', 'Email'],
    ['cv_file', 'CV file'],
    ['cv_extraction_summary', 'CV extraction summary'],
    ['import_method', 'Import method'],
    ['source_url', 'Source URL'],
    ['source_reference_id', 'Source reference'],
    ['search_variant', 'Search variant'],
    ['boolean_used', 'Boolean used'],
    ['found_at', 'Found at'],
  ];
  const changed = changeFields
    .map(([key, label]) => {
      const beforeValue = listValue(previousCandidate?.[key]);
      const afterValue = listValue(nextCandidate?.[key]);
      if (compareValues(beforeValue, afterValue)) return null;
      return {
        field: key,
        label,
        previous: Array.isArray(beforeValue) ? beforeValue.join(', ') : beforeValue,
        current: Array.isArray(afterValue) ? afterValue.join(', ') : afterValue,
      };
    })
    .filter(Boolean);

  const sourceChanges = changed.filter((entry) => ['source_url', 'source_reference_id', 'search_variant', 'boolean_used', 'found_at'].includes(entry.field));
  return {
    candidate_id: candidateId,
    candidate_name: trimString(nextCandidate?.candidate_name || previousCandidate?.candidate_name, 160),
    current_title: trimString(nextCandidate?.current_title || previousCandidate?.current_title, 160),
    change_type: previousCandidate ? 'updated' : 'added',
    changed_fields: changed.map((entry) => entry.field),
    change_labels: changed.map((entry) => entry.label),
    field_changes: changed.slice(0, 16),
    previous_preview_excerpt: previewExcerpt(previousCandidate?.summary_text),
    current_preview_excerpt: previewExcerpt(nextCandidate?.summary_text),
    previous_title: trimString(previousCandidate?.current_title, 160),
    current_title_after: trimString(nextCandidate?.current_title, 160),
    previous_location: trimString(previousCandidate?.location, 160),
    current_location: trimString(nextCandidate?.location, 160),
    source_changes: sourceChanges.slice(0, 8),
  };
}

function detectTextFile(filePath) {
  const extension = trimString(path.extname(filePath).slice(1).toLowerCase(), 16);
  return extension === 'txt' || extension === 'md';
}

async function extractCvInfo(roleDir, candidate) {
  const rawCvPath = trimString(candidate.cv_file, 500);
  if (!rawCvPath && !trimString(candidate.cv_text, 200)) {
    return null;
  }

  if (trimString(candidate.cv_text, 200)) {
    return {
      downloaded: true,
      relativePath: '',
      text: candidate.cv_text,
      summary: trimString(candidate.cv_extraction_summary, 500) || 'Used inline CV text from the candidate input file.',
    };
  }

  const resolvedPath = path.isAbsolute(rawCvPath)
    ? rawCvPath
    : path.resolve(roleDir, rawCvPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`CV file not found: ${resolvedPath}`);
  }

  if (detectTextFile(resolvedPath)) {
    return {
      downloaded: true,
      relativePath: relPath(roleDir, resolvedPath),
      text: readTextFile(resolvedPath),
      summary: 'Read CV text directly from a plain-text file.',
    };
  }

  const buffer = fs.readFileSync(resolvedPath);
  const prepared = candidateMatcherCore.prepareCandidateFiles([{
    name: path.basename(resolvedPath),
    contentType: '',
    size: buffer.byteLength,
    data: buffer.toString('base64'),
  }]);
  const extraction = await candidateMatcherCore.extractCandidateDocuments(prepared, {
    enablePdfOcr: false,
  });
  if (!extraction.documents[0] || extraction.documents[0].status !== 'ok') {
    throw new Error(extraction.documents[0]?.error || 'CV extraction failed.');
  }
  return {
    downloaded: true,
    relativePath: relPath(roleDir, resolvedPath),
    text: extraction.combinedText,
    summary: extraction.documents[0]?.error
      ? extraction.documents[0].error
      : `Extracted text from ${path.basename(resolvedPath)} via the candidate matcher parser.`,
  };
}

function buildArtifactDescriptor(roleDir, relativePath, options = {}) {
  const cleanedPath = trimString(relativePath, 400);
  const absolutePath = cleanedPath ? path.resolve(roleDir, cleanedPath) : '';
  const exists = absolutePath ? fs.existsSync(absolutePath) : false;
  const stats = exists ? fs.statSync(absolutePath) : null;
  return {
    path: cleanedPath,
    exists,
    downloadable: options.downloadable !== false,
    openable: exists,
    last_updated: stats ? stats.mtime.toISOString() : '',
    size_bytes: stats ? stats.size : 0,
    status: exists ? 'available' : 'missing',
    label: options.label || path.basename(cleanedPath || '') || '',
    group: trimString(options.group, 80) || 'role',
    source_of_truth: trimString(options.sourceOfTruth, 240) || 'filesystem',
    empty_state: trimString(options.emptyState, 240) || (exists ? '' : 'Not generated yet.'),
  };
}

function formatSourceAuditString(record) {
  const foundAt = trimString(record?.source_audit?.found_at, 40);
  const booleanUsed = trimString(record?.source_audit?.boolean_used, 240);
  const searchVariant = trimString(record?.search_used?.variant, 40);
  const referenceId = trimString(record?.source_audit?.source_reference_id, 120);
  return `Found from ${record?.source || 'the source'}${foundAt ? ` on ${foundAt}` : ''}${searchVariant ? ` via ${searchVariant} search` : ''}${booleanUsed ? ` using Boolean: ${booleanUsed}` : ''}${referenceId ? ` (ref ${referenceId})` : ''}`.trim();
}

function summarizeHistoryIds(values) {
  return limitHistoryIds(values, 20);
}

function readImportHistory(roleDir) {
  return readHistoryEntries(roleDir, DEFAULT_IMPORT_HISTORY_FILE);
}

function readRunHistory(roleDir) {
  return readHistoryEntries(roleDir, DEFAULT_RUN_HISTORY_FILE);
}

function mapRecordsById(records = []) {
  const mapped = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    if (trimString(record?.candidate_id, 80)) {
      mapped.set(record.candidate_id, record);
    }
  });
  return mapped;
}

function buildRunChangeSummary(previousRecords = [], nextRecords = []) {
  const previousById = mapRecordsById(previousRecords);
  const nextById = mapRecordsById(nextRecords);
  const addedIds = [];
  const removedIds = [];
  const draftAddedIds = [];
  const shortlistReadyIds = [];
  const rankingChanges = [];
  const statusChanges = [];

  nextRecords.forEach((record) => {
    const previous = previousById.get(record.candidate_id);
    if (!previous) {
      addedIds.push(record.candidate_id);
      if (['strong_shortlist', 'possible_shortlist', 'outreach_ready', 'outreach_drafted'].includes(record.lifecycle?.current_stage)) {
        shortlistReadyIds.push(record.candidate_id);
      }
      if (record.outreach?.draft_path) draftAddedIds.push(record.candidate_id);
      return;
    }

    if (!previous.outreach?.draft_path && record.outreach?.draft_path) {
      draftAddedIds.push(record.candidate_id);
    }
    if (
      trimString(previous.lifecycle?.current_stage, 40) !== trimString(record.lifecycle?.current_stage, 40)
      || trimString(previous.status?.shortlist_stage, 40) !== trimString(record.status?.shortlist_stage, 40)
      || normaliseShortlistBucket(previous.operator_review?.shortlist_bucket) !== normaliseShortlistBucket(record.operator_review?.shortlist_bucket)
    ) {
      statusChanges.push({
        candidate_id: record.candidate_id,
        from_stage: previous.lifecycle?.current_stage || '',
        to_stage: record.lifecycle?.current_stage || '',
        from_shortlist: previous.status?.shortlist_stage || '',
        to_shortlist: record.status?.shortlist_stage || '',
        from_bucket: previous.operator_review?.shortlist_bucket || '',
        to_bucket: record.operator_review?.shortlist_bucket || '',
      });
      if (['strong_shortlist', 'possible_shortlist', 'outreach_ready', 'outreach_drafted'].includes(record.lifecycle?.current_stage)) {
        shortlistReadyIds.push(record.candidate_id);
      }
    }
    if ((previous.ranking?.position || 0) !== (record.ranking?.position || 0)) {
      rankingChanges.push({
        candidate_id: record.candidate_id,
        from: previous.ranking?.position || 0,
        to: record.ranking?.position || 0,
      });
    }
  });

  previousRecords.forEach((record) => {
    if (!nextById.has(record.candidate_id)) {
      removedIds.push(record.candidate_id);
    }
  });

  return {
    added: summarizeHistoryIds(addedIds),
    removed: summarizeHistoryIds(removedIds),
    drafts_added: summarizeHistoryIds(draftAddedIds),
    shortlist_ready: summarizeHistoryIds(shortlistReadyIds),
    ranking_changes: rankingChanges.slice(0, 20),
    ranking_change_count: rankingChanges.length,
    status_changes: statusChanges.slice(0, 20),
    status_change_count: statusChanges.length,
  };
}

function buildCandidateSessionFlags(record, latestImportEntry = null, latestRunEntry = null) {
  const candidateId = trimString(record?.candidate_id, 80);
  const importChangedIds = new Set([
    ...((latestImportEntry?.added?.ids) || []),
    ...((latestImportEntry?.updated?.ids) || []),
  ]);
  const latestShortlistIds = new Set((latestRunEntry?.changes?.shortlist_ready?.ids) || []);
  return {
    new_since_last_review: !trimString(record?.operator_review?.updated_at, 40) && importChangedIds.has(candidateId),
    awaiting_manual_screening: record?.status?.needs_operator_review === true,
    newly_shortlist_ready: latestShortlistIds.has(candidateId),
    draft_ready_not_contacted: !!record?.outreach?.draft_path && !['contacted', 'awaiting_reply', 'closed'].includes(record?.lifecycle?.current_stage),
    contacted_awaiting_reply: ['contacted', 'awaiting_reply'].includes(record?.lifecycle?.current_stage),
    changed_since_last_import: importChangedIds.has(candidateId),
  };
}

function buildCandidateChangeReview(record, latestImportEntry = null, latestRunEntry = null) {
  const candidateId = trimString(record?.candidate_id, 80);
  const importChange = Array.isArray(latestImportEntry?.candidate_changes)
    ? latestImportEntry.candidate_changes.find((entry) => trimString(entry?.candidate_id, 80) === candidateId) || null
    : null;
  const rankChange = Array.isArray(latestRunEntry?.changes?.ranking_changes)
    ? latestRunEntry.changes.ranking_changes.find((entry) => trimString(entry?.candidate_id, 80) === candidateId) || null
    : null;
  const statusChange = Array.isArray(latestRunEntry?.changes?.status_changes)
    ? latestRunEntry.changes.status_changes.find((entry) => trimString(entry?.candidate_id, 80) === candidateId) || null
    : null;
  const draftAdded = ((latestRunEntry?.changes?.drafts_added?.ids) || []).includes(candidateId);
  const shortlistReady = ((latestRunEntry?.changes?.shortlist_ready?.ids) || []).includes(candidateId);
  const summaries = [];
  if (importChange?.change_type === 'added') summaries.push('New candidate added in the latest import.');
  if (importChange?.change_type === 'updated' && (importChange?.change_labels || []).length) {
    summaries.push(`Updated fields: ${(importChange.change_labels || []).join(', ')}.`);
  }
  if (rankChange && rankChange.from !== rankChange.to) {
    summaries.push(`Rank moved from ${rankChange.from || 'unranked'} to ${rankChange.to || 'unranked'}.`);
  }
  if (statusChange && (statusChange.from_stage !== statusChange.to_stage || statusChange.from_shortlist !== statusChange.to_shortlist || statusChange.from_bucket !== statusChange.to_bucket)) {
    summaries.push(`Status changed from ${statusChange.from_stage || 'none'} to ${statusChange.to_stage || 'none'}.`);
  }
  if (draftAdded) summaries.push('A new outreach draft was created in the latest run.');
  if (shortlistReady) summaries.push('The candidate moved into a shortlist-ready state in the latest run.');
  return {
    changed: !!(importChange || rankChange || statusChange || draftAdded || shortlistReady),
    import_change: importChange,
    rank_change: rankChange,
    status_change: statusChange,
    draft_added: draftAdded,
    shortlist_ready_changed: shortlistReady,
    summaries,
  };
}

function summariseDashboard(job, metrics, searchPack, candidateRecords, roleDir, roleConfig = buildDefaultRoleConfig()) {
  const importHistory = readImportHistory(roleDir).slice(-12).reverse();
  const bulkCvHistory = readHistoryEntries(roleDir, DEFAULT_BULK_CV_IMPORT_HISTORY_FILE).slice(-12).reverse();
  const runHistory = readRunHistory(roleDir).slice(-12).reverse();
  const latestImport = importHistory[0] || null;
  const latestBulkCvImport = bulkCvHistory[0] || null;
  const latestRun = runHistory[0] || null;
  const drafts = candidateRecords
    .filter((record) => record.outreach.ready && record.outreach.draft_path)
    .map((record) => ({
      candidate_id: record.candidate_id,
      candidate_name: record.candidate_name || record.current_title || record.candidate_id,
      subject: record.outreach.subject,
      path: record.outreach.draft_path,
      email: record.outreach.email || record.email || '',
    }));

  const roleArtifacts = {
    intake: buildArtifactDescriptor(roleDir, `${ROLE_INPUTS_DIR}/${DEFAULT_ROLE_FILE}`, { label: 'Job Spec Intake', downloadable: true, group: 'role_input', sourceOfTruth: 'inputs/job-spec.yaml' }),
    roleConfig: buildArtifactDescriptor(roleDir, `${ROLE_INPUTS_DIR}/${DEFAULT_ROLE_CONFIG_FILE}`, { label: 'Role Config', downloadable: true, group: 'role_input', sourceOfTruth: 'inputs/role-config.json' }),
    candidates: buildArtifactDescriptor(roleDir, `${ROLE_INPUTS_DIR}/${DEFAULT_CANDIDATES_FILE}`, { label: 'Imported Previews', downloadable: true, group: 'role_input', sourceOfTruth: 'inputs/candidates.json' }),
    candidatesCsv: buildArtifactDescriptor(roleDir, `${ROLE_INPUTS_DIR}/${DEFAULT_CANDIDATES_CSV_FILE}`, { label: 'Imported Previews CSV', downloadable: true, group: 'role_input', sourceOfTruth: 'inputs/candidates.csv', emptyState: 'No CSV import has been saved for this role yet.' }),
    operatorOverrides: buildArtifactDescriptor(roleDir, `${ROLE_INPUTS_DIR}/${DEFAULT_OPERATOR_OVERRIDES_FILE}`, { label: 'Operator Overrides', downloadable: true, group: 'role_input', sourceOfTruth: 'inputs/operator-overrides.json' }),
    importHistory: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/${DEFAULT_IMPORT_HISTORY_FILE}`, { label: 'Import History', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/import-history.json', emptyState: 'No imports have been recorded yet.' }),
    bulkCvImportHistory: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/${DEFAULT_BULK_CV_IMPORT_HISTORY_FILE}`, { label: 'Bulk CV Upload History', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/bulk-cv-import-history.json', emptyState: 'No bulk CV batches have been recorded yet.' }),
    searchPackMarkdown: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/search-pack.md`, { label: 'Search Pack', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/search-pack.md' }),
    searchPackJson: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/search-pack.json`, { label: 'Search Pack JSON', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/search-pack.json' }),
    previewTriage: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/preview-triage.json`, { label: 'Preview Triage', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/preview-triage.json' }),
    candidateRecords: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/candidate-records.json`, { label: 'Candidate Records', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/candidate-records.json' }),
    candidateExportCsv: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/${DEFAULT_CANDIDATE_EXPORT_FILE}`, { label: 'Candidate Export CSV', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/candidate-review-export.csv' }),
    metrics: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/metrics.json`, { label: 'Metrics JSON', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/metrics.json' }),
    metricsSummary: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/metrics-summary.md`, { label: 'Metrics Summary', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/metrics-summary.md' }),
    operatorReview: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/operator-review.md`, { label: 'Operator Review', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/operator-review.md' }),
    runSummary: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/${DEFAULT_RUN_SUMMARY_FILE}`, { label: 'Run Summary', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/run-summary.json' }),
    runHistory: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/${DEFAULT_RUN_HISTORY_FILE}`, { label: 'Run History', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/run-history.json', emptyState: 'No runs have been recorded yet.' }),
    dashboardSummary: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/dashboard-summary.json`, { label: 'Dashboard Summary', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/dashboard-summary.json' }),
    auditLog: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/audit-log.jsonl`, { label: 'Audit Log', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/audit-log.jsonl' }),
  };

  const rankedCandidates = [...candidateRecords].sort((left, right) => (left.ranking?.position || 0) - (right.ranking?.position || 0));

  return {
    roleSlug: path.basename(roleDir),
    roleId: job.roleId,
    roleTitle: job.title.canonical,
    rolePath: roleDir,
    updatedAt: nowIso(),
    roleConfig,
    roleState: metrics.role_workflow_state,
    overview: {
      clientName: job.clientName,
      consultant: job.consultant,
      functionFamily: job.title.functionFamily,
      location: job.location,
      mustHaveSkills: job.mustHave.skills,
      mustHaveQualifications: job.mustHave.qualifications,
      sectors: job.mustHave.sectors,
      outreachHook: job.outreach.roleHook,
      nextActions: metrics.next_actions,
    },
    shortlistProgress: metrics.shortlist_progress,
    roleHistory: {
      importHistory,
      bulkCvHistory,
      runHistory,
      latestImport,
      latestBulkCvImport,
      latestRun,
      recentActivity: [
        latestImport
          ? {
            kind: 'import',
            at: latestImport.at,
            summary: `${latestImport.added?.count || 0} added, ${latestImport.updated?.count || 0} updated, ${latestImport.preview_text_changed?.count || 0} preview text change(s).`,
          }
          : null,
        latestBulkCvImport
          ? {
            kind: 'bulk_cv_upload',
            at: latestBulkCvImport.at,
            summary: `${latestBulkCvImport.parsed_successfully || 0} parsed, ${latestBulkCvImport.failed || 0} failed, OCR ${latestBulkCvImport.ocr_enabled ? 'enabled' : 'disabled'}.`,
          }
          : null,
        latestRun
          ? {
            kind: 'run',
            at: latestRun.completed_at || latestRun.at,
            summary: `${latestRun.changes?.shortlist_ready?.count || 0} shortlist-ready, ${latestRun.changes?.drafts_added?.count || 0} draft(s), ${latestRun.changes?.ranking_change_count || 0} rank move(s).`,
          }
          : null,
      ].filter(Boolean),
    },
    searchPack,
    metrics,
    reviewQueues: {
      new_since_last_review: rankedCandidates.filter((record) => buildCandidateSessionFlags(record, latestImport, latestRun).new_since_last_review).length,
      awaiting_manual_screening: rankedCandidates.filter((record) => buildCandidateSessionFlags(record, latestImport, latestRun).awaiting_manual_screening).length,
      newly_shortlist_ready: rankedCandidates.filter((record) => buildCandidateSessionFlags(record, latestImport, latestRun).newly_shortlist_ready).length,
      draft_ready_not_contacted: rankedCandidates.filter((record) => buildCandidateSessionFlags(record, latestImport, latestRun).draft_ready_not_contacted).length,
      contacted_awaiting_reply: rankedCandidates.filter((record) => buildCandidateSessionFlags(record, latestImport, latestRun).contacted_awaiting_reply).length,
      changed_since_last_import: rankedCandidates.filter((record) => buildCandidateSessionFlags(record, latestImport, latestRun).changed_since_last_import).length,
    },
    previewTriage: {
      counts: metrics.preview_counts,
      candidates: rankedCandidates.map((record) => ({
        candidate_id: record.candidate_id,
        candidate_name: record.candidate_name || record.current_title || record.candidate_id,
        current_title: record.current_title,
        location: record.location,
        preview_score: record.preview_assessment.totalScore,
        classification: record.preview_assessment.finalClassification,
        lifecycle_stage: record.lifecycle.current_stage,
        reasons: record.preview_assessment.reasons,
        suggested_download: record.preview_assessment.recommendedCvDownload,
        next_action: record.status.next_action,
        rank_position: record.ranking?.position || 0,
      })),
    },
    candidateReviews: rankedCandidates.map((record) => ({
      candidate_id: record.candidate_id,
      candidate_name: record.candidate_name || record.current_title || record.candidate_id,
      email: record.email || record.outreach.email || '',
      rank_position: record.ranking?.position || 0,
      rank_score: record.ranking?.total_score || 0,
      rank_reasons: record.ranking?.reasons || [],
      shortlist_recommendation: record.full_cv.shortlist_recommendation || '',
      shortlist_status: record.status.shortlist_stage || '',
      lifecycle_stage: record.lifecycle.current_stage,
      outreach_ready: record.outreach.ready,
      operator_decision: record.operator_decision || '',
      operator_review_needed: record.status.needs_operator_review,
      shortlist_bucket: record.operator_review.shortlist_bucket || '',
      strengths: record.full_cv.strengths || [],
      gaps: record.full_cv.gaps || [],
      follow_up_questions: record.full_cv.follow_up_questions || [],
      operator_notes: record.operator_review.manual_notes || '',
      source_audit_string: formatSourceAuditString(record),
    })),
    candidateDetails: rankedCandidates.map((record) => ({
      candidate_id: record.candidate_id,
      identity: {
        name: record.candidate_name || record.current_title || record.candidate_id,
        email: record.email || record.outreach.email || '',
        title: record.current_title,
        location: record.location,
        source: record.source,
      },
      ranking: record.ranking || { position: 0, total_score: 0, reasons: [] },
      status: record.status,
      lifecycle: record.lifecycle,
      sessionFlags: buildCandidateSessionFlags(record, latestImport, latestRun),
      changeReview: buildCandidateChangeReview(record, latestImport, latestRun),
      preview: {
        headline: record.preview.headline,
        summary_text: record.preview.summary_text,
        notes: record.preview.notes,
        structured_fields: {
          sector_tags: record.preview.sector_tags || [],
          mobility: record.preview.mobility || '',
          salary_text: record.preview.salary_text || '',
          search_variant: record.search_used.variant || '',
          search_name: record.search_used.name || '',
          boolean_used: record.search_used.boolean_used || '',
          found_at: record.source_audit.found_at || '',
          imported_at: record.source_audit.imported_at || '',
          source_reference_id: record.source_audit.source_reference_id || '',
        },
        triage: record.preview_assessment,
      },
      machineAssessment: {
        preview_classification: record.preview_assessment.finalClassification,
        preview_score: record.preview_assessment.totalScore,
        preview_reasons: record.preview_assessment.reasons || [],
        preview_missing_info: record.preview_assessment.missingCriticalInfo || [],
        preview_hard_reject_reasons: record.preview_assessment.hardRejectReasons || [],
        shortlist_recommendation: record.full_cv.shortlist_recommendation || '',
        cv_score: record.full_cv.score || 0,
        suitability_summary: record.full_cv.suitability_summary || '',
      },
      fullCv: {
        downloaded: record.full_cv.downloaded,
        cv_file: record.full_cv.cv_file || '',
        extraction_summary: record.full_cv.extraction_summary || '',
        review_status: record.full_cv.review_status || '',
        reviewed_at: record.full_cv.reviewed_at || '',
        score: record.full_cv.score || 0,
        shortlist_recommendation: record.full_cv.shortlist_recommendation || '',
        highlights: record.full_cv.extracted_highlights || [],
        strengths: record.full_cv.strengths || [],
        concerns: record.full_cv.gaps || [],
        follow_up_questions: record.full_cv.follow_up_questions || [],
        uncertainty_notes: record.full_cv.uncertainty_notes || [],
      },
      operatorReview: {
        classification: record.operator_review.classification || '',
        decision: record.operator_review.decision || '',
        shortlist_status: record.operator_review.shortlist_status || '',
        outreach_ready_override: record.operator_review.outreach_ready_override,
        lifecycle_stage: record.operator_review.lifecycle_stage || '',
        manual_notes: record.operator_review.manual_notes || '',
        strengths: record.operator_review.strengths || [],
        concerns: record.operator_review.concerns || [],
        follow_up_questions: record.operator_review.follow_up_questions || [],
        override_reason: record.operator_review.override_reason || '',
        availability_notes: record.operator_review.availability_notes || '',
        appetite_notes: record.operator_review.appetite_notes || '',
        compensation_notes: record.operator_review.compensation_notes || '',
        location_mobility_notes: record.operator_review.location_mobility_notes || '',
        manual_screening_summary: record.operator_review.manual_screening_summary || '',
        recommended_next_step: record.operator_review.recommended_next_step || '',
        recruiter_confidence: record.operator_review.recruiter_confidence || '',
        final_manual_rationale: record.operator_review.final_manual_rationale || '',
        shortlist_bucket: record.operator_review.shortlist_bucket || '',
        ranking_pin: record.operator_review.ranking_pin === true,
        contact_log: record.operator_review.contact_log || [],
      },
      evidence: {
        preview_source: {
          summary_text: record.preview.summary_text || '',
          headline: record.preview.headline || '',
          notes: record.preview.notes || '',
          structured_fields: {
            sector_tags: record.preview.sector_tags || [],
            mobility: record.preview.mobility || '',
            salary_text: record.preview.salary_text || '',
          },
        },
        cv_extracted: {
          extraction_summary: record.full_cv.extraction_summary || '',
          highlights: record.full_cv.extracted_highlights || [],
          strengths: record.full_cv.strengths || [],
          concerns: record.full_cv.gaps || [],
          follow_up_questions: record.full_cv.follow_up_questions || [],
          uncertainty_notes: record.full_cv.uncertainty_notes || [],
          suitability_summary: record.full_cv.suitability_summary || '',
        },
        machine_assessment: {
          preview: record.preview_assessment,
          full_cv: {
            review_status: record.full_cv.review_status || '',
            score: record.full_cv.score || 0,
            shortlist_recommendation: record.full_cv.shortlist_recommendation || '',
            outreach_ready: record.full_cv.outreach_ready === true,
          },
        },
        operator_assessment: {
          manual_notes: record.operator_review.manual_notes || '',
          strengths: record.operator_review.strengths || [],
          concerns: record.operator_review.concerns || [],
          follow_up_questions: record.operator_review.follow_up_questions || [],
          appetite_notes: record.operator_review.appetite_notes || '',
          availability_notes: record.operator_review.availability_notes || '',
          compensation_notes: record.operator_review.compensation_notes || '',
          location_mobility_notes: record.operator_review.location_mobility_notes || '',
          manual_screening_summary: record.operator_review.manual_screening_summary || '',
          recommended_next_step: record.operator_review.recommended_next_step || '',
          recruiter_confidence: record.operator_review.recruiter_confidence || '',
          final_manual_rationale: record.operator_review.final_manual_rationale || '',
        },
      },
      outreach: {
        email: record.outreach.email || record.email || '',
        subject: record.outreach.subject || '',
        body: record.outreach.draft_path && fs.existsSync(path.join(roleDir, record.outreach.draft_path))
          ? readTextFile(path.join(roleDir, record.outreach.draft_path))
          : '',
        why_contacted_summary: record.outreach.why_contacted_summary || '',
        draft_path: record.outreach.draft_path || '',
        ready: record.outreach.ready,
      },
      sourceAudit: {
        ...record.source_audit,
        display: formatSourceAuditString(record),
      },
      auditTrail: record.lifecycle.history,
      artifacts: {
        candidateRecord: buildArtifactDescriptor(roleDir, `${ROLE_RECORDS_DIR}/${record.candidate_id}.json`, { label: 'Candidate Record', downloadable: true, group: 'candidate', sourceOfTruth: `records/${record.candidate_id}.json` }),
        cvFile: buildArtifactDescriptor(roleDir, record.full_cv.cv_file || '', { label: 'CV File', downloadable: true, group: 'candidate', sourceOfTruth: record.full_cv.cv_file || 'cvs/', emptyState: 'No local CV file has been linked for this candidate yet.' }),
        outreachDraft: buildArtifactDescriptor(roleDir, record.outreach.draft_path || '', { label: 'Outreach Draft', downloadable: true, group: 'candidate', sourceOfTruth: record.outreach.draft_path || 'drafts/', emptyState: 'No outreach draft has been generated for this candidate yet.' }),
      },
    })),
    drafts,
    artifacts: roleArtifacts,
  };
}

function readWorkflowConfig(workflowRoot) {
  const configPath = path.join(workflowRoot, 'launcher-config.json');
  const config = fs.existsSync(configPath)
    ? readJsonFileStrict(configPath, 'launcher-config.json')
    : {};
  const dashboardPort = Number(config.dashboardPort);
  return {
    workflowRoot,
    dashboardPort: Number.isInteger(dashboardPort) && dashboardPort > 0 ? dashboardPort : DEFAULT_PORT,
    rolesDir: path.resolve(workflowRoot, trimString(config.rolesPath, 240) || 'roles'),
    websiteRepoPath: path.resolve(workflowRoot, trimString(config.websiteRepoPath, 240) || '../../Website/WORKING COPY'),
  };
}

function listRoleIds(workflowRoot) {
  const config = readWorkflowConfig(workflowRoot);
  ensureDir(config.rolesDir);
  return fs.readdirSync(config.rolesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

function resolveRoleDir(workflowRoot, roleId) {
  const config = readWorkflowConfig(workflowRoot);
  const safeRoleId = validateRoleSlug(roleId);
  return path.join(config.rolesDir, safeRoleId);
}

function requireExistingRoleDir(workflowRoot, roleId) {
  const roleDir = resolveRoleDir(workflowRoot, roleId);
  if (!fs.existsSync(roleDir)) {
    throw createWorkflowError(`Role folder was not found for ${roleId} at ${roleDir}.`, {
      code: 'missing_role_folder',
      statusCode: 404,
      details: { roleId, roleDir },
    });
  }
  ensureRoleWorkspaceStructure(roleDir);
  return roleDir;
}

function buildDefaultCandidatesTemplate() {
  return [];
}

function scaffoldRoleWorkspace({ workflowRoot, roleId, roleTitle = '' }) {
  const roleSlug = validateRoleSlug(roleId || roleTitle || '');
  const roleDir = resolveRoleDir(workflowRoot, roleSlug);
  ensureRoleWorkspaceStructure(roleDir);

  const workflowRootResolved = path.resolve(workflowRoot);
  const templatesDir = path.join(workflowRootResolved, 'templates');
  const jobTemplatePath = path.join(templatesDir, 'job_spec_intake_template.yaml');
  const intakeTargetPath = path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_ROLE_FILE);
  if (!fs.existsSync(intakeTargetPath)) {
    if (fs.existsSync(jobTemplatePath)) {
      writeTextFile(intakeTargetPath, readTextFile(jobTemplatePath));
    } else {
      writeTextFile(intakeTargetPath, `role_id: ${roleSlug.toUpperCase()}\nclient_name: \"\"\nconsultant: Joe\nrole_summary:\n  canonical_title: \"${roleTitle}\"\n`);
    }
  }

  const candidatesPath = path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_CANDIDATES_FILE);
  if (!fs.existsSync(candidatesPath)) {
    writeJsonFile(candidatesPath, buildDefaultCandidatesTemplate());
  }

  const operatorOverridesPath = path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_OPERATOR_OVERRIDES_FILE);
  if (!fs.existsSync(operatorOverridesPath)) {
    writeJsonFile(operatorOverridesPath, {});
  }

  const roleConfigPath = path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_ROLE_CONFIG_FILE);
  if (!fs.existsSync(roleConfigPath)) {
    writeJsonFile(roleConfigPath, buildDefaultRoleConfig());
  }

  return {
    roleId: roleSlug,
    roleDir,
    intakePath: intakeTargetPath,
    candidatesPath,
    operatorOverridesPath,
    roleConfigPath,
  };
}

function loadJobSpecInput(roleDir) {
  const yamlPath = path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_ROLE_FILE);
  const jsonPath = path.join(roleDir, ROLE_INPUTS_DIR, 'job-spec.json');
  if (fs.existsSync(yamlPath)) {
    try {
      return parseYaml(readTextFile(yamlPath));
    } catch (error) {
      throw createWorkflowError(`Job spec YAML could not be parsed at ${yamlPath}.`, {
        code: 'invalid_job_spec_yaml',
        statusCode: 400,
        details: { cause: error?.message || String(error) },
      });
    }
  }
  if (fs.existsSync(jsonPath)) return readJsonFileStrict(jsonPath, 'job-spec.json');
  throw createWorkflowError(`No job spec file found in ${path.join(roleDir, ROLE_INPUTS_DIR)}.`, {
    code: 'missing_job_spec',
    statusCode: 404,
  });
}

function loadCandidatesInput(roleDir) {
  const candidatesJsonPath = path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_CANDIDATES_FILE);
  const candidatesCsvPath = path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_CANDIDATES_CSV_FILE);
  if (fs.existsSync(candidatesJsonPath)) {
    const records = readJsonFileStrict(candidatesJsonPath, 'candidates.json');
    if (!Array.isArray(records)) {
      throw createWorkflowError(`Candidate input JSON must contain an array at ${candidatesJsonPath}.`, {
        code: 'invalid_candidate_json',
        statusCode: 400,
      });
    }
    return normaliseCandidateBatch(records, {
      message: 'Candidate input JSON validation failed.',
      code: 'invalid_candidate_json',
    });
  }
  if (fs.existsSync(candidatesCsvPath)) {
    return parseCandidateImportText(candidatesCsvPath, readTextFile(candidatesCsvPath));
  }
  return [];
}

function operatorOverridesPath(roleDir) {
  return path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_OPERATOR_OVERRIDES_FILE);
}

function roleConfigPath(roleDir) {
  return path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_ROLE_CONFIG_FILE);
}

function loadOperatorOverrides(roleDir) {
  if (!fs.existsSync(operatorOverridesPath(roleDir))) return {};
  const overrides = readJsonFileStrict(operatorOverridesPath(roleDir), 'operator-overrides.json');
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw createWorkflowError(`operator-overrides.json must contain an object at ${operatorOverridesPath(roleDir)}.`, {
      code: 'invalid_operator_overrides',
      statusCode: 400,
    });
  }
  return overrides;
}

function writeOperatorOverrides(roleDir, overrides) {
  writeJsonFile(operatorOverridesPath(roleDir), overrides);
}

function loadRoleConfig(roleDir) {
  if (!fs.existsSync(roleConfigPath(roleDir))) return buildDefaultRoleConfig();
  const config = readJsonFileStrict(roleConfigPath(roleDir), DEFAULT_ROLE_CONFIG_FILE);
  const normalised = normaliseRoleConfig(config);
  const issues = validateRoleConfig(normalised);
  if (issues.length) {
    throw createWorkflowError(`Role config validation failed at ${roleConfigPath(roleDir)}.`, {
      code: 'invalid_role_config',
      statusCode: 400,
      details: { issues },
    });
  }
  return normalised;
}

function saveRoleConfig(roleDir, config) {
  const normalised = normaliseRoleConfig(config);
  const issues = validateRoleConfig(normalised);
  if (issues.length) {
    throw createWorkflowError('Role config update failed validation.', {
      code: 'invalid_role_config',
      statusCode: 400,
      details: { issues },
    });
  }
  writeJsonFile(roleConfigPath(roleDir), normalised);
  return normalised;
}

function readCandidateRecordsFromDisk(roleDir) {
  const consolidatedPath = path.join(roleDir, ROLE_OUTPUTS_DIR, 'candidate-records.json');
  const consolidated = readJsonFile(consolidatedPath, null);
  if (Array.isArray(consolidated)) return consolidated;

  const recordsDir = path.join(roleDir, ROLE_RECORDS_DIR);
  if (!fs.existsSync(recordsDir)) return [];
  return fs.readdirSync(recordsDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => readJsonFile(path.join(recordsDir, entry), null))
    .filter(Boolean);
}

function removeStaleRoleArtifacts(roleDir, candidateRecords) {
  const validRecordFiles = new Set(candidateRecords.map((record) => `${record.candidate_id}.json`));
  const validDraftFiles = new Set(candidateRecords
    .filter((record) => record.outreach?.draft_path)
    .map((record) => `${record.candidate_id}.md`));
  const removed = {
    record_files: [],
    draft_files: [],
  };

  const recordsDir = path.join(roleDir, ROLE_RECORDS_DIR);
  if (fs.existsSync(recordsDir)) {
    fs.readdirSync(recordsDir)
      .filter((entry) => entry.endsWith('.json') && !validRecordFiles.has(entry))
      .forEach((entry) => {
        fs.unlinkSync(path.join(recordsDir, entry));
        removed.record_files.push(entry);
      });
  }

  const draftsDir = path.join(roleDir, ROLE_DRAFTS_DIR);
  if (fs.existsSync(draftsDir)) {
    fs.readdirSync(draftsDir)
      .filter((entry) => entry.endsWith('.md') && !validDraftFiles.has(entry))
      .forEach((entry) => {
        fs.unlinkSync(path.join(draftsDir, entry));
        removed.draft_files.push(entry);
      });
  }

  return removed;
}

function importPreviewCandidatesInternal({
  roleDir,
  roleId,
  importSourcePath,
  fileName,
  text,
  importMethodOverride = '',
}) {
  const importTimestamp = nowIso();
  const importLabel = trimString(fileName || importSourcePath, 240) || 'uploaded-candidates.csv';
  const extension = trimString(path.extname(importLabel).slice(1).toLowerCase(), 12);
  const importMethod = trimString(importMethodOverride, 120) || (extension === 'csv' ? 'csv_import' : 'json_import');
  const importedCandidates = parseCandidateImportText(importLabel, text)
    .map((candidate) => normaliseCandidateInput({
      ...candidate,
      import_method: candidate.import_method || importMethod,
    }))
    .filter((candidate) => candidate.candidate_name || candidate.current_title || candidate.summary_text || candidate.headline);
  if (!importedCandidates.length) {
    throw createWorkflowError('No usable candidate preview rows were found in the supplied import file.', {
      code: 'empty_candidate_batch',
      statusCode: 400,
    });
  }

  const targetJsonPath = path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_CANDIDATES_FILE);
  const currentCandidates = fs.existsSync(targetJsonPath)
    ? readJsonFileStrict(targetJsonPath, 'candidates.json')
    : [];
  const currentNormalised = Array.isArray(currentCandidates)
    ? normaliseCandidateBatch(currentCandidates, {
      message: 'Candidate input JSON validation failed.',
      code: 'invalid_candidate_json',
    })
    : [];
  const currentById = new Map();
  currentNormalised.forEach((candidate, index) => {
    currentById.set(buildCandidateIdentifier(candidate, index), candidate);
  });
  const mergedById = new Map();
  currentNormalised.forEach((candidate, index) => {
    mergedById.set(buildCandidateIdentifier(candidate, index), candidate);
  });
  const addedIds = [];
  const updatedIds = [];
  const unchangedIds = [];
  const previewChangedIds = [];
  const candidateChanges = [];
  importedCandidates.forEach((candidate, index) => {
    const candidateId = buildCandidateIdentifier(candidate, index);
    const existing = mergedById.get(candidateId) || {};
    const previous = currentById.get(candidateId) || null;
    const mergedCandidate = mergeImportedCandidate({
      ...existing,
      candidate_id: candidateId,
    }, {
      ...candidate,
      candidate_id: candidateId,
    }, importTimestamp, importMethod);
    if (!previous) {
      addedIds.push(candidateId);
      candidateChanges.push(buildCandidateImportChange(null, mergedCandidate, candidateId));
    } else if (!compareValues(previous, mergedCandidate)) {
      updatedIds.push(candidateId);
      if (trimString(previous.summary_text, 4000) !== trimString(candidate.summary_text, 4000)) {
        previewChangedIds.push(candidateId);
      }
      candidateChanges.push(buildCandidateImportChange(previous, mergedCandidate, candidateId));
    } else {
      unchangedIds.push(candidateId);
    }
    mergedById.set(candidateId, mergedCandidate);
  });
  const mergedCandidates = Array.from(mergedById.values());
  let unchanged = false;
  if (Array.isArray(currentCandidates)) {
    try {
      unchanged = compareValues(currentNormalised, mergedCandidates);
    } catch {
      unchanged = false;
    }
  }
  if (!unchanged) {
    writeJsonFile(targetJsonPath, mergedCandidates);
  }
  if (extension === 'csv') {
    const csvTargetPath = path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_CANDIDATES_CSV_FILE);
    const existingText = fs.existsSync(csvTargetPath) ? readTextFile(csvTargetPath) : '';
    if (existingText !== text) {
      writeTextFile(csvTargetPath, text);
    }
  }

  appendJsonLine(path.join(roleDir, ROLE_OUTPUTS_DIR, 'audit-log.jsonl'), {
    at: nowIso(),
    action: unchanged ? 'candidate_previews_import_skipped' : 'candidate_previews_merged',
    role_id: roleId,
    source_path: importSourcePath || importLabel,
    count: importedCandidates.length,
    total_candidates_after_import: mergedCandidates.length,
  });

  const historyEntry = {
    at: importTimestamp,
    role_id: roleId,
    method: importMethod,
    source_path: importSourcePath || importLabel,
    imported_count: importedCandidates.length,
    total_candidates_after_import: mergedCandidates.length,
    unchanged,
    added: summarizeHistoryIds(addedIds),
    updated: summarizeHistoryIds(updatedIds),
    unchanged_rows: summarizeHistoryIds(unchangedIds),
    preview_text_changed: summarizeHistoryIds(previewChangedIds),
    candidate_changes: candidateChanges.slice(0, 20),
    candidate_change_count: candidateChanges.length,
  };
  appendHistoryEntry(roleDir, DEFAULT_IMPORT_HISTORY_FILE, historyEntry);

  return {
    roleId,
    inputPath: importSourcePath || importLabel,
    candidatesPath: targetJsonPath,
    importedCount: importedCandidates.length,
    totalCandidates: mergedCandidates.length,
    mode: 'merge_upsert',
    unchanged,
    importHistoryEntry: historyEntry,
  };
}

function importPreviewCandidates({ workflowRoot, roleId, inputPath }) {
  if (!trimString(inputPath, 400)) {
    throw createWorkflowError('An input file path is required for preview import.', {
      code: 'missing_import_path',
      statusCode: 400,
    });
  }
  const resolvedInputPath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(inputPath);
  if (!fs.existsSync(resolvedInputPath)) {
    throw createWorkflowError(`Candidate import file not found: ${resolvedInputPath}`, {
      code: 'missing_import_file',
      statusCode: 404,
    });
  }
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
  return importPreviewCandidatesInternal({
    roleDir,
    roleId,
    importSourcePath: resolvedInputPath,
    fileName: path.basename(resolvedInputPath),
    text: readTextFile(resolvedInputPath),
  });
}

function importPreviewCandidatesFromText({ workflowRoot, roleId, fileName, text }) {
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
  const normalisedName = trimString(fileName, 240) || 'uploaded-candidates.csv';
  if (!trimString(text, 20)) {
    throw createWorkflowError('Uploaded candidate batch is empty.', {
      code: 'empty_candidate_upload',
      statusCode: 400,
    });
  }
  return importPreviewCandidatesInternal({
    roleDir,
    roleId,
    importSourcePath: `dashboard-upload:${normalisedName}`,
    fileName: normalisedName,
    text,
  });
}

async function importBulkCvFiles({ workflowRoot, roleId, files = [] }) {
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
  ensureRoleWorkspaceStructure(roleDir);
  const inputFiles = Array.isArray(files) ? files : [];
  if (!inputFiles.length) {
    throw createWorkflowError('Upload at least one PDF or DOCX file before starting a bulk CV batch.', {
      code: 'empty_bulk_cv_upload',
      statusCode: 400,
    });
  }
  if (inputFiles.length > BULK_CV_MAX_FILES) {
    throw createWorkflowError(`Upload up to ${BULK_CV_MAX_FILES} files at a time for bulk CV parsing.`, {
      code: 'too_many_bulk_cv_files',
      statusCode: 400,
      details: { maxFiles: BULK_CV_MAX_FILES },
    });
  }

  const totalDeclaredBytes = inputFiles.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
  if (totalDeclaredBytes > BULK_CV_MAX_TOTAL_BYTES) {
    throw createWorkflowError(`Bulk CV upload is limited to ${Math.round(BULK_CV_MAX_TOTAL_BYTES / (1024 * 1024))}MB per batch. Split larger batches into smaller uploads.`, {
      code: 'bulk_cv_batch_too_large',
      statusCode: 400,
      details: { maxBytes: BULK_CV_MAX_TOTAL_BYTES, totalDeclaredBytes },
    });
  }

  const batchTimestamp = nowIso();
  const batchId = `batch-${batchTimestamp.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}`;
  const batchDir = path.join(roleDir, ROLE_CVS_DIR, 'bulk-upload', batchId);
  ensureDir(batchDir);

  const existingCandidates = loadCandidatesInput(roleDir);
  const reservedIds = new Set(existingCandidates.map((candidate, index) => buildCandidateIdentifier(candidate, index)));
  const importedCandidates = [];
  const fileResults = [];
  const ocrEnabled = bulkCvOcrEnabled();

  for (let index = 0; index < inputFiles.length; index += 1) {
    const rawFile = inputFiles[index] || {};
    const originalFileName = trimString(rawFile.name, 240) || `uploaded-cv-${index + 1}`;
    const extension = trimString(path.extname(originalFileName).slice(1).toLowerCase(), 16);
    const safeName = safeUploadFileName(originalFileName, extension);
    let prepared = null;
    try {
      const preparedList = candidateMatcherCore.prepareCandidateFiles([{
        name: originalFileName,
        contentType: trimString(rawFile.contentType, 120),
        size: Number(rawFile.size) || 0,
        data: typeof rawFile.data === 'string' ? rawFile.data : '',
      }]);
      prepared = preparedList[0];
    } catch (error) {
      fileResults.push(buildBulkCvUploadFileResult({
        fileName: originalFileName,
        savedRelativePath: '',
        status: 'failed',
        failureCode: trimString(error?.code, 120) || 'bulk_cv_prepare_failed',
        errorMessage: error?.message || String(error),
      }));
      continue;
    }
    const savedPath = path.join(batchDir, `${String(index + 1).padStart(2, '0')}-${safeName}`);
    const savedRelativePath = relPath(roleDir, savedPath);

    if (prepared?.buffer?.byteLength) {
      ensureDir(path.dirname(savedPath));
      fs.writeFileSync(savedPath, prepared.buffer);
    }

    if (!BULK_CV_ALLOWED_EXTENSIONS.has(prepared?.extension || extension)) {
      fileResults.push(buildBulkCvUploadFileResult({
        fileName: originalFileName,
        savedRelativePath,
        status: 'failed',
        failureCode: 'unsupported_bulk_cv_extension',
        errorMessage: 'Only PDF and DOCX bulk parsing are supported reliably in this uploader. Legacy DOC remains manual for now.',
      }));
      continue;
    }

    if (!prepared || prepared.status !== 'ready') {
      fileResults.push(buildBulkCvUploadFileResult({
        fileName: originalFileName,
        savedRelativePath,
        status: 'failed',
        failureCode: prepared?.failureCode || prepared?.status || 'bulk_cv_prepare_failed',
        errorMessage: prepared?.error || 'The uploaded CV could not be prepared for extraction.',
      }));
      continue;
    }

    let extractionResult = null;
    try {
      extractionResult = await candidateMatcherCore.extractCandidateDocuments([prepared], {
        enablePdfOcr: ocrEnabled,
      });
    } catch (error) {
      fileResults.push(buildBulkCvUploadFileResult({
        fileName: originalFileName,
        savedRelativePath,
        status: 'failed',
        failureCode: trimString(error?.code, 120) || 'bulk_cv_extract_failed',
        errorMessage: error?.message || String(error),
      }));
      continue;
    }

    const documentResult = extractionResult?.documents?.[0] || null;
    if (!documentResult || documentResult.status !== 'ok' || documentResult.textUsable !== true) {
      fileResults.push(buildBulkCvUploadFileResult({
        fileName: originalFileName,
        savedRelativePath,
        status: 'failed',
        extractionResult,
        failureCode: documentResult?.failureCode || 'bulk_cv_no_usable_text',
        errorMessage: documentResult?.error || 'The uploaded CV did not produce reliable readable text.',
      }));
      continue;
    }

    const nextCandidate = buildBulkCvCandidate({
      roleDir,
      existingCandidates: existingCandidates.concat(importedCandidates),
      reservedIds,
      relativePath: savedRelativePath,
      extractedText: trimString(documentResult.extractedText || extractionResult.combinedText, 40000),
      documentResult,
      originalFileName,
      importedAt: batchTimestamp,
    });
    reservedIds.add(nextCandidate.candidate_id);
    importedCandidates.push(nextCandidate);
    fileResults.push(buildBulkCvUploadFileResult({
      fileName: originalFileName,
      savedRelativePath,
      status: 'imported',
      candidateId: nextCandidate.candidate_id,
      candidateName: nextCandidate.candidate_name,
      extractionResult,
    }));
  }

  const importResult = importedCandidates.length
    ? importPreviewCandidatesInternal({
      roleDir,
      roleId,
      importSourcePath: `dashboard-bulk-cv:${batchId}`,
      fileName: `${batchId}.json`,
      text: `${JSON.stringify(importedCandidates, null, 2)}\n`,
      importMethodOverride: 'bulk_cv_upload',
    })
    : null;

  const batchHistoryEntry = {
    at: batchTimestamp,
    role_id: roleId,
    batch_id: batchId,
    source_path: relPath(roleDir, batchDir),
    files_received: inputFiles.length,
    parsed_successfully: fileResults.filter((entry) => entry.status === 'imported').length,
    failed: fileResults.filter((entry) => entry.status !== 'imported').length,
    ocr_enabled: ocrEnabled,
    ocr_used_count: fileResults.filter((entry) => entry.ocr_triggered).length,
    candidate_ids: summarizeHistoryIds(importedCandidates.map((candidate) => candidate.candidate_id)),
    files: fileResults.slice(0, 40),
  };
  appendHistoryEntry(roleDir, DEFAULT_BULK_CV_IMPORT_HISTORY_FILE, batchHistoryEntry);
  appendJsonLine(path.join(roleDir, ROLE_OUTPUTS_DIR, 'audit-log.jsonl'), {
    at: batchTimestamp,
    action: 'bulk_cv_upload_processed',
    role_id: roleId,
    batch_id: batchId,
    files_received: inputFiles.length,
    parsed_successfully: batchHistoryEntry.parsed_successfully,
    failed: batchHistoryEntry.failed,
    ocr_enabled: ocrEnabled,
  });

  return {
    roleId,
    batchId,
    batchDir: relPath(roleDir, batchDir),
    filesReceived: inputFiles.length,
    successfulCount: batchHistoryEntry.parsed_successfully,
    failedCount: batchHistoryEntry.failed,
    ocrEnabled,
    importResult,
    batchHistoryEntry,
  };
}

function exportCandidateReviewsCsv({ workflowRoot, roleId, outputPath = '' }) {
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
  const candidateRecords = readCandidateRecordsFromDisk(roleDir);
  const targetPath = outputPath
    ? (path.isAbsolute(outputPath) ? outputPath : path.resolve(roleDir, outputPath))
    : path.join(roleDir, ROLE_OUTPUTS_DIR, DEFAULT_CANDIDATE_EXPORT_FILE);

  writeTextFile(targetPath, stringifyCsv(buildCandidateExportRows(candidateRecords)));
  appendJsonLine(path.join(roleDir, ROLE_OUTPUTS_DIR, 'audit-log.jsonl'), {
    at: nowIso(),
    action: 'candidate_reviews_exported',
    role_id: roleId,
    output_path: targetPath,
    count: candidateRecords.length,
  });

  return {
    roleId,
    outputPath: targetPath,
    exportedCount: candidateRecords.length,
  };
}

function inferActionSteps(action) {
  const key = trimString(action, 60) || 'run_all';
  const allSteps = ['search_pack', 'triage', 'full_cv', 'outreach', 'metrics'];
  const mapping = {
    generate_search_pack: ['search_pack', 'metrics'],
    run_preview_triage: ['search_pack', 'triage', 'metrics'],
    review_downloaded_cvs: ['search_pack', 'triage', 'full_cv', 'metrics'],
    generate_outreach_drafts: ['search_pack', 'triage', 'full_cv', 'outreach', 'metrics'],
    refresh_metrics: ['search_pack', 'triage', 'full_cv', 'outreach', 'metrics'],
    run_all: allSteps,
  };
  return mapping[key] || allSteps;
}

async function runRoleWorkspaceInternal({ workflowRoot, roleId, action = 'run_all', roleDir = null }) {
  const resolvedRoleDir = roleDir || requireExistingRoleDir(workflowRoot, roleId);
  ensureRoleWorkspaceStructure(resolvedRoleDir);
  if (!fs.existsSync(operatorOverridesPath(resolvedRoleDir))) {
    writeJsonFile(operatorOverridesPath(resolvedRoleDir), {});
  }
  if (!fs.existsSync(roleConfigPath(resolvedRoleDir))) {
    writeJsonFile(roleConfigPath(resolvedRoleDir), buildDefaultRoleConfig());
  }
  const startedAt = nowIso();
  const jobInput = loadJobSpecInput(resolvedRoleDir);
  const job = normaliseJobSpecIntake(jobInput);
  const jobIssues = validateJobSpec(job);
  if (jobIssues.length) {
    throw createWorkflowError(`Job spec validation failed for ${roleId}.`, {
      code: 'invalid_job_spec',
      statusCode: 400,
      details: { issues: jobIssues },
    });
  }
  const roleConfig = loadRoleConfig(resolvedRoleDir);
  const steps = inferActionSteps(action);
  const searchPack = generateSearchPack(job, roleConfig);
  const sourceCandidates = loadCandidatesInput(resolvedRoleDir);
  const previousRecords = readCandidateRecordsFromDisk(resolvedRoleDir);
  const previousRecordsById = mapRecordsById(previousRecords);
  const previousMetrics = buildMetrics(job, previousRecords, roleConfig);
  const previewLimit = roleConfig.max_previews_per_run > 0 ? roleConfig.max_previews_per_run : sourceCandidates.length;
  const candidates = sourceCandidates.slice(0, previewLimit);
  const processedCandidateIds = new Set(candidates.map((candidate, index) => buildCandidateIdentifier(candidate, index)));
  const operatorOverrides = loadOperatorOverrides(resolvedRoleDir);
  const staleOverrideIds = Object.keys(operatorOverrides).filter((candidateId) => !sourceCandidates.some((candidate, index) => buildCandidateIdentifier(candidate, index) === candidateId));
  const candidateRecords = [];
  const auditLogPath = path.join(resolvedRoleDir, ROLE_OUTPUTS_DIR, 'audit-log.jsonl');
  const runWarnings = [];
  const runErrors = [];
  let cvReviewsAttempted = 0;
  let cvLimitWarningShown = false;

  appendJsonLine(auditLogPath, {
    at: startedAt,
    action: 'role_processed',
    role_id: job.roleId,
    requested_action: action,
    role_config: roleConfig,
  });

  if (!sourceCandidates.length) {
    runWarnings.push('No candidate previews were available in the role input file.');
  }
  if (sourceCandidates.length > candidates.length) {
    runWarnings.push(`Preview processing stopped at ${candidates.length} candidate(s) because max_previews_per_run is ${roleConfig.max_previews_per_run}.`);
  }
  if (staleOverrideIds.length) {
    runWarnings.push(`Operator overrides exist for ${staleOverrideIds.length} stale candidate(s). They were preserved but not applied.`);
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = normaliseCandidateInput(candidates[index]);
    const candidateId = buildCandidateIdentifier(candidate, index);
    const previousRecord = previousRecordsById.get(candidateId) || null;
    const operatorReview = mergeOperatorReviewState(candidate, operatorOverrides[candidateId]);
    const candidateWithOperatorState = mergeCandidateWithOperatorState(candidate, operatorReview);
    const previewReview = steps.includes('triage')
      ? {
        ...scorePreviewCandidate(job, candidateWithOperatorState, roleConfig),
        assessed_at: nowIso(),
      }
      : null;
    let fullCvReview = null;
    let outreachDraft = null;
    let cvInfo = null;
    let processingError = '';

    const canAttemptCvReview = steps.includes('full_cv') && (trimString(candidateWithOperatorState.cv_file, 500) || trimString(candidateWithOperatorState.cv_text, 200));
    const cvReviewLimitReached = roleConfig.max_cv_reviews_per_run > 0 && cvReviewsAttempted >= roleConfig.max_cv_reviews_per_run;

    if (canAttemptCvReview && cvReviewLimitReached) {
      if (!cvLimitWarningShown) {
        runWarnings.push(`CV review processing stopped at ${roleConfig.max_cv_reviews_per_run} candidate(s) because max_cv_reviews_per_run is set.`);
        cvLimitWarningShown = true;
      }
    } else if (canAttemptCvReview) {
      try {
        cvInfo = await extractCvInfo(resolvedRoleDir, candidateWithOperatorState);
        fullCvReview = reviewFullCv(job, candidateWithOperatorState, cvInfo.text, roleConfig);
        cvReviewsAttempted += 1;
        appendJsonLine(auditLogPath, {
          at: nowIso(),
          action: 'cv_reviewed',
          candidate_id: candidateId,
          shortlist_recommendation: fullCvReview.shortlistRecommendation,
        });
      } catch (error) {
        processingError = error?.message || String(error);
        runWarnings.push(`Candidate ${candidateId}: ${processingError}`);
        appendJsonLine(auditLogPath, {
          at: nowIso(),
          action: 'cv_review_failed',
          candidate_id: candidateId,
          error: processingError,
        });
      }
    }

    const outreachEnabled = fullCvReview && (
      operatorReview.outreach_ready_override === true
      || (operatorReview.outreach_ready_override !== false && fullCvReview.outreachReady)
    );
    if (steps.includes('outreach') && outreachEnabled) {
      outreachDraft = buildOutreachDraft(job, candidateWithOperatorState, fullCvReview);
    }

    const record = createCandidateReviewRecord({
      job,
      roleDir: resolvedRoleDir,
      candidate: candidateWithOperatorState,
      index,
      previewReview: previewReview || {
        suggestedClassification: '',
        finalClassification: '',
        overrideApplied: false,
        overrideReason: '',
        totalScore: 0,
        scoreBreakdown: [],
        reasons: [],
        hardRejectReasons: [],
        missingCriticalInfo: [],
        confidence: 'low',
        recommendedProfileOpen: false,
        recommendedCvDownload: false,
        assessed_at: '',
      },
      fullCvReview,
      outreachDraft,
      cvInfo,
      operatorReview,
      processingError,
    });

    if (previousRecord) {
      if (!steps.includes('triage') && previousRecord.preview_assessment) {
        record.preview_assessment = cloneJsonValue(previousRecord.preview_assessment);
      }
      if ((!steps.includes('full_cv') || (!canAttemptCvReview && !processingError)) && previousRecord.full_cv) {
        record.full_cv = cloneJsonValue(previousRecord.full_cv);
      }
      if (!steps.includes('outreach') && previousRecord.outreach) {
        record.outreach = cloneJsonValue(previousRecord.outreach);
      }
      if (steps.includes('outreach') && !outreachDraft && previousRecord.outreach?.draft_path && previousRecord.outreach?.ready) {
        record.outreach = cloneJsonValue(previousRecord.outreach);
      }
      record.created_at = previousRecord.created_at || record.created_at;
      if (previousRecord.full_cv?.downloaded && !record.preview?.opened_profile) {
        record.preview.opened_profile = previousRecord.preview?.opened_profile === true;
      }
      refreshCandidateRecordState(record);
    }

    if (outreachDraft) {
      const draftPath = path.join(resolvedRoleDir, ROLE_DRAFTS_DIR, `${record.candidate_id}.md`);
      writeTextFile(draftPath, `${outreachDraft.body}\n`);
      record.outreach.draft_path = relPath(resolvedRoleDir, draftPath);
      refreshCandidateRecordState(record);
      appendJsonLine(auditLogPath, {
        at: nowIso(),
        action: 'outreach_draft_generated',
        candidate_id: record.candidate_id,
        draft_path: record.outreach.draft_path,
      });
    }

    candidateRecords.push(record);
  }

  const rankedRecords = applyCandidateRanking(candidateRecords, roleConfig);
  sourceCandidates.forEach((candidate, index) => {
    const candidateId = buildCandidateIdentifier(candidate, index);
    if (processedCandidateIds.has(candidateId)) return;
    const previous = previousRecordsById.get(candidateId);
    if (previous) {
      rankedRecords.push(previous);
    }
  });
  applyCandidateRanking(rankedRecords, roleConfig);
  const cleanup = removeStaleRoleArtifacts(resolvedRoleDir, rankedRecords);
  rankedRecords.forEach((record) => {
    const recordPath = path.join(resolvedRoleDir, ROLE_RECORDS_DIR, `${record.candidate_id}.json`);
    writeJsonFile(recordPath, record);
  });

  const metrics = buildMetrics(job, rankedRecords, roleConfig);
  const runChanges = buildRunChangeSummary(previousRecords, rankedRecords);
  const runSummary = {
    role_id: job.roleId,
    action,
    started_at: startedAt,
    completed_at: nowIso(),
    status: runErrors.length ? 'failed' : runWarnings.length ? 'completed_with_warnings' : 'completed',
    source_candidate_count: sourceCandidates.length,
    candidate_count: candidates.length,
    record_count: rankedRecords.length,
    warning_count: runWarnings.length,
    error_count: runErrors.length,
    warnings: runWarnings,
    errors: runErrors,
    stale_override_ids: staleOverrideIds,
    cleanup,
    changes: runChanges,
    shortlist_gap_before: previousMetrics.shortlist_progress?.remaining_strong_needed ?? roleConfig.shortlist_target_size,
    shortlist_gap_after: metrics.shortlist_progress?.remaining_strong_needed ?? roleConfig.shortlist_target_size,
    role_config: roleConfig,
  };
  writeJsonFile(path.join(resolvedRoleDir, ROLE_OUTPUTS_DIR, 'search-pack.json'), searchPack);
  writeTextFile(path.join(resolvedRoleDir, ROLE_OUTPUTS_DIR, 'search-pack.md'), `${buildSearchPackMarkdown(job, searchPack)}\n`);
  writeJsonFile(path.join(resolvedRoleDir, ROLE_OUTPUTS_DIR, 'preview-triage.json'), rankedRecords.map((record) => ({
    candidate_id: record.candidate_id,
    candidate_name: record.candidate_name,
    preview_assessment: record.preview_assessment,
    lifecycle_stage: record.lifecycle.current_stage,
    next_action: record.status.next_action,
    rank_position: record.ranking?.position || 0,
    source_audit: record.source_audit,
  })));
  writeJsonFile(path.join(resolvedRoleDir, ROLE_OUTPUTS_DIR, 'candidate-records.json'), rankedRecords);
  writeJsonFile(path.join(resolvedRoleDir, ROLE_OUTPUTS_DIR, 'metrics.json'), metrics);
  writeTextFile(path.join(resolvedRoleDir, ROLE_OUTPUTS_DIR, 'metrics-summary.md'), `${buildMetricsMarkdown(job, metrics)}\n`);
  writeTextFile(path.join(resolvedRoleDir, ROLE_OUTPUTS_DIR, 'operator-review.md'), `${buildOperatorReviewMarkdown(job, metrics, rankedRecords)}\n`);
  writeTextFile(
    path.join(resolvedRoleDir, ROLE_OUTPUTS_DIR, DEFAULT_CANDIDATE_EXPORT_FILE),
    stringifyCsv(buildCandidateExportRows(rankedRecords)),
  );
  writeJsonFile(path.join(resolvedRoleDir, ROLE_OUTPUTS_DIR, DEFAULT_RUN_SUMMARY_FILE), runSummary);
  appendHistoryEntry(resolvedRoleDir, DEFAULT_RUN_HISTORY_FILE, {
    at: runSummary.completed_at,
    action,
    started_at: startedAt,
    completed_at: runSummary.completed_at,
    status: runSummary.status,
    source_candidate_count: sourceCandidates.length,
    processed_candidate_count: candidates.length,
    record_count: rankedRecords.length,
    warnings: runWarnings.slice(0, 8),
    errors: runErrors.slice(0, 8),
    changes: runChanges,
    shortlist_gap_before: previousMetrics.shortlist_progress?.remaining_strong_needed ?? roleConfig.shortlist_target_size,
    shortlist_gap_after: metrics.shortlist_progress?.remaining_strong_needed ?? roleConfig.shortlist_target_size,
  });
  const dashboardSummary = summariseDashboard(job, metrics, searchPack, rankedRecords, resolvedRoleDir, roleConfig);
  const finalSummary = {
    ...dashboardSummary,
    runSummary,
  };
  writeJsonFile(path.join(resolvedRoleDir, ROLE_OUTPUTS_DIR, 'dashboard-summary.json'), finalSummary);
  finalSummary.artifacts.dashboardSummary = buildArtifactDescriptor(
    resolvedRoleDir,
    `${ROLE_OUTPUTS_DIR}/dashboard-summary.json`,
    { label: 'Dashboard Summary', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/dashboard-summary.json' },
  );

  appendJsonLine(auditLogPath, {
    at: nowIso(),
    action: 'metrics_refreshed',
    metrics,
  });

  return finalSummary;
}

async function runRoleWorkspace({ workflowRoot, roleId, action = 'run_all' }) {
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
  return withRoleLock(roleDir, `run_${trimString(action, 60) || 'run_all'}`, async () => runRoleWorkspaceInternal({
    workflowRoot,
    roleId,
    action,
    roleDir,
  }));
}

function isDashboardSummaryStale(roleDir, dashboardPath) {
  const dashboardStat = safeStat(dashboardPath);
  if (!dashboardStat) return true;
  const dependencies = [
    path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_ROLE_FILE),
    path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_CANDIDATES_FILE),
    path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_OPERATOR_OVERRIDES_FILE),
    path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_ROLE_CONFIG_FILE),
    path.join(roleDir, ROLE_OUTPUTS_DIR, DEFAULT_IMPORT_HISTORY_FILE),
    path.join(roleDir, ROLE_OUTPUTS_DIR, DEFAULT_RUN_HISTORY_FILE),
    path.join(roleDir, ROLE_OUTPUTS_DIR, DEFAULT_RUN_SUMMARY_FILE),
    path.join(roleDir, ROLE_OUTPUTS_DIR, 'candidate-records.json'),
  ];
  return dependencies.some((dependencyPath) => {
    const stat = safeStat(dependencyPath);
    return stat && stat.mtimeMs > dashboardStat.mtimeMs;
  });
}

function summariseRoleFromDisk(workflowRoot, roleId) {
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
  const dashboardPath = path.join(roleDir, ROLE_OUTPUTS_DIR, 'dashboard-summary.json');
  const dashboard = readJsonFile(dashboardPath, null);
  if (dashboard && !isDashboardSummaryStale(roleDir, dashboardPath)) return dashboard;

  const job = normaliseJobSpecIntake(loadJobSpecInput(roleDir));
  const roleConfig = loadRoleConfig(roleDir);
  const searchPack = readJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'search-pack.json'), null) || generateSearchPack(job, roleConfig);
  const candidateRecords = readCandidateRecordsFromDisk(roleDir);
  const sourceCandidates = loadCandidatesInput(roleDir);
  if (candidateRecords.length) {
    const operatorOverrides = loadOperatorOverrides(roleDir);
    const recordedIds = new Set(candidateRecords.map((record) => trimString(record.candidate_id, 80)).filter(Boolean));
    sourceCandidates.forEach((candidate, index) => {
      const candidateId = buildCandidateIdentifier(candidate, index);
      if (recordedIds.has(candidateId)) return;
      const operatorReview = mergeOperatorReviewState(candidate, operatorOverrides[candidateId]);
      candidateRecords.push(createCandidateReviewRecord({
        job,
        roleDir,
        candidate: mergeCandidateWithOperatorState(candidate, operatorReview),
        index,
        previewReview: {
          suggestedClassification: '',
          finalClassification: 'preview_only',
          overrideApplied: false,
          overrideReason: '',
          totalScore: 0,
          scoreBreakdown: [],
          reasons: [],
          hardRejectReasons: [],
          missingCriticalInfo: [],
          confidence: 'low',
          recommendedProfileOpen: false,
          recommendedCvDownload: false,
          assessed_at: '',
        },
        fullCvReview: null,
        outreachDraft: null,
        cvInfo: null,
        operatorReview,
        processingError: '',
      }));
    });
    applyCandidateRanking(candidateRecords, roleConfig);
    return summariseDashboard(job, buildMetrics(job, candidateRecords, roleConfig), searchPack, candidateRecords, roleDir, roleConfig);
  }
  const candidates = sourceCandidates;
  return {
    roleSlug: path.basename(roleDir),
    roleId: job.roleId,
    roleTitle: job.title.canonical,
    rolePath: roleDir,
    updatedAt: fs.existsSync(roleDir) ? fs.statSync(roleDir).mtime.toISOString() : '',
    roleConfig,
    roleState: 'gathering_candidates',
    overview: {
      clientName: job.clientName,
      consultant: job.consultant,
      location: job.location,
      mustHaveSkills: job.mustHave.skills,
    },
    shortlistProgress: buildShortlistProgress(roleConfig, {
      shortlist_counts: {
        strong: 0,
        possible: 0,
      },
      lifecycle_counts: LIFECYCLE_STAGES.reduce((accumulator, stage) => ({ ...accumulator, [stage]: 0 }), {}),
    }),
    metrics: buildMetrics(job, [], roleConfig),
    roleHistory: {
      importHistory: readImportHistory(roleDir).slice(-12).reverse(),
      bulkCvHistory: readHistoryEntries(roleDir, DEFAULT_BULK_CV_IMPORT_HISTORY_FILE).slice(-12).reverse(),
      runHistory: readRunHistory(roleDir).slice(-12).reverse(),
      latestImport: readImportHistory(roleDir).slice(-1)[0] || null,
      latestBulkCvImport: readHistoryEntries(roleDir, DEFAULT_BULK_CV_IMPORT_HISTORY_FILE).slice(-1)[0] || null,
      latestRun: readRunHistory(roleDir).slice(-1)[0] || null,
    },
    previewTriage: {
      counts: {
        strong_open: 0,
        maybe_open: 0,
        low_priority: 0,
        reject: 0,
      },
      candidates: [],
    },
    candidateReviews: [],
    candidateDetails: [],
    reviewQueues: {
      new_since_last_review: 0,
      awaiting_manual_screening: 0,
      newly_shortlist_ready: 0,
      draft_ready_not_contacted: 0,
      contacted_awaiting_reply: 0,
      changed_since_last_import: 0,
    },
    drafts: [],
    artifacts: {
      intake: buildArtifactDescriptor(roleDir, `${ROLE_INPUTS_DIR}/${DEFAULT_ROLE_FILE}`, { label: 'Job Spec Intake', downloadable: true, group: 'role_input', sourceOfTruth: 'inputs/job-spec.yaml' }),
      roleConfig: buildArtifactDescriptor(roleDir, `${ROLE_INPUTS_DIR}/${DEFAULT_ROLE_CONFIG_FILE}`, { label: 'Role Config', downloadable: true, group: 'role_input', sourceOfTruth: 'inputs/role-config.json' }),
      candidates: buildArtifactDescriptor(roleDir, `${ROLE_INPUTS_DIR}/${DEFAULT_CANDIDATES_FILE}`, { label: 'Imported Previews', downloadable: true, group: 'role_input', sourceOfTruth: 'inputs/candidates.json' }),
      candidatesCsv: buildArtifactDescriptor(roleDir, `${ROLE_INPUTS_DIR}/${DEFAULT_CANDIDATES_CSV_FILE}`, { label: 'Imported Previews CSV', downloadable: true, group: 'role_input', sourceOfTruth: 'inputs/candidates.csv' }),
      operatorOverrides: buildArtifactDescriptor(roleDir, `${ROLE_INPUTS_DIR}/${DEFAULT_OPERATOR_OVERRIDES_FILE}`, { label: 'Operator Overrides', downloadable: true, group: 'role_input', sourceOfTruth: 'inputs/operator-overrides.json' }),
      importHistory: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/${DEFAULT_IMPORT_HISTORY_FILE}`, { label: 'Import History', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/import-history.json' }),
      bulkCvImportHistory: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/${DEFAULT_BULK_CV_IMPORT_HISTORY_FILE}`, { label: 'Bulk CV Upload History', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/bulk-cv-import-history.json', emptyState: 'No bulk CV batches have been recorded yet.' }),
      runSummary: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/${DEFAULT_RUN_SUMMARY_FILE}`, { label: 'Run Summary', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/run-summary.json' }),
      runHistory: buildArtifactDescriptor(roleDir, `${ROLE_OUTPUTS_DIR}/${DEFAULT_RUN_HISTORY_FILE}`, { label: 'Run History', downloadable: true, group: 'role_output', sourceOfTruth: 'outputs/run-history.json' }),
    },
    status: candidates.length ? 'inputs_ready' : 'awaiting_inputs',
  };
}

function buildRoleIndexEntry(summary) {
  return {
    role_slug: summary.roleSlug || path.basename(summary.rolePath || ''),
    role_id: summary.roleId,
    role_title: summary.roleTitle,
    role_path: summary.rolePath,
    last_updated: summary.updatedAt,
    previews_processed: summary.metrics?.profiles_reviewed || 0,
    cvs_reviewed: summary.metrics?.cvs_downloaded || 0,
    shortlist_count: (summary.metrics?.shortlist_counts?.strong || 0) + (summary.metrics?.shortlist_counts?.possible || 0),
    outreach_drafts_prepared: summary.metrics?.outreach_drafts_prepared || summary.drafts?.length || 0,
    shortlist_target: summary.shortlistProgress?.target || summary.roleConfig?.shortlist_target_size || 0,
    shortlist_progress_status: summary.shortlistProgress?.status || '',
    role_state: summary.roleState || summary.metrics?.role_workflow_state || '',
    current_kpi: summary.metrics?.conversion?.manual_profiles_reviewed_per_viable_outreach_candidate ?? null,
    operator_review_needed: (summary.metrics?.operator_review_needed || 0) > 0,
    operator_review_needed_count: summary.metrics?.operator_review_needed || 0,
    next_actions: summary.metrics?.next_actions || [],
    error: summary.error || '',
  };
}

function listRoles(workflowRoot) {
  return listRoleIds(workflowRoot).map((roleId) => {
    try {
      return summariseRoleFromDisk(workflowRoot, roleId);
    } catch (error) {
      return {
        roleId: roleId.toUpperCase(),
        roleTitle: roleId,
        rolePath: resolveRoleDir(workflowRoot, roleId),
        updatedAt: '',
        overview: {},
        metrics: buildMetrics({ roleId: roleId.toUpperCase(), title: { canonical: roleId } }, []),
        previewTriage: { counts: {}, candidates: [] },
        candidateReviews: [],
        drafts: [],
        artifacts: {},
        error: error?.message || String(error),
      };
    }
  })
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

function listRoleIndex(workflowRoot) {
  return listRoles(workflowRoot).map((summary) => buildRoleIndexEntry(summary));
}

function runHealthCheck(workflowRoot) {
  const issues = [];
  let config = null;
  let configError = '';
  try {
    config = readWorkflowConfig(workflowRoot);
  } catch (error) {
    configError = error?.message || String(error);
  }
  const checks = {
    workflow_root_exists: fs.existsSync(workflowRoot),
    roles_dir_exists: config ? fs.existsSync(config.rolesDir) : false,
    website_repo_exists: config ? fs.existsSync(config.websiteRepoPath) : false,
    dashboard_starter_exists: config ? fs.existsSync(path.join(config.websiteRepoPath, 'scripts', 'start-sourcing-dashboard.js')) : false,
    dashboard_static_exists: config ? fs.existsSync(path.join(config.websiteRepoPath, 'sourcing-dashboard', 'index.html')) : false,
    launcher_config_valid: !configError,
  };

  if (!checks.workflow_root_exists) issues.push(`Workflow root does not exist: ${workflowRoot}`);
  if (configError) {
    issues.push(`launcher-config.json is invalid: ${configError}`);
  } else if (config) {
    if (!checks.website_repo_exists) issues.push(`Website repo path does not exist: ${config.websiteRepoPath}`);
    if (!checks.dashboard_starter_exists) issues.push('Dashboard starter script is missing.');
    if (!checks.dashboard_static_exists) issues.push('Dashboard static files are missing.');
  }

  return {
    ok: issues.length === 0,
    workflowRoot,
    config,
    roleCount: checks.workflow_root_exists && config ? listRoleIds(workflowRoot).length : 0,
    checks,
    issues,
  };
}

function buildCandidateRecordSnapshot(roleDir, candidates, candidateIndex, currentOverride) {
  return readCandidateRecordsFromDisk(roleDir).find((record) => record.candidate_id === buildCandidateIdentifier(candidates[candidateIndex], candidateIndex))
    || createCandidateReviewRecord({
      job: normaliseJobSpecIntake(loadJobSpecInput(roleDir)),
      roleDir,
      candidate: mergeCandidateWithOperatorState(candidates[candidateIndex], currentOverride),
      index: candidateIndex,
      previewReview: {
        suggestedClassification: normalisePreviewClassification(currentOverride.classification),
        finalClassification: normalisePreviewClassification(currentOverride.classification) || 'preview_only',
        overrideApplied: !!currentOverride.classification,
        overrideReason: currentOverride.override_reason,
        totalScore: 0,
        scoreBreakdown: [],
        reasons: [],
        hardRejectReasons: [],
        missingCriticalInfo: [],
        confidence: 'low',
        recommendedProfileOpen: false,
        recommendedCvDownload: false,
        assessed_at: '',
      },
      fullCvReview: null,
      outreachDraft: null,
      cvInfo: null,
      operatorReview: currentOverride,
      processingError: '',
    });
}

async function updateRoleConfig({ workflowRoot, roleId, patch = {}, actor = 'operator' }) {
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
  return withRoleLock(roleDir, 'update_role_config', async () => {
    const current = loadRoleConfig(roleDir);
    const next = saveRoleConfig(roleDir, {
      ...current,
      ...patch,
    });
    appendJsonLine(path.join(roleDir, ROLE_OUTPUTS_DIR, 'audit-log.jsonl'), {
      at: nowIso(),
      action: 'role_config_updated',
      role_id: roleId,
      actor,
      config: next,
    });
    const refreshed = await runRoleWorkspaceInternal({
      workflowRoot,
      roleId,
      action: 'refresh_metrics',
      roleDir,
    });
    return {
      roleId,
      roleConfig: next,
      role: refreshed,
      roleSummary: buildRoleIndexEntry(refreshed),
    };
  });
}

async function logCandidateContactState({
  workflowRoot,
  roleId,
  candidateId,
  stage,
  date = '',
  note = '',
  messageSummary = '',
  actor = 'operator',
}) {
  const contactStage = normaliseLifecycleStage(stage);
  if (!CONTACT_LIFECYCLE_STAGES.includes(contactStage)) {
    throw createWorkflowError(`Contact stage "${stage}" is not supported.`, {
      code: 'invalid_contact_stage',
      statusCode: 400,
    });
  }
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
  return withRoleLock(roleDir, `contact_${contactStage}`, async () => {
    const candidates = loadCandidatesInput(roleDir);
    const candidateIndex = candidates.findIndex((candidate, index) => buildCandidateIdentifier(candidate, index) === candidateId);
    if (candidateIndex === -1) {
      throw createWorkflowError(`Candidate ${candidateId} was not found in role ${roleId}.`, {
        code: 'missing_candidate',
        statusCode: 404,
      });
    }
    const overrides = loadOperatorOverrides(roleDir);
    const current = normaliseOperatorReviewState(overrides[candidateId] || {});
    const existingRecord = buildCandidateRecordSnapshot(roleDir, candidates, candidateIndex, current);
    const entry = {
      at: normaliseIsoDate(date) || nowIso(),
      actor,
      stage: contactStage,
      note: trimString(note, 600),
      message_summary: trimString(messageSummary, 1000),
    };
    const next = normaliseOperatorReviewState({
      ...current,
      decision: contactStage,
      lifecycle_stage: contactStage,
      updated_at: nowIso(),
      updated_by: actor,
      history: [
        ...(current.history || []),
        {
          at: entry.at,
          actor,
          stage: contactStage,
          changed_fields: ['decision', 'lifecycle_stage', 'contact_log'],
          summary: contactStage,
          reason: entry.note || entry.message_summary,
        },
      ],
      contact_log: [
        ...(current.contact_log || []),
        entry,
      ],
    });
    const transitionIssues = validateLifecycleTransition(existingRecord, next);
    if (transitionIssues.length) {
      throw createWorkflowError('Contact update failed validation.', {
        code: 'invalid_contact_update',
        statusCode: 400,
        details: { issues: transitionIssues },
      });
    }
    overrides[candidateId] = next;
    writeOperatorOverrides(roleDir, overrides);
    appendJsonLine(path.join(roleDir, ROLE_OUTPUTS_DIR, 'audit-log.jsonl'), {
      at: entry.at,
      action: 'candidate_contact_state_logged',
      role_id: roleId,
      candidate_id: candidateId,
      stage: contactStage,
      actor,
      note: entry.note,
    });
    const refreshed = await runRoleWorkspaceInternal({
      workflowRoot,
      roleId,
      action: 'refresh_metrics',
      roleDir,
    });
    return {
      roleId,
      candidateId,
      contactEvent: entry,
      role: refreshed,
      roleSummary: buildRoleIndexEntry(refreshed),
    };
  });
}

async function updateCandidateOperatorState({ workflowRoot, roleId, candidateId, patch = {}, actor = 'operator' }) {
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
  return withRoleLock(roleDir, 'update_candidate', async () => {
    const candidates = loadCandidatesInput(roleDir);
    const candidateIndex = candidates.findIndex((candidate, index) => buildCandidateIdentifier(candidate, index) === candidateId);
    if (candidateIndex === -1) {
      throw createWorkflowError(`Candidate ${candidateId} was not found in role ${roleId}.`, {
        code: 'missing_candidate',
        statusCode: 404,
      });
    }

    const overrides = loadOperatorOverrides(roleDir);
    const current = normaliseOperatorReviewState(overrides[candidateId] || {});
    const existingRecord = buildCandidateRecordSnapshot(roleDir, candidates, candidateIndex, current);
    const timestamp = nowIso();
    const next = normaliseOperatorReviewState({
      ...current,
      ...patch,
      created_at: current.created_at || timestamp,
      updated_at: timestamp,
      updated_by: actor,
      history: current.history,
      contact_log: current.contact_log,
    });
    if (!next.lifecycle_stage) {
      next.lifecycle_stage = normaliseLifecycleStage(next.shortlist_status || decisionImpliedStage(next.decision));
    }

    const transitionIssues = validateLifecycleTransition(existingRecord, next);
    if (transitionIssues.length) {
      throw createWorkflowError('Operator update failed validation.', {
        code: 'invalid_operator_update',
        statusCode: 400,
        details: { issues: transitionIssues },
      });
    }

    const trackedFields = [
      'classification',
      'decision',
      'shortlist_status',
      'shortlist_bucket',
      'ranking_pin',
      'outreach_ready_override',
      'lifecycle_stage',
      'manual_notes',
      'strengths',
      'concerns',
      'follow_up_questions',
      'override_reason',
      'availability_notes',
      'appetite_notes',
      'compensation_notes',
      'location_mobility_notes',
      'manual_screening_summary',
      'recommended_next_step',
      'recruiter_confidence',
      'final_manual_rationale',
    ];
    const changedFields = trackedFields.filter((field) => !compareValues(current[field], next[field]));
    if (!changedFields.length) {
      return {
        roleId,
        candidateId,
        changedFields,
        unchanged: true,
        operatorReview: current,
        roleSummary: buildRoleIndexEntry(summariseRoleFromDisk(workflowRoot, roleId)),
      };
    }

    next.history = [
      ...(current.history || []),
      {
        at: timestamp,
        actor,
        stage: next.lifecycle_stage || decisionImpliedStage(next.decision) || '',
        changed_fields: changedFields,
        summary: next.lifecycle_stage || 'operator_update',
        reason: next.override_reason || trimString(patch.reason, 240),
      },
    ];

    overrides[candidateId] = next;
    writeOperatorOverrides(roleDir, overrides);
    appendJsonLine(path.join(roleDir, ROLE_OUTPUTS_DIR, 'audit-log.jsonl'), {
      at: timestamp,
      action: 'operator_update',
      role_id: roleId,
      candidate_id: candidateId,
      changed_fields: changedFields,
    });

    const refreshed = await runRoleWorkspaceInternal({
      workflowRoot,
      roleId,
      action: 'refresh_metrics',
      roleDir,
    });

    return {
      roleId,
      candidateId,
      changedFields,
      unchanged: false,
      operatorReview: next,
      role: refreshed,
      roleSummary: buildRoleIndexEntry(refreshed),
    };
  });
}

module.exports = {
  DEFAULT_CANDIDATES_CSV_FILE,
  DEFAULT_CANDIDATES_FILE,
  DEFAULT_CANDIDATE_EXPORT_FILE,
  DEFAULT_BULK_CV_IMPORT_HISTORY_FILE,
  DEFAULT_IMPORT_HISTORY_FILE,
  DEFAULT_OPERATOR_OVERRIDES_FILE,
  DEFAULT_PORT,
  DEFAULT_ROLE_CONFIG_FILE,
  DEFAULT_ROLE_FILE,
  DEFAULT_RUN_HISTORY_FILE,
  DEFAULT_RUN_SUMMARY_FILE,
  LIFECYCLE_STAGES,
  OPERATOR_DECISIONS,
  PREVIEW_CLASSIFICATIONS,
  ROLE_CVS_DIR,
  ROLE_DRAFTS_DIR,
  ROLE_INPUTS_DIR,
  ROLE_OUTPUTS_DIR,
  ROLE_RECORDS_DIR,
  SHORTLIST_STATUSES,
  WORKFLOW_VERSION,
  buildOutreachDraft,
  buildCandidateExportRows,
  buildDefaultRoleConfig,
  buildSearchPackMarkdown,
  buildDefaultCandidatesTemplate,
  buildMetrics,
  buildMetricsMarkdown,
  exportCandidateReviewsCsv,
  generateSearchPack,
  importBulkCvFiles,
  importPreviewCandidates,
  importPreviewCandidatesFromText,
  logCandidateContactState,
  listRoleIds,
  listRoleIndex,
  listRoles,
  loadRoleConfig,
  normaliseJobSpecIntake,
  readWorkflowConfig,
  resolveRoleDir,
  runHealthCheck,
  runRoleWorkspace,
  scaffoldRoleWorkspace,
  scorePreviewCandidate,
  updateRoleConfig,
  summariseRoleFromDisk,
  reviewFullCv,
  updateCandidateOperatorState,
};
