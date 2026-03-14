(() => {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const QUICK_REPLY_TARGETS = [
    { value: 'jobs', label: 'Jobs page' },
    { value: 'candidate_registration', label: 'Candidate registration' },
    { value: 'application', label: 'Application route' },
    { value: 'client_enquiry', label: 'Client enquiry' },
    { value: 'contact', label: 'Contact page' },
    { value: 'email', label: 'Email link' },
    { value: 'phone', label: 'Phone link' },
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'custom_url', label: 'Custom URL' },
  ];

  const state = {
    helpers: null,
    settings: null,
    conversations: [],
    detail: null,
    analytics: null,
    currentConversationId: '',
    dirty: false,
    conversationSetupRequired: false,
    analyticsSetupRequired: false,
  };

  const els = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    [
      'welcomeMeta', 'heroEnabledChip', 'heroRouteChip', 'heroStorageChip', 'heroSummary',
      'saveSettingsBtn', 'reloadSettingsBtn', 'testAssistantBtn',
      'storageBanner', 'storageBannerTitle', 'storageBannerBody',
      'metricEnabled', 'metricEnabledLabel', 'metricQuickReplies', 'metricQuickRepliesLabel', 'metricConversations', 'metricConversationsLabel', 'metricHandoffs', 'metricHandoffsLabel',
      'enabled', 'autoOpen', 'showLabel', 'autoOpenDelayMs', 'autoHideDelayMs', 'launcherPosition', 'launcherLabel', 'launcherCompactLabel', 'launcherBadge',
      'welcomeTitle', 'welcomeBody', 'emptyStatePrompt',
      'tonePreset', 'writingStyle', 'formality', 'warmth', 'directness', 'proactivity', 'ctaCadence', 'replyLength', 'conversionStrength', 'recruitmentFocus', 'askFollowUpQuestion', 'fallbackStyle', 'maxReplySentences', 'customInstructions', 'bannedPhrases', 'ukEnglish',
      'goalCandidateRegistration', 'goalRoleApplication', 'goalClientEnquiry', 'goalContactForm', 'goalHumanHandoff',
      'routeMode', 'includePatterns', 'excludePatterns', 'pageTargetHome', 'pageTargetAbout', 'pageTargetJobs', 'pageTargetJobDetail', 'pageTargetCandidates', 'pageTargetClients', 'pageTargetContact', 'pageTargetOtherPublic',
      'candidateRegistrationUrl', 'jobsUrl', 'applicationUrl', 'clientEnquiryUrl', 'contactUrl', 'handoffMessage', 'supportEmail', 'supportPhone', 'whatsappUrl',
      'includeRoute', 'includePageTitle', 'includeMetaDescription', 'includePageCategory', 'includeConversationHistory', 'classifyIntent', 'injectCtaCatalog', 'injectBusinessContext', 'injectWebsiteContext', 'injectJobsContext', 'maxHistoryMessages', 'maxGroundingJobs', 'collectLeadInChat',
      'promptBaseRole', 'promptAdditionalContext', 'promptBusinessGoals', 'promptRoutingInstructions', 'promptSafetyConstraints', 'promptPageAwareInstructions', 'promptAnswerStructure', 'promptOffTopicHandling',
      'quickRepliesList', 'addQuickReplyBtn',
      'model', 'fallbackModel', 'temperature', 'maxOutputTokens', 'requestTimeoutMs', 'debugLogging',
      'previewBadge', 'previewTitle', 'previewBody', 'previewBubble', 'previewActions', 'previewRoute', 'previewCategory', 'previewTitleInput', 'previewMetaDescription', 'testMessage', 'runPreviewTestBtn', 'refreshPreviewBtn', 'testReplyOutput', 'promptPreviewOutput',
      'analyticsSourceChip', 'analyticsBody', 'metricWidgetOpens', 'metricFirstMessages', 'metricUsefulRoutes', 'metricFallbackResponses', 'analyticsIntentList', 'analyticsIntentEmpty', 'analyticsOutcomeList', 'analyticsOutcomeEmpty', 'analyticsCtaList', 'analyticsCtaEmpty',
      'conversationSearch', 'refreshConversationsBtn', 'conversationList', 'conversationEmpty', 'transcriptHeading', 'transcriptSummary', 'transcriptMeta', 'transcriptMessages', 'transcriptEmpty',
    ].forEach((id) => { els[id] = byId(id); });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function trimString(value, maxLength) {
    const text = typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
    if (!text) return '';
    if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
    return text.slice(0, maxLength);
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function setFieldValue(id, value) {
    const element = els[id];
    if (!element) return;
    if (element.type === 'checkbox') {
      element.checked = !!value;
      return;
    }
    element.value = value == null ? '' : String(value);
  }

  function getCheckboxValue(id) {
    return !!els[id]?.checked;
  }

  function getNumberValue(id, fallback) {
    const num = Number(els[id]?.value);
    return Number.isFinite(num) ? num : fallback;
  }

  function getStringValue(id) {
    return trimString(els[id]?.value || '', 2000);
  }

  function markDirty(isDirty = true) {
    state.dirty = isDirty;
    els.saveSettingsBtn.textContent = isDirty ? 'Save changes' : 'Saved';
  }

  function bindDirtyTracking() {
    document.querySelectorAll('#app input, #app select, #app textarea').forEach((field) => {
      field.addEventListener('input', () => {
        markDirty(true);
        refreshPreviewCard();
      });
      field.addEventListener('change', () => {
        markDirty(true);
        refreshPreviewCard();
      });
    });
  }

  function applySettingsToForm(settings) {
    setFieldValue('enabled', settings.enabled);
    setFieldValue('autoOpen', settings.launcher.autoOpen);
    setFieldValue('showLabel', settings.launcher.showLabel);
    setFieldValue('autoOpenDelayMs', settings.launcher.autoOpenDelayMs);
    setFieldValue('autoHideDelayMs', settings.launcher.autoHideDelayMs);
    setFieldValue('launcherPosition', settings.launcher.position);
    setFieldValue('launcherLabel', settings.launcher.label);
    setFieldValue('launcherCompactLabel', settings.launcher.compactLabel);
    setFieldValue('launcherBadge', settings.launcher.badge);

    setFieldValue('welcomeTitle', settings.welcome.title);
    setFieldValue('welcomeBody', settings.welcome.body);
    setFieldValue('emptyStatePrompt', settings.welcome.emptyStatePrompt);

    setFieldValue('tonePreset', settings.tone.tonePreset);
    setFieldValue('writingStyle', settings.tone.writingStyle);
    setFieldValue('formality', settings.tone.formality);
    setFieldValue('warmth', settings.tone.warmth);
    setFieldValue('directness', settings.tone.directness);
    setFieldValue('proactivity', settings.tone.proactivity);
    setFieldValue('ctaCadence', settings.tone.ctaCadence);
    setFieldValue('replyLength', settings.tone.replyLength);
    setFieldValue('conversionStrength', settings.tone.conversionStrength);
    setFieldValue('recruitmentFocus', settings.tone.recruitmentFocus);
    setFieldValue('askFollowUpQuestion', settings.tone.askFollowUpQuestion);
    setFieldValue('fallbackStyle', settings.tone.fallbackStyle);
    setFieldValue('maxReplySentences', settings.tone.maxReplySentences);
    setFieldValue('customInstructions', settings.tone.customInstructions);
    setFieldValue('bannedPhrases', (settings.tone.bannedPhrases || []).join('\n'));
    setFieldValue('ukEnglish', settings.tone.ukEnglish);

    setFieldValue('goalCandidateRegistration', settings.goals.candidate_registration);
    setFieldValue('goalRoleApplication', settings.goals.role_application);
    setFieldValue('goalClientEnquiry', settings.goals.client_enquiry);
    setFieldValue('goalContactForm', settings.goals.contact_form);
    setFieldValue('goalHumanHandoff', settings.goals.human_handoff);

    setFieldValue('routeMode', settings.visibility.routeMode);
    setFieldValue('includePatterns', (settings.visibility.includePatterns || []).join('\n'));
    setFieldValue('excludePatterns', (settings.visibility.excludePatterns || []).join('\n'));
    setFieldValue('pageTargetHome', settings.visibility.pageTargets.home);
    setFieldValue('pageTargetAbout', settings.visibility.pageTargets.about);
    setFieldValue('pageTargetJobs', settings.visibility.pageTargets.jobs);
    setFieldValue('pageTargetJobDetail', settings.visibility.pageTargets.job_detail);
    setFieldValue('pageTargetCandidates', settings.visibility.pageTargets.candidates);
    setFieldValue('pageTargetClients', settings.visibility.pageTargets.clients);
    setFieldValue('pageTargetContact', settings.visibility.pageTargets.contact);
    setFieldValue('pageTargetOtherPublic', settings.visibility.pageTargets.other_public);

    setFieldValue('candidateRegistrationUrl', settings.handoff.candidateRegistrationUrl);
    setFieldValue('jobsUrl', settings.handoff.jobsUrl);
    setFieldValue('applicationUrl', settings.handoff.applicationUrl);
    setFieldValue('clientEnquiryUrl', settings.handoff.clientEnquiryUrl);
    setFieldValue('contactUrl', settings.handoff.contactUrl);
    setFieldValue('handoffMessage', settings.handoff.handoffMessage);
    setFieldValue('supportEmail', settings.handoff.supportEmail);
    setFieldValue('supportPhone', settings.handoff.supportPhone);
    setFieldValue('whatsappUrl', settings.handoff.whatsappUrl);
    setFieldValue('collectLeadInChat', settings.handoff.collectLeadInChat);

    setFieldValue('includeRoute', settings.dataPolicy.includeRoute);
    setFieldValue('includePageTitle', settings.dataPolicy.includePageTitle);
    setFieldValue('includeMetaDescription', settings.dataPolicy.includeMetaDescription);
    setFieldValue('includePageCategory', settings.dataPolicy.includePageCategory);
    setFieldValue('includeConversationHistory', settings.dataPolicy.includeConversationHistory);
    setFieldValue('classifyIntent', settings.dataPolicy.classifyIntent);
    setFieldValue('injectCtaCatalog', settings.dataPolicy.injectCtaCatalog);
    setFieldValue('injectBusinessContext', settings.dataPolicy.injectBusinessContext);
    setFieldValue('injectWebsiteContext', settings.dataPolicy.injectWebsiteContext);
    setFieldValue('injectJobsContext', settings.dataPolicy.injectJobsContext);
    setFieldValue('maxHistoryMessages', settings.dataPolicy.maxHistoryMessages);
    setFieldValue('maxGroundingJobs', settings.dataPolicy.maxGroundingJobs);

    setFieldValue('promptBaseRole', settings.prompts.baseRole);
    setFieldValue('promptAdditionalContext', settings.prompts.additionalContext);
    setFieldValue('promptBusinessGoals', settings.prompts.businessGoals);
    setFieldValue('promptRoutingInstructions', settings.prompts.routingInstructions);
    setFieldValue('promptSafetyConstraints', settings.prompts.safetyConstraints);
    setFieldValue('promptPageAwareInstructions', settings.prompts.pageAwareInstructions);
    setFieldValue('promptAnswerStructure', settings.prompts.answerStructure);
    setFieldValue('promptOffTopicHandling', settings.prompts.offTopicHandling);

    setFieldValue('model', settings.advanced.model);
    setFieldValue('fallbackModel', settings.advanced.fallbackModel);
    setFieldValue('temperature', settings.advanced.temperature);
    setFieldValue('maxOutputTokens', settings.advanced.maxOutputTokens);
    setFieldValue('requestTimeoutMs', settings.advanced.requestTimeoutMs);
    setFieldValue('debugLogging', settings.advanced.debugLogging);

    renderQuickReplies(settings.quickReplies);
    refreshPreviewCard();
    updateHero();
    markDirty(false);
  }

  function splitLines(value) {
    return String(value || '')
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function readQuickRepliesFromDom() {
    const rows = Array.from(els.quickRepliesList.querySelectorAll('[data-quick-reply]'));
    return rows.map((row) => ({
      id: trimString(row.querySelector('[data-key="id"]')?.value || '', 80),
      label: trimString(row.querySelector('[data-key="label"]')?.value || '', 48),
      description: trimString(row.querySelector('[data-key="description"]')?.value || '', 120),
      placement: trimString(row.querySelector('[data-key="placement"]')?.value || '', 40) || 'welcome',
      style: trimString(row.querySelector('[data-key="style"]')?.value || '', 40) || 'secondary',
      actionMode: trimString(row.querySelector('[data-key="actionMode"]')?.value || '', 40) || 'navigate',
      target: trimString(row.querySelector('[data-key="target"]')?.value || '', 40) || 'jobs',
      url: trimString(row.querySelector('[data-key="url"]')?.value || '', 280),
      prompt: trimString(row.querySelector('[data-key="prompt"]')?.value || '', 320),
      visible: !!row.querySelector('[data-key="visible"]')?.checked,
    }));
  }

  function readSettingsFromForm() {
    return {
      enabled: getCheckboxValue('enabled'),
      visibility: {
        routeMode: getStringValue('routeMode') || 'all_public',
        includePatterns: splitLines(els.includePatterns.value),
        excludePatterns: splitLines(els.excludePatterns.value),
        pageTargets: {
          home: getCheckboxValue('pageTargetHome'),
          about: getCheckboxValue('pageTargetAbout'),
          jobs: getCheckboxValue('pageTargetJobs'),
          job_detail: getCheckboxValue('pageTargetJobDetail'),
          candidates: getCheckboxValue('pageTargetCandidates'),
          clients: getCheckboxValue('pageTargetClients'),
          contact: getCheckboxValue('pageTargetContact'),
          other_public: getCheckboxValue('pageTargetOtherPublic'),
        },
      },
      launcher: {
        autoOpen: getCheckboxValue('autoOpen'),
        autoOpenDelayMs: getNumberValue('autoOpenDelayMs', 1200),
        autoHideDelayMs: getNumberValue('autoHideDelayMs', 10000),
        position: getStringValue('launcherPosition') || 'right',
        showLabel: getCheckboxValue('showLabel'),
        label: getStringValue('launcherLabel'),
        compactLabel: getStringValue('launcherCompactLabel'),
        badge: getStringValue('launcherBadge'),
      },
      welcome: {
        title: getStringValue('welcomeTitle'),
        body: getStringValue('welcomeBody'),
        emptyStatePrompt: getStringValue('emptyStatePrompt'),
      },
      tone: {
        tonePreset: getStringValue('tonePreset'),
        writingStyle: getStringValue('writingStyle'),
        formality: getStringValue('formality'),
        warmth: getStringValue('warmth'),
        directness: getStringValue('directness'),
        proactivity: getStringValue('proactivity'),
        ctaCadence: getStringValue('ctaCadence'),
        replyLength: getStringValue('replyLength'),
        conversionStrength: getStringValue('conversionStrength'),
        recruitmentFocus: getStringValue('recruitmentFocus'),
        askFollowUpQuestion: getStringValue('askFollowUpQuestion'),
        fallbackStyle: getStringValue('fallbackStyle'),
        maxReplySentences: getNumberValue('maxReplySentences', 3),
        bannedPhrases: splitLines(els.bannedPhrases.value),
        ukEnglish: getCheckboxValue('ukEnglish'),
        customInstructions: getStringValue('customInstructions'),
      },
      goals: {
        candidate_registration: getNumberValue('goalCandidateRegistration', 5),
        role_application: getNumberValue('goalRoleApplication', 5),
        client_enquiry: getNumberValue('goalClientEnquiry', 4),
        contact_form: getNumberValue('goalContactForm', 3),
        human_handoff: getNumberValue('goalHumanHandoff', 3),
      },
      prompts: {
        baseRole: getStringValue('promptBaseRole'),
        additionalContext: getStringValue('promptAdditionalContext'),
        businessGoals: getStringValue('promptBusinessGoals'),
        routingInstructions: getStringValue('promptRoutingInstructions'),
        safetyConstraints: getStringValue('promptSafetyConstraints'),
        pageAwareInstructions: getStringValue('promptPageAwareInstructions'),
        answerStructure: getStringValue('promptAnswerStructure'),
        offTopicHandling: getStringValue('promptOffTopicHandling'),
      },
      dataPolicy: {
        includeRoute: getCheckboxValue('includeRoute'),
        includePageTitle: getCheckboxValue('includePageTitle'),
        includeMetaDescription: getCheckboxValue('includeMetaDescription'),
        includePageCategory: getCheckboxValue('includePageCategory'),
        includeConversationHistory: getCheckboxValue('includeConversationHistory'),
        maxHistoryMessages: getNumberValue('maxHistoryMessages', 8),
        classifyIntent: getCheckboxValue('classifyIntent'),
        injectCtaCatalog: getCheckboxValue('injectCtaCatalog'),
        injectBusinessContext: getCheckboxValue('injectBusinessContext'),
        injectWebsiteContext: getCheckboxValue('injectWebsiteContext'),
        injectJobsContext: getCheckboxValue('injectJobsContext'),
        maxGroundingJobs: getNumberValue('maxGroundingJobs', 3),
      },
      handoff: {
        candidateRegistrationUrl: getStringValue('candidateRegistrationUrl'),
        jobsUrl: getStringValue('jobsUrl'),
        applicationUrl: getStringValue('applicationUrl'),
        clientEnquiryUrl: getStringValue('clientEnquiryUrl'),
        contactUrl: getStringValue('contactUrl'),
        supportEmail: getStringValue('supportEmail'),
        supportPhone: getStringValue('supportPhone'),
        whatsappUrl: getStringValue('whatsappUrl'),
        handoffMessage: getStringValue('handoffMessage'),
        collectLeadInChat: getCheckboxValue('collectLeadInChat'),
      },
      quickReplies: readQuickRepliesFromDom(),
      advanced: {
        model: getStringValue('model'),
        fallbackModel: getStringValue('fallbackModel'),
        temperature: getNumberValue('temperature', 0.4),
        maxOutputTokens: getNumberValue('maxOutputTokens', 280),
        requestTimeoutMs: getNumberValue('requestTimeoutMs', 15000),
        debugLogging: getCheckboxValue('debugLogging'),
      },
    };
  }

  function newQuickReply() {
    return {
      id: `reply_${Date.now().toString(36)}`,
      label: 'New action',
      description: 'Describe the action briefly.',
      placement: 'conversation',
      style: 'secondary',
      actionMode: 'navigate',
      target: 'contact',
      url: '',
      prompt: '',
      visible: true,
    };
  }

  function quickReplyMarkup(reply, index) {
    const targetOptions = QUICK_REPLY_TARGETS.map((option) => (
      `<option value="${escapeHtml(option.value)}"${reply.target === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`
    )).join('');

    return `
      <article class="quick-reply-card" data-quick-reply="${index}">
        <div class="quick-reply-card__top">
          <div class="quick-reply-card__title">
            <strong>${escapeHtml(reply.label || `Quick reply ${index + 1}`)}</strong>
            <span class="muted">Order ${index + 1}</span>
          </div>
          <div class="quick-reply-actions">
            <button class="btn soft small" type="button" data-move="up">Move up</button>
            <button class="btn soft small" type="button" data-move="down">Move down</button>
            <button class="btn soft small" type="button" data-remove="1">Remove</button>
          </div>
        </div>
        <div class="field-grid">
          <div class="field">
            <label>Internal id</label>
            <input data-key="id" type="text" value="${escapeHtml(reply.id || '')}">
          </div>
          <div class="field">
            <label>Label</label>
            <input data-key="label" type="text" value="${escapeHtml(reply.label || '')}">
          </div>
          <div class="field field--wide">
            <label>Description</label>
            <input data-key="description" type="text" value="${escapeHtml(reply.description || '')}">
          </div>
          <div class="field">
            <label>Placement</label>
            <select data-key="placement">
              <option value="welcome"${reply.placement === 'welcome' ? ' selected' : ''}>Welcome only</option>
              <option value="conversation"${reply.placement === 'conversation' ? ' selected' : ''}>Conversation only</option>
              <option value="both"${reply.placement === 'both' ? ' selected' : ''}>Both</option>
            </select>
          </div>
          <div class="field">
            <label>Style</label>
            <select data-key="style">
              <option value="primary"${reply.style === 'primary' ? ' selected' : ''}>Primary</option>
              <option value="secondary"${reply.style === 'secondary' ? ' selected' : ''}>Secondary</option>
              <option value="ghost"${reply.style === 'ghost' ? ' selected' : ''}>Ghost</option>
            </select>
          </div>
          <div class="field">
            <label>Action mode</label>
            <select data-key="actionMode">
              <option value="navigate"${reply.actionMode === 'navigate' ? ' selected' : ''}>Navigate to route</option>
              <option value="send_prompt"${reply.actionMode === 'send_prompt' ? ' selected' : ''}>Send prompt into chat</option>
            </select>
          </div>
          <div class="field">
            <label>Target</label>
            <select data-key="target">${targetOptions}</select>
          </div>
          <div class="field field--wide">
            <label>Custom URL</label>
            <input data-key="url" type="text" value="${escapeHtml(reply.url || '')}" placeholder="Only used when target is Custom URL">
          </div>
          <div class="field field--wide">
            <label>Prompt text</label>
            <input data-key="prompt" type="text" value="${escapeHtml(reply.prompt || '')}" placeholder="Used when action mode is Send prompt">
          </div>
          <label class="checkline" style="grid-column:1/-1"><input data-key="visible" type="checkbox"${reply.visible ? ' checked' : ''}> Show this action to visitors</label>
        </div>
      </article>
    `;
  }

  function renderQuickReplies(replies) {
    const safeReplies = Array.isArray(replies) && replies.length ? replies : [newQuickReply()];
    els.quickRepliesList.innerHTML = safeReplies.map((reply, index) => quickReplyMarkup(reply, index)).join('');

    els.quickRepliesList.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.closest('[data-quick-reply]')?.dataset.quickReply || 0);
        const next = readQuickRepliesFromDom().filter((_, rowIndex) => rowIndex !== index);
        renderQuickReplies(next.length ? next : [newQuickReply()]);
        markDirty(true);
        refreshPreviewCard();
      });
    });

    els.quickRepliesList.querySelectorAll('[data-move]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.closest('[data-quick-reply]')?.dataset.quickReply || 0);
        const direction = button.dataset.move === 'up' ? -1 : 1;
        const rows = readQuickRepliesFromDom();
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= rows.length) return;
        const [row] = rows.splice(index, 1);
        rows.splice(targetIndex, 0, row);
        renderQuickReplies(rows);
        markDirty(true);
        refreshPreviewCard();
      });
    });

    els.quickRepliesList.querySelectorAll('input, select').forEach((field) => {
      field.addEventListener('input', () => {
        markDirty(true);
        refreshPreviewCard();
      });
      field.addEventListener('change', () => {
        markDirty(true);
        refreshPreviewCard();
      });
    });
  }

  function refreshPreviewCard() {
    const settings = readSettingsFromForm();
    els.previewBadge.textContent = settings.launcher.badge || 'HMJ Assistant';
    els.previewTitle.textContent = settings.welcome.title || 'Welcome title';
    els.previewBody.textContent = settings.welcome.body || 'Welcome support copy';
    els.previewBubble.textContent = [settings.welcome.title, settings.welcome.body].filter(Boolean).join(' ') || 'Welcome message preview';
    const actions = (settings.quickReplies || []).filter((reply) => reply.visible).slice(0, 5);
    els.previewActions.innerHTML = actions.map((reply) => `<span class="preview-card__chip">${escapeHtml(reply.label || 'Action')}</span>`).join('');
    updateHero();
  }

  function updateHero() {
    const settings = readSettingsFromForm();
    els.heroEnabledChip.textContent = settings.enabled ? 'Assistant live' : 'Assistant hidden';
    els.heroEnabledChip.dataset.tone = settings.enabled ? 'ok' : 'warn';
    els.heroRouteChip.textContent = settings.visibility.routeMode === 'selected' ? 'Selected routes only' : 'All public routes';
    els.heroRouteChip.dataset.tone = 'info';
    els.heroStorageChip.textContent = (state.conversationSetupRequired || state.analyticsSetupRequired)
      ? 'History & analytics need SQL'
      : 'History & analytics ready';
    els.heroStorageChip.dataset.tone = (state.conversationSetupRequired || state.analyticsSetupRequired) ? 'warn' : 'ok';
    els.heroSummary.textContent = settings.enabled
      ? 'The live site widget can auto-open once, collapse after inactivity, stay grounded in HMJ content, and use these admin-managed settings immediately after save.'
      : 'The widget is currently disabled for public visitors, but you can still edit copy, prompt logic, and preview behaviour here.';
    els.metricEnabled.textContent = settings.enabled ? 'On' : 'Off';
    els.metricEnabledLabel.textContent = settings.enabled ? 'Public widget enabled' : 'Public widget disabled';
    els.metricQuickReplies.textContent = String((settings.quickReplies || []).filter((reply) => reply.visible).length);
  }

  function updateConversationMetrics() {
    els.metricConversations.textContent = String(state.conversations.length);
    const handoffs = state.conversations.reduce((total, row) => total + Number(row.handoff_count || 0), 0);
    els.metricHandoffs.textContent = String(handoffs);
    els.metricConversationsLabel.textContent = state.conversationSetupRequired
      ? 'Run the SQL setup to enable storage'
      : 'Stored visitor sessions';
  }

  function renderAnalyticsTags(host, empty, items, suffix = '') {
    const safeItems = Array.isArray(items) ? items : [];
    host.innerHTML = safeItems.map((item) => (
      `<span class="chip">${escapeHtml(item.label || 'Unknown')}${suffix}${Number(item.count || 0)}</span>`
    )).join('');
    empty.hidden = safeItems.length > 0;
  }

  function updateAnalyticsSummary() {
    const summary = state.analytics?.summary || {};
    els.metricWidgetOpens.textContent = String(summary.widgetOpens || 0);
    els.metricFirstMessages.textContent = String(summary.firstMessages || 0);
    els.metricUsefulRoutes.textContent = String(summary.usefulRoutes || 0);
    els.metricFallbackResponses.textContent = String(summary.fallbackResponses || 0);
    els.analyticsSourceChip.textContent = state.analyticsSetupRequired
      ? 'SQL setup needed'
      : state.analytics?.source === 'supabase'
        ? 'Live analytics'
        : 'Analytics unavailable';
    els.analyticsSourceChip.dataset.tone = state.analyticsSetupRequired
      ? 'warn'
      : state.analytics?.source === 'supabase'
        ? 'ok'
        : 'info';
    els.analyticsBody.textContent = state.analyticsSetupRequired
      ? 'Run the chatbot SQL setup to store opens, CTA activity, routing outcomes, and fallback behaviour for reporting.'
      : 'Tracking widget opens, first messages, routing outcomes, CTA interactions, and fallback usage so the assistant can be tuned over time.';
    renderAnalyticsTags(els.analyticsIntentList, els.analyticsIntentEmpty, summary.topIntents, ' · ');
    renderAnalyticsTags(els.analyticsOutcomeList, els.analyticsOutcomeEmpty, summary.topOutcomes, ' · ');
    renderAnalyticsTags(els.analyticsCtaList, els.analyticsCtaEmpty, summary.topCtas, ' · ');
  }

  async function loadSettings() {
    const response = await state.helpers.api('admin-settings-get', 'POST', { keys: ['chatbot_settings'] });
    state.settings = cloneJson(response?.settings?.chatbot_settings || {});
    applySettingsToForm(state.settings);
  }

  async function saveSettings() {
    const settings = readSettingsFromForm();
    await state.helpers.api('admin-settings-save', 'POST', {
      chatbot_settings: settings,
    });
    state.settings = cloneJson(settings);
    markDirty(false);
    state.helpers.toast('Website assistant settings saved', 'info', 2200);
  }

  async function runPreviewTest() {
    const settings = readSettingsFromForm();
    const context = {
      route: getStringValue('previewRoute') || '/index.html',
      pageCategory: getStringValue('previewCategory') || 'home',
      pageTitle: getStringValue('previewTitleInput') || 'HMJ Global',
      metaDescription: getStringValue('previewMetaDescription'),
    };
    els.testReplyOutput.textContent = 'Running preview…';
    els.promptPreviewOutput.textContent = 'Building prompt…';
    try {
      const response = await state.helpers.api('admin-chatbot-preview', 'POST', {
        settings,
        message: getStringValue('testMessage') || 'I am looking for work and need help.',
        context,
      });
      els.testReplyOutput.textContent = [
        response.reply || 'No reply returned.',
        '',
        `Intent: ${response.intent || 'n/a'}`,
        `Visitor type: ${response.visitorType || 'n/a'}`,
        `Outcome: ${response.outcome || 'n/a'}`,
        `Confidence: ${response.answerConfidence || 'n/a'}`,
        response.followUpQuestion ? `Follow-up: ${response.followUpQuestion}` : '',
        Array.isArray(response.suggestedPrompts) && response.suggestedPrompts.length
          ? `Suggested prompts: ${response.suggestedPrompts.join(' | ')}`
          : '',
        Array.isArray(response.resourceLinks) && response.resourceLinks.length
          ? `Links: ${response.resourceLinks.map((link) => `${link.label} -> ${link.href}`).join(' | ')}`
          : '',
      ].filter(Boolean).join('\n');
      els.promptPreviewOutput.textContent = response.promptPreview || 'No prompt preview returned.';
      state.helpers.toast('Preview reply generated', 'info', 1800);
    } catch (error) {
      const fallback = error?.details?.fallback;
      els.testReplyOutput.textContent = [
        fallback?.reply || error.message || 'Preview failed.',
        fallback?.intent ? `Intent: ${fallback.intent}` : '',
        fallback?.visitorType ? `Visitor type: ${fallback.visitorType}` : '',
        fallback?.outcome ? `Outcome: ${fallback.outcome}` : '',
      ].filter(Boolean).join('\n');
      els.promptPreviewOutput.textContent = error?.details?.promptPreview || 'Preview prompt unavailable.';
      state.helpers.toast('Preview failed: ' + (error.message || error), 'warn', 2800);
    }
  }

  async function loadAnalytics() {
    const response = await state.helpers.api('admin-chatbot-analytics', 'POST', { limit: 1200 });
    state.analytics = response;
    state.analyticsSetupRequired = !!response.setupRequired;
    updateAnalyticsSummary();
    updateHero();
  }

  function renderConversationList() {
    if (!state.conversations.length) {
      els.conversationList.innerHTML = '';
      els.conversationEmpty.hidden = false;
      return;
    }
    els.conversationEmpty.hidden = true;
    els.conversationList.innerHTML = state.conversations.map((row) => `
      <article class="conversation-card${row.id === state.currentConversationId ? ' is-active' : ''}" data-conversation-id="${escapeHtml(row.id)}">
        <div class="conversation-card__head">
          <strong>${escapeHtml(row.latest_page_title || row.latest_route || 'Website visitor')}</strong>
          <span class="chip"${Number(row.handoff_count || 0) ? ' data-tone="ok"' : ''}>${Number(row.handoff_count || 0) ? `${row.handoff_count} handoff` : 'Chat only'}</span>
        </div>
        <p class="conversation-card__preview">${escapeHtml(row.last_message_preview || 'No assistant preview yet.')}</p>
        <p class="conversation-card__meta">${escapeHtml(row.latest_route || 'Unknown route')} · ${Number(row.message_count || 0)} messages · ${escapeHtml(new Date(row.updated_at || row.created_at || Date.now()).toLocaleString())}</p>
      </article>
    `).join('');

    els.conversationList.querySelectorAll('[data-conversation-id]').forEach((card) => {
      card.addEventListener('click', () => loadConversationDetail(card.dataset.conversationId));
    });
  }

  function renderConversationDetail() {
    const detail = state.detail;
    if (!detail?.conversation) {
      els.transcriptEmpty.hidden = false;
      els.transcriptMessages.innerHTML = '';
      els.transcriptHeading.textContent = 'Select a conversation';
      els.transcriptSummary.textContent = 'The message transcript and context will appear here.';
      els.transcriptMeta.innerHTML = '';
      return;
    }

    const metadata = detail.conversation.metadata && typeof detail.conversation.metadata === 'object'
      ? detail.conversation.metadata
      : {};
    els.transcriptEmpty.hidden = true;
    els.transcriptHeading.textContent = detail.conversation.latest_page_title || detail.conversation.latest_route || 'Website visitor';
    els.transcriptSummary.textContent = `${detail.conversation.latest_route || 'Unknown route'} · ${Number(detail.conversation.message_count || 0)} messages · latest intent: ${detail.conversation.latest_intent || 'n/a'}`;
    els.transcriptMeta.innerHTML = `
      <span class="chip">${escapeHtml(detail.conversation.page_category || 'unknown')}</span>
      <span class="chip"${Number(detail.conversation.handoff_count || 0) ? ' data-tone="ok"' : ''}>${Number(detail.conversation.handoff_count || 0)} handoff</span>
      ${metadata.visitor_type ? `<span class="chip" data-tone="info">${escapeHtml(metadata.visitor_type)}</span>` : ''}
      ${metadata.outcome ? `<span class="chip" data-tone="ok">${escapeHtml(metadata.outcome)}</span>` : ''}
      <span class="chip">${escapeHtml(detail.conversation.session_id || 'no session id')}</span>
    `;

    els.transcriptMessages.innerHTML = (detail.messages || []).map((message) => `
      <article class="transcript-message" data-role="${escapeHtml(message.role || 'assistant')}">
        <div class="transcript-bubble">${escapeHtml(message.content || '')}</div>
        <div class="transcript-meta-line">${escapeHtml(message.role || 'assistant')} · ${escapeHtml(new Date(message.created_at || Date.now()).toLocaleString())}${message.model ? ` · ${escapeHtml(message.model)}` : ''}${message.intent ? ` · ${escapeHtml(message.intent)}` : ''}</div>
      </article>
    `).join('');
  }

  async function loadConversations() {
    const response = await state.helpers.api('admin-chatbot-conversations', 'POST', {
      search: getStringValue('conversationSearch'),
      limit: 60,
    });
    state.conversations = Array.isArray(response.conversations) ? response.conversations : [];
    state.conversationSetupRequired = !!response.setupRequired;

    if (state.conversationSetupRequired || state.analyticsSetupRequired) {
      els.storageBanner.hidden = false;
      els.storageBanner.style.display = 'grid';
      els.storageBanner.dataset.tone = 'warn';
      els.storageBannerTitle.textContent = 'Chatbot storage still needs SQL setup';
      els.storageBannerBody.textContent = 'Apply the Supabase SQL for the chatbot module, then refresh this page to start viewing stored visitor transcripts and analytics.';
    } else {
      els.storageBanner.hidden = true;
      els.storageBanner.style.display = 'none';
    }

    renderConversationList();
    updateConversationMetrics();
    updateHero();
  }

  async function loadConversationDetail(id) {
    state.currentConversationId = id;
    renderConversationList();
    const detail = await state.helpers.api('admin-chatbot-conversations', 'POST', { conversationId: id });
    state.detail = detail;
    renderConversationDetail();
  }

  function bindQuickReplyControls() {
    els.addQuickReplyBtn.addEventListener('click', () => {
      const next = readQuickRepliesFromDom();
      next.push(newQuickReply());
      renderQuickReplies(next);
      markDirty(true);
      refreshPreviewCard();
    });
  }

  function bindActions() {
    els.saveSettingsBtn.addEventListener('click', async () => {
      try {
        await saveSettings();
      } catch (error) {
        state.helpers.toast('Save failed: ' + (error.message || error), 'error', 3200);
      }
    });

    els.reloadSettingsBtn.addEventListener('click', async () => {
      try {
        await loadSettings();
        await loadAnalytics();
        await loadConversations();
        state.helpers.toast('Reloaded stored assistant settings', 'info', 2000);
      } catch (error) {
        state.helpers.toast('Reload failed: ' + (error.message || error), 'error', 3200);
      }
    });

    els.testAssistantBtn.addEventListener('click', () => runPreviewTest());
    els.runPreviewTestBtn.addEventListener('click', () => runPreviewTest());
    els.refreshPreviewBtn.addEventListener('click', () => refreshPreviewCard());
    els.refreshConversationsBtn.addEventListener('click', async () => {
      await loadAnalytics();
      await loadConversations();
    });
    els.conversationSearch.addEventListener('input', () => loadConversations());
  }

  function initPage(helpers, who) {
    state.helpers = helpers;
    cacheElements();
    els.welcomeMeta.textContent = `Signed in as ${who.email || 'admin user'}`;
    bindDirtyTracking();
    bindQuickReplyControls();
    bindActions();

    loadSettings()
      .then(() => Promise.all([loadAnalytics(), loadConversations()]))
      .catch((error) => {
        helpers.toast('Unable to load website assistant settings: ' + (error.message || error), 'error', 3600);
      });
  }

  function boot() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      return setTimeout(boot, 40);
    }

    window.Admin.bootAdmin(async (helpers) => {
      try {
        const who = await helpers.identity('admin');
        if (!who?.ok) return;
        initPage(helpers, who);
      } catch (error) {
        helpers.toast('Unable to load user details', 'warn', 2600);
      }
    });
  }

  boot();
})();
