(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.HMJChatbot && window.HMJChatbot.__ready) return;

  const CONFIG_ENDPOINT = '/.netlify/functions/chatbot-config';
  const CHAT_ENDPOINT = '/.netlify/functions/chatbot-chat';
  const EVENT_ENDPOINT = '/.netlify/functions/chatbot-event';
  const SESSION_KEY = 'hmj.chatbot.session.v1';
  const MAX_STORED_MESSAGES = 18;
  const MAX_CONVERSATION_ACTIONS = 2;
  const MAX_WELCOME_ACTIONS = 4;
  const DEFAULT_ASSISTANT_NAME = 'Jacob';
  const DEFAULT_ASSISTANT_BADGE = 'Live support';
  const LEGACY_ASSISTANT_BADGES = new Set(['HMJ Assistant', 'Henley, HMJ Assistant']);

  const DEFAULT_CONFIG = {
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
      assistantName: DEFAULT_ASSISTANT_NAME,
      position: 'right',
      showLabel: true,
      label: 'Chat with HMJ',
      compactLabel: 'Ask HMJ',
      badge: DEFAULT_ASSISTANT_BADGE,
    },
    welcome: {
      title: 'HMJ Global support',
      body: 'Ask about jobs, applications, candidate registration, or hiring support.',
      emptyStatePrompt: 'I can help you find roles, apply, register, or contact the HMJ team.',
    },
    handoff: {
      supportEmail: 'info@hmj-global.com',
      supportPhone: '',
      handoffMessage: 'Prefer to speak with the HMJ team directly? Use the contact route and we’ll point you to the right person.',
    },
    quickReplies: [
      { id: 'find_jobs', label: 'Browse jobs', placement: 'welcome', style: 'primary', actionMode: 'navigate', href: '/jobs', prompt: '' },
      { id: 'apply_role', label: 'Apply now', placement: 'welcome', style: 'secondary', actionMode: 'navigate', href: '/apply', prompt: '' },
      { id: 'register_candidate', label: 'Candidate registration', placement: 'welcome', style: 'secondary', actionMode: 'navigate', href: '/candidates', prompt: '' },
      { id: 'hiring_staff', label: 'Hiring support', placement: 'welcome', style: 'secondary', actionMode: 'navigate', href: '/clients', prompt: '' },
      { id: 'contact_hmj', label: 'Contact HMJ', placement: 'conversation', style: 'ghost', actionMode: 'navigate', href: '/contact', prompt: '' },
      { id: 'ask_sectors', label: 'What sectors do you cover?', placement: 'conversation', style: 'ghost', actionMode: 'send_prompt', href: '', prompt: 'What sectors do you support and what types of roles do you usually cover?' },
    ],
  };

  const state = {
    context: null,
    config: null,
    sessionId: '',
    conversationId: '',
    sessionProfile: {},
    messages: [],
    open: false,
    loading: false,
    mounted: false,
    hasAutoOpened: false,
    manualDismissed: false,
    engaged: false,
    unread: false,
    statusText: '',
    statusTone: 'info',
    autoHideTimer: 0,
    autoOpenTimer: 0,
    trackedShownKeys: new Set(),
    elements: {},
  };

  function trimString(value, maxLength) {
    const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
    if (!text) return '';
    if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
    return text.slice(0, maxLength);
  }

  function safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function makeId(prefix) {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${random}`;
  }

  function normaliseSessionProfile(profile) {
    const safe = profile && typeof profile === 'object' ? profile : {};
    return {
      visitorType: trimString(safe.visitorType, 40),
      currentIntent: trimString(safe.currentIntent, 80),
      topics: Array.isArray(safe.topics)
        ? safe.topics.map((entry) => trimString(entry, 80)).filter(Boolean).slice(0, 6)
        : [],
      locations: Array.isArray(safe.locations)
        ? safe.locations.map((entry) => trimString(entry, 80)).filter(Boolean).slice(0, 4)
        : [],
      lastOutcome: trimString(safe.lastOutcome, 80),
      lastCtaIds: Array.isArray(safe.lastCtaIds)
        ? safe.lastCtaIds.map((entry) => trimString(entry, 80)).filter(Boolean).slice(0, 5)
        : [],
    };
  }

  function normaliseResourceLinks(links) {
    const unique = [];
    (Array.isArray(links) ? links : []).forEach((link, index) => {
      const safe = {
        id: trimString(link?.id, 80) || `link_${index + 1}`,
        label: trimString(link?.label, 120),
        href: trimString(link?.href, 280),
        kind: trimString(link?.kind, 40),
      };
      if (!safe.label || !safe.href) return;
      if (unique.some((entry) => entry.id === safe.id || entry.href === safe.href)) return;
      unique.push(safe);
    });
    return unique.slice(0, 2);
  }

  function normaliseSuggestedPrompts(prompts) {
    const unique = [];
    (Array.isArray(prompts) ? prompts : []).forEach((prompt) => {
      const safe = trimString(prompt, 180);
      if (safe && !unique.includes(safe)) unique.push(safe);
    });
    return unique.slice(0, 2);
  }

  function normaliseMessage(message) {
    return {
      id: message.id || makeId(message.role || 'msg'),
      role: message.role || 'assistant',
      text: trimString(message.text, 2400),
      createdAt: message.createdAt || new Date().toISOString(),
      ctaIds: Array.isArray(message.ctaIds) ? message.ctaIds.map((entry) => trimString(entry, 80)).filter(Boolean).slice(0, 5) : [],
      quickReplyIds: Array.isArray(message.quickReplyIds) ? message.quickReplyIds.map((entry) => trimString(entry, 80)).filter(Boolean).slice(0, 5) : [],
      resourceLinks: normaliseResourceLinks(message.resourceLinks),
      suggestedPrompts: normaliseSuggestedPrompts(message.suggestedPrompts),
      followUpQuestion: trimString(message.followUpQuestion, 220),
      visitorType: trimString(message.visitorType, 40),
      outcome: trimString(message.outcome, 80),
      isWelcome: !!message.isWelcome,
    };
  }

  function getAssistantBadge() {
    const badge = trimString(state.config?.launcher?.badge, 40) || DEFAULT_ASSISTANT_BADGE;
    return LEGACY_ASSISTANT_BADGES.has(badge) ? DEFAULT_ASSISTANT_BADGE : badge;
  }

  function getAssistantName() {
    const configured = trimString(state.config?.launcher?.assistantName, 24);
    if (configured) return configured;
    const rawBadge = trimString(state.config?.launcher?.badge, 40);
    if (LEGACY_ASSISTANT_BADGES.has(rawBadge) || rawBadge === DEFAULT_ASSISTANT_BADGE) {
      return DEFAULT_ASSISTANT_NAME;
    }
    const primary = getAssistantBadge().split(',')[0];
    return trimString(primary, 24) || DEFAULT_ASSISTANT_NAME;
  }

  function getAssistantIdentityLabel() {
    return `${getAssistantName()}, HMJ Assistant`;
  }

  function getStoredSession() {
    try {
      const parsed = safeJsonParse(window.sessionStorage.getItem(SESSION_KEY));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function persistSession() {
    try {
      const payload = {
        sessionId: state.sessionId,
        conversationId: state.conversationId,
        sessionProfile: state.sessionProfile,
        messages: state.messages.slice(-MAX_STORED_MESSAGES).map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          createdAt: message.createdAt,
          ctaIds: Array.isArray(message.ctaIds) ? message.ctaIds : [],
          quickReplyIds: Array.isArray(message.quickReplyIds) ? message.quickReplyIds : [],
          resourceLinks: Array.isArray(message.resourceLinks) ? message.resourceLinks : [],
          suggestedPrompts: Array.isArray(message.suggestedPrompts) ? message.suggestedPrompts : [],
          followUpQuestion: message.followUpQuestion || '',
          visitorType: message.visitorType || '',
          outcome: message.outcome || '',
          isWelcome: !!message.isWelcome,
        })),
        hasAutoOpened: !!state.hasAutoOpened,
        manualDismissed: !!state.manualDismissed,
        engaged: !!state.engaged,
        unread: !!state.unread,
      };
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    } catch {}
  }

  function hydrateSession() {
    const stored = getStoredSession();
    state.sessionId = trimString(stored?.sessionId, 120) || (window.crypto?.randomUUID ? window.crypto.randomUUID() : makeId('chat'));
    state.conversationId = trimString(stored?.conversationId, 120);
    state.sessionProfile = normaliseSessionProfile(stored?.sessionProfile);
    state.messages = Array.isArray(stored?.messages)
      ? stored.messages.slice(-MAX_STORED_MESSAGES).map((message) => normaliseMessage(message))
      : [];
    if (!state.sessionProfile.visitorType) {
      const lastAssistant = state.messages.slice().reverse().find((message) => message.role === 'assistant' && !message.isWelcome);
      if (lastAssistant) {
        state.sessionProfile = normaliseSessionProfile({
          visitorType: lastAssistant.visitorType,
          lastOutcome: lastAssistant.outcome,
          lastCtaIds: lastAssistant.ctaIds,
        });
      }
    }
    state.hasAutoOpened = !!stored?.hasAutoOpened;
    state.manualDismissed = !!stored?.manualDismissed;
    state.engaged = !!stored?.engaged;
    state.unread = !!stored?.unread;
  }

  function getContext() {
    const pathname = window.location.pathname || '/';
    const route = pathname === '/' ? '/' : pathname.replace(/\/+$/, '') || '/';
    const body = document.body;
    let pageCategory = 'other_public';

    if (route === '/' || route === '/index.html') pageCategory = 'home';
    else if (route === '/about' || route === '/about.html') pageCategory = 'about';
    else if (route === '/jobs' || route === '/jobs.html') pageCategory = 'jobs';
    else if (/^\/jobs\/.+/.test(route) && route !== '/jobs' && route !== '/jobs.html') pageCategory = 'job_detail';
    else if (route === '/candidates' || route === '/candidates.html') pageCategory = 'candidates';
    else if (route === '/clients' || route === '/clients.html') pageCategory = 'clients';
    else if (route === '/contact' || route === '/contact.html' || route === '/apply') pageCategory = 'contact';

    if (body?.classList.contains('clients-body')) {
      pageCategory = 'clients';
    }

    return {
      route,
      pageCategory,
      pageTitle: trimString(document.title, 200),
      metaDescription: trimString(document.querySelector('meta[name="description"]')?.getAttribute('content') || '', 280),
    };
  }

  function getComposerPlaceholder() {
    if (state.sessionProfile.visitorType === 'candidate') {
      return 'Ask about roles, locations, applications, or registering...';
    }
    if (state.sessionProfile.visitorType === 'client') {
      return 'Ask about hiring support, sectors, or the quickest contact route...';
    }
    return 'Ask about jobs, applying, registration, or contacting HMJ...';
  }

  function escapePattern(value) {
    return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }

  function matchesPattern(route, pattern) {
    const safePattern = trimString(pattern, 180);
    if (!safePattern) return false;
    if (!safePattern.includes('*')) return route.includes(safePattern);
    const regex = new RegExp(`^${safePattern.split('*').map(escapePattern).join('.*')}$`, 'i');
    return regex.test(route);
  }

  function shouldShowForPage(config, context) {
    if (!config?.enabled) return false;
    if (!context?.route || context.route.startsWith('/admin')) return false;

    const visibility = config.visibility || DEFAULT_CONFIG.visibility;
    const pageTargets = visibility.pageTargets || DEFAULT_CONFIG.visibility.pageTargets;
    if (pageTargets[context.pageCategory] === false) return false;

    const excluded = Array.isArray(visibility.excludePatterns)
      && visibility.excludePatterns.some((pattern) => matchesPattern(context.route, pattern));
    if (excluded) return false;

    if (visibility.routeMode === 'selected' && Array.isArray(visibility.includePatterns) && visibility.includePatterns.length) {
      return visibility.includePatterns.some((pattern) => matchesPattern(context.route, pattern));
    }

    return true;
  }

  function trackEvent(eventType, extra = {}, options = {}) {
    if (!eventType) return;
    const payload = {
      eventType,
      sessionId: state.sessionId,
      conversationId: state.conversationId,
      context: state.context,
      visitorType: state.sessionProfile.visitorType || '',
      outcome: state.sessionProfile.lastOutcome || '',
      intent: state.sessionProfile.currentIntent || '',
      ...extra,
    };

    try {
      const body = JSON.stringify(payload);
      if (options.preferBeacon && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(EVENT_ENDPOINT, blob);
        return;
      }
      fetch(EVENT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        keepalive: options.keepalive !== false,
        body,
      }).catch(() => {});
    } catch {}
  }

  function trackShownAction(ctaId, metadata) {
    const safeId = trimString(ctaId, 80);
    if (!safeId) return;
    const key = `${safeId}:${trimString(metadata?.source, 40)}:${state.messages.length}`;
    if (state.trackedShownKeys.has(key)) return;
    state.trackedShownKeys.add(key);
    trackEvent('cta_shown', {
      ctaId: safeId,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
    });
  }

  async function loadConfig() {
    try {
      const response = await fetch(CONFIG_ENDPOINT, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json();
      if (response.ok && payload?.config) return payload.config;
    } catch {}
    return DEFAULT_CONFIG;
  }

  function normaliseConfig(config) {
    const safe = config && typeof config === 'object' ? config : DEFAULT_CONFIG;
    return {
      ...DEFAULT_CONFIG,
      ...safe,
      visibility: { ...DEFAULT_CONFIG.visibility, ...(safe.visibility || {}) },
      launcher: { ...DEFAULT_CONFIG.launcher, ...(safe.launcher || {}) },
      welcome: { ...DEFAULT_CONFIG.welcome, ...(safe.welcome || {}) },
      handoff: { ...DEFAULT_CONFIG.handoff, ...(safe.handoff || {}) },
      quickReplies: Array.isArray(safe.quickReplies) && safe.quickReplies.length ? safe.quickReplies : DEFAULT_CONFIG.quickReplies,
    };
  }

  function ensureWelcomeMessage() {
    if (state.messages.some((message) => message.isWelcome)) return;
    const welcomeText = [state.config.welcome.title, state.config.welcome.body].filter(Boolean).join(' ');
    state.messages.unshift({
      id: 'welcome',
      role: 'assistant',
      text: welcomeText,
      createdAt: new Date().toISOString(),
      isWelcome: true,
      ctaIds: [],
      quickReplyIds: [],
    });
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function buildShell() {
    const root = createElement('div', 'hmj-chatbot');
    root.dataset.open = 'false';
    root.dataset.position = state.config.launcher.position || 'right';
    root.setAttribute('aria-live', 'polite');

    const launcher = createElement('button', 'hmj-chatbot__launcher');
    launcher.type = 'button';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-label', state.config.launcher.label || 'Need help?');

    const launcherIcon = createElement('span', 'hmj-chatbot__launcher-icon');
    launcherIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12c0-4.42 3.58-8 8-8h8v8c0 4.42-3.58 8-8 8H4v-8Z" stroke="currentColor" stroke-width="1.7"/><path d="M9.3 10.1h5.4M9.3 13.9h3.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

    const launcherText = createElement('span', 'hmj-chatbot__launcher-text');
    const launcherLabel = createElement('span', 'hmj-chatbot__launcher-label', state.config.launcher.showLabel ? state.config.launcher.label : state.config.launcher.compactLabel);
    const launcherMeta = createElement('span', 'hmj-chatbot__launcher-meta', getAssistantIdentityLabel());
    launcherText.appendChild(launcherLabel);
    if (state.config.launcher.showLabel) launcherText.appendChild(launcherMeta);
    const launcherDot = createElement('span', 'hmj-chatbot__launcher-dot');

    launcher.appendChild(launcherIcon);
    launcher.appendChild(launcherText);
    launcher.appendChild(launcherDot);

    const panel = createElement('section', 'hmj-chatbot__panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', state.config.launcher.label || 'Website assistant');

    const header = createElement('header', 'hmj-chatbot__header');
    const headerCopy = createElement('div', 'hmj-chatbot__header-copy');
    const badge = createElement('span', 'hmj-chatbot__badge', getAssistantBadge());
    const title = createElement('p', 'hmj-chatbot__title', state.config.welcome.title);
    const subtitle = createElement('p', 'hmj-chatbot__subtitle', state.config.welcome.emptyStatePrompt);
    headerCopy.appendChild(badge);
    headerCopy.appendChild(title);
    headerCopy.appendChild(subtitle);

    const headerActions = createElement('div', 'hmj-chatbot__header-actions');
    const minimise = createElement('button', 'hmj-chatbot__header-btn');
    minimise.type = 'button';
    minimise.setAttribute('aria-label', 'Minimise assistant');
    minimise.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    const close = createElement('button', 'hmj-chatbot__header-btn');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close assistant');
    close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    headerActions.appendChild(minimise);
    headerActions.appendChild(close);
    header.appendChild(headerCopy);
    header.appendChild(headerActions);

    const messages = createElement('div', 'hmj-chatbot__messages');
    messages.setAttribute('role', 'log');

    const actions = createElement('div', 'hmj-chatbot__actions');
    const status = createElement('div', 'hmj-chatbot__status');

    const composer = createElement('div', 'hmj-chatbot__composer');
    const composerShell = createElement('div', 'hmj-chatbot__composer-shell');
    const input = createElement('textarea', 'hmj-chatbot__input');
    input.rows = 1;
    input.placeholder = getComposerPlaceholder();
    input.maxLength = 1200;
    const send = createElement('button', 'hmj-chatbot__send');
    send.type = 'button';
    send.setAttribute('aria-label', 'Send message');
    send.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5 19 5l-3.6 14-4.2-4.2-6.2-2.3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    composerShell.appendChild(input);
    composerShell.appendChild(send);
    composer.appendChild(composerShell);

    panel.appendChild(header);
    panel.appendChild(messages);
    panel.appendChild(actions);
    panel.appendChild(status);
    panel.appendChild(composer);

    root.appendChild(panel);
    root.appendChild(launcher);
    document.body.appendChild(root);

    state.elements = {
      root,
      launcher,
      launcherLabel,
      launcherMeta,
      panel,
      messages,
      actions,
      status,
      input,
      send,
      minimise,
      close,
    };

    launcher.addEventListener('click', () => openPanel(true));
    minimise.addEventListener('click', () => minimisePanel(true));
    close.addEventListener('click', () => minimisePanel(true));
    send.addEventListener('click', () => submitMessage());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitMessage();
      }
    });
    input.addEventListener('input', autoResizeInput);
    input.addEventListener('focus', markEngaged);
  }

  function autoResizeInput() {
    const input = state.elements.input;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  function markEngaged() {
    state.engaged = true;
    clearAutoTimers();
    persistSession();
  }

  function clearAutoTimers() {
    if (state.autoOpenTimer) window.clearTimeout(state.autoOpenTimer);
    if (state.autoHideTimer) window.clearTimeout(state.autoHideTimer);
    state.autoOpenTimer = 0;
    state.autoHideTimer = 0;
  }

  function openPanel(manual) {
    state.open = true;
    state.unread = false;
    state.statusText = '';
    if (manual) {
      state.engaged = true;
      state.manualDismissed = false;
      clearAutoTimers();
    }
    persistSession();
    render();
    trackEvent('widget_open', {
      metadata: {
        source: manual ? 'manual' : 'auto',
      },
    }, { preferBeacon: true });
    getConversationActions().forEach((action) => {
      trackShownAction(action.id, {
        source: state.messages.some((message) => message.role === 'user') ? 'conversation_actions' : 'welcome_actions',
      });
    });
    if (manual) {
      window.setTimeout(() => state.elements.input?.focus(), 60);
    }
  }

  function minimisePanel(manual) {
    state.open = false;
    if (manual) {
      state.manualDismissed = true;
      clearAutoTimers();
    }
    persistSession();
    render();
  }

  function addMessage(message) {
    state.messages.push(normaliseMessage(message));
    state.messages = state.messages.slice(-MAX_STORED_MESSAGES);
    persistSession();
  }

  function getConversationActions() {
    const allActions = Array.isArray(state.config.quickReplies) ? state.config.quickReplies : [];
    const byId = new Map(allActions.map((action) => [action.id, action]));
    const nonWelcomeMessages = state.messages.filter((message) => !message.isWelcome && message.role === 'assistant');
    const latestAssistant = nonWelcomeMessages[nonWelcomeMessages.length - 1];
    const dedupeIds = (list, limit) => {
      const unique = [];
      (Array.isArray(list) ? list : []).forEach((id) => {
        const safe = trimString(id, 80);
        if (!safe || unique.includes(safe)) return;
        unique.push(safe);
      });
      return unique.slice(0, limit);
    };
    const inConversation = state.messages.some((message) => message.role === 'user');
    let actionIds = [];

    if (latestAssistant) {
      actionIds = dedupeIds(
        []
          .concat(Array.isArray(latestAssistant.ctaIds) ? latestAssistant.ctaIds : [])
          .concat(Array.isArray(latestAssistant.quickReplyIds) ? latestAssistant.quickReplyIds : []),
        inConversation ? MAX_CONVERSATION_ACTIONS : MAX_WELCOME_ACTIONS,
      );
    }

    if (!actionIds.length) {
      const placement = inConversation
        ? ['conversation', 'both']
        : ['welcome', 'both'];
      actionIds = dedupeIds(
        allActions
          .filter((action) => placement.includes(action.placement))
          .map((action) => action.id),
        inConversation ? MAX_CONVERSATION_ACTIONS : MAX_WELCOME_ACTIONS,
      );
    }

    return actionIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .slice(0, inConversation ? MAX_CONVERSATION_ACTIONS : MAX_WELCOME_ACTIONS);
  }

  function renderMessages() {
    const host = state.elements.messages;
    host.innerHTML = '';
    const latestAssistant = state.messages.slice().reverse().find((message) => message.role === 'assistant' && !message.isWelcome);

    state.messages.forEach((message) => {
      const wrap = createElement('div', 'hmj-chatbot__message');
      wrap.dataset.role = message.role;
      const bubble = createElement('div', 'hmj-chatbot__bubble');
      const bubbleText = createElement('div', 'hmj-chatbot__bubble-text', message.text);
      bubble.appendChild(bubbleText);
      if (message.role === 'assistant' && message.followUpQuestion) {
        bubble.appendChild(createElement('p', 'hmj-chatbot__followup', message.followUpQuestion));
      }
      const meta = createElement('div', 'hmj-chatbot__meta', message.role === 'assistant' ? getAssistantName() : 'You');
      wrap.appendChild(bubble);

      const isLatestAssistant = !!latestAssistant && latestAssistant.id === message.id;

      if (isLatestAssistant && Array.isArray(message.resourceLinks) && message.resourceLinks.length) {
        const links = createElement('div', 'hmj-chatbot__message-links');
        message.resourceLinks.forEach((link) => {
          const anchor = createElement('a', 'hmj-chatbot__message-link', link.label);
          anchor.href = link.href;
          anchor.target = '_self';
          anchor.rel = 'noopener';
          anchor.addEventListener('click', () => {
            trackEvent('cta_click', {
              ctaId: link.id,
              metadata: {
                source: 'assistant_resource_link',
                label: link.label,
                href: link.href,
                kind: link.kind,
              },
            }, { preferBeacon: true });
          });
          links.appendChild(anchor);
        });
        wrap.appendChild(links);
      }

      if (isLatestAssistant && Array.isArray(message.suggestedPrompts) && message.suggestedPrompts.length) {
        const prompts = createElement('div', 'hmj-chatbot__suggestions');
        message.suggestedPrompts.forEach((prompt) => {
          const button = createElement('button', 'hmj-chatbot__suggestion', prompt);
          button.type = 'button';
          button.addEventListener('click', () => {
            trackEvent('suggested_prompt_click', {
              ctaId: 'suggested_prompt',
              metadata: {
                source: 'assistant_suggested_prompt',
                prompt,
              },
            });
            submitMessage(prompt);
          });
          prompts.appendChild(button);
        });
        wrap.appendChild(prompts);
      }

      wrap.appendChild(meta);
      host.appendChild(wrap);
    });

    if (state.loading) {
      const wrap = createElement('div', 'hmj-chatbot__message');
      wrap.dataset.role = 'assistant';
      const bubble = createElement('div', 'hmj-chatbot__bubble');
      const typing = createElement('div', 'hmj-chatbot__typing');
      typing.appendChild(createElement('span'));
      typing.appendChild(createElement('span'));
      typing.appendChild(createElement('span'));
      bubble.appendChild(typing);
      wrap.appendChild(bubble);
      host.appendChild(wrap);
    }

    host.scrollTop = host.scrollHeight;
  }

  function renderActions() {
    const host = state.elements.actions;
    host.innerHTML = '';
    const actions = getConversationActions();
    actions.forEach((action) => {
      const button = createElement('button', 'hmj-chatbot__action', action.label);
      button.type = 'button';
      button.dataset.style = action.style || 'secondary';
      button.addEventListener('click', () => handleAction(action));
      host.appendChild(button);
    });
  }

  function renderStatus() {
    const status = state.elements.status;
    status.textContent = state.statusText || '';
    status.dataset.tone = state.statusTone || 'info';
  }

  function render() {
    if (!state.mounted) return;
    const root = state.elements.root;
    root.dataset.open = state.open ? 'true' : 'false';
    root.dataset.position = state.config.launcher.position || 'right';
    root.dataset.unread = state.unread ? 'true' : 'false';
    state.elements.launcher.setAttribute('aria-expanded', state.open ? 'true' : 'false');
    state.elements.launcherLabel.textContent = state.config.launcher.showLabel ? state.config.launcher.label : state.config.launcher.compactLabel;
    state.elements.launcherMeta.textContent = state.sessionProfile.visitorType === 'candidate'
      ? 'Jobs, applications & registration'
      : state.sessionProfile.visitorType === 'client'
        ? 'Hiring support & contact'
        : 'HMJ website assistant';
    state.elements.input.placeholder = getComposerPlaceholder();
    state.elements.input.disabled = state.loading;
    state.elements.send.disabled = state.loading;
    renderMessages();
    renderActions();
    renderStatus();
    autoResizeInput();
  }

  function buildHistoryPayload() {
    return state.messages
      .filter((message) => !message.isWelcome)
      .map((message) => ({
        role: message.role,
        text: message.text,
      }))
      .slice(-12);
  }

  async function submitMessage(prefilledText) {
    const input = state.elements.input;
    const text = trimString(prefilledText || input.value, 1200);
    if (!text || state.loading) return;
    if (!navigator.onLine) {
      state.statusText = 'You appear to be offline. You can still use the direct HMJ links below.';
      state.statusTone = 'error';
      render();
      return;
    }

    markEngaged();
    state.loading = true;
    state.statusText = 'Thinking…';
    state.statusTone = 'info';
    const history = buildHistoryPayload();
    if (!prefilledText) input.value = '';
    autoResizeInput();
    addMessage({ role: 'user', text });
    render();

    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          sessionId: state.sessionId,
          message: text,
          history,
          context: state.context,
          sessionProfile: state.sessionProfile,
        }),
      });
      const payload = await response.json();
      const reply = payload?.ok ? payload : payload?.fallback;
      if (!reply || !reply.reply) {
        throw new Error(payload?.message || payload?.error || 'assistant_unavailable');
      }

      state.conversationId = trimString(reply.conversationId || payload?.conversationId, 120) || state.conversationId;
      state.sessionProfile = normaliseSessionProfile(reply.sessionProfile || {
        visitorType: reply.visitorType,
        currentIntent: reply.intent,
        lastOutcome: reply.outcome,
        lastCtaIds: reply.ctaIds,
      });
      addMessage({
        role: 'assistant',
        text: reply.reply,
        ctaIds: reply.ctaIds || [],
        quickReplyIds: reply.quickReplyIds || [],
        resourceLinks: reply.resourceLinks || [],
        suggestedPrompts: reply.suggestedPrompts || [],
        followUpQuestion: reply.followUpQuestion || '',
        visitorType: reply.visitorType || '',
        outcome: reply.outcome || '',
      });
      (Array.isArray(reply.ctaIds) ? reply.ctaIds : []).forEach((ctaId) => {
        trackShownAction(ctaId, { source: 'assistant_cta_ids' });
      });
      (Array.isArray(reply.resourceLinks) ? reply.resourceLinks : []).forEach((link) => {
        trackShownAction(link.id || link.href, {
          source: 'assistant_resource_link',
          label: link.label,
          href: link.href,
          kind: link.kind,
        });
      });
      state.statusText = payload?.ok
        ? ''
        : 'I’m using backup guidance just now, but I can still point you to the right HMJ route.';
      state.statusTone = payload?.ok ? 'info' : 'error';
      if (!state.open) state.unread = true;
    } catch (error) {
      addMessage({
        role: 'assistant',
        text: 'I’m having trouble right now. You can still browse jobs, register as a candidate, or contact HMJ directly using the options below.',
        ctaIds: ['find_jobs', 'register_candidate', 'contact_hmj'],
      });
      state.statusText = 'I’m having trouble connecting just now, but the main HMJ routes are still available below.';
      state.statusTone = 'error';
    } finally {
      state.loading = false;
      persistSession();
      render();
    }
  }

  function handleAction(action) {
    if (!action) return;
    markEngaged();
    trackEvent('cta_click', {
      ctaId: action.id,
      metadata: {
        source: action.actionMode === 'navigate' ? 'action_button_navigate' : 'action_button_prompt',
        href: action.href || '',
        prompt: action.prompt || '',
      },
    }, { preferBeacon: action.actionMode === 'navigate' });
    if (action.actionMode === 'navigate' && action.href) {
      window.location.href = action.href;
      return;
    }
    submitMessage(action.prompt || action.label);
  }

  function scheduleAutoOpen() {
    clearAutoTimers();
    const launcher = state.config.launcher;
    if (!launcher.autoOpen || state.hasAutoOpened || state.manualDismissed || state.engaged) {
      render();
      return;
    }

    state.autoOpenTimer = window.setTimeout(() => {
      state.hasAutoOpened = true;
      openPanel(false);
      state.autoHideTimer = window.setTimeout(() => {
        if (!state.engaged) {
          state.open = false;
          persistSession();
          render();
        }
      }, Number(launcher.autoHideDelayMs) || 10000);
    }, Number(launcher.autoOpenDelayMs) || 1200);
  }

  async function init() {
    hydrateSession();
    state.context = getContext();
    state.config = normaliseConfig(await loadConfig());
    if (!shouldShowForPage(state.config, state.context)) return;

    ensureWelcomeMessage();
    buildShell();
    state.mounted = true;
    render();
    scheduleAutoOpen();

    window.addEventListener('online', () => {
      state.statusText = '';
      state.statusTone = 'info';
      render();
    });
    window.addEventListener('offline', () => {
      state.statusText = 'You appear to be offline.';
      state.statusTone = 'error';
      render();
    });
  }

  window.HMJChatbot = {
    __ready: true,
    open: () => openPanel(true),
    close: () => minimisePanel(true),
    send: (text) => submitMessage(text),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
