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
const DEFAULT_MODEL = 'gpt-5-mini';
const AI_BACKUP_MODEL = 'gpt-4.1-mini';
const MAX_INPUT_CHARS = 32000;
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

function buildRoleHints(jobSpecText) {
  const lines = splitNonEmptyLines(jobSpecText);
  const firstUseful = lines.find((line) => line.length <= 90 && !/^(job spec|job description|overview|summary)$/i.test(line)) || '';
  const titleFromLabel = findLineAfterLabel(jobSpecText, ['Job Title', 'Role', 'Position', 'Title']);
  return trimString(titleFromLabel || firstUseful, 120);
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
  if (trimString(explicitProfile).length > 40) {
    return trimString(toClientReadyVoice(explicitProfile), 1400);
  }

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
  return trimString(toClientReadyVoice(selected), 1400);
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
  const explicit = cleanList(section, 14, 180).filter((line) => !isLikelyTemplateArtifact(line) && !isLikelyRoleTitle(line));
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
  const jobSpecRole = buildRoleHints(jobSpecText);
  const targetRole = trimString(
    formatOptions.targetRoleOverride || jobSpecRole || fileRole || candidateName || fileBaseName(candidateFileName),
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
  const profileRole = trimString(fileRole || rawPosition || inferredRole || targetRole, 140);
  const displayLocation = safeLocation || guessFallbackLocation(candidateText, {
    candidateName,
    role: profileRole,
    anonymiseMode: formatOptions.anonymiseMode,
  });

  return sanitiseStructuredProfile({
    target_role: targetRole,
    sanitized_location: displayLocation,
    interview_availability: safeAvailability,
    languages: collectLanguages(candidateText),
    profile: fallbackProfileParagraph(candidateText, {
      candidateName,
      role: profileRole,
      location: displayLocation,
    }),
    role_alignment: jobSpecText
      ? [
          'Content emphasis has been tuned against the uploaded job specification.',
          'Priority skills and projects have been reordered toward the target brief.',
          'All statements remain grounded in the supplied CV evidence only.',
        ]
      : [],
    relevant_projects: collectRelevantProjects(candidateText, jobSpecText),
    key_skills: collectKeySkills(candidateText),
    qualifications: collectQualifications(candidateText),
    accreditations: collectQualifications(candidateText).filter((line) => /\b(?:ipaf|smsts|ecs|cscs|dbs|edition|certified|certificate|licensed|card)\b/i.test(line)),
    employment_history: collectEmploymentHistory(candidateText),
    additional_information: cleanList(collectHeadingSection(candidateText, ['Additional Information']), 6, 180),
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

function sanitiseOpenAiErrorMessage(message) {
  const text = trimString(message, 240);
  if (!text) return 'OpenAI request failed.';
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
  const message = trimString(result?.error).toLowerCase();
  const status = Number(result?.status) || 0;
  if (!message) return false;
  if (message.includes('authentication failed') || message.includes('key_missing') || status === 401 || status === 403) {
    return false;
  }
  if (message.includes('invalid_json') || message.includes('request_failed')) return true;
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
}) {
  const requestBody = {
    model,
    max_output_tokens: 2400,
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
        name: 'hmj_client_ready_cv',
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
}) {
  const apiKey = trimString(process.env.OPENAI_API_KEY, 240);
  if (!apiKey || /^YOUR_OPENAI_API_KEY$/i.test(apiKey)) {
    return { ok: false, error: 'openai_key_missing' };
  }

  const formatOptions = normaliseFormatOptions(options);
  const requestBody = buildOpenAiRequestBody({
    model,
    candidateFileName,
    candidateText,
    jobSpecText,
    candidateReference,
    formatOptions,
  });

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
        ok: false,
        error: sanitiseOpenAiErrorMessage(payload?.error?.message || payload?.message || `openai_http_${response.status}`),
        status: response.status,
        model,
      };
    }

    const parsed = parseModelJson(extractOutputText(payload));
    if (!parsed) {
      return { ok: false, error: 'openai_invalid_json', model };
    }

    return { ok: true, data: parsed, model };
  } catch (error) {
    return { ok: false, error: sanitiseOpenAiErrorMessage(error?.message || 'openai_request_failed'), model };
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
    return { ok: false, error: 'openai_key_missing', attempts: [] };
  }

  const models = buildOpenAiModelSequence();
  const attempts = [];
  let lastFailure = { ok: false, error: 'openai_request_failed', model: models[0] || DEFAULT_MODEL };

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const result = await requestOpenAiFormatter({
      model,
      candidateFileName,
      candidateText,
      jobSpecText,
      candidateReference,
      options,
      requestFetch,
    });
    attempts.push({
      model,
      ok: !!result.ok,
      status: Number(result.status) || null,
      error: result.ok ? '' : trimString(result.error, 240),
    });
    if (result.ok) {
      return { ...result, attempts };
    }
    lastFailure = result;
    if (!shouldRetryAiAttempt(result)) {
      break;
    }
  }

  return {
    ok: false,
    error: trimString(lastFailure.error || 'openai_request_failed', 240),
    status: Number(lastFailure.status) || null,
    model: trimString(lastFailure.model) || null,
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
  const fileRole = findLineAfterLabel(candidateText, ['Position', 'Role', 'Title']);

  let profile = null;
  let source = 'fallback';
  let model = '';
  let warnings = [];
  let aiAttempts = [];

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
