'use strict';

const CHATBOT_SETTINGS_KEY = 'chatbot_settings';
const DEFAULT_ASSISTANT_NAME = 'Jacob';
const DEFAULT_ASSISTANT_BADGE = 'Live support';
const LEGACY_ASSISTANT_BADGES = new Set([
  'HMJ Assistant',
  'Henley, HMJ Assistant',
]);

const PAGE_TARGET_KEYS = [
  'home',
  'about',
  'jobs',
  'job_detail',
  'candidates',
  'clients',
  'contact',
  'other_public',
];

const TARGET_KEYS = [
  'jobs',
  'candidate_registration',
  'application',
  'client_enquiry',
  'contact',
  'email',
  'phone',
  'whatsapp',
  'custom_url',
];

const DEFAULT_CHATBOT_SETTINGS = {
  enabled: true,
  visibility: {
    routeMode: 'all_public',
    includePatterns: ['/', '/about*', '/jobs*', '/candidates*', '/clients*', '/contact*', '/apply*'],
    excludePatterns: ['/admin*', '/dashboard*', '/preview*'],
    pageTargets: {
      home: true,
      about: true,
      jobs: true,
      job_detail: true,
      candidates: true,
      clients: true,
      contact: true,
      other_public: false,
    },
  },
  launcher: {
    autoOpen: true,
    autoOpenDelayMs: 4500,
    autoHideDelayMs: 18000,
    position: 'right',
    showLabel: true,
    label: 'Chat with HMJ',
    compactLabel: 'Ask HMJ',
    badge: DEFAULT_ASSISTANT_BADGE,
    assistantName: DEFAULT_ASSISTANT_NAME,
  },
  welcome: {
    title: 'HMJ Global support',
    body: 'Ask about jobs, applications, candidate registration, or hiring support.',
    emptyStatePrompt: 'I can help you find roles, apply, register, or contact the HMJ team.',
  },
  tone: {
    tonePreset: 'professional_helpful',
    writingStyle: 'concise_clear_commercial',
    formality: 'medium',
    warmth: 'medium',
    directness: 'high',
    proactivity: 'medium_high',
    ctaCadence: 'strong',
    replyLength: 'short_medium',
    recruitmentFocus: 'high',
    conversionStrength: 'medium_high',
    askFollowUpQuestion: 'single_focused_question',
    fallbackStyle: 'honest_calm_redirect',
    bannedPhrases: [
      'delighted',
      'absolutely',
      'no worries',
      'reach out',
      'touch base',
      'world-class',
      'best-in-class',
      'game-changing',
    ],
    maxReplySentences: 5,
    ukEnglish: true,
    customInstructions: 'Use a professional, friendly HMJ Global tone. Prioritise helping visitors move toward a useful next step quickly. For candidates, focus on relevant job routes, application routes, candidate registration, and clear explanation of requirements where possible. For clients, focus on staffing support, labour supply, recruitment support, and contact routes. Keep answers concise and practical. Ask at most one follow-up question when required. Offer CTA options naturally. Avoid sounding robotic or overexcited. Be especially strong on mission-critical, data centre, life sciences, commercial, and construction hiring contexts. Use UK spelling. Do not invent job details, salary, locations, visa rules, or availability. If unsure, say so briefly and direct the user to the best HMJ route.',
  },
  goals: {
    candidate_registration: 10,
    role_application: 10,
    client_enquiry: 9,
    contact_form: 8,
    human_handoff: 7,
  },
  prompts: {
    baseRole: 'You are the HMJ Global website assistant. Your job is to help public website visitors move quickly to the best next step: finding jobs, applying, registering as a candidate, making a client enquiry, or contacting HMJ.',
    additionalContext: 'HMJ Global is a recruitment and labour supply business supporting sectors such as mission-critical construction, data centres, life sciences, commercial and related project environments. The website serves both candidates and clients. The assistant should reflect a professional, credible, fast-moving recruitment brand.',
    businessGoals: '1. Help candidates find the right route quickly. 2. Encourage job browsing and applications where relevant. 3. Encourage candidate registration where no immediate job match is obvious. 4. Help clients understand HMJ services and drive them to enquiry/contact routes. 5. Reduce friction and confusion. 6. Avoid long answers when a route or CTA is better.',
    routingInstructions: 'When the visitor shows job-seeking intent, prioritise jobs, apply, and candidate pages. When the visitor shows hiring intent, prioritise client and contact routes. When the visitor asks general company questions, answer briefly and offer the most relevant route. Use approved CTAs only. Never send users to admin or hidden routes.',
    safetyConstraints: 'Do not invent facts, jobs, pay rates, sponsorship availability, client names, compliance outcomes, or guarantees. Do not give legal, immigration, or regulated employment advice as fact. Do not claim a live recruiter is immediately available unless confirmed by configured routes/processes. Do not collect sensitive personal data in open chat beyond basic lead-capture intent unless that flow is explicitly enabled. Keep the assistant within HMJ website topics and next steps.',
    pageAwareInstructions: 'Use the current page to keep replies relevant. On jobs pages, bias toward helping with roles and applications. On candidate pages, bias toward registration and candidate support. On client pages, bias toward staffing support and enquiry. On contact/apply pages, be brief and action-oriented.',
    answerStructure: '1. Direct answer in one or two sentences. 2. Best next step. 3. Optional single CTA or single follow-up question.',
    offTopicHandling: 'If a message is unrelated to HMJ website support, respond briefly that you can help with HMJ jobs, applications, candidate registration, hiring support, and contact routes, then offer one relevant option.',
  },
  dataPolicy: {
    includeRoute: true,
    includePageTitle: true,
    includeMetaDescription: true,
    includePageCategory: true,
    includeConversationHistory: true,
    maxHistoryMessages: 10,
    classifyIntent: true,
    injectCtaCatalog: true,
    injectBusinessContext: true,
    injectWebsiteContext: true,
    injectJobsContext: true,
    maxGroundingJobs: 12,
  },
  handoff: {
    candidateRegistrationUrl: '/candidates',
    jobsUrl: '/jobs',
    applicationUrl: '/apply',
    clientEnquiryUrl: '/clients',
    contactUrl: '/contact',
    supportEmail: 'info@hmj-global.com',
    supportPhone: '',
    whatsappUrl: '',
    handoffMessage: 'Prefer to speak with the HMJ team directly? Use the contact route and we’ll point you to the right person.',
    collectLeadInChat: false,
  },
  quickReplies: [
    {
      id: 'find_jobs',
      label: 'Browse jobs',
      description: 'See current HMJ opportunities.',
      placement: 'welcome',
      style: 'primary',
      actionMode: 'navigate',
      target: 'jobs',
      url: '',
      prompt: '',
      visible: true,
    },
    {
      id: 'apply_role',
      label: 'Apply now',
      description: 'Go to the HMJ application route.',
      placement: 'welcome',
      style: 'secondary',
      actionMode: 'navigate',
      target: 'application',
      url: '',
      prompt: '',
      visible: true,
    },
    {
      id: 'register_candidate',
      label: 'Candidate registration',
      description: 'Register your profile or send your CV.',
      placement: 'welcome',
      style: 'secondary',
      actionMode: 'navigate',
      target: 'candidate_registration',
      url: '',
      prompt: '',
      visible: true,
    },
    {
      id: 'hiring_staff',
      label: 'Hiring support',
      description: 'Go to the HMJ client enquiry route.',
      placement: 'welcome',
      style: 'secondary',
      actionMode: 'navigate',
      target: 'client_enquiry',
      url: '',
      prompt: '',
      visible: true,
    },
    {
      id: 'contact_hmj',
      label: 'Contact HMJ',
      description: 'Go straight to the HMJ contact page.',
      placement: 'conversation',
      style: 'ghost',
      actionMode: 'navigate',
      target: 'contact',
      url: '',
      prompt: '',
      visible: true,
    },
    {
      id: 'ask_sectors',
      label: 'What sectors do you cover?',
      description: 'Ask what HMJ supports and the roles covered.',
      placement: 'conversation',
      style: 'ghost',
      actionMode: 'send_prompt',
      target: 'contact',
      url: '',
      prompt: 'What sectors do you support and what types of roles do you usually cover?',
      visible: true,
    },
  ],
  advanced: {
    model: 'gpt-5-mini',
    fallbackModel: 'gpt-4.1-mini',
    temperature: 0.4,
    maxOutputTokens: 450,
    requestTimeoutMs: 18000,
    debugLogging: true,
  },
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function trimString(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function slugify(value) {
  return trimString(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const safe = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(safe)) return true;
    if (['0', 'false', 'no', 'off'].includes(safe)) return false;
  }
  return fallback;
}

function asNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (Number.isFinite(min) && num < min) return min;
  if (Number.isFinite(max) && num > max) return max;
  return num;
}

function asArray(value, maxItems) {
  if (!Array.isArray(value)) return [];
  if (!Number.isInteger(maxItems) || maxItems <= 0) return value.slice();
  return value.slice(0, maxItems);
}

function dedupeStrings(list, maxItems) {
  const out = [];
  asArray(list, maxItems).forEach((entry) => {
    const value = trimString(entry, 120);
    if (value && !out.includes(value)) out.push(value);
  });
  return out;
}

function mergeObjects(baseValue, overrideValue) {
  if (Array.isArray(baseValue)) {
    return Array.isArray(overrideValue) ? overrideValue.slice() : baseValue.slice();
  }
  if (!baseValue || typeof baseValue !== 'object') {
    return overrideValue === undefined ? baseValue : overrideValue;
  }
  const output = {};
  const keys = new Set([
    ...Object.keys(baseValue || {}),
    ...Object.keys((overrideValue && typeof overrideValue === 'object' && !Array.isArray(overrideValue)) ? overrideValue : {}),
  ]);
  keys.forEach((key) => {
    const baseEntry = baseValue ? baseValue[key] : undefined;
    const overrideEntry = overrideValue && typeof overrideValue === 'object' && !Array.isArray(overrideValue)
      ? overrideValue[key]
      : undefined;
    if (
      baseEntry
      && overrideEntry
      && typeof baseEntry === 'object'
      && !Array.isArray(baseEntry)
      && typeof overrideEntry === 'object'
      && !Array.isArray(overrideEntry)
    ) {
      output[key] = mergeObjects(baseEntry, overrideEntry);
      return;
    }
    if (overrideEntry === undefined) {
      output[key] = Array.isArray(baseEntry)
        ? baseEntry.slice()
        : (baseEntry && typeof baseEntry === 'object' ? mergeObjects(baseEntry, undefined) : baseEntry);
      return;
    }
    output[key] = Array.isArray(overrideEntry)
      ? overrideEntry.slice()
      : overrideEntry;
  });
  return output;
}

function resolvePosition(value) {
  const safe = trimString(value, 24);
  if (safe === 'bottom-left') return 'left';
  if (safe === 'bottom-right') return 'right';
  return ['left', 'right'].includes(safe) ? safe : DEFAULT_CHATBOT_SETTINGS.launcher.position;
}

function resolveEnum(value, allowed, fallback) {
  const safe = trimString(value, 40);
  return allowed.includes(safe) ? safe : fallback;
}

function normaliseVisibility(visibility = {}) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.visibility;
  const pageTargets = {};
  const routeMode = trimString(visibility.routeMode, 40) === 'all_public_pages'
    ? 'all_public'
    : resolveEnum(visibility.routeMode, ['all_public', 'selected'], fallback.routeMode);
  const includePatterns = dedupeStrings(visibility.includePatterns, 12);
  const excludePatterns = dedupeStrings(visibility.excludePatterns, 12);
  const isLegacyVisibility = routeMode === 'all_public'
    && !includePatterns.length
    && excludePatterns.length === 2
    && excludePatterns.includes('/admin')
    && excludePatterns.includes('/timesheets');
  PAGE_TARGET_KEYS.forEach((key) => {
    pageTargets[key] = asBoolean(visibility?.pageTargets?.[key], fallback.pageTargets[key]);
  });
  return {
    routeMode,
    includePatterns: isLegacyVisibility ? fallback.includePatterns.slice() : includePatterns,
    excludePatterns: isLegacyVisibility ? fallback.excludePatterns.slice() : excludePatterns,
    pageTargets,
  };
}

function normaliseLauncher(launcher = {}) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.launcher;
  const rawBadge = trimString(launcher.badge, 40);
  const isLegacyBadge = LEGACY_ASSISTANT_BADGES.has(rawBadge);
  const badge = isLegacyBadge
    ? DEFAULT_ASSISTANT_BADGE
    : (rawBadge || fallback.badge);
  const rawAssistantName = trimString(launcher.assistantName, 24);
  const derivedAssistantName = rawAssistantName
    || (isLegacyBadge ? '' : trimString((rawBadge.match(/^([^,]+),\s*HMJ Assistant$/i) || [])[1], 24))
    || fallback.assistantName;
  return {
    autoOpen: asBoolean(launcher.autoOpen, fallback.autoOpen),
    autoOpenDelayMs: asNumber(launcher.autoOpenDelayMs, fallback.autoOpenDelayMs, 0, 10000),
    autoHideDelayMs: asNumber(launcher.autoHideDelayMs, fallback.autoHideDelayMs, 4000, 30000),
    position: resolvePosition(launcher.position),
    showLabel: asBoolean(launcher.showLabel, fallback.showLabel),
    label: trimString(launcher.label, 42) || fallback.label,
    compactLabel: trimString(launcher.compactLabel, 18) || fallback.compactLabel,
    badge,
    assistantName: derivedAssistantName,
  };
}

function normaliseWelcome(welcome = {}) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.welcome;
  return {
    title: trimString(welcome.title, 140) || fallback.title,
    body: trimString(welcome.body, 220) || fallback.body,
    emptyStatePrompt: trimString(welcome.emptyStatePrompt, 140) || fallback.emptyStatePrompt,
  };
}

function normaliseTone(tone = {}) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.tone;
  return {
    tonePreset: resolveEnum(tone.tonePreset, ['professional_helpful', 'professional_friendly', 'direct_consultative', 'warm_supportive', 'confident_recruitment'], fallback.tonePreset),
    writingStyle: resolveEnum(tone.writingStyle, ['concise_clear_commercial', 'concise_guided', 'conversational', 'direct', 'consultative'], fallback.writingStyle),
    formality: resolveEnum(tone.formality, ['low', 'medium', 'high', 'professional', 'neutral', 'relaxed'], fallback.formality),
    warmth: resolveEnum(tone.warmth, ['low', 'medium', 'high', 'friendly', 'balanced', 'matter_of_fact'], fallback.warmth),
    directness: resolveEnum(tone.directness, ['low', 'medium', 'high', 'soft', 'balanced', 'straightforward'], fallback.directness),
    proactivity: resolveEnum(tone.proactivity, ['low', 'balanced', 'medium_high', 'high'], fallback.proactivity),
    ctaCadence: resolveEnum(tone.ctaCadence, ['light', 'balanced', 'frequent', 'strong'], fallback.ctaCadence),
    replyLength: resolveEnum(tone.replyLength, ['short', 'medium', 'short_medium'], fallback.replyLength),
    recruitmentFocus: resolveEnum(tone.recruitmentFocus, ['balanced', 'candidate_first', 'client_first', 'support_first', 'medium', 'high'], fallback.recruitmentFocus),
    conversionStrength: resolveEnum(tone.conversionStrength, ['soft', 'balanced', 'strong', 'medium_high'], fallback.conversionStrength),
    askFollowUpQuestion: resolveEnum(tone.askFollowUpQuestion, ['rarely', 'balanced', 'often', 'single_focused_question'], fallback.askFollowUpQuestion),
    fallbackStyle: resolveEnum(tone.fallbackStyle, ['reassuring_action', 'brief_redirect', 'warm_handoff', 'honest_calm_redirect'], fallback.fallbackStyle),
    bannedPhrases: dedupeStrings(tone.bannedPhrases, 16),
    maxReplySentences: asNumber(tone.maxReplySentences, fallback.maxReplySentences, 1, 6),
    ukEnglish: asBoolean(tone.ukEnglish, fallback.ukEnglish),
    customInstructions: trimString(tone.customInstructions, 1200),
  };
}

function normaliseGoals(goals = {}) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.goals;
  return {
    candidate_registration: asNumber(goals.candidate_registration, fallback.candidate_registration, 1, 10),
    role_application: asNumber(goals.role_application, fallback.role_application, 1, 10),
    client_enquiry: asNumber(goals.client_enquiry, fallback.client_enquiry, 1, 10),
    contact_form: asNumber(goals.contact_form, fallback.contact_form, 1, 10),
    human_handoff: asNumber(goals.human_handoff, fallback.human_handoff, 1, 10),
  };
}

function normalisePrompts(prompts = {}) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.prompts;
  return {
    baseRole: trimString(prompts.baseRole, 1400) || fallback.baseRole,
    additionalContext: trimString(prompts.additionalContext, 1400) || fallback.additionalContext,
    businessGoals: trimString(prompts.businessGoals, 1400) || fallback.businessGoals,
    routingInstructions: trimString(prompts.routingInstructions, 1400) || fallback.routingInstructions,
    safetyConstraints: trimString(prompts.safetyConstraints, 1400) || fallback.safetyConstraints,
    pageAwareInstructions: trimString(prompts.pageAwareInstructions, 1400) || fallback.pageAwareInstructions,
    answerStructure: trimString(prompts.answerStructure, 1400) || fallback.answerStructure,
    offTopicHandling: trimString(prompts.offTopicHandling, 1400) || fallback.offTopicHandling,
  };
}

function normaliseDataPolicy(dataPolicy = {}) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.dataPolicy;
  return {
    includeRoute: asBoolean(dataPolicy.includeRoute, fallback.includeRoute),
    includePageTitle: asBoolean(dataPolicy.includePageTitle, fallback.includePageTitle),
    includeMetaDescription: asBoolean(dataPolicy.includeMetaDescription, fallback.includeMetaDescription),
    includePageCategory: asBoolean(dataPolicy.includePageCategory, fallback.includePageCategory),
    includeConversationHistory: asBoolean(dataPolicy.includeConversationHistory, fallback.includeConversationHistory),
    maxHistoryMessages: asNumber(dataPolicy.maxHistoryMessages, fallback.maxHistoryMessages, 1, 12),
    classifyIntent: asBoolean(dataPolicy.classifyIntent, fallback.classifyIntent),
    injectCtaCatalog: asBoolean(dataPolicy.injectCtaCatalog, fallback.injectCtaCatalog),
    injectBusinessContext: asBoolean(dataPolicy.injectBusinessContext, fallback.injectBusinessContext),
    injectWebsiteContext: asBoolean(dataPolicy.injectWebsiteContext, fallback.injectWebsiteContext),
    injectJobsContext: asBoolean(dataPolicy.injectJobsContext, fallback.injectJobsContext),
    maxGroundingJobs: asNumber(dataPolicy.maxGroundingJobs, fallback.maxGroundingJobs, 1, 12),
  };
}

function normaliseHandoff(handoff = {}) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.handoff;
  return {
    candidateRegistrationUrl: trimString(handoff.candidateRegistrationUrl, 280) || fallback.candidateRegistrationUrl,
    jobsUrl: trimString(handoff.jobsUrl, 280) || fallback.jobsUrl,
    applicationUrl: trimString(handoff.applicationUrl, 280) || fallback.applicationUrl,
    clientEnquiryUrl: trimString(handoff.clientEnquiryUrl, 280) || fallback.clientEnquiryUrl,
    contactUrl: trimString(handoff.contactUrl, 280) || fallback.contactUrl,
    supportEmail: trimString(handoff.supportEmail, 120) || fallback.supportEmail,
    supportPhone: trimString(handoff.supportPhone, 48) || fallback.supportPhone,
    whatsappUrl: trimString(handoff.whatsappUrl, 280) || fallback.whatsappUrl,
    handoffMessage: trimString(handoff.handoffMessage, 280) || fallback.handoffMessage,
    collectLeadInChat: asBoolean(handoff.collectLeadInChat, fallback.collectLeadInChat),
  };
}

function normaliseQuickReply(entry = {}, index = 0) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.quickReplies[Math.min(index, DEFAULT_CHATBOT_SETTINGS.quickReplies.length - 1)]
    || DEFAULT_CHATBOT_SETTINGS.quickReplies[0];
  const label = trimString(entry.label, 48) || fallback.label;
  const id = slugify(entry.id || label || fallback.id || `reply_${index + 1}`) || `reply_${index + 1}`;
  const actionMode = resolveEnum(entry.actionMode || entry.type, ['navigate', 'send_prompt'], fallback.actionMode);
  const rawValue = trimString(entry.value, 320);
  const target = resolveEnum(entry.target, TARGET_KEYS, actionMode === 'navigate' && rawValue ? 'custom_url' : fallback.target);
  const customUrl = trimString(entry.url, 280) || (actionMode === 'navigate' && target === 'custom_url' ? trimString(rawValue, 280) : '');
  return {
    id,
    label,
    description: trimString(entry.description, 120) || fallback.description,
    placement: resolveEnum(entry.placement, ['welcome', 'conversation', 'both'], fallback.placement),
    style: resolveEnum(entry.style, ['primary', 'secondary', 'ghost'], fallback.style),
    actionMode,
    target,
    url: customUrl,
    prompt: trimString(entry.prompt, 320) || (actionMode === 'send_prompt' ? rawValue || label : ''),
    visible: asBoolean(entry.visible, asBoolean(entry.enabled, fallback.visible)),
  };
}

function normaliseQuickReplies(quickReplies) {
  const input = Array.isArray(quickReplies) && quickReplies.length
    ? quickReplies
    : DEFAULT_CHATBOT_SETTINGS.quickReplies;
  const seen = new Set();
  const output = [];
  input.slice(0, 10).forEach((entry, index) => {
    const normalised = normaliseQuickReply(entry, index);
    if (seen.has(normalised.id)) {
      normalised.id = `${normalised.id}_${index + 1}`;
    }
    seen.add(normalised.id);
    output.push(normalised);
  });
  return output;
}

function normaliseAdvanced(advanced = {}) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.advanced;
  return {
    model: trimString(advanced.model, 80) || fallback.model,
    fallbackModel: trimString(advanced.fallbackModel, 80) || fallback.fallbackModel,
    temperature: asNumber(advanced.temperature, fallback.temperature, 0, 2),
    maxOutputTokens: asNumber(advanced.maxOutputTokens, fallback.maxOutputTokens, 120, 1000),
    requestTimeoutMs: asNumber(advanced.requestTimeoutMs, fallback.requestTimeoutMs, 5000, 45000),
    debugLogging: asBoolean(advanced.debugLogging, fallback.debugLogging),
  };
}

function resolveChatbotSettings(rawValue) {
  const merged = mergeObjects(DEFAULT_CHATBOT_SETTINGS, rawValue && typeof rawValue === 'object' ? rawValue : {});
  return {
    enabled: asBoolean(merged.enabled, DEFAULT_CHATBOT_SETTINGS.enabled),
    visibility: normaliseVisibility(merged.visibility),
    launcher: normaliseLauncher(merged.launcher),
    welcome: normaliseWelcome(merged.welcome),
    tone: normaliseTone(merged.tone),
    goals: normaliseGoals(merged.goals),
    prompts: normalisePrompts(merged.prompts),
    dataPolicy: normaliseDataPolicy(merged.dataPolicy),
    handoff: normaliseHandoff(merged.handoff),
    quickReplies: normaliseQuickReplies(merged.quickReplies),
    advanced: normaliseAdvanced(merged.advanced),
  };
}

function resolveHrefForTarget(target, settings, url) {
  const handoff = settings.handoff;
  switch (target) {
    case 'jobs':
      return handoff.jobsUrl;
    case 'candidate_registration':
      return handoff.candidateRegistrationUrl;
    case 'application':
      return handoff.applicationUrl;
    case 'client_enquiry':
      return handoff.clientEnquiryUrl;
    case 'contact':
      return handoff.contactUrl;
    case 'email':
      return handoff.supportEmail ? `mailto:${handoff.supportEmail}` : '';
    case 'phone':
      return handoff.supportPhone
        ? `tel:${handoff.supportPhone.replace(/[^\d+]/g, '')}`
        : '';
    case 'whatsapp':
      return handoff.whatsappUrl;
    case 'custom_url':
      return trimString(url, 280);
    default:
      return '';
  }
}

function buildActionCatalog(settings) {
  return settings.quickReplies
    .filter((entry) => entry.visible)
    .map((entry) => {
      const href = entry.actionMode === 'navigate'
        ? resolveHrefForTarget(entry.target, settings, entry.url)
        : '';
      return {
        id: entry.id,
        label: entry.label,
        description: entry.description,
        placement: entry.placement,
        style: entry.style,
        actionMode: entry.actionMode,
        target: entry.target,
        href,
        prompt: entry.actionMode === 'send_prompt' ? (entry.prompt || entry.label) : '',
      };
    })
    .filter((entry) => entry.actionMode === 'send_prompt' || entry.href);
}

function toPublicChatbotSettings(settings) {
  const resolved = resolveChatbotSettings(settings);
  return {
    enabled: resolved.enabled,
    visibility: resolved.visibility,
    launcher: resolved.launcher,
    welcome: resolved.welcome,
    handoff: {
      supportEmail: resolved.handoff.supportEmail,
      supportPhone: resolved.handoff.supportPhone,
      handoffMessage: resolved.handoff.handoffMessage,
    },
    quickReplies: buildActionCatalog(resolved),
  };
}

module.exports = {
  CHATBOT_SETTINGS_KEY,
  DEFAULT_CHATBOT_SETTINGS,
  PAGE_TARGET_KEYS,
  TARGET_KEYS,
  buildActionCatalog,
  cloneJson,
  resolveChatbotSettings,
  resolveHrefForTarget,
  toPublicChatbotSettings,
};
