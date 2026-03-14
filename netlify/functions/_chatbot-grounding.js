'use strict';

const siteContext = require('./_data/chatbot-site-context.json');
const { buildPublicJobDetailPath, loadStaticJobs } = require('./_jobs-helpers.js');

const VISITOR_TYPES = ['candidate', 'client', 'general'];
const INTENT_OPTIONS = [
  'candidate_job_search',
  'candidate_application_help',
  'candidate_registration',
  'client_hiring_enquiry',
  'client_partnership_enquiry',
  'general_company_question',
  'contact_request',
  'off_topic',
];

const OUTCOME_OPTIONS = [
  'browse_jobs',
  'apply_now',
  'register_candidate',
  'client_enquiry',
  'contact_human',
  'answer_site_question',
  'redirect_off_topic',
];

const REGION_KEYWORDS = [
  'uk',
  'ireland',
  'benelux',
  'nordics',
  'dach',
  'germany',
  'frankfurt',
  'netherlands',
  'eemshaven',
  'london',
  'dublin',
  'sweden',
  'denmark',
  'finland',
];

const TOPIC_KEYWORDS = [
  'data centre',
  'data center',
  'commissioning',
  'electrical',
  'mep',
  'csa',
  'pharma',
  'cleanroom',
  'project controls',
  'substation',
  'power',
  'commercial',
  'qaqc',
  'hse',
  'operations',
];

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function uniqueStrings(list, maxItems) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((entry) => {
    const safe = trimString(entry, 120);
    if (safe && !out.includes(safe)) out.push(safe);
  });
  return Number.isInteger(maxItems) && maxItems > 0 ? out.slice(0, maxItems) : out;
}

function tokenise(text) {
  return uniqueStrings(
    trimString(text, 1600)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((token) => token && token.length > 2),
    80,
  );
}

function hasPhrase(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function classifyVisitorIntent(message, history = [], sessionProfile = {}) {
  const text = trimString(message, 1200).toLowerCase();
  const historyText = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map((entry) => trimString(entry?.text, 400).toLowerCase())
    .join(' ');
  const combined = `${historyText} ${text}`.trim();

  if (!text) return 'general_company_question';

  if (hasPhrase(text, [
    /\b(weather|recipe|football|soccer|stocks|crypto|homework|essay|poem|joke|horoscope|movie|restaurant)\b/,
  ]) && !hasPhrase(text, [/\b(job|role|hire|hmj|candidate|client|cv|apply|staff|project)\b/])) {
    return 'off_topic';
  }

  if (hasPhrase(text, [/\b(partner|partnership|psl|supplier|recruitment partner|delivery partner)\b/])) {
    return 'client_partnership_enquiry';
  }

  if (hasPhrase(text, [/\b(hiring|hire|need staff|need people|find staff|find people|fill roles|recruitment support|share requirement|proposal|project team|brief)\b/])) {
    return 'client_hiring_enquiry';
  }

  if (
    hasPhrase(combined, [
      /\b(what does hmj do|what do you do|who are you|about hmj|where do you recruit|do you recruit for|what sectors|what services)\b/,
    ]) ||
    trimString(sessionProfile?.visitorType, 40) === 'general'
  ) {
    return 'general_company_question';
  }

  if (hasPhrase(text, [/\b(apply|application|interview|notice period|salary|rate|visa|right to work|sponsorship)\b/])) {
    return 'candidate_application_help';
  }

  if (hasPhrase(text, [/\b(register|registration|upload cv|send cv|submit cv|candidate profile|profile)\b/])) {
    return 'candidate_registration';
  }

  if (hasPhrase(text, [/\b(job|jobs|role|roles|vacanc|looking for work|looking for a role|openings|opportunities|commissioning|electrical work)\b/])) {
    return 'candidate_job_search';
  }

  if (hasPhrase(text, [/\b(contact|call|phone|email|whatsapp|speak to someone|talk to someone)\b/])) {
    return 'contact_request';
  }

  return 'general_company_question';
}

function intentToVisitorType(intent, sessionProfile = {}) {
  const safeProfile = trimString(sessionProfile?.visitorType, 40);
  if (safeProfile && VISITOR_TYPES.includes(safeProfile)) return safeProfile;
  if (String(intent).startsWith('candidate_')) return 'candidate';
  if (String(intent).startsWith('client_')) return 'client';
  if (intent === 'contact_request' && safeProfile) return safeProfile;
  return 'general';
}

function extractTopics(message, matchedJobs = [], previousProfile = {}) {
  const text = trimString(message, 1200).toLowerCase();
  const topics = [];
  TOPIC_KEYWORDS.forEach((keyword) => {
    if (text.includes(keyword) && !topics.includes(keyword)) topics.push(keyword);
  });
  matchedJobs.forEach((job) => {
    const jobHints = [job.discipline, job.sectionLabel, job.locationText]
      .map((entry) => trimString(entry, 80))
      .filter(Boolean);
    jobHints.forEach((hint) => {
      const lower = hint.toLowerCase();
      if (!topics.includes(lower)) topics.push(lower);
    });
  });
  (Array.isArray(previousProfile?.topics) ? previousProfile.topics : []).forEach((topic) => {
    const safe = trimString(topic, 80).toLowerCase();
    if (safe && !topics.includes(safe)) topics.push(safe);
  });
  return topics.slice(0, 6);
}

function extractLocations(message, matchedJobs = [], previousProfile = {}) {
  const text = trimString(message, 1200).toLowerCase();
  const locations = [];
  REGION_KEYWORDS.forEach((keyword) => {
    if (text.includes(keyword) && !locations.includes(keyword)) locations.push(keyword);
  });
  matchedJobs.forEach((job) => {
    const safe = trimString(job.locationText, 80);
    if (safe && !locations.includes(safe.toLowerCase())) locations.push(safe.toLowerCase());
  });
  (Array.isArray(previousProfile?.locations) ? previousProfile.locations : []).forEach((location) => {
    const safe = trimString(location, 80).toLowerCase();
    if (safe && !locations.includes(safe)) locations.push(safe);
  });
  return locations.slice(0, 4);
}

function scoreJob(job, tokens, messageLower) {
  const haystack = [
    job.title,
    job.locationText,
    job.overview,
    job.discipline,
    job.sectionLabel,
    job.keywords,
    Array.isArray(job.requirements) ? job.requirements.join(' ') : '',
    Array.isArray(job.responsibilities) ? job.responsibilities.join(' ') : '',
  ].join(' ').toLowerCase();

  let score = 0;
  tokens.forEach((token) => {
    if (haystack.includes(token)) score += token.length > 6 ? 5 : 3;
  });

  if (messageLower.includes('electrical') && haystack.includes('electrical')) score += 8;
  if (messageLower.includes('commissioning') && haystack.includes('commissioning')) score += 8;
  if (messageLower.includes('pharma') && haystack.includes('pharma')) score += 8;
  if (messageLower.includes('data centre') && haystack.includes('data centre')) score += 8;
  if (messageLower.includes('data center') && haystack.includes('data centre')) score += 8;
  if (messageLower.includes('frankfurt') && haystack.includes('frankfurt')) score += 10;
  if (messageLower.includes('germany') && haystack.includes('germany')) score += 6;
  if (messageLower.includes('netherlands') && haystack.includes('netherlands')) score += 6;
  if (job.status === 'live') score += 4;
  if (job.published !== false) score += 2;

  return score;
}

function findRelevantJobs(message, options = {}) {
  const safeMessage = trimString(message, 1200);
  if (!safeMessage) return [];
  const jobs = loadStaticJobs().filter((job) => job && job.published !== false);
  const tokens = tokenise(safeMessage);
  const lower = safeMessage.toLowerCase();
  const limit = Math.max(1, Math.min(Number(options.limit) || 3, 5));

  return jobs
    .map((job) => ({ job, score: scoreJob(job, tokens, lower) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.job);
}

function findRelevantFaqs(message) {
  const lower = trimString(message, 1200).toLowerCase();
  if (!lower) return [];
  return (Array.isArray(siteContext.faqs) ? siteContext.faqs : [])
    .filter((entry) => Array.isArray(entry.keywords) && entry.keywords.some((keyword) => lower.includes(keyword)))
    .slice(0, 2);
}

function getPageContext(pageCategory) {
  const key = trimString(pageCategory, 80) || 'home';
  return siteContext.pages?.[key] || null;
}

function buildConversationProfile(input = {}) {
  const previousProfile = input.previousProfile && typeof input.previousProfile === 'object'
    ? input.previousProfile
    : {};
  const intent = INTENT_OPTIONS.includes(trimString(input.intent, 60))
    ? trimString(input.intent, 60)
    : 'general_company_question';
  const visitorType = intentToVisitorType(intent, previousProfile);
  const matchedJobs = Array.isArray(input.matchedJobs) ? input.matchedJobs : [];
  const topics = extractTopics(input.message, matchedJobs, previousProfile);
  const locations = extractLocations(input.message, matchedJobs, previousProfile);
  const lastCtaIds = uniqueStrings(input.lastCtaIds || previousProfile.lastCtaIds, 5);

  return {
    visitorType,
    currentIntent: intent,
    topics,
    locations,
    lastOutcome: trimString(input.lastOutcome || previousProfile.lastOutcome, 60),
    lastCtaIds,
  };
}

function buildGroundingBundle(options = {}) {
  const context = options.context && typeof options.context === 'object' ? options.context : {};
  const pageContext = getPageContext(context.pageCategory);
  const matchedJobs = options.includeJobs === false
    ? []
    : findRelevantJobs(options.message, { limit: options.maxJobs || 3 });
  const faqs = options.includeWebsiteContext === false ? [] : findRelevantFaqs(options.message);
  const profile = buildConversationProfile({
    previousProfile: options.sessionProfile,
    intent: options.intent,
    message: options.message,
    matchedJobs,
    lastCtaIds: options.lastCtaIds,
    lastOutcome: options.lastOutcome,
  });

  return {
    siteContext,
    pageContext,
    matchedJobs,
    faqs,
    profile,
  };
}

function buildGroundingSummary(bundle = {}) {
  const lines = [];
  const company = bundle.siteContext?.company || {};
  if (company.summary) lines.push(`HMJ summary: ${company.summary}`);
  if (Array.isArray(company.services) && company.services.length) {
    lines.push(`Core services: ${company.services.slice(0, 4).join(' | ')}`);
  }
  if (Array.isArray(company.sectors) && company.sectors.length) {
    lines.push(`Core sectors: ${company.sectors.join(' | ')}`);
  }
  if (Array.isArray(company.regions) && company.regions.length) {
    lines.push(`Regions: ${company.regions.join(' | ')}`);
  }
  if (bundle.pageContext?.summary) {
    lines.push(`Relevant page summary: ${bundle.pageContext.summary}`);
  }
  if (Array.isArray(bundle.faqs) && bundle.faqs.length) {
    lines.push(`Relevant site answers: ${bundle.faqs.map((entry) => `${entry.question}: ${entry.answer}`).join(' | ')}`);
  }
  if (Array.isArray(bundle.matchedJobs) && bundle.matchedJobs.length) {
    lines.push(
      `Relevant live jobs: ${bundle.matchedJobs.map((job) => `${job.title} (${job.locationText}) - ${job.overview}`).join(' | ')}`,
    );
  } else {
    lines.push('Relevant live jobs: No specific live role match found in the bundled jobs data.');
  }
  if (bundle.profile) {
    lines.push(
      `Session profile: visitor_type=${bundle.profile.visitorType}; intent=${bundle.profile.currentIntent}; topics=${(bundle.profile.topics || []).join(', ') || 'none'}; locations=${(bundle.profile.locations || []).join(', ') || 'none'}.`,
    );
  }
  return lines.join('\n');
}

function buildDynamicResourceLinks(bundle = {}, settings = {}) {
  const links = [];
  const handoff = settings.handoff || {};

  (Array.isArray(bundle.matchedJobs) ? bundle.matchedJobs : []).slice(0, 2).forEach((job) => {
    const detailPath = buildPublicJobDetailPath(job);
    const detailHref = detailPath ? `/${detailPath.replace(/^\/+/, '')}` : '';
    if (detailHref) {
      links.push({
        id: `job_${job.id}_detail`,
        label: job.title,
        href: detailHref,
        kind: 'job_detail',
      });
    }
    if (job.applyUrl) {
      links.push({
        id: `job_${job.id}_apply`,
        label: `Apply for ${job.title}`,
        href: job.applyUrl,
        kind: 'apply',
      });
    }
  });

  const visitorType = bundle.profile?.visitorType || 'general';
  if (visitorType === 'candidate') {
    if (handoff.jobsUrl) {
      links.push({ id: 'jobs_page', label: 'Browse live jobs', href: handoff.jobsUrl, kind: 'jobs' });
    }
    if (handoff.candidateRegistrationUrl) {
      links.push({ id: 'candidate_register', label: 'Register your CV', href: handoff.candidateRegistrationUrl, kind: 'register' });
    }
  } else if (visitorType === 'client') {
    if (handoff.clientEnquiryUrl) {
      links.push({ id: 'client_enquiry', label: 'Share your requirement', href: handoff.clientEnquiryUrl, kind: 'client_enquiry' });
    }
    if (handoff.contactUrl) {
      links.push({ id: 'contact_hmj', label: 'Contact HMJ', href: handoff.contactUrl, kind: 'contact' });
    }
  } else if (handoff.contactUrl) {
    links.push({ id: 'contact_hmj', label: 'Contact HMJ', href: handoff.contactUrl, kind: 'contact' });
  }

  const deduped = [];
  const seen = new Set();
  links.forEach((entry) => {
    const key = `${entry.id}:${entry.href}`;
    if (!entry.href || seen.has(key)) return;
    seen.add(key);
    deduped.push(entry);
  });
  return deduped.slice(0, 4);
}

function buildSuggestedPrompts(bundle = {}) {
  const visitorType = bundle.profile?.visitorType || 'general';
  const prompts = [];

  if (visitorType === 'candidate') {
    prompts.push('Show me the most relevant live roles');
    prompts.push('How do I register my CV with HMJ Global?');
    prompts.push('What is the quickest next step for me?');
  } else if (visitorType === 'client') {
    prompts.push('We need help hiring on a project');
    prompts.push('What sectors can HMJ support?');
    prompts.push('How quickly can HMJ review a requirement?');
  } else {
    prompts.push('What does HMJ Global do?');
    prompts.push('Do you recruit for data centre roles?');
    prompts.push('How can I get in touch?');
  }

  return uniqueStrings(prompts, 3);
}

module.exports = {
  INTENT_OPTIONS,
  OUTCOME_OPTIONS,
  VISITOR_TYPES,
  buildConversationProfile,
  buildDynamicResourceLinks,
  buildGroundingBundle,
  buildGroundingSummary,
  buildSuggestedPrompts,
  classifyVisitorIntent,
  intentToVisitorType,
};
