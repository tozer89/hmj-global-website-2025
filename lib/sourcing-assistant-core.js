'use strict';

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
const DEFAULT_CANDIDATE_EXPORT_FILE = 'candidate-review-export.csv';
const DEFAULT_RUN_SUMMARY_FILE = 'run-summary.json';
const DEFAULT_PORT = 4287;
const PREVIEW_CLASSIFICATIONS = ['strong_open', 'maybe_open', 'low_priority', 'reject'];
const SHORTLIST_STATUSES = ['strong_shortlist', 'possible_shortlist', 'do_not_progress'];
const OPERATOR_DECISIONS = ['manual_screened', 'hold', 'do_not_progress', 'contacted', 'awaiting_reply', 'closed'];
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
const REQUIRED_CSV_COLUMNS = ['source', 'search_variant'];

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

function relPath(rootPath, targetPath) {
  return path.relative(rootPath, targetPath).replace(/\\/g, '/');
}

function nowIso() {
  return new Date().toISOString();
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

function buildDefaultOperatorReview() {
  return {
    classification: '',
    decision: '',
    shortlist_status: '',
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
    search_variant: trimString(candidate.search_variant, 40),
    search_name: trimString(candidate.search_name, 160),
    candidate_name: trimString(candidate.candidate_name || candidate.name || candidate.display_name, 160),
    current_title: trimString(candidate.current_title || candidate.title, 160),
    headline: trimString(candidate.headline, 220),
    location: trimString(candidate.location, 160),
    mobility: trimString(candidate.mobility, 160),
    salary_text: trimString(candidate.salary_text || candidate.compensation, 120),
    sector_tags: cleanArray(candidate.sector_tags || candidate.sectors, 12, 80),
    summary_text: trimString(candidate.summary_text || candidate.preview_text || candidate.preview || candidate.summary, 4000),
    last_updated: trimString(candidate.last_updated, 40),
    opened_profile: asBoolean(candidate.opened_profile) === true,
    cv_file: trimString(candidate.cv_file, 500),
    cv_text: trimString(candidate.cv_text, 40000),
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
    search_variant: row.search_variant,
    search_name: row.search_name,
    candidate_name: row.candidate_name || row.name,
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

function generateSearchPack(job) {
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
      job.location.drivingLicenceRequired ? 'Apply driving licence filter where relevant.' : '',
    ], 8, 160),
    variants: {
      broad,
      medium,
      narrow,
    },
  };
}

function scoreLocation(job, previewText, candidate) {
  const notes = [];
  let score = 0;
  if (!job.location.base) {
    return { score: 0, notes };
  }
  if (containsPhrase(previewText, job.location.base)) {
    score += 10;
    notes.push(`Location matches ${job.location.base}.`);
  } else if (containsPhrase(previewText, 'relocation') || containsPhrase(previewText, 'travel') || containsPhrase(previewText, 'nationwide')) {
    score += job.location.relocationConsidered ? 8 : 4;
    notes.push('Location is not exact but mobility or travel is mentioned.');
  } else if (Array.isArray(candidate.location_tags) && candidate.location_tags.some((entry) => containsPhrase(job.location.base, entry) || containsPhrase(entry, job.location.base))) {
    score += 8;
    notes.push('Location tags suggest a workable match.');
  } else {
    notes.push('No clear evidence that the location is workable from preview data.');
  }
  return { score, notes };
}

function classifyPreview(score, hardReject, missingCriticalInfo) {
  if (hardReject.length) return 'reject';
  if (score >= 65) return 'strong_open';
  if (score >= 40) return 'maybe_open';
  if (score >= 25) return 'low_priority';
  return 'reject';
}

function scorePreviewCandidate(job, candidate = {}) {
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
    totalScore += 12;
    breakdown.push({ label: 'adjacent_role_fit', score: 12, evidence: adjacentTitleMatches });
    reasons.push(`Adjacent title evidence: ${adjacentTitleMatches.join(', ')}.`);
  } else {
    missingCriticalInfo.push('No clear direct or adjacent title match in preview.');
  }

  if (skillMatches.length || qualificationMatches.length) {
    const skillScore = Math.min(18, (skillMatches.length * 6) + (qualificationMatches.length * 4));
    totalScore += skillScore;
    breakdown.push({
      label: 'core_skill_alignment',
      score: skillScore,
      evidence: [...skillMatches, ...qualificationMatches],
    });
    reasons.push(`Must-have evidence found: ${[...skillMatches, ...qualificationMatches].join(', ')}.`);
  } else {
    missingCriticalInfo.push('No must-have skill evidence visible in preview.');
  }

  if (sectorMatches.length) {
    const sectorScore = Math.min(12, sectorMatches.length * 4);
    totalScore += sectorScore;
    breakdown.push({ label: 'sector_project_relevance', score: sectorScore, evidence: sectorMatches });
    reasons.push(`Sector or project relevance: ${sectorMatches.join(', ')}.`);
  }

  const locationScore = scoreLocation(job, previewText, candidate);
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

  const suggestedClassification = classifyPreview(totalScore, hardReject, missingCriticalInfo);
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

function reviewFullCv(job, candidate, cvText) {
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
  const locationScore = scoreLocation(job, sourceText, candidate);
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
    score += 14;
    breakdown.push({ label: 'adjacent_role_fit', score: 14, evidence: adjacentTitleMatches });
    strengths.push(`Transferable title evidence: ${adjacentTitleMatches.join(', ')}.`);
  } else {
    gaps.push('No clear direct or adjacent title evidence in the CV text.');
  }

  if (skillMatches.length || qualificationMatches.length) {
    const skillScore = Math.min(20, (skillMatches.length * 5) + (qualificationMatches.length * 4));
    score += skillScore;
    breakdown.push({ label: 'must_have_experience', score: skillScore, evidence: [...skillMatches, ...qualificationMatches] });
    strengths.push(`Relevant must-have evidence: ${[...skillMatches, ...qualificationMatches].join(', ')}.`);
  } else {
    gaps.push('Must-have experience is not evidenced strongly enough in the CV text.');
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
    score += Math.min(8, preferredMatches.length * 2);
    breakdown.push({ label: 'preferred_experience', score: Math.min(8, preferredMatches.length * 2), evidence: preferredMatches });
  }

  if (excludedMatches.length) {
    score -= 18;
    gaps.push(`Excluded patterns appear in the CV text: ${excludedMatches.join(', ')}.`);
  }

  const shortlistRecommendation = (score >= 70 && directTitleMatches.length) || score >= 85
    ? 'strong'
    : score >= 45
      ? 'possible'
      : 'reject';

  if (!highlights.length) {
    uncertaintyNotes.push('The CV text produced limited extractable evidence, so the review should be treated cautiously.');
  }

  const followUpQuestions = buildFollowUpQuestions(job, candidate, { sourceText });
  const outreachReady = shortlistRecommendation !== 'reject' && !excludedMatches.length;

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
    subject,
    body,
    evidencePoints: evidence,
    roleDetails,
    questions,
  };
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
  const previewStage = trimString(record?.preview_assessment?.finalClassification, 40);
  if (previewStage) {
    history.push({
      at: baseTime,
      source: 'machine',
      stage: previewStage,
      note: 'Preview triage classification',
    });
  }
  if (record?.full_cv?.review_status === 'completed') {
    history.push({
      at: baseTime,
      source: 'machine',
      stage: 'cv_reviewed',
      note: 'Full CV reviewed',
    });
  }
  const shortlistStage = mapMachineShortlistToStage(trimString(record?.full_cv?.shortlist_recommendation, 40));
  if (shortlistStage) {
    history.push({
      at: baseTime,
      source: 'machine',
      stage: shortlistStage,
      note: 'Machine shortlist recommendation',
    });
  }
  if (record?.outreach?.ready) {
    history.push({
      at: baseTime,
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
  if (['strong_shortlist', 'possible_shortlist', 'outreach_ready'].includes(stage) && !record?.outreach?.draft_path) {
    return 'Prepare draft outreach';
  }
  if (stage === 'outreach_drafted') return 'Send manually or update contact status';
  if (stage === 'contacted') return 'Await reply and update status';
  if (stage === 'awaiting_reply') return 'Chase or close manually when appropriate';
  if (stage === 'closed' || stage === 'do_not_progress' || stage === 'reject') return 'No further action';
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

  if (nextReview.outreach_ready_override === true && !hasCompletedCv) {
    issues.push('Outreach cannot be forced ready before a completed CV review exists.');
  }
  if (nextReview.shortlist_status && !hasCompletedCv) {
    issues.push('Shortlist status cannot be set before a completed CV review exists.');
  }
  if (nextReview.shortlist_status === 'do_not_progress' && targetStage && !['do_not_progress', 'closed'].includes(targetStage)) {
    issues.push('Shortlist status do_not_progress can only be paired with lifecycle do_not_progress or closed.');
  }
  if (nextReview.classification === 'reject' && nextReview.shortlist_status && nextReview.shortlist_status !== 'do_not_progress') {
    issues.push('A rejected preview classification cannot be paired with a shortlist status.');
  }

  if (targetStage) {
    if (PREVIEW_CLASSIFICATIONS.includes(targetStage) && hasCompletedCv) {
      issues.push('Lifecycle cannot be moved back to a preview-only stage after CV review is complete.');
    }
    if (['strong_shortlist', 'possible_shortlist', 'outreach_ready', 'outreach_drafted'].includes(targetStage) && !hasCompletedCv) {
      issues.push(`Lifecycle stage ${targetStage} requires a completed CV review.`);
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
  const record = {
    version: WORKFLOW_VERSION,
    candidate_id: candidateId,
    role_id: job.roleId,
    source: trimString(candidate.source, 80) || 'CV-Library',
    search_used: {
      variant: trimString(candidate.search_variant, 40),
      name: trimString(candidate.search_name, 160),
    },
    candidate_name: trimString(candidate.candidate_name, 160),
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
    },
    preview_assessment: previewReview,
    full_cv: fullCvReview
      ? {
        downloaded: !!cvInfo?.downloaded,
        cv_file: cvInfo?.relativePath || '',
        extraction_summary: cvInfo?.summary || '',
        review_status: 'completed',
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
        error_message: processingError || '',
      },
    outreach: outreachDraft
      ? {
        ready: true,
        subject: outreachDraft.subject,
        draft_path: '',
        evidence_points: outreachDraft.evidencePoints,
        questions: outreachDraft.questions,
      }
      : {
        ready: false,
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

function buildMetrics(job, candidateRecords) {
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

  return {
    role_id: job.roleId,
    profiles_reviewed: profilesReviewed,
    recommended_to_open: recommendedToOpen,
    profiles_opened: profilesOpened,
    cvs_downloaded: cvsDownloaded,
    viable_outreach_candidates: viableOutreachCandidates,
    outreach_drafts_prepared: outreachDraftsPrepared,
    preview_counts: previewCounts,
    shortlist_counts: shortlistCounts,
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
  };
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
    lifecycle: record.lifecycle.current_stage,
    classification: record.preview_assessment.finalClassification,
    score: record.preview_assessment.totalScore,
    shortlist: record.status.shortlist_stage || 'pending',
    decision: record.operator_decision || '',
    outreach: record.outreach.draft_path ? 'drafted' : record.outreach.ready ? 'ready' : 'not ready',
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
      { label: 'Lifecycle', render: (row) => row.lifecycle },
      { label: 'Preview Class', render: (row) => row.classification },
      { label: 'Score', render: (row) => String(row.score) },
      { label: 'Shortlist', render: (row) => row.shortlist },
      { label: 'Operator', render: (row) => row.decision || 'pending' },
      { label: 'Outreach', render: (row) => row.outreach },
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
    current_title: record.current_title,
    source: record.source,
    search_variant: record.search_used.variant,
    location: record.location,
    preview_classification: record.preview_assessment.finalClassification,
    preview_score: record.preview_assessment.totalScore,
    lifecycle_stage: record.lifecycle.current_stage,
    shortlist_status: record.status.shortlist_stage,
    outreach_ready: record.outreach.ready ? 'yes' : 'no',
    outreach_draft_path: record.outreach.draft_path || '',
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
    next_action: record.status.next_action,
  }));
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
      summary: 'Used inline CV text from the candidate input file.',
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

function summariseDashboard(job, metrics, searchPack, candidateRecords, roleDir) {
  const drafts = candidateRecords
    .filter((record) => record.outreach.ready && record.outreach.draft_path)
    .map((record) => ({
      candidate_id: record.candidate_id,
      candidate_name: record.candidate_name || record.current_title || record.candidate_id,
      subject: record.outreach.subject,
      path: record.outreach.draft_path,
    }));

  return {
    roleId: job.roleId,
    roleTitle: job.title.canonical,
    rolePath: roleDir,
    updatedAt: nowIso(),
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
    searchPack,
    metrics,
    previewTriage: {
      counts: metrics.preview_counts,
      candidates: candidateRecords.map((record) => ({
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
      })),
    },
    candidateReviews: candidateRecords.map((record) => ({
      candidate_id: record.candidate_id,
      candidate_name: record.candidate_name || record.current_title || record.candidate_id,
      shortlist_recommendation: record.full_cv.shortlist_recommendation || '',
      shortlist_status: record.status.shortlist_stage || '',
      lifecycle_stage: record.lifecycle.current_stage,
      outreach_ready: record.outreach.ready,
      operator_decision: record.operator_decision || '',
      operator_review_needed: record.status.needs_operator_review,
      strengths: record.full_cv.strengths || [],
      gaps: record.full_cv.gaps || [],
      follow_up_questions: record.full_cv.follow_up_questions || [],
      operator_notes: record.operator_review.manual_notes || '',
    })),
    drafts,
    artifacts: {
      intake: `${ROLE_INPUTS_DIR}/${DEFAULT_ROLE_FILE}`,
      candidates: `${ROLE_INPUTS_DIR}/${DEFAULT_CANDIDATES_FILE}`,
      candidatesCsv: `${ROLE_INPUTS_DIR}/${DEFAULT_CANDIDATES_CSV_FILE}`,
      operatorOverrides: `${ROLE_INPUTS_DIR}/${DEFAULT_OPERATOR_OVERRIDES_FILE}`,
      searchPackMarkdown: `${ROLE_OUTPUTS_DIR}/search-pack.md`,
      searchPackJson: `${ROLE_OUTPUTS_DIR}/search-pack.json`,
      previewTriage: `${ROLE_OUTPUTS_DIR}/preview-triage.json`,
      candidateRecords: `${ROLE_OUTPUTS_DIR}/candidate-records.json`,
      candidateExportCsv: `${ROLE_OUTPUTS_DIR}/${DEFAULT_CANDIDATE_EXPORT_FILE}`,
      metrics: `${ROLE_OUTPUTS_DIR}/metrics.json`,
      metricsSummary: `${ROLE_OUTPUTS_DIR}/metrics-summary.md`,
      operatorReview: `${ROLE_OUTPUTS_DIR}/operator-review.md`,
      runSummary: `${ROLE_OUTPUTS_DIR}/${DEFAULT_RUN_SUMMARY_FILE}`,
      dashboardSummary: `${ROLE_OUTPUTS_DIR}/dashboard-summary.json`,
      auditLog: `${ROLE_OUTPUTS_DIR}/audit-log.jsonl`,
    },
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
  return roleDir;
}

function buildDefaultCandidatesTemplate() {
  return [];
}

function scaffoldRoleWorkspace({ workflowRoot, roleId, roleTitle = '' }) {
  const roleSlug = validateRoleSlug(roleId || roleTitle || '');
  const roleDir = resolveRoleDir(workflowRoot, roleSlug);
  ensureDir(path.join(roleDir, ROLE_INPUTS_DIR));
  ensureDir(path.join(roleDir, ROLE_OUTPUTS_DIR));
  ensureDir(path.join(roleDir, ROLE_RECORDS_DIR));
  ensureDir(path.join(roleDir, ROLE_DRAFTS_DIR));
  ensureDir(path.join(roleDir, ROLE_CVS_DIR));

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

  return {
    roleId: roleSlug,
    roleDir,
    intakePath: intakeTargetPath,
    candidatesPath,
    operatorOverridesPath,
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

  const recordsDir = path.join(roleDir, ROLE_RECORDS_DIR);
  if (fs.existsSync(recordsDir)) {
    fs.readdirSync(recordsDir)
      .filter((entry) => entry.endsWith('.json') && !validRecordFiles.has(entry))
      .forEach((entry) => fs.unlinkSync(path.join(recordsDir, entry)));
  }

  const draftsDir = path.join(roleDir, ROLE_DRAFTS_DIR);
  if (fs.existsSync(draftsDir)) {
    fs.readdirSync(draftsDir)
      .filter((entry) => entry.endsWith('.md') && !validDraftFiles.has(entry))
      .forEach((entry) => fs.unlinkSync(path.join(draftsDir, entry)));
  }
}

function importPreviewCandidates({ workflowRoot, roleId, inputPath }) {
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
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
  const importedCandidates = parseCandidateImportText(resolvedInputPath, readTextFile(resolvedInputPath))
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
  const unchanged = Array.isArray(currentCandidates) && compareValues(normaliseCandidateBatch(currentCandidates), importedCandidates);
  if (!unchanged) {
    writeJsonFile(targetJsonPath, importedCandidates);
  }
  if (trimString(path.extname(resolvedInputPath).slice(1).toLowerCase(), 12) === 'csv') {
    const csvTargetPath = path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_CANDIDATES_CSV_FILE);
    const incomingText = readTextFile(resolvedInputPath);
    const existingText = fs.existsSync(csvTargetPath) ? readTextFile(csvTargetPath) : '';
    if (existingText !== incomingText) {
      writeTextFile(csvTargetPath, incomingText);
    }
  }

  appendJsonLine(path.join(roleDir, ROLE_OUTPUTS_DIR, 'audit-log.jsonl'), {
    at: nowIso(),
    action: unchanged ? 'candidate_previews_import_skipped' : 'candidate_previews_imported',
    role_id: roleId,
    source_path: resolvedInputPath,
    count: importedCandidates.length,
  });

  return {
    roleId,
    inputPath: resolvedInputPath,
    candidatesPath: targetJsonPath,
    importedCount: importedCandidates.length,
    mode: 'replace',
    unchanged,
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

async function runRoleWorkspace({ workflowRoot, roleId, action = 'run_all' }) {
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
  if (!fs.existsSync(operatorOverridesPath(roleDir))) {
    writeJsonFile(operatorOverridesPath(roleDir), {});
  }
  const startedAt = nowIso();
  const jobInput = loadJobSpecInput(roleDir);
  const job = normaliseJobSpecIntake(jobInput);
  const jobIssues = validateJobSpec(job);
  if (jobIssues.length) {
    throw createWorkflowError(`Job spec validation failed for ${roleId}.`, {
      code: 'invalid_job_spec',
      statusCode: 400,
      details: { issues: jobIssues },
    });
  }
  const steps = inferActionSteps(action);
  const searchPack = generateSearchPack(job);
  const candidates = loadCandidatesInput(roleDir);
  const operatorOverrides = loadOperatorOverrides(roleDir);
  const candidateRecords = [];
  const auditLogPath = path.join(roleDir, ROLE_OUTPUTS_DIR, 'audit-log.jsonl');
  const runWarnings = [];
  const runErrors = [];

  appendJsonLine(auditLogPath, {
    at: startedAt,
    action: 'role_processed',
    role_id: job.roleId,
    requested_action: action,
  });

  if (!candidates.length) {
    runWarnings.push('No candidate previews were available in the role input file.');
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = normaliseCandidateInput(candidates[index]);
    const candidateId = buildCandidateIdentifier(candidate, index);
    const operatorReview = mergeOperatorReviewState(candidate, operatorOverrides[candidateId]);
    const candidateWithOperatorState = mergeCandidateWithOperatorState(candidate, operatorReview);
    const previewReview = steps.includes('triage')
      ? scorePreviewCandidate(job, candidateWithOperatorState)
      : null;
    let fullCvReview = null;
    let outreachDraft = null;
    let cvInfo = null;
    let processingError = '';

    if (steps.includes('full_cv') && (trimString(candidateWithOperatorState.cv_file, 500) || trimString(candidateWithOperatorState.cv_text, 200))) {
      try {
        cvInfo = await extractCvInfo(roleDir, candidateWithOperatorState);
        fullCvReview = reviewFullCv(job, candidateWithOperatorState, cvInfo.text);
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
      roleDir,
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
      },
      fullCvReview,
      outreachDraft,
      cvInfo,
      operatorReview,
      processingError,
    });

    if (outreachDraft) {
      const draftPath = path.join(roleDir, ROLE_DRAFTS_DIR, `${record.candidate_id}.md`);
      writeTextFile(draftPath, `${outreachDraft.body}\n`);
      record.outreach.draft_path = relPath(roleDir, draftPath);
      refreshCandidateRecordState(record);
      appendJsonLine(auditLogPath, {
        at: nowIso(),
        action: 'outreach_draft_generated',
        candidate_id: record.candidate_id,
        draft_path: record.outreach.draft_path,
      });
    }

    const recordPath = path.join(roleDir, ROLE_RECORDS_DIR, `${record.candidate_id}.json`);
    writeJsonFile(recordPath, record);
    candidateRecords.push(record);
  }

  removeStaleRoleArtifacts(roleDir, candidateRecords);

  const metrics = buildMetrics(job, candidateRecords);
  const dashboardSummary = summariseDashboard(job, metrics, searchPack, candidateRecords, roleDir);
  const runSummary = {
    role_id: job.roleId,
    action,
    started_at: startedAt,
    completed_at: nowIso(),
    status: runErrors.length ? 'failed' : runWarnings.length ? 'completed_with_warnings' : 'completed',
    candidate_count: candidates.length,
    record_count: candidateRecords.length,
    warning_count: runWarnings.length,
    error_count: runErrors.length,
    warnings: runWarnings,
    errors: runErrors,
  };
  writeJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'search-pack.json'), searchPack);
  writeTextFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'search-pack.md'), `${buildSearchPackMarkdown(job, searchPack)}\n`);
  writeJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'preview-triage.json'), candidateRecords.map((record) => ({
    candidate_id: record.candidate_id,
    candidate_name: record.candidate_name,
    preview_assessment: record.preview_assessment,
    lifecycle_stage: record.lifecycle.current_stage,
    next_action: record.status.next_action,
  })));
  writeJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'candidate-records.json'), candidateRecords);
  writeJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'metrics.json'), metrics);
  writeTextFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'metrics-summary.md'), `${buildMetricsMarkdown(job, metrics)}\n`);
  writeTextFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'operator-review.md'), `${buildOperatorReviewMarkdown(job, metrics, candidateRecords)}\n`);
  writeTextFile(
    path.join(roleDir, ROLE_OUTPUTS_DIR, DEFAULT_CANDIDATE_EXPORT_FILE),
    stringifyCsv(buildCandidateExportRows(candidateRecords)),
  );
  writeJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, DEFAULT_RUN_SUMMARY_FILE), runSummary);
  writeJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'dashboard-summary.json'), dashboardSummary);

  appendJsonLine(auditLogPath, {
    at: nowIso(),
    action: 'metrics_refreshed',
    metrics,
  });

  return {
    ...dashboardSummary,
    runSummary,
  };
}

function summariseRoleFromDisk(workflowRoot, roleId) {
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
  const dashboardPath = path.join(roleDir, ROLE_OUTPUTS_DIR, 'dashboard-summary.json');
  const dashboard = readJsonFile(dashboardPath, null);
  if (dashboard) return dashboard;

  const job = normaliseJobSpecIntake(loadJobSpecInput(roleDir));
  const searchPack = readJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'search-pack.json'), null) || generateSearchPack(job);
  const candidateRecords = readCandidateRecordsFromDisk(roleDir);
  if (candidateRecords.length) {
    return summariseDashboard(job, buildMetrics(job, candidateRecords), searchPack, candidateRecords, roleDir);
  }
  const candidates = loadCandidatesInput(roleDir);
  return {
    roleId: job.roleId,
    roleTitle: job.title.canonical,
    rolePath: roleDir,
    updatedAt: fs.existsSync(roleDir) ? fs.statSync(roleDir).mtime.toISOString() : '',
    overview: {
      clientName: job.clientName,
      consultant: job.consultant,
      location: job.location,
      mustHaveSkills: job.mustHave.skills,
    },
    metrics: buildMetrics(job, []),
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
    drafts: [],
    artifacts: {
      intake: `${ROLE_INPUTS_DIR}/${DEFAULT_ROLE_FILE}`,
      candidates: `${ROLE_INPUTS_DIR}/${DEFAULT_CANDIDATES_FILE}`,
      candidatesCsv: `${ROLE_INPUTS_DIR}/${DEFAULT_CANDIDATES_CSV_FILE}`,
      operatorOverrides: `${ROLE_INPUTS_DIR}/${DEFAULT_OPERATOR_OVERRIDES_FILE}`,
      runSummary: `${ROLE_OUTPUTS_DIR}/${DEFAULT_RUN_SUMMARY_FILE}`,
    },
    status: candidates.length ? 'inputs_ready' : 'awaiting_inputs',
  };
}

function buildRoleIndexEntry(summary) {
  return {
    role_id: summary.roleId,
    role_title: summary.roleTitle,
    role_path: summary.rolePath,
    last_updated: summary.updatedAt,
    previews_processed: summary.metrics?.profiles_reviewed || 0,
    cvs_reviewed: summary.metrics?.cvs_downloaded || 0,
    shortlist_count: (summary.metrics?.shortlist_counts?.strong || 0) + (summary.metrics?.shortlist_counts?.possible || 0),
    outreach_drafts_prepared: summary.metrics?.outreach_drafts_prepared || summary.drafts?.length || 0,
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
  const config = readWorkflowConfig(workflowRoot);
  const issues = [];
  const checks = {
    workflow_root_exists: fs.existsSync(workflowRoot),
    roles_dir_exists: fs.existsSync(config.rolesDir),
    website_repo_exists: fs.existsSync(config.websiteRepoPath),
    dashboard_starter_exists: fs.existsSync(path.join(config.websiteRepoPath, 'scripts', 'start-sourcing-dashboard.js')),
    dashboard_static_exists: fs.existsSync(path.join(config.websiteRepoPath, 'sourcing-dashboard', 'index.html')),
    launcher_config_valid: true,
  };

  if (!checks.workflow_root_exists) issues.push(`Workflow root does not exist: ${workflowRoot}`);
  if (!checks.website_repo_exists) issues.push(`Website repo path does not exist: ${config.websiteRepoPath}`);
  if (!checks.dashboard_starter_exists) issues.push('Dashboard starter script is missing.');
  if (!checks.dashboard_static_exists) issues.push('Dashboard static files are missing.');

  return {
    ok: issues.length === 0,
    workflowRoot,
    config,
    roleCount: checks.workflow_root_exists ? listRoleIds(workflowRoot).length : 0,
    checks,
    issues,
  };
}

async function updateCandidateOperatorState({ workflowRoot, roleId, candidateId, patch = {}, actor = 'operator' }) {
  const roleDir = requireExistingRoleDir(workflowRoot, roleId);
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
  const existingRecord = readCandidateRecordsFromDisk(roleDir).find((record) => record.candidate_id === candidateId)
    || createCandidateReviewRecord({
      job: normaliseJobSpecIntake(loadJobSpecInput(roleDir)),
      roleDir,
      candidate: mergeCandidateWithOperatorState(candidates[candidateIndex], current),
      index: candidateIndex,
      previewReview: {
        suggestedClassification: normalisePreviewClassification(current.classification),
        finalClassification: normalisePreviewClassification(current.classification) || 'preview_only',
        overrideApplied: !!current.classification,
        overrideReason: current.override_reason,
        totalScore: 0,
        scoreBreakdown: [],
        reasons: [],
        hardRejectReasons: [],
        missingCriticalInfo: [],
        confidence: 'low',
        recommendedProfileOpen: false,
        recommendedCvDownload: false,
      },
      fullCvReview: null,
      outreachDraft: null,
      cvInfo: null,
      operatorReview: current,
      processingError: '',
    });
  const timestamp = nowIso();
  const next = normaliseOperatorReviewState({
    ...current,
    ...patch,
    created_at: current.created_at || timestamp,
    updated_at: timestamp,
    updated_by: actor,
    history: current.history,
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
  if (changedFields.length) {
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
  } else {
    next.history = current.history || [];
  }

  overrides[candidateId] = next;
  writeOperatorOverrides(roleDir, overrides);
  appendJsonLine(path.join(roleDir, ROLE_OUTPUTS_DIR, 'audit-log.jsonl'), {
    at: timestamp,
    action: 'operator_update',
    role_id: roleId,
    candidate_id: candidateId,
    changed_fields: changedFields,
  });

  const refreshed = await runRoleWorkspace({
    workflowRoot,
    roleId,
    action: 'refresh_metrics',
  });

  return {
    roleId,
    candidateId,
    changedFields,
    unchanged: false,
    operatorReview: next,
    roleSummary: buildRoleIndexEntry(refreshed),
  };
}

module.exports = {
  DEFAULT_CANDIDATES_CSV_FILE,
  DEFAULT_CANDIDATES_FILE,
  DEFAULT_CANDIDATE_EXPORT_FILE,
  DEFAULT_OPERATOR_OVERRIDES_FILE,
  DEFAULT_PORT,
  DEFAULT_ROLE_FILE,
  LIFECYCLE_STAGES,
  ROLE_CVS_DIR,
  ROLE_DRAFTS_DIR,
  ROLE_INPUTS_DIR,
  ROLE_OUTPUTS_DIR,
  ROLE_RECORDS_DIR,
  WORKFLOW_VERSION,
  buildOutreachDraft,
  buildCandidateExportRows,
  buildSearchPackMarkdown,
  buildDefaultCandidatesTemplate,
  buildMetrics,
  buildMetricsMarkdown,
  exportCandidateReviewsCsv,
  generateSearchPack,
  importPreviewCandidates,
  listRoleIds,
  listRoleIndex,
  listRoles,
  normaliseJobSpecIntake,
  readWorkflowConfig,
  resolveRoleDir,
  runRoleWorkspace,
  scaffoldRoleWorkspace,
  scorePreviewCandidate,
  summariseRoleFromDisk,
  reviewFullCv,
  updateCandidateOperatorState,
};
