(function bootOnboardingWorkspace() {
  if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
    return setTimeout(bootOnboardingWorkspace, 40);
  }

  const DEFAULT_CONFIRMATION_SUBJECT = 'Welcome to HMJ Global - your onboarding details for <COMPANY_NAME>';
  const DEFAULT_CONFIRMATION_HEADING = 'Welcome to HMJ Global';
  const DEFAULT_CONFIRMATION_BODY = [
    'Hi <FIRST_NAME>,',
    '',
    'Welcome to HMJ Global, and congratulations on securing your role with <PLACEMENT_CONTEXT>.',
    '',
    "We're pleased to have you on board. Before you start, please take a few moments to review the below and confirm everything is in order.",
    '',
    '1. Timesheet Portal - Login Check (Important)',
    'You should have received an email to set up your Timesheet Portal login.',
    '',
    'Please log in and ensure you have access.',
    'Check your details are correct.',
    'If you have not received this email, please let us know as soon as possible and we will resend it.',
    '',
    '2. Timesheet & Payment Process',
    '',
    'Your timesheet is completed online each week.',
    '',
    'Your e-timesheet is released in the early hours of Monday and relates to the working week ahead.',
    'Enter your hours directly into the system during the week - there is no need to send anything back.',
    'Please ensure your timesheet is fully completed by the end of the working week.',
    '',
    'Payments are typically processed on the following Wednesday, subject to timesheet approval and submission within the required timeframe.',
    '',
    '3. Contact & Support',
    '',
    'If you need any help at any stage, you can contact us:',
    '',
    "Joe Tozer-O'Sullivan - joe@hmj-global.com",
    'General support - info@hmj-global.com',
    '',
    'We aim to respond quickly and resolve any issues without delay.',
    '',
    '4. Contract & Onboarding',
    '',
    'Your contract will be issued separately via email.',
    'Please review, sign, and return promptly to avoid any delays in onboarding and payment setup.',
    '',
    'If you have any questions at all, just reach out.',
    '',
    'Welcome onboard - we look forward to working with you.',
    '',
    'Best regards,',
    '',
    "Joe Tozer-O'Sullivan",
    'Director | HMJ Global',
    '07842 550187',
    'HMJ-Global.com - Media City, Manchester',
    '',
    'HMJ Global is a limited company registered in the United Kingdom',
    'Registered number: 16029938',
    'Registered office: 905 Lightbox Blue, Media City, Manchester, M50 2AE',
    '',
    'This message contains confidential information and is intended only for the intended recipients. If you are not an intended recipient you should not disseminate, distribute, or copy this e-mail. Please notify info@hmj-global.com immediately if received in error and delete it from your system.',
  ].join('\n');

  function trimString(value) {
    return String(value == null ? '' : value).trim();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatSender(settings = {}) {
    const senderName = trimString(settings.senderName);
    const senderEmail = trimString(settings.senderEmail);
    if (senderName && senderEmail) return `${senderName} <${senderEmail}>`;
    return senderEmail || senderName || 'Not configured';
  }

  function joinPreviewUrl(baseUrl, path) {
    const base = trimString(baseUrl) || 'https://www.hmj-global.com/';
    return `${base.replace(/\/?$/, '/')}${String(path || '').replace(/^\/+/, '')}`;
  }

  function candidateTimesheetsDashboardUrl() {
    return 'https://hmjglobal.timesheetportal.com/Dashboard/';
  }

  function buildPlacementContext(company, projectLocation) {
    const clientName = trimString(company) || 'your new client';
    const location = trimString(projectLocation);
    return location ? `${clientName} on ${location}` : clientName;
  }

  function onboardingTokenValue(rawToken, context = {}) {
    const normalized = String(rawToken || '')
      .trim()
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();

    const key = {
      FIRST_NAME: 'first_name',
      LAST_NAME: 'last_name',
      FULL_NAME: 'full_name',
      COMPANY: 'company_name',
      COMPANY_NAME: 'company_name',
      CLIENT: 'company_name',
      CLIENT_NAME: 'company_name',
      PROJECT: 'project_location',
      PROJECT_LOCATION: 'project_location',
      LOCATION: 'project_location',
      PLACEMENT_CONTEXT: 'placement_context',
      SUPPORT_EMAIL: 'support_email',
    }[normalized];

    if (!key) return null;
    return String(context[key] || '').trim();
  }

  function renderMergeTokens(text, context = {}) {
    const source = String(text == null ? '' : text);
    const replacer = (match, token) => {
      const value = onboardingTokenValue(token, context);
      return value == null ? match : value;
    };
    return source
      .replace(/<\s*([A-Za-z0-9 _-]+?)\s*>/g, replacer)
      .replace(/\{\{\s*([A-Za-z0-9 _-]+?)\s*\}\}/g, replacer);
  }

  function splitParagraphs(text) {
    return String(text || '')
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  }

  function paragraphsToHtml(paragraphs = []) {
    return (Array.isArray(paragraphs) ? paragraphs : [])
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  function deliverySourceLabel(diagnostics = {}) {
    const source = trimString(diagnostics.deliverySource).toLowerCase();
    if (source === 'smtp') return 'SMTP';
    if (source === 'resend') return 'Resend';
    if (source === 'smtp_invalid') return 'SMTP (credentials rejected)';
    if (source === 'resend_invalid') return 'Resend (key rejected)';
    return 'Not configured';
  }

  function fieldValue(element) {
    return trimString(element?.value || '');
  }

  Admin.bootAdmin(async ({ api, sel, toast, identity }) => {
    const gate = sel('#gate');
    const app = sel('#app');
    const who = await identity('admin');

    if (!who || !who.ok) {
      if (app) app.style.display = 'none';
      if (gate) {
        gate.style.display = '';
        const why = gate.querySelector('.why');
        if (why) why.textContent = 'Restricted. Sign in with an HMJ admin account.';
      }
      return;
    }

    if (gate) gate.style.display = 'none';
    if (app) app.style.display = '';

    const els = {
      status: sel('#onboardingStatus'),
      form: sel('#onboardingForm'),
      clear: sel('#onboardingClear'),
      introSubmit: sel('#sendIntroSubmit'),
      confirmationSubmit: sel('#sendConfirmationSubmit'),
      confirmationReset: sel('#resetConfirmationTemplate'),
      previewIntroButton: sel('#previewIntroButton'),
      previewConfirmationButton: sel('#previewConfirmationButton'),
      previewModeLabel: sel('#previewModeLabel'),
      previewSubject: sel('#onboardingPreviewSubject'),
      previewRecipient: sel('#onboardingPreviewRecipient'),
      previewHeading: sel('#onboardingPreviewHeading'),
      previewBody: sel('#onboardingPreviewBody'),
      previewActions: sel('#onboardingPreviewActions'),
      previewFooter: sel('#onboardingPreviewFooter'),
      previewModeIntro: sel('#previewModeIntro'),
      previewModeConfirmation: sel('#previewModeConfirmation'),
      audit: sel('#onboardingAudit'),
      senderNote: sel('#onboardingSenderNote'),
      firstName: sel('#introFirstName'),
      lastName: sel('#introLastName'),
      email: sel('#introEmail'),
      clientCompany: sel('#introClientCompany'),
      projectLocation: sel('#introProjectLocation'),
      phone: sel('#introPhone'),
      jobTitle: sel('#introJobTitle'),
      confirmationSubject: sel('#confirmationSubject'),
      confirmationHeading: sel('#confirmationHeading'),
      confirmationBody: sel('#confirmationBody'),
      tokenPalette: sel('#confirmationTokenPalette'),
    };

    const state = {
      sendingIntro: false,
      sendingConfirmation: false,
      emailSettings: null,
      emailDiagnostics: null,
      previewMode: 'intro',
      activeTemplateField: null,
    };

    function confirmationDefaults() {
      return {
        subject: DEFAULT_CONFIRMATION_SUBJECT,
        heading: DEFAULT_CONFIRMATION_HEADING,
        body: DEFAULT_CONFIRMATION_BODY,
      };
    }

    function setStatus(tone, text) {
      if (!els.status) return;
      els.status.dataset.tone = tone || 'info';
      els.status.innerHTML = text;
    }

    function setPreviewMode(mode) {
      state.previewMode = mode === 'confirmation' ? 'confirmation' : 'intro';
      if (els.previewModeIntro) els.previewModeIntro.classList.toggle('active', state.previewMode === 'intro');
      if (els.previewModeConfirmation) els.previewModeConfirmation.classList.toggle('active', state.previewMode === 'confirmation');
      renderPreview();
    }

    function syncButtonStates() {
      if (els.introSubmit) {
        els.introSubmit.disabled = state.sendingIntro || state.sendingConfirmation;
        els.introSubmit.textContent = state.sendingIntro ? 'Sending stage 1 intro email…' : 'Send stage 1 intro email';
      }
      if (els.confirmationSubmit) {
        els.confirmationSubmit.disabled = state.sendingConfirmation || state.sendingIntro;
        els.confirmationSubmit.textContent = state.sendingConfirmation ? 'Sending stage 2 confirmation…' : 'Send stage 2 confirmation';
      }
      if (els.clear) els.clear.disabled = state.sendingIntro || state.sendingConfirmation;
      if (els.confirmationReset) els.confirmationReset.disabled = state.sendingIntro || state.sendingConfirmation;
    }

    function buildConfirmationContext() {
      const firstName = fieldValue(els.firstName) || 'there';
      const lastName = fieldValue(els.lastName);
      const fullName = trimString([firstName, lastName].filter(Boolean).join(' ')) || firstName;
      const companyName = fieldValue(els.clientCompany) || 'your new client';
      const projectLocation = fieldValue(els.projectLocation);
      const supportEmail = trimString(state.emailSettings?.supportEmail || state.emailSettings?.senderEmail || 'info@hmj-global.com') || 'info@hmj-global.com';
      return {
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        company_name: companyName,
        project_location: projectLocation,
        placement_context: buildPlacementContext(companyName, projectLocation),
        support_email: supportEmail,
      };
    }

    function applyConfirmationDefaults(force = false) {
      const defaults = confirmationDefaults();
      if (els.confirmationSubject && (force || !fieldValue(els.confirmationSubject))) els.confirmationSubject.value = defaults.subject;
      if (els.confirmationHeading && (force || !fieldValue(els.confirmationHeading))) els.confirmationHeading.value = defaults.heading;
      if (els.confirmationBody && (force || !fieldValue(els.confirmationBody))) els.confirmationBody.value = defaults.body;
      if (!state.activeTemplateField && els.confirmationBody) state.activeTemplateField = els.confirmationBody;
    }

    function renderAudit() {
      if (!els.audit) return;
      const settings = state.emailSettings || {};
      const diagnostics = state.emailDiagnostics || {};
      const sender = formatSender(settings);
      const senderEmail = trimString(settings.senderEmail).toLowerCase();
      const statusLabel = diagnostics.publicDeliveryReady ? 'Ready' : 'Needs attention';
      const statusDetail = diagnostics.publicDeliveryReady
        ? 'The current provider is ready to deliver onboarding emails.'
        : trimString((Array.isArray(diagnostics.warnings) ? diagnostics.warnings[0] : '') || 'Open Candidate email settings to finish the sender/provider setup.');
      const auditRows = [
        `<li><strong>Status</strong><span>${escapeHtml(statusLabel)} - ${escapeHtml(statusDetail)}</span></li>`,
        `<li><strong>Delivery route</strong><span>${escapeHtml(deliverySourceLabel(diagnostics))}</span></li>`,
        `<li><strong>Sender</strong><span>${escapeHtml(sender)}</span></li>`,
        `<li><strong>Support inbox</strong><span>${escapeHtml(trimString(settings.supportEmail) || 'info@hmj-global.com')}</span></li>`,
        `<li><strong>Candidate access path</strong><span>${escapeHtml(joinPreviewUrl(settings.siteUrl, '/candidates?path=starter'))}</span></li>`,
        `<li><strong>Timesheets path</strong><span>${escapeHtml(candidateTimesheetsDashboardUrl())}</span></li>`,
      ];
      els.audit.innerHTML = auditRows.join('');
      if (els.senderNote) {
        els.senderNote.innerHTML = senderEmail && senderEmail !== 'info@hmj-global.com'
          ? `Emails are currently configured to send from <strong>${escapeHtml(sender)}</strong>. Update Candidate email settings if you want onboarding emails to go from <strong>info@hmj-global.com</strong>.`
          : `Emails are currently configured to send from <strong>${escapeHtml(sender)}</strong>.`;
      }
    }

    function renderPreview() {
      const firstName = fieldValue(els.firstName) || 'there';
      const lastName = fieldValue(els.lastName);
      const email = fieldValue(els.email);
      const company = fieldValue(els.clientCompany);
      const projectLocation = fieldValue(els.projectLocation);
      const jobTitle = fieldValue(els.jobTitle);
      const sender = formatSender(state.emailSettings || {});
      const siteUrl = trimString(state.emailSettings?.siteUrl);
      const context = buildConfirmationContext();

      let stageLabel = 'Stage 1 · Intro email';
      let subject = jobTitle
        ? 'Welcome to HMJ Global - next steps for your new assignment'
        : 'Welcome to HMJ Global - complete your registration';
      let heading = 'Welcome to HMJ Global';
      let bodyHtml = paragraphsToHtml([
        `Hi ${firstName},`,
        `Congratulations on starting your new role${jobTitle ? ` as ${jobTitle}` : ''} with ${company || 'your new client'}.`,
        'Use the HMJ access button below to open the new starter registration page already pointed at the correct onboarding route.',
        'HMJ needs your profile, right-to-work, onboarding, and payment details where relevant so we can move your setup forward properly.',
        'The registration path opens the HMJ candidate page with the new starter route selected for you, so you land in the correct onboarding form rather than the general sign-in area.',
        'We will also use this information to help get you set up on the HMJ Timesheet Portal dashboard so you can submit hours once your setup is underway.',
        'Use the HMJ buttons below rather than saving direct system links. They will take you to the correct HMJ access path.',
      ]);
      let actionsHtml = [
        '<span class="preview-btn">Open HMJ onboarding access</span>',
        '<span class="preview-btn secondary">Open HMJ timesheets / portal access</span>',
      ].join('');
      let footerHtml = [
        `<div><strong>Sender</strong><div>${escapeHtml(sender)}</div></div>`,
        `<div><strong>Registration path</strong><div>${escapeHtml(joinPreviewUrl(siteUrl, '/candidates?path=starter'))}</div></div>`,
        `<div><strong>Timesheets path</strong><div>${escapeHtml(candidateTimesheetsDashboardUrl())}</div></div>`,
      ].join('');

      if (state.previewMode === 'confirmation') {
        stageLabel = 'Stage 2 · Onboarding confirmation';
        subject = trimString(renderMergeTokens(fieldValue(els.confirmationSubject) || DEFAULT_CONFIRMATION_SUBJECT, context)) || 'Welcome to HMJ Global';
        heading = trimString(renderMergeTokens(fieldValue(els.confirmationHeading) || DEFAULT_CONFIRMATION_HEADING, context)) || 'Welcome to HMJ Global';
        bodyHtml = paragraphsToHtml(
          splitParagraphs(renderMergeTokens(fieldValue(els.confirmationBody) || DEFAULT_CONFIRMATION_BODY, context))
        );
        actionsHtml = '<span class="preview-btn">Open HMJ timesheets / portal access</span>';
        footerHtml = [
          `<div><strong>Sender</strong><div>${escapeHtml(sender)}</div></div>`,
          `<div><strong>Placement</strong><div>${escapeHtml(buildPlacementContext(company, projectLocation))}</div></div>`,
          `<div><strong>Timesheets path</strong><div>${escapeHtml(candidateTimesheetsDashboardUrl())}</div></div>`,
        ].join('');
      }

      if (els.previewModeLabel) els.previewModeLabel.textContent = stageLabel;
      if (els.previewSubject) els.previewSubject.textContent = subject;
      if (els.previewRecipient) {
        els.previewRecipient.textContent = `Previewing ${[firstName, lastName].filter(Boolean).join(' ') || 'Contractor'}${email ? ` · ${email}` : ''}`;
      }
      if (els.previewHeading) els.previewHeading.textContent = heading;
      if (els.previewBody) els.previewBody.innerHTML = bodyHtml || '<p>Add email copy to preview it here.</p>';
      if (els.previewActions) els.previewActions.innerHTML = actionsHtml;
      if (els.previewFooter) els.previewFooter.innerHTML = footerHtml;
    }

    async function loadEmailStatus() {
      try {
        const response = await api('admin-candidate-email-settings', 'POST', { action: 'get' });
        state.emailSettings = response?.settings || {};
        state.emailDiagnostics = response?.diagnostics || {};
        renderAudit();
        renderPreview();

        if (state.emailDiagnostics.publicDeliveryReady) {
          const sender = formatSender(state.emailSettings || {});
          const senderEmail = trimString(state.emailSettings?.senderEmail).toLowerCase();
          const senderMessage = senderEmail && senderEmail !== 'info@hmj-global.com'
            ? ` Emails are currently configured to send from <strong>${escapeHtml(sender)}</strong>, not <strong>info@hmj-global.com</strong>.`
            : '';
          setStatus(
            'success',
            `Candidate email delivery is ready. Onboarding emails will send using <strong>${escapeHtml(deliverySourceLabel(state.emailDiagnostics))}</strong> from <strong>${escapeHtml(sender)}</strong>.${senderMessage}`
          );
          return;
        }

        const warnings = Array.isArray(state.emailDiagnostics.warnings) ? state.emailDiagnostics.warnings : [];
        setStatus(
          'warn',
          `Onboarding emails are currently blocked because outbound candidate email delivery is not ready. ${escapeHtml(warnings[0] || 'Open Candidate email settings and finish the sender/provider setup first.')}`
        );
      } catch (error) {
        setStatus('error', `Could not load candidate email settings. ${escapeHtml(error?.message || 'Unknown error.')}`);
      }
    }

    function buildSharedPayload() {
      return {
        first_name: fieldValue(els.firstName),
        last_name: fieldValue(els.lastName),
        email: fieldValue(els.email),
        company: fieldValue(els.clientCompany),
        project_location: fieldValue(els.projectLocation),
        phone: fieldValue(els.phone),
        job_title: fieldValue(els.jobTitle),
      };
    }

    function buildConfirmationPayload() {
      return {
        ...buildSharedPayload(),
        email_type: 'confirmation',
        subject: fieldValue(els.confirmationSubject) || DEFAULT_CONFIRMATION_SUBJECT,
        heading: fieldValue(els.confirmationHeading) || DEFAULT_CONFIRMATION_HEADING,
        body: fieldValue(els.confirmationBody) || DEFAULT_CONFIRMATION_BODY,
      };
    }

    function validateDeliveryReady(failureLabel) {
      if (state.emailDiagnostics?.publicDeliveryReady) return true;
      setStatus(
        'error',
        `${failureLabel} cannot be sent yet because candidate email delivery is not configured. Open Candidate email settings and finish the sender/provider setup first.`
      );
      toast('Candidate email delivery is not configured.', 'warn', 4200);
      return false;
    }

    function validateConfirmationPayload(payload) {
      if (!trimString(payload.subject)) {
        els.confirmationSubject?.focus();
        throw new Error('Confirmation email subject is required.');
      }
      if (!trimString(payload.heading)) {
        els.confirmationHeading?.focus();
        throw new Error('Confirmation email heading is required.');
      }
      if (!trimString(payload.body)) {
        els.confirmationBody?.focus();
        throw new Error('Confirmation email body is required.');
      }
    }

    async function handleSendIntro() {
      if (state.sendingIntro || state.sendingConfirmation) return;
      setPreviewMode('intro');
      if (!els.form?.reportValidity()) return;
      if (!validateDeliveryReady('Stage 1 intro email')) return;

      state.sendingIntro = true;
      syncButtonStates();
      setStatus('info', 'Sending stage 1 HMJ intro email…');

      try {
        const response = await api('admin-send-intro-email', 'POST', {
          ...buildSharedPayload(),
          email_type: 'intro',
        });
        setStatus(
          'success',
          `Stage 1 intro email was accepted for delivery to <strong>${escapeHtml(response?.recipient || buildSharedPayload().email)}</strong> via ${escapeHtml(response?.delivery?.provider || 'configured provider')}.`
        );
        toast('Stage 1 intro email accepted for delivery.', 'ok', 3200);
      } catch (error) {
        const detailsMessage = trimString(error?.details?.error || error?.details?.message || '');
        setStatus(
          'error',
          `Stage 1 intro email could not be sent. ${escapeHtml(detailsMessage || error?.message || 'Unknown error.')}`
        );
      } finally {
        state.sendingIntro = false;
        syncButtonStates();
      }
    }

    async function handleSendConfirmation() {
      if (state.sendingIntro || state.sendingConfirmation) return;
      setPreviewMode('confirmation');
      if (!els.form?.reportValidity()) return;
      if (!validateDeliveryReady('Stage 2 confirmation email')) return;

      const payload = buildConfirmationPayload();
      try {
        validateConfirmationPayload(payload);
      } catch (error) {
        setStatus('error', escapeHtml(error.message || 'Confirmation email copy is incomplete.'));
        toast(error.message || 'Confirmation email copy is incomplete.', 'warn', 3600);
        return;
      }

      state.sendingConfirmation = true;
      syncButtonStates();
      setStatus('info', 'Sending stage 2 HMJ onboarding confirmation email…');

      try {
        const response = await api('admin-send-intro-email', 'POST', payload);
        setStatus(
          'success',
          `Stage 2 onboarding confirmation email was accepted for delivery to <strong>${escapeHtml(response?.recipient || payload.email)}</strong> via ${escapeHtml(response?.delivery?.provider || 'configured provider')}.`
        );
        toast('Stage 2 onboarding confirmation accepted for delivery.', 'ok', 3200);
      } catch (error) {
        const detailsMessage = trimString(error?.details?.error || error?.details?.message || '');
        setStatus(
          'error',
          `Stage 2 onboarding confirmation could not be sent. ${escapeHtml(detailsMessage || error?.message || 'Unknown error.')}`
        );
      } finally {
        state.sendingConfirmation = false;
        syncButtonStates();
      }
    }

    function handleClear() {
      if (state.sendingIntro || state.sendingConfirmation) return;
      els.form?.reset();
      applyConfirmationDefaults(true);
      setPreviewMode('intro');
      if (state.emailDiagnostics?.publicDeliveryReady) {
        const sender = formatSender(state.emailSettings || {});
        setStatus(
          'success',
          `Candidate email delivery is ready. Onboarding emails will send from <strong>${escapeHtml(sender)}</strong>.`
        );
      }
      renderPreview();
    }

    function insertToken(token) {
      const field = state.activeTemplateField || els.confirmationBody;
      if (!field || typeof field.selectionStart !== 'number' || typeof field.selectionEnd !== 'number') {
        return;
      }
      const value = String(field.value || '');
      const start = field.selectionStart;
      const end = field.selectionEnd;
      field.value = `${value.slice(0, start)}${token}${value.slice(end)}`;
      const nextCaret = start + token.length;
      field.focus();
      field.setSelectionRange(nextCaret, nextCaret);
      setPreviewMode('confirmation');
      renderPreview();
    }

    els.introSubmit?.addEventListener('click', () => {
      void handleSendIntro();
    });
    els.confirmationSubmit?.addEventListener('click', () => {
      void handleSendConfirmation();
    });
    els.clear?.addEventListener('click', handleClear);
    els.confirmationReset?.addEventListener('click', () => {
      applyConfirmationDefaults(true);
      setPreviewMode('confirmation');
      renderPreview();
    });
    els.previewIntroButton?.addEventListener('click', () => setPreviewMode('intro'));
    els.previewConfirmationButton?.addEventListener('click', () => setPreviewMode('confirmation'));
    els.previewModeIntro?.addEventListener('click', () => setPreviewMode('intro'));
    els.previewModeConfirmation?.addEventListener('click', () => setPreviewMode('confirmation'));

    [els.firstName, els.lastName, els.email, els.clientCompany, els.projectLocation, els.phone, els.jobTitle].forEach((field) => {
      field?.addEventListener('input', renderPreview);
    });
    [els.confirmationSubject, els.confirmationHeading, els.confirmationBody].forEach((field) => {
      field?.addEventListener('focus', () => {
        state.activeTemplateField = field;
        setPreviewMode('confirmation');
      });
      field?.addEventListener('input', () => {
        state.activeTemplateField = field;
        setPreviewMode('confirmation');
      });
    });
    els.tokenPalette?.querySelectorAll('[data-template-token]').forEach((button) => {
      button.addEventListener('click', () => insertToken(button.dataset.templateToken || ''));
    });

    applyConfirmationDefaults(true);
    syncButtonStates();
    renderAudit();
    renderPreview();
    await loadEmailStatus();
  });
})();
