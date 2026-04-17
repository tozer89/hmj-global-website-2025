(function bootSendIntroEmail() {
  if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
    return setTimeout(bootSendIntroEmail, 40);
  }

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
      status: sel('#sendIntroStatus'),
      form: sel('#sendIntroForm'),
      submit: sel('#sendIntroSubmit'),
      reset: sel('#sendIntroReset'),
      preview: sel('#sendIntroPreview'),
      firstName: sel('#introFirstName'),
      lastName: sel('#introLastName'),
      email: sel('#introEmail'),
      clientCompany: sel('#introClientCompany'),
      phone: sel('#introPhone'),
      jobTitle: sel('#introJobTitle'),
    };

    const state = {
      sending: false,
      emailSettings: null,
      emailDiagnostics: null,
    };

    function setStatus(tone, text) {
      if (!els.status) return;
      els.status.dataset.tone = tone || 'info';
      els.status.innerHTML = text;
    }

    function renderPreview() {
      if (!els.preview) return;
      const firstName = fieldValue(els.firstName);
      const lastName = fieldValue(els.lastName);
      const email = fieldValue(els.email);
      const clientCompany = fieldValue(els.clientCompany);
      const phone = fieldValue(els.phone);
      const jobTitle = fieldValue(els.jobTitle);
      const sender = formatSender(state.emailSettings || {});
      const siteUrl = trimString(state.emailSettings?.siteUrl);

      els.preview.innerHTML = `
        <li><strong>Recipient</strong><span>${escapeHtml([firstName, lastName].filter(Boolean).join(' ') || '—')} ${email ? `· ${escapeHtml(email)}` : ''}</span></li>
        <li><strong>Role / client</strong><span>${escapeHtml(jobTitle || 'Role pending')} · ${escapeHtml(clientCompany || 'Client pending')}</span></li>
        <li><strong>Sender</strong><span>${escapeHtml(sender)}</span></li>
        <li><strong>Registration path</strong><span>${escapeHtml(joinPreviewUrl(siteUrl, '/candidates?path=starter'))}</span></li>
        <li><strong>Timesheets path</strong><span>${escapeHtml(candidateTimesheetsDashboardUrl())}${phone ? ` · phone logged: ${escapeHtml(phone)}` : ''}</span></li>
      `;
    }

    async function loadEmailStatus() {
      try {
        const response = await api('admin-candidate-email-settings', 'POST', { action: 'get' });
        state.emailSettings = response?.settings || {};
        state.emailDiagnostics = response?.diagnostics || {};
        renderPreview();

        if (state.emailDiagnostics.publicDeliveryReady) {
          setStatus(
            'success',
            `Candidate email delivery is ready. Intro emails will send from <strong>${escapeHtml(formatSender(state.emailSettings))}</strong>.`
          );
          return;
        }

        const warnings = Array.isArray(state.emailDiagnostics.warnings) ? state.emailDiagnostics.warnings : [];
        setStatus(
          'warn',
          `Intro emails are currently blocked because outbound candidate email delivery is not ready. ${escapeHtml(warnings[0] || 'Open Candidate account email settings and finish the sender or provider setup first.')}`
        );
      } catch (error) {
        setStatus('error', `Could not load candidate email settings. ${escapeHtml(error?.message || 'Unknown error.')}`);
      }
    }

    function formPayload() {
      return {
        first_name: fieldValue(els.firstName),
        last_name: fieldValue(els.lastName),
        email: fieldValue(els.email),
        company: fieldValue(els.clientCompany),
        phone: fieldValue(els.phone),
        job_title: fieldValue(els.jobTitle),
      };
    }

    function syncSendingState() {
      if (els.submit) {
        els.submit.disabled = state.sending;
        els.submit.textContent = state.sending ? 'Sending intro email…' : 'Send intro email';
      }
    }

    async function handleSubmit(event) {
      event.preventDefault();
      if (state.sending) return;
      if (!els.form.reportValidity()) return;

      if (!state.emailDiagnostics?.publicDeliveryReady) {
        setStatus(
          'error',
          'Intro emails cannot be sent yet because candidate email delivery is not configured. Open Candidate account email settings and finish the sender/provider setup first.'
        );
        toast('Candidate email delivery is not configured.', 'warn', 4200);
        return;
      }

      state.sending = true;
      syncSendingState();
      setStatus('info', 'Sending branded HMJ intro email…');

      try {
        const response = await api('admin-send-intro-email', 'POST', formPayload());
        setStatus(
          'success',
          `Intro email was accepted for delivery to <strong>${escapeHtml(response?.recipient || formPayload().email)}</strong> via ${escapeHtml(response?.delivery?.provider || 'configured provider')}.`
        );
        toast('Intro email accepted for delivery.', 'ok', 3200);
      } catch (error) {
        const detailsMessage = trimString(error?.details?.error || error?.details?.message || '');
        setStatus(
          'error',
          `Intro email could not be sent. ${escapeHtml(detailsMessage || error?.message || 'Unknown error.')}`
        );
      } finally {
        state.sending = false;
        syncSendingState();
      }
    }

    function handleReset() {
      if (state.sending) return;
      els.form.reset();
      renderPreview();
      if (state.emailDiagnostics?.publicDeliveryReady) {
        setStatus(
          'success',
          `Candidate email delivery is ready. Intro emails will send from <strong>${escapeHtml(formatSender(state.emailSettings || {}))}</strong>.`
        );
      }
    }

    els.form?.addEventListener('submit', handleSubmit);
    els.reset?.addEventListener('click', handleReset);
    [els.firstName, els.lastName, els.email, els.clientCompany, els.phone, els.jobTitle].forEach((field) => {
      field?.addEventListener('input', renderPreview);
    });

    syncSendingState();
    renderPreview();
    await loadEmailStatus();
  });
})();
