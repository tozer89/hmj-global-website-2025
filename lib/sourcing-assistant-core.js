'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { slugify } = require('../netlify/functions/_jobs-helpers.js');
const candidateMatcherCore = require('./candidate-matcher-core.js');
const { parseYaml } = require('./simple-yaml.js');

const WORKFLOW_VERSION = 1;
const ROLE_INPUTS_DIR = 'inputs';
const ROLE_OUTPUTS_DIR = 'outputs';
const ROLE_RECORDS_DIR = 'records';
const ROLE_DRAFTS_DIR = 'drafts';
const ROLE_CVS_DIR = 'cvs';
const DEFAULT_ROLE_FILE = 'job-spec.yaml';
const DEFAULT_CANDIDATES_FILE = 'candidates.json';
const DEFAULT_PORT = 4287;

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

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeTextFile(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, String(text == null ? '' : text), 'utf8');
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
  return String(value).split(/\r?\n|,|\u2022/);
}

function cleanArray(value, maxItems = 12, maxLength = 160) {
  return uniqueStrings(splitListString(value), maxItems, maxLength);
}

function flattenText(parts) {
  return normaliseWhitespace((Array.isArray(parts) ? parts : [parts]).filter(Boolean).join(' '), 40000);
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

  const shortlistRecommendation = score >= 70
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

function createCandidateReviewRecord({ job, roleDir, candidate, index, previewReview, fullCvReview, outreachDraft, cvInfo }) {
  const now = nowIso();
  const candidateId = buildCandidateIdentifier(candidate, index);
  return {
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
      }
      : {
        downloaded: !!cvInfo?.downloaded,
        cv_file: cvInfo?.relativePath || '',
        review_status: cvInfo?.downloaded ? 'pending' : 'not_downloaded',
      },
    outreach: outreachDraft
      ? {
        ready: true,
        subject: outreachDraft.subject,
        draft_path: relPath(roleDir, cvInfo?.draftPath || ''),
        evidence_points: outreachDraft.evidencePoints,
        questions: outreachDraft.questions,
      }
      : {
        ready: false,
      },
    operator_decision: trimString(candidate.operator_decision, 80) || '',
    audit_notes: trimString(candidate.audit_notes, 800),
    created_at: now,
    updated_at: now,
  };
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
  let profilesOpened = 0;
  let cvsDownloaded = 0;
  let viableOutreachCandidates = 0;
  let operatorOverrides = 0;

  candidateRecords.forEach((record) => {
    const previewClass = trimString(record?.preview_assessment?.finalClassification, 40);
    if (previewCounts[previewClass] !== undefined) previewCounts[previewClass] += 1;
    if (record?.preview?.opened_profile === true) profilesOpened += 1;
    if (record?.preview_assessment?.overrideApplied) operatorOverrides += 1;
    if (record?.full_cv?.downloaded) cvsDownloaded += 1;
    const shortlist = trimString(record?.full_cv?.shortlist_recommendation, 40);
    if (shortlistCounts[shortlist] !== undefined) shortlistCounts[shortlist] += 1;
    if (record?.full_cv?.review_status === 'pending') shortlistCounts.pending += 1;
    if (record?.outreach?.ready) viableOutreachCandidates += 1;
  });

  const profilesReviewed = candidateRecords.length;
  const recommendedToOpen = previewCounts.strong_open + previewCounts.maybe_open;

  return {
    role_id: job.roleId,
    profiles_reviewed: profilesReviewed,
    recommended_to_open: recommendedToOpen,
    profiles_opened: profilesOpened,
    cvs_downloaded: cvsDownloaded,
    viable_outreach_candidates: viableOutreachCandidates,
    preview_counts: previewCounts,
    shortlist_counts: shortlistCounts,
    operator_overrides: operatorOverrides,
    conversion: {
      reviewed_to_open_recommendation: profilesReviewed ? Number((recommendedToOpen / profilesReviewed).toFixed(3)) : 0,
      reviewed_to_cv_download: profilesReviewed ? Number((cvsDownloaded / profilesReviewed).toFixed(3)) : 0,
      reviewed_to_viable_outreach: profilesReviewed ? Number((viableOutreachCandidates / profilesReviewed).toFixed(3)) : 0,
      open_recommendation_to_cv_download: recommendedToOpen ? Number((cvsDownloaded / recommendedToOpen).toFixed(3)) : 0,
      cv_download_to_viable_outreach: cvsDownloaded ? Number((viableOutreachCandidates / cvsDownloaded).toFixed(3)) : 0,
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
    `- Outreach drafts prepared: ${metrics.viable_outreach_candidates}`,
    `- Profiles reviewed per outreach-ready candidate: ${metrics.conversion.manual_profiles_reviewed_per_viable_outreach_candidate ?? 'n/a'}`,
    '',
  ].join('\n');
}

function buildOperatorReviewMarkdown(job, metrics, candidateRecords) {
  const previewRows = candidateRecords.map((record) => ({
    candidate: record.candidate_name || record.current_title || record.candidate_id,
    classification: record.preview_assessment.finalClassification,
    score: record.preview_assessment.totalScore,
    decision: record.full_cv?.shortlist_recommendation || record.operator_decision || '',
    outreach: record.outreach.ready ? 'ready' : 'not ready',
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
    `Manual profiles reviewed per viable outreach candidate: ${metrics.conversion.manual_profiles_reviewed_per_viable_outreach_candidate ?? 'n/a'}`,
    '',
    '## Preview Queue',
    '',
    markdownTable(previewRows, [
      { label: 'Candidate', render: (row) => row.candidate },
      { label: 'Preview Class', render: (row) => row.classification },
      { label: 'Score', render: (row) => String(row.score) },
      { label: 'CV Review', render: (row) => row.decision || 'pending' },
      { label: 'Outreach', render: (row) => row.outreach },
    ]),
    '',
  ].join('\n');
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
        reasons: record.preview_assessment.reasons,
        suggested_download: record.preview_assessment.recommendedCvDownload,
      })),
    },
    candidateReviews: candidateRecords.map((record) => ({
      candidate_id: record.candidate_id,
      candidate_name: record.candidate_name || record.current_title || record.candidate_id,
      shortlist_recommendation: record.full_cv.shortlist_recommendation || '',
      outreach_ready: record.outreach.ready,
      strengths: record.full_cv.strengths || [],
      gaps: record.full_cv.gaps || [],
      follow_up_questions: record.full_cv.follow_up_questions || [],
    })),
    drafts,
    artifacts: {
      intake: `${ROLE_INPUTS_DIR}/${DEFAULT_ROLE_FILE}`,
      candidates: `${ROLE_INPUTS_DIR}/${DEFAULT_CANDIDATES_FILE}`,
      searchPackMarkdown: `${ROLE_OUTPUTS_DIR}/search-pack.md`,
      searchPackJson: `${ROLE_OUTPUTS_DIR}/search-pack.json`,
      previewTriage: `${ROLE_OUTPUTS_DIR}/preview-triage.json`,
      candidateRecords: `${ROLE_OUTPUTS_DIR}/candidate-records.json`,
      metrics: `${ROLE_OUTPUTS_DIR}/metrics.json`,
      metricsSummary: `${ROLE_OUTPUTS_DIR}/metrics-summary.md`,
      operatorReview: `${ROLE_OUTPUTS_DIR}/operator-review.md`,
      dashboardSummary: `${ROLE_OUTPUTS_DIR}/dashboard-summary.json`,
      auditLog: `${ROLE_OUTPUTS_DIR}/audit-log.jsonl`,
    },
  };
}

function readWorkflowConfig(workflowRoot) {
  const configPath = path.join(workflowRoot, 'launcher-config.json');
  const config = readJsonFile(configPath, {}) || {};
  return {
    workflowRoot,
    dashboardPort: Number(config.dashboardPort) || DEFAULT_PORT,
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
  const safeRoleId = slugify(roleId || '').toLowerCase();
  if (!safeRoleId) throw new Error('A role id is required.');
  return path.join(config.rolesDir, safeRoleId);
}

function buildDefaultCandidatesTemplate() {
  return [
    {
      candidate_id: 'cvl-001',
      source: 'CV-Library',
      search_variant: 'medium',
      search_name: '',
      candidate_name: '',
      current_title: '',
      headline: '',
      location: '',
      mobility: '',
      salary_text: '',
      sector_tags: [],
      summary_text: '',
      last_updated: '',
      opened_profile: false,
      cv_file: '',
      preview_notes: '',
      audit_notes: '',
      operator_override: {
        classification: '',
        reason: '',
      },
      operator_decision: '',
    },
  ];
}

function scaffoldRoleWorkspace({ workflowRoot, roleId, roleTitle = '' }) {
  const roleSlug = slugify(roleId || roleTitle || '');
  if (!roleSlug) throw new Error('A role id or role title is required.');
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
    const candidatesTemplatePath = path.join(templatesDir, 'candidate_input_template.json');
    if (fs.existsSync(candidatesTemplatePath)) {
      writeJsonFile(candidatesPath, readJsonFile(candidatesTemplatePath, buildDefaultCandidatesTemplate()));
    } else {
      writeJsonFile(candidatesPath, buildDefaultCandidatesTemplate());
    }
  }

  return {
    roleId: roleSlug,
    roleDir,
    intakePath: intakeTargetPath,
    candidatesPath,
  };
}

function loadJobSpecInput(roleDir) {
  const yamlPath = path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_ROLE_FILE);
  const jsonPath = path.join(roleDir, ROLE_INPUTS_DIR, 'job-spec.json');
  if (fs.existsSync(yamlPath)) return parseYaml(readTextFile(yamlPath));
  if (fs.existsSync(jsonPath)) return readJsonFile(jsonPath, {});
  throw new Error(`No job spec file found in ${path.join(roleDir, ROLE_INPUTS_DIR)}.`);
}

function loadCandidatesInput(roleDir) {
  const candidatesPath = path.join(roleDir, ROLE_INPUTS_DIR, DEFAULT_CANDIDATES_FILE);
  const records = readJsonFile(candidatesPath, []);
  return Array.isArray(records) ? records : [];
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
  const roleDir = resolveRoleDir(workflowRoot, roleId);
  const startedAt = nowIso();
  const jobInput = loadJobSpecInput(roleDir);
  const job = normaliseJobSpecIntake(jobInput);
  const steps = inferActionSteps(action);
  const searchPack = generateSearchPack(job);
  const candidates = loadCandidatesInput(roleDir);
  const candidateRecords = [];
  const auditLogPath = path.join(roleDir, ROLE_OUTPUTS_DIR, 'audit-log.jsonl');

  appendJsonLine(auditLogPath, {
    at: startedAt,
    action: 'role_processed',
    role_id: job.roleId,
    requested_action: action,
  });

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const previewReview = steps.includes('triage')
      ? scorePreviewCandidate(job, candidate)
      : null;
    let fullCvReview = null;
    let outreachDraft = null;
    let cvInfo = null;

    if (steps.includes('full_cv') && (trimString(candidate.cv_file, 500) || trimString(candidate.cv_text, 200))) {
      cvInfo = await extractCvInfo(roleDir, candidate);
      fullCvReview = reviewFullCv(job, candidate, cvInfo.text);
      appendJsonLine(auditLogPath, {
        at: nowIso(),
        action: 'cv_reviewed',
        candidate_id: buildCandidateIdentifier(candidate, index),
        shortlist_recommendation: fullCvReview.shortlistRecommendation,
      });
    }

    if (steps.includes('outreach') && fullCvReview?.outreachReady) {
      outreachDraft = buildOutreachDraft(job, candidate, fullCvReview);
    }

    const record = createCandidateReviewRecord({
      job,
      roleDir,
      candidate,
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
    });

    if (outreachDraft) {
      const draftPath = path.join(roleDir, ROLE_DRAFTS_DIR, `${record.candidate_id}.md`);
      writeTextFile(draftPath, `${outreachDraft.body}\n`);
      record.outreach.draft_path = relPath(roleDir, draftPath);
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

  const metrics = buildMetrics(job, candidateRecords);
  const dashboardSummary = summariseDashboard(job, metrics, searchPack, candidateRecords, roleDir);
  writeJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'search-pack.json'), searchPack);
  writeTextFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'search-pack.md'), `${buildSearchPackMarkdown(job, searchPack)}\n`);
  writeJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'preview-triage.json'), candidateRecords.map((record) => ({
    candidate_id: record.candidate_id,
    candidate_name: record.candidate_name,
    preview_assessment: record.preview_assessment,
  })));
  writeJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'candidate-records.json'), candidateRecords);
  writeJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'metrics.json'), metrics);
  writeTextFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'metrics-summary.md'), `${buildMetricsMarkdown(job, metrics)}\n`);
  writeTextFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'operator-review.md'), `${buildOperatorReviewMarkdown(job, metrics, candidateRecords)}\n`);
  writeJsonFile(path.join(roleDir, ROLE_OUTPUTS_DIR, 'dashboard-summary.json'), dashboardSummary);

  appendJsonLine(auditLogPath, {
    at: nowIso(),
    action: 'metrics_refreshed',
    metrics,
  });

  return dashboardSummary;
}

function summariseRoleFromDisk(workflowRoot, roleId) {
  const roleDir = resolveRoleDir(workflowRoot, roleId);
  const dashboardPath = path.join(roleDir, ROLE_OUTPUTS_DIR, 'dashboard-summary.json');
  const dashboard = readJsonFile(dashboardPath, null);
  if (dashboard) return dashboard;

  const job = normaliseJobSpecIntake(loadJobSpecInput(roleDir));
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
    },
    status: candidates.length ? 'inputs_ready' : 'awaiting_inputs',
  };
}

function listRoles(workflowRoot) {
  return listRoleIds(workflowRoot).map((roleId) => summariseRoleFromDisk(workflowRoot, roleId))
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

module.exports = {
  DEFAULT_CANDIDATES_FILE,
  DEFAULT_PORT,
  DEFAULT_ROLE_FILE,
  ROLE_CVS_DIR,
  ROLE_DRAFTS_DIR,
  ROLE_INPUTS_DIR,
  ROLE_OUTPUTS_DIR,
  ROLE_RECORDS_DIR,
  WORKFLOW_VERSION,
  buildOutreachDraft,
  buildSearchPackMarkdown,
  buildDefaultCandidatesTemplate,
  buildMetrics,
  buildMetricsMarkdown,
  generateSearchPack,
  listRoleIds,
  listRoles,
  normaliseJobSpecIntake,
  readWorkflowConfig,
  resolveRoleDir,
  runRoleWorkspace,
  scaffoldRoleWorkspace,
  scorePreviewCandidate,
  summariseRoleFromDisk,
  reviewFullCv,
};
