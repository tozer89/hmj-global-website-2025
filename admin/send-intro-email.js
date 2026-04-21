(function bootOnboardingWorkspace() {
  if (!window.Admin || typeof window.Admin.bootAdmin !== 'function' || !window.HMJOnboardingEmailCopy) {
    return setTimeout(bootOnboardingWorkspace, 40);
  }

  const {
    ACCOUNTS_SUPPORT_EMAIL,
    DEFAULT_CONFIRMATION_LANGUAGE,
    GENERAL_SUPPORT_EMAIL,
    buildConfirmationContext: buildSharedConfirmationContext,
    buildConfirmationDefaults,
    buildPlacementContext,
    languageLabel,
    normaliseConfirmationLanguage,
    renderConfirmationBodyHtml,
    renderMergeTokens,
  } = window.HMJOnboardingEmailCopy;

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
      confirmationLanguage: sel('#confirmationLanguage'),
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

    function selectedConfirmationLanguage() {
      return normaliseConfirmationLanguage(fieldValue(els.confirmationLanguage) || DEFAULT_CONFIRMATION_LANGUAGE);
    }

    function confirmationDefaults(language = selectedConfirmationLanguage()) {
      return buildConfirmationDefaults(language);
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
      return buildSharedConfirmationContext({
        first_name: fieldValue(els.firstName),
        last_name: fieldValue(els.lastName),
        company: fieldValue(els.clientCompany),
        project_location: fieldValue(els.projectLocation),
        support_email: GENERAL_SUPPORT_EMAIL,
        info_email: GENERAL_SUPPORT_EMAIL,
        accounts_email: ACCOUNTS_SUPPORT_EMAIL,
        language: selectedConfirmationLanguage(),
      });
    }

    function applyConfirmationDefaults(force = false, language = selectedConfirmationLanguage()) {
      const defaults = confirmationDefaults(language);
      if (els.confirmationLanguage) els.confirmationLanguage.value = defaults.language;
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
      const confirmationLanguage = selectedConfirmationLanguage();
      const confirmationTemplate = confirmationDefaults(confirmationLanguage);

      let stageLabel = 'Stage 1 · Intro email';
      let subject = jobTitle
        ? 'Welcome to HMJ Global - next steps for your new assignment'
        : 'Welcome to HMJ Global - complete your registration';
      let heading = 'Welcome to HMJ Global';
      let bodyHtml = [
        `<p>Hi ${escapeHtml(firstName)},</p>`,
        `<p>Congratulations on starting your new role${jobTitle ? ` as ${escapeHtml(jobTitle)}` : ''} with ${escapeHtml(company || 'your new client')}.</p>`,
        '<p>Use the HMJ access button below to open the new starter registration page already pointed at the correct onboarding route.</p>',
        '<p>HMJ needs your profile, right-to-work, onboarding, and payment details where relevant so we can move your setup forward properly.</p>',
        '<p>The registration path opens the HMJ candidate page with the new starter route selected for you, so you land in the correct onboarding form rather than the general sign-in area.</p>',
        '<p>We will also use this information to help get you set up on the HMJ Timesheet Portal dashboard so you can submit hours once your setup is underway.</p>',
        '<p>Use the HMJ buttons below rather than saving direct system links. They will take you to the correct HMJ access path.</p>',
      ].join('');
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
        stageLabel = `Stage 2 · Onboarding confirmation · ${languageLabel(confirmationLanguage)}`;
        subject = trimString(renderMergeTokens(fieldValue(els.confirmationSubject) || confirmationTemplate.subject, context)) || confirmationTemplate.heading;
        heading = trimString(renderMergeTokens(fieldValue(els.confirmationHeading) || confirmationTemplate.heading, context)) || confirmationTemplate.heading;
        bodyHtml = [
          `<p style="margin:0 0 14px;color:#42557f;font-size:15px;line-height:1.75;">${escapeHtml(renderMergeTokens(confirmationTemplate.intro, context))}</p>`,
          `<p style="margin:0 0 18px;color:#5f74a8;font-size:14px;line-height:1.7;font-weight:700;">${escapeHtml(renderMergeTokens(confirmationTemplate.contextNote, context))}</p>`,
          renderConfirmationBodyHtml(fieldValue(els.confirmationBody) || confirmationTemplate.body, context),
        ].join('');
        actionsHtml = `<span class="preview-btn">${escapeHtml(confirmationTemplate.actionLabel)}</span>`;
        footerHtml = [
          `<div><strong>Sender</strong><div>${escapeHtml(sender)}</div></div>`,
          `<div><strong>Placement</strong><div>${escapeHtml(buildPlacementContext(company, projectLocation, confirmationLanguage))}</div></div>`,
          `<div><strong>Language</strong><div>${escapeHtml(languageLabel(confirmationLanguage))}</div></div>`,
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
      const defaults = confirmationDefaults();
      return {
        ...buildSharedPayload(),
        email_type: 'confirmation',
        language: selectedConfirmationLanguage(),
        subject: fieldValue(els.confirmationSubject) || defaults.subject,
        heading: fieldValue(els.confirmationHeading) || defaults.heading,
        body: fieldValue(els.confirmationBody) || defaults.body,
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
    els.confirmationLanguage?.addEventListener('change', () => {
      applyConfirmationDefaults(true, selectedConfirmationLanguage());
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
