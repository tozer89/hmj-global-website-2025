'use strict';

const CHATBOT_SETTINGS_KEY = 'chatbot_settings';
const DEFAULT_ASSISTANT_BADGE = 'Henley, HMJ Assistant';

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
    includePatterns: [],
    excludePatterns: ['/admin', '/timesheets'],
    pageTargets: {
      home: true,
      about: true,
      jobs: true,
      job_detail: true,
      candidates: true,
      clients: true,
      contact: true,
      other_public: true,
    },
  },
  launcher: {
    autoOpen: true,
    autoOpenDelayMs: 1200,
    autoHideDelayMs: 10000,
    position: 'right',
    showLabel: true,
    label: 'Need help?',
    compactLabel: 'Chat',
    badge: DEFAULT_ASSISTANT_BADGE,
  },
  welcome: {
    title: 'Hi — need help finding a role or getting in touch?',
    body: 'I can point you to jobs, candidate registration, applications, or the right HMJ contact route.',
    emptyStatePrompt: 'Choose an option below or ask a quick question.',
  },
  tone: {
    tonePreset: 'professional_friendly',
    writingStyle: 'concise_guided',
    formality: 'professional',
    warmth: 'friendly',
    directness: 'straightforward',
    proactivity: 'balanced',
    ctaCadence: 'balanced',
    replyLength: 'short',
    recruitmentFocus: 'balanced',
    conversionStrength: 'balanced',
    askFollowUpQuestion: 'balanced',
    fallbackStyle: 'reassuring_action',
    bannedPhrases: [],
    maxReplySentences: 3,
    ukEnglish: true,
    customInstructions: '',
  },
  goals: {
    candidate_registration: 5,
    role_application: 5,
    client_enquiry: 4,
    contact_form: 3,
    human_handoff: 3,
  },
  prompts: {
    baseRole: 'You are the HMJ Global website assistant for a recruitment business serving data centres, critical infrastructure, and pharma projects.',
    additionalContext: 'Help visitors move quickly toward jobs, candidate registration, applications, client enquiries, or a human contact route.',
    businessGoals: 'Prioritise candidate registration, role applications, and client enquiries when intent is clear.',
    routingInstructions: 'Use only approved HMJ routes and CTA ids supplied by the application. Do not invent URLs or offers.',
    safetyConstraints: 'Do not invent roles, rates, sponsorship, legal advice, financial advice, or business details that are not provided. When unsure, route to a human or contact form.',
    pageAwareInstructions: 'Use the current page context briefly when it helps, but do not overstate what is known from the page.',
    answerStructure: 'Default to: direct answer, short supporting detail, recommended next step, and one follow-up question only when it helps move the conversation forward.',
    offTopicHandling: 'If a question is unrelated to HMJ Global, jobs, candidates, clients, hiring or contact routes, politely redirect the visitor back to HMJ-related help.',
  },
  dataPolicy: {
    includeRoute: true,
    includePageTitle: true,
    includeMetaDescription: true,
    includePageCategory: true,
    includeConversationHistory: true,
    maxHistoryMessages: 8,
    classifyIntent: true,
    injectCtaCatalog: true,
    injectBusinessContext: true,
    injectWebsiteContext: true,
    injectJobsContext: true,
    maxGroundingJobs: 3,
  },
  handoff: {
    candidateRegistrationUrl: '/candidates.html#candForm',
    jobsUrl: '/jobs.html',
    applicationUrl: '/contact.html',
    clientEnquiryUrl: '/clients.html#clientEnquiryForm',
    contactUrl: '/contact.html',
    supportEmail: 'info@HMJ-Global.com',
    supportPhone: '0800 861 1230',
    whatsappUrl: 'https://wa.me/447842550187',
    handoffMessage: 'If you would rather speak to the HMJ team directly, I can send you to the best contact route.',
    collectLeadInChat: false,
  },
  quickReplies: [
    {
      id: 'find_jobs',
      label: 'Find jobs',
      description: 'Browse current live HMJ roles.',
      placement: 'welcome',
      style: 'primary',
      actionMode: 'navigate',
      target: 'jobs',
      url: '',
      prompt: '',
      visible: true,
    },
    {
      id: 'register_candidate',
      label: 'Register as candidate',
      description: 'Send your CV and profile.',
      placement: 'welcome',
      style: 'secondary',
      actionMode: 'navigate',
      target: 'candidate_registration',
      url: '',
      prompt: '',
      visible: true,
    },
    {
      id: 'apply_role',
      label: 'Apply for a role',
      description: 'Open the application route.',
      placement: 'welcome',
      style: 'secondary',
      actionMode: 'navigate',
      target: 'application',
      url: '',
      prompt: '',
      visible: true,
    },
    {
      id: 'hiring_staff',
      label: 'Hiring staff',
      description: 'Open the client enquiry route.',
      placement: 'welcome',
      style: 'secondary',
      actionMode: 'navigate',
      target: 'client_enquiry',
      url: '',
      prompt: '',
      visible: true,
    },
    {
      id: 'ask_question',
      label: 'Ask a question',
      description: 'Get a quick answer from Henley, the HMJ assistant.',
      placement: 'welcome',
      style: 'ghost',
      actionMode: 'send_prompt',
      target: 'contact',
      url: '',
      prompt: 'I have a question about HMJ and the roles you recruit for.',
      visible: true,
    },
    {
      id: 'contact_hmj',
      label: 'Contact HMJ',
      description: 'Go straight to the contact page.',
      placement: 'conversation',
      style: 'ghost',
      actionMode: 'navigate',
      target: 'contact',
      url: '',
      prompt: '',
      visible: true,
    },
  ],
  advanced: {
    model: 'gpt-5-mini',
    fallbackModel: 'gpt-4.1-mini',
    temperature: 0.4,
    maxOutputTokens: 280,
    requestTimeoutMs: 15000,
    debugLogging: false,
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
  return ['left', 'right'].includes(trimString(value, 16)) ? trimString(value, 16) : DEFAULT_CHATBOT_SETTINGS.launcher.position;
}

function resolveEnum(value, allowed, fallback) {
  const safe = trimString(value, 40);
  return allowed.includes(safe) ? safe : fallback;
}

function normaliseVisibility(visibility = {}) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.visibility;
  const pageTargets = {};
  PAGE_TARGET_KEYS.forEach((key) => {
    pageTargets[key] = asBoolean(visibility?.pageTargets?.[key], fallback.pageTargets[key]);
  });
  return {
    routeMode: resolveEnum(visibility.routeMode, ['all_public', 'selected'], fallback.routeMode),
    includePatterns: dedupeStrings(visibility.includePatterns, 12),
    excludePatterns: dedupeStrings(visibility.excludePatterns, 12),
    pageTargets,
  };
}

function normaliseLauncher(launcher = {}) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.launcher;
  const rawBadge = trimString(launcher.badge, 32);
  const badge = rawBadge === 'HMJ Assistant'
    ? DEFAULT_ASSISTANT_BADGE
    : (rawBadge || fallback.badge);
  return {
    autoOpen: asBoolean(launcher.autoOpen, fallback.autoOpen),
    autoOpenDelayMs: asNumber(launcher.autoOpenDelayMs, fallback.autoOpenDelayMs, 0, 10000),
    autoHideDelayMs: asNumber(launcher.autoHideDelayMs, fallback.autoHideDelayMs, 4000, 30000),
    position: resolvePosition(launcher.position),
    showLabel: asBoolean(launcher.showLabel, fallback.showLabel),
    label: trimString(launcher.label, 42) || fallback.label,
    compactLabel: trimString(launcher.compactLabel, 18) || fallback.compactLabel,
    badge,
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
    tonePreset: resolveEnum(tone.tonePreset, ['professional_friendly', 'direct_consultative', 'warm_supportive', 'confident_recruitment'], fallback.tonePreset),
    writingStyle: resolveEnum(tone.writingStyle, ['concise_guided', 'conversational', 'direct', 'consultative'], fallback.writingStyle),
    formality: resolveEnum(tone.formality, ['professional', 'neutral', 'relaxed'], fallback.formality),
    warmth: resolveEnum(tone.warmth, ['friendly', 'balanced', 'matter_of_fact'], fallback.warmth),
    directness: resolveEnum(tone.directness, ['soft', 'balanced', 'straightforward'], fallback.directness),
    proactivity: resolveEnum(tone.proactivity, ['low', 'balanced', 'high'], fallback.proactivity),
    ctaCadence: resolveEnum(tone.ctaCadence, ['light', 'balanced', 'frequent'], fallback.ctaCadence),
    replyLength: resolveEnum(tone.replyLength, ['short', 'medium'], fallback.replyLength),
    recruitmentFocus: resolveEnum(tone.recruitmentFocus, ['balanced', 'candidate_first', 'client_first', 'support_first'], fallback.recruitmentFocus),
    conversionStrength: resolveEnum(tone.conversionStrength, ['soft', 'balanced', 'strong'], fallback.conversionStrength),
    askFollowUpQuestion: resolveEnum(tone.askFollowUpQuestion, ['rarely', 'balanced', 'often'], fallback.askFollowUpQuestion),
    fallbackStyle: resolveEnum(tone.fallbackStyle, ['reassuring_action', 'brief_redirect', 'warm_handoff'], fallback.fallbackStyle),
    bannedPhrases: dedupeStrings(tone.bannedPhrases, 16),
    maxReplySentences: asNumber(tone.maxReplySentences, fallback.maxReplySentences, 1, 6),
    ukEnglish: asBoolean(tone.ukEnglish, fallback.ukEnglish),
    customInstructions: trimString(tone.customInstructions, 1200),
  };
}

function normaliseGoals(goals = {}) {
  const fallback = DEFAULT_CHATBOT_SETTINGS.goals;
  return {
    candidate_registration: asNumber(goals.candidate_registration, fallback.candidate_registration, 1, 5),
    role_application: asNumber(goals.role_application, fallback.role_application, 1, 5),
    client_enquiry: asNumber(goals.client_enquiry, fallback.client_enquiry, 1, 5),
    contact_form: asNumber(goals.contact_form, fallback.contact_form, 1, 5),
    human_handoff: asNumber(goals.human_handoff, fallback.human_handoff, 1, 5),
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
    maxGroundingJobs: asNumber(dataPolicy.maxGroundingJobs, fallback.maxGroundingJobs, 1, 5),
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
  const actionMode = resolveEnum(entry.actionMode, ['navigate', 'send_prompt'], fallback.actionMode);
  const target = resolveEnum(entry.target, TARGET_KEYS, fallback.target);
  return {
    id,
    label,
    description: trimString(entry.description, 120) || fallback.description,
    placement: resolveEnum(entry.placement, ['welcome', 'conversation', 'both'], fallback.placement),
    style: resolveEnum(entry.style, ['primary', 'secondary', 'ghost'], fallback.style),
    actionMode,
    target,
    url: trimString(entry.url, 280),
    prompt: trimString(entry.prompt, 320) || (actionMode === 'send_prompt' ? label : ''),
    visible: asBoolean(entry.visible, fallback.visible),
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
