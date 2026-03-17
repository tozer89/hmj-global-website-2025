(function () {
  'use strict';

  const stores = {
    activity: 'hmj.admin.activity:v1'
  };

  const PRESET_DEFAULTS = {
    godaddy_microsoft365: {
      smtpHost: 'smtp.office365.com',
      smtpPort: '587',
      smtpEncryption: 'starttls',
    },
    custom: {
      smtpHost: '',
      smtpPort: '587',
      smtpEncryption: 'starttls',
    },
    supabase_default: {
      smtpHost: '',
      smtpPort: '587',
      smtpEncryption: 'starttls',
    },
  };

  const state = {
    helpers: null,
    who: null,
    activity: [],
    candidateEmailSettings: null,
    candidateEmailDiagnostics: null,
    candidateEmailPreviews: null,
    candidateEmailPatchPreview: null,
    candidateEmailPreviewMode: 'confirmation',
    taskCalendarSettings: null,
    taskCalendarDiagnostics: null,
    taskCalendarConnections: [],
  };

  const els = {};

  function cacheDom() {
    [
      'activityList',
      'healthResult',
      'settingsSummary',
      'settingsHealthChips',
      'candidateEmailSettingsForm',
      'candidateEmailNotice',
      'candidateEmailProvider',
      'candidateCustomSmtpEnabled',
      'candidateSmtpHost',
      'candidateSmtpPort',
      'candidateSmtpEncryption',
      'candidateSmtpUser',
      'candidateSmtpPassword',
      'candidateSmtpPasswordHint',
      'candidateClearSmtpPassword',
      'candidateSenderName',
      'candidateSenderEmail',
      'candidateSupportEmail',
      'candidateSiteUrl',
      'candidateVerificationRedirect',
      'candidateRecoveryRedirect',
      'candidateConfirmationSubject',
      'candidateRecoverySubject',
      'candidateEmailChangeSubject',
      'candidatePreheader',
      'candidateConfirmationHeading',
      'candidateRecoveryHeading',
      'candidateEmailChangeHeading',
      'candidateIntroCopy',
      'candidateRecoveryCopy',
      'candidateHelpCopy',
      'candidateFooterTagline',
      'candidateSupabaseManagementToken',
      'candidateEmailStatusSummary',
      'candidateEmailStatusList',
      'candidateEmailPatchPreview',
      'candidateEmailPreviewFrame',
      'candidateEmailPreviewTitle',
      'candidateEmailPreviewMeta',
      'btnApplyCandidateEmailSettings',
      'taskCalendarSettingsForm',
      'taskCalendarNotice',
      'taskCalendarEnabled',
      'taskCalendarTenantId',
      'taskCalendarClientId',
      'taskCalendarClientSecret',
      'taskCalendarClientSecretHint',
      'taskCalendarClearClientSecret',
      'taskCalendarShowExternalEvents',
      'taskCalendarShowTeamConnections',
      'taskCalendarSyncEnabled',
      'taskCalendarCallbackUrl',
      'taskCalendarScopes',
      'taskCalendarStatusSummary',
      'taskCalendarStatusList',
      'taskCalendarCurrentConnection',
      'btnSaveTaskCalendarSettings',
      'btnTaskCalendarConnect',
      'btnTaskCalendarDisconnect',
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
    els.previewButtons = Array.from(document.querySelectorAll('[data-email-preview]'));
  }

  function safeLocalStorage(fn) {
    try {
      return fn();
    } catch (err) {
      console.warn('[HMJ]', 'localStorage unavailable', err);
      return undefined;
    }
  }

  function readStore(key, fallback) {
    return safeLocalStorage(() => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw);
      } catch (err) {
        console.warn('[HMJ]', 'parse failed for', key, err);
        return fallback;
      }
    });
  }

  function writeStore(key, value) {
    safeLocalStorage(() => {
      window.localStorage.setItem(key, JSON.stringify(value));
    });
  }

  function now() {
    return Date.now();
  }

  function createEl(tag, options) {
    const el = document.createElement(tag);
    if (!options) return el;
    if (options.className) el.className = options.className;
    if (options.attrs) {
      Object.entries(options.attrs).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        el.setAttribute(k, String(v));
      });
    }
    if (options.text) el.textContent = options.text;
    if (options.html) el.innerHTML = options.html;
    return el;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function trimText(value, maxLength) {
    const text = typeof value === 'string'
      ? value.trim()
      : String(value == null ? '' : value).trim();
    if (!text) return '';
    if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
    return text.slice(0, maxLength);
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return '';
    }
  }

  function formatRelative(ts) {
    const diff = now() - ts;
    const min = Math.round(diff / 60000);
    if (min < 1) return 'Just now';
    if (min === 1) return '1 min ago';
    if (min < 60) return `${min} mins ago`;
    const hours = Math.round(min / 60);
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'Yesterday' : `${days} days ago`;
  }

  function detectEnvironment(hostname) {
    if (!hostname) return 'Production';
    if (hostname.includes('localhost')) return 'Local development';
    if (hostname.includes('--')) return 'Preview';
    if (/netlify\.app$/i.test(hostname)) return 'Production';
    if (/netlify\.live$/i.test(hostname)) return 'Preview';
    return 'Production';
  }

  function toast(message, type = 'info', ms = 2600) {
    if (state.helpers?.toast) {
      state.helpers.toast(message, type, ms);
    }
  }

  function persistActivity() {
    writeStore(stores.activity, { list: state.activity });
  }

  function loadActivity() {
    const stored = readStore(stores.activity, { list: [] });
    state.activity = Array.isArray(stored?.list) ? stored.list.slice(0, 30) : [];
  }

  function logActivity(entry) {
    const item = {
      id: 'a_' + now(),
      ts: now(),
      kind: entry.kind || 'event',
      label: entry.label || 'Event',
      detail: entry.detail || '',
      href: entry.href || null
    };
    state.activity.unshift(item);
    if (state.activity.length > 30) state.activity.length = 30;
    persistActivity();
    renderActivity();
  }

  function setChip(id, text, tone) {
    const chip = document.getElementById(id);
    if (!chip) return;
    chip.textContent = text;
    if (tone) chip.dataset.tone = tone;
    else chip.removeAttribute('data-tone');
  }

  function updateSummary() {
    const summary = document.getElementById('settingsSummary');
    if (!summary) return;
    const activityCount = state.activity.length;
    summary.textContent = activityCount
      ? `Recent activity and platform diagnostics now live here. This browser currently holds ${activityCount} recent admin actions for quick reference.`
      : 'Recent activity and platform diagnostics now live here so the dashboard can stay focused on daily work.';
    setChip('settingsActivityChip', `${activityCount} recent ${activityCount === 1 ? 'action' : 'actions'}`);
  }

  function renderActivity() {
    const list = els.activityList;
    if (!list) return;
    list.innerHTML = '';
    updateSummary();
    if (!state.activity.length) {
      const empty = createEl('li', { className: 'activity-empty', text: 'No recent local activity yet. Open a module, run a health check, or use a dashboard shortcut and it will show up here.' });
      list.appendChild(empty);
      return;
    }
    state.activity.forEach((item) => {
      const li = createEl('li');
      const entry = createEl('div', { className: 'activity-entry' });
      entry.appendChild(createEl('div', { className: 'activity-entry__label', text: item.label }));
      if (item.detail) {
        entry.appendChild(createEl('div', { className: 'activity-entry__detail', text: item.detail }));
      }
      entry.appendChild(createEl('time', {
        className: 'activity-entry__time',
        text: formatRelative(item.ts),
        attrs: { datetime: new Date(item.ts).toISOString(), title: formatTime(item.ts) }
      }));
      li.appendChild(entry);
      list.appendChild(li);
    });
  }

  function parseHealth(raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const out = {};
      if (parsed.api !== undefined) out.api = !!parsed.api;
      if (parsed.db !== undefined) out.db = !!parsed.db;
      if (parsed.storage !== undefined) out.storage = !!parsed.storage;
      return out;
    } catch {
      return null;
    }
  }

  function updateHealthChips(detail) {
    const chips = els.settingsHealthChips;
    if (!chips) return;
    chips.hidden = false;
    const statuses = detail.raw ? parseHealth(detail.raw) : null;
    ['api', 'db', 'storage'].forEach((key) => {
      const chip = chips.querySelector(`[data-target="${key}"]`);
      if (!chip) return;
      const value = chip.querySelector('.value');
      if (!value) return;
      if (statuses && statuses[key] !== undefined) {
        const ok = statuses[key];
        chip.dataset.state = ok ? 'ok' : 'bad';
        value.textContent = ok ? 'OK' : 'Fail';
      } else {
        chip.dataset.state = detail.ok ? 'ok' : 'bad';
        value.textContent = detail.ok ? 'OK' : 'Fail';
      }
      chip.title = `Last updated ${formatTime(detail.at || now())}`;
    });
  }

  async function runHealthCheck() {
    const result = els.healthResult;
    if (result) {
      result.hidden = false;
      result.textContent = 'Checking Netlify function…';
    }
    try {
      const res = await fetch('/.netlify/functions/supa-health', { credentials: 'include' });
      const txt = await res.text();
      let display = txt;
      try {
        display = JSON.stringify(JSON.parse(txt), null, 2);
      } catch {}
      if (result) result.textContent = display || 'OK';
      updateHealthChips({ ok: true, raw: txt, at: now() });
      toast('Health check complete', 'info', 2200);
      logActivity({ label: 'Supabase health check complete', detail: formatTime(now()), kind: 'health' });
    } catch (err) {
      if (result) result.textContent = 'Error: ' + (err.message || err);
      updateHealthChips({ ok: false, at: now() });
      toast('Health check failed', 'error', 3200);
      logActivity({ label: 'Supabase health check failed', detail: err.message || 'Unknown error', kind: 'health' });
    }
  }

  async function loadSettingsStatus() {
    if (!state.helpers?.api) {
      setChip('settingsStorageChip', 'Shared settings unavailable', 'warn');
      return;
    }
    try {
      const response = await state.helpers.api('admin-settings-get', 'POST', { keys: ['chatbot_settings'] });
      const sharedAvailable = typeof response?.source === 'string' && response.source.startsWith('supabase');
      setChip('settingsStorageChip', sharedAvailable ? 'Shared settings live' : 'Fallback mode', sharedAvailable ? 'ok' : 'warn');
    } catch (err) {
      console.warn('[HMJ]', 'settings status lookup failed', err);
      setChip('settingsStorageChip', 'Shared settings unavailable', 'warn');
    }
  }

  function updateCandidateEmailNotice(message, tone = 'warn', detail = '') {
    const notice = els.candidateEmailNotice;
    if (!notice) return;
    const headline = trimText(message, 260);
    const body = trimText(detail, 520);
    if (!headline && !body) {
      notice.hidden = true;
      notice.innerHTML = '';
      return;
    }
    notice.hidden = false;
    notice.dataset.tone = tone;
    notice.innerHTML = `
      <strong>${escapeHtml(headline || 'Candidate email settings')}</strong>
      ${body ? `<p>${escapeHtml(body)}</p>` : ''}
    `;
  }

  function setFieldValue(element, value) {
    if (!element) return;
    if (element.type === 'checkbox') {
      element.checked = !!value;
      return;
    }
    element.value = value == null ? '' : String(value);
  }

  function setCandidateEmailForm(settings = {}) {
    setFieldValue(els.candidateEmailProvider, settings.smtpProvider || 'godaddy_microsoft365');
    setFieldValue(els.candidateCustomSmtpEnabled, settings.customSmtpEnabled);
    setFieldValue(els.candidateSmtpHost, settings.smtpHost || '');
    setFieldValue(els.candidateSmtpPort, settings.smtpPort || 587);
    setFieldValue(els.candidateSmtpEncryption, settings.smtpEncryption || 'starttls');
    setFieldValue(els.candidateSmtpUser, settings.smtpUser || '');
    setFieldValue(els.candidateSmtpPassword, '');
    setFieldValue(els.candidateClearSmtpPassword, false);
    setFieldValue(els.candidateSenderName, settings.senderName || '');
    setFieldValue(els.candidateSenderEmail, settings.senderEmail || '');
    setFieldValue(els.candidateSupportEmail, settings.supportEmail || '');
    setFieldValue(els.candidateSiteUrl, settings.siteUrl || '');
    setFieldValue(els.candidateVerificationRedirect, settings.verificationRedirectUrl || '');
    setFieldValue(els.candidateRecoveryRedirect, settings.recoveryRedirectUrl || '');
    setFieldValue(els.candidateConfirmationSubject, settings.confirmationSubject || '');
    setFieldValue(els.candidateRecoverySubject, settings.recoverySubject || '');
    setFieldValue(els.candidateEmailChangeSubject, settings.emailChangeSubject || '');
    setFieldValue(els.candidatePreheader, settings.preheader || '');
    setFieldValue(els.candidateConfirmationHeading, settings.confirmationHeading || '');
    setFieldValue(els.candidateRecoveryHeading, settings.recoveryHeading || '');
    setFieldValue(els.candidateEmailChangeHeading, settings.emailChangeHeading || '');
    setFieldValue(els.candidateIntroCopy, settings.introCopy || '');
    setFieldValue(els.candidateRecoveryCopy, settings.recoveryCopy || '');
    setFieldValue(els.candidateHelpCopy, settings.helpCopy || '');
    setFieldValue(els.candidateFooterTagline, settings.footerTagline || '');

    if (els.candidateSmtpPasswordHint) {
      els.candidateSmtpPasswordHint.textContent = settings.smtpPasswordStored
        ? 'A password is already saved. Leave this blank to keep it unchanged.'
        : 'No SMTP password is saved yet. Enter the mailbox password or app password here when ready.';
    }
  }

  function readCandidateEmailForm() {
    return {
      smtpProvider: trimText(els.candidateEmailProvider?.value, 64),
      customSmtpEnabled: !!els.candidateCustomSmtpEnabled?.checked,
      smtpHost: trimText(els.candidateSmtpHost?.value, 320),
      smtpPort: trimText(els.candidateSmtpPort?.value, 16),
      smtpEncryption: trimText(els.candidateSmtpEncryption?.value, 32),
      smtpUser: trimText(els.candidateSmtpUser?.value, 320),
      smtpPassword: String(els.candidateSmtpPassword?.value || ''),
      clearSmtpPassword: !!els.candidateClearSmtpPassword?.checked,
      senderName: trimText(els.candidateSenderName?.value, 160),
      senderEmail: trimText(els.candidateSenderEmail?.value, 320),
      supportEmail: trimText(els.candidateSupportEmail?.value, 320),
      siteUrl: trimText(els.candidateSiteUrl?.value, 1000),
      verificationRedirectUrl: trimText(els.candidateVerificationRedirect?.value, 1000),
      recoveryRedirectUrl: trimText(els.candidateRecoveryRedirect?.value, 1000),
      confirmationSubject: trimText(els.candidateConfirmationSubject?.value, 160),
      recoverySubject: trimText(els.candidateRecoverySubject?.value, 160),
      emailChangeSubject: trimText(els.candidateEmailChangeSubject?.value, 160),
      preheader: trimText(els.candidatePreheader?.value, 220),
      confirmationHeading: trimText(els.candidateConfirmationHeading?.value, 160),
      recoveryHeading: trimText(els.candidateRecoveryHeading?.value, 160),
      emailChangeHeading: trimText(els.candidateEmailChangeHeading?.value, 160),
      introCopy: trimText(els.candidateIntroCopy?.value, 320),
      recoveryCopy: trimText(els.candidateRecoveryCopy?.value, 320),
      helpCopy: trimText(els.candidateHelpCopy?.value, 320),
      footerTagline: trimText(els.candidateFooterTagline?.value, 220),
    };
  }

  function renderCandidateEmailStatus() {
    const diagnostics = state.candidateEmailDiagnostics || {};
    const settings = state.candidateEmailSettings || {};
    const summary = els.candidateEmailStatusSummary;
    const list = els.candidateEmailStatusList;
    const patchPreview = els.candidateEmailPatchPreview;

    if (summary) {
      const tone = diagnostics.publicDeliveryReady ? 'success' : 'warn';
      summary.dataset.tone = tone;
      summary.innerHTML = `
        <strong>${diagnostics.publicDeliveryReady ? 'Candidate email delivery is close to production-ready.' : 'Candidate email delivery still needs attention.'}</strong>
        <p>${escapeHtml(
          diagnostics.publicDeliveryReady
            ? 'Custom SMTP, redirects, and branding are in place. Apply the settings to Supabase Auth after every material change.'
            : 'Without custom SMTP, public candidate verification and password reset emails are not dependable for real candidates.'
        )}</p>
      `;
    }

    if (list) {
      list.innerHTML = '';
      const items = [
        {
          tone: diagnostics.publicDeliveryReady ? 'ok' : 'warn',
          title: diagnostics.publicDeliveryReady ? 'Custom SMTP ready' : 'Custom SMTP incomplete',
          body: diagnostics.publicDeliveryReady
            ? `SMTP is configured for ${settings.senderEmail || 'the HMJ sender address'}.`
            : 'Add the real HMJ mailbox credentials to switch Supabase away from the default test mailer.',
        },
        {
          tone: diagnostics.redirectsReady ? 'ok' : 'danger',
          title: diagnostics.redirectsReady ? 'Redirect URLs look valid' : 'Redirect URLs need fixing',
          body: diagnostics.redirectsReady
            ? `Verification and recovery return to ${settings.siteUrl || 'the candidate portal'}.`
            : 'Verification or recovery links are incomplete and can break email authentication flows.',
        },
        {
          tone: diagnostics.managementTokenAvailable ? 'ok' : 'warn',
          title: diagnostics.managementTokenAvailable ? 'Direct Supabase apply available' : 'Direct Supabase apply needs a management token',
          body: diagnostics.managementTokenAvailable
            ? 'The Netlify environment includes a Supabase management token, so this page can push auth email settings directly.'
            : 'Add SUPABASE_MANAGEMENT_ACCESS_TOKEN to Netlify or paste a one-time Supabase personal access token into the field above before clicking Apply.',
        },
        {
          tone: settings.lastAppliedAt ? 'ok' : 'warn',
          title: settings.lastAppliedAt ? 'Last applied to Supabase' : 'Not yet applied from admin',
          body: settings.lastAppliedAt
            ? `${formatTime(settings.lastAppliedAt)} by ${settings.lastAppliedBy || 'an admin user'}.`
            : 'Saved settings do not change the live Supabase auth emails until they are applied.',
        },
      ];

      items.forEach((item) => {
        const node = createEl('div', { className: 'status-item', attrs: { 'data-tone': item.tone } });
        node.appendChild(createEl('strong', { text: item.title }));
        node.appendChild(createEl('p', { text: item.body }));
        list.appendChild(node);
      });

      (diagnostics.warnings || []).forEach((warning) => {
        const node = createEl('div', { className: 'status-item', attrs: { 'data-tone': 'warn' } });
        node.appendChild(createEl('strong', { text: 'Warning' }));
        node.appendChild(createEl('p', { text: warning }));
        list.appendChild(node);
      });
    }

    if (patchPreview) {
      patchPreview.textContent = state.candidateEmailPatchPreview
        ? JSON.stringify(state.candidateEmailPatchPreview, null, 2)
        : 'No preview available yet.';
    }
  }

  function renderCandidateEmailPreview() {
    const previews = state.candidateEmailPreviews || {};
    const mode = state.candidateEmailPreviewMode || 'confirmation';
    const frame = els.candidateEmailPreviewFrame;
    const title = els.candidateEmailPreviewTitle;
    const meta = els.candidateEmailPreviewMeta;
    const labels = {
      confirmation: 'Verification email',
      recovery: 'Password reset email',
      email_change: 'Email change email',
    };
    if (title) title.textContent = labels[mode] || 'Candidate email preview';
    if (meta) meta.textContent = 'Live preview generated from the saved settings.';
    if (frame) {
      frame.srcdoc = previews[mode] || '<p style="font-family:Arial,sans-serif;padding:24px;">Preview unavailable.</p>';
    }
    els.previewButtons.forEach((button) => {
      button.classList.toggle('primary', button.getAttribute('data-email-preview') === mode);
      button.classList.toggle('ghost', button.getAttribute('data-email-preview') !== mode);
    });
  }

  function applyCandidateEmailResponse(payload, message, tone) {
    state.candidateEmailSettings = payload?.settings || state.candidateEmailSettings;
    state.candidateEmailDiagnostics = payload?.diagnostics || state.candidateEmailDiagnostics;
    state.candidateEmailPreviews = payload?.previews || state.candidateEmailPreviews;
    state.candidateEmailPatchPreview = payload?.patchPreview || state.candidateEmailPatchPreview;
    setCandidateEmailForm(state.candidateEmailSettings || {});
    renderCandidateEmailStatus();
    renderCandidateEmailPreview();
    if (message) {
      updateCandidateEmailNotice(message, tone || 'success');
    }
  }

  function updateTaskCalendarNotice(message, tone = 'warn', detail = '') {
    const notice = els.taskCalendarNotice;
    if (!notice) return;
    const headline = trimText(message, 260);
    const body = trimText(detail, 520);
    if (!headline && !body) {
      notice.hidden = true;
      notice.innerHTML = '';
      return;
    }
    notice.hidden = false;
    notice.dataset.tone = tone;
    notice.innerHTML = `
      <strong>${escapeHtml(headline || 'Team Tasks calendar setup')}</strong>
      ${body ? `<p>${escapeHtml(body)}</p>` : ''}
    `;
  }

  function setTaskCalendarForm(settings = {}, diagnostics = {}) {
    setFieldValue(els.taskCalendarEnabled, settings.enabled);
    setFieldValue(els.taskCalendarTenantId, settings.tenantId || 'common');
    setFieldValue(els.taskCalendarClientId, settings.clientId || '');
    setFieldValue(els.taskCalendarClientSecret, '');
    setFieldValue(els.taskCalendarClearClientSecret, false);
    setFieldValue(els.taskCalendarShowExternalEvents, settings.showExternalEvents !== false);
    setFieldValue(els.taskCalendarShowTeamConnections, settings.showTeamConnections !== false);
    setFieldValue(els.taskCalendarSyncEnabled, settings.syncEnabled !== false);
    setFieldValue(els.taskCalendarCallbackUrl, diagnostics.callbackUrl || '');
    setFieldValue(els.taskCalendarScopes, Array.isArray(diagnostics.scopes) ? diagnostics.scopes.join(' ') : '');

    if (els.taskCalendarClientSecretHint) {
      els.taskCalendarClientSecretHint.textContent = settings.clientSecretStored
        ? 'A client secret is already saved. Leave this blank to keep it unchanged.'
        : 'No client secret is saved yet. Paste the Microsoft app secret here when ready.';
    }
  }

  function readTaskCalendarForm() {
    return {
      enabled: !!els.taskCalendarEnabled?.checked,
      tenantId: trimText(els.taskCalendarTenantId?.value, 160),
      clientId: trimText(els.taskCalendarClientId?.value, 240),
      clientSecret: String(els.taskCalendarClientSecret?.value || ''),
      clearClientSecret: !!els.taskCalendarClearClientSecret?.checked,
      showExternalEvents: !!els.taskCalendarShowExternalEvents?.checked,
      showTeamConnections: !!els.taskCalendarShowTeamConnections?.checked,
      syncEnabled: !!els.taskCalendarSyncEnabled?.checked,
    };
  }

  function renderTaskCalendarStatus() {
    const diagnostics = state.taskCalendarDiagnostics || {};
    const settings = state.taskCalendarSettings || {};
    const connections = Array.isArray(state.taskCalendarConnections) ? state.taskCalendarConnections : [];
    const currentConnection = connections.find((entry) => entry.isCurrentUser) || null;
    const summary = els.taskCalendarStatusSummary;
    const list = els.taskCalendarStatusList;

    if (summary) {
      const tone = diagnostics.setupReady && settings.enabled ? 'success' : 'warn';
      summary.dataset.tone = tone;
      summary.innerHTML = `
        <strong>${diagnostics.setupReady && settings.enabled ? 'Microsoft calendar setup is ready to use.' : 'Microsoft calendar setup still needs attention.'}</strong>
        <p>${escapeHtml(
          diagnostics.setupReady && settings.enabled
            ? 'Admins can now connect their Outlook / Teams calendars and the Team Tasks weekly planner can show live diary events.'
            : 'Save the Microsoft app details first, then connect calendars from Team Tasks or this page.'
        )}</p>
      `;
    }

    if (list) {
      list.innerHTML = '';
      const items = [
        {
          tone: settings.enabled ? 'ok' : 'warn',
          title: settings.enabled ? 'Calendar sync enabled' : 'Calendar sync disabled',
          body: settings.enabled
            ? 'Team Tasks is allowed to offer Microsoft calendar connections.'
            : 'The UI can show setup guidance, but no Microsoft connections should be started until this is enabled.',
        },
        {
          tone: diagnostics.setupReady ? 'ok' : 'danger',
          title: diagnostics.setupReady ? 'Microsoft app details saved' : 'Microsoft app details incomplete',
          body: diagnostics.setupReady
            ? `Client ID and client secret are saved. Callback URL: ${diagnostics.callbackUrl || 'Unavailable'}.`
            : 'Client ID, client secret, or callback URL setup is still incomplete.',
        },
        {
          tone: currentConnection ? 'ok' : 'warn',
          title: currentConnection ? 'Your calendar is connected' : 'Your calendar is not connected yet',
          body: currentConnection
            ? `${currentConnection.externalAccountEmail || currentConnection.userEmail} is linked and ready for the Team Tasks planner.`
            : 'Use the connect button after saving the Microsoft app details to link your own Outlook / Teams diary.',
        },
        {
          tone: connections.length ? 'ok' : 'warn',
          title: connections.length ? `${connections.length} connected team ${connections.length === 1 ? 'member' : 'members'}` : 'No team calendars connected yet',
          body: connections.length
            ? 'The weekly Team Tasks planner can now combine due tasks with live connected diary events.'
            : 'Once admins connect their calendars, the planner will show diary blocks using their assigned colour.',
        },
      ];

      items.forEach((item) => {
        const node = createEl('div', { className: 'status-item', attrs: { 'data-tone': item.tone } });
        node.appendChild(createEl('strong', { text: item.title }));
        node.appendChild(createEl('p', { text: item.body }));
        list.appendChild(node);
      });

      (diagnostics.warnings || []).forEach((warning) => {
        const node = createEl('div', { className: 'status-item', attrs: { 'data-tone': 'warn' } });
        node.appendChild(createEl('strong', { text: 'Warning' }));
        node.appendChild(createEl('p', { text: warning }));
        list.appendChild(node);
      });
    }

    if (els.taskCalendarCurrentConnection) {
      els.taskCalendarCurrentConnection.textContent = currentConnection
        ? `${currentConnection.userDisplayName || currentConnection.userEmail} is connected as ${currentConnection.externalAccountEmail || 'a Microsoft account'}. Team Tasks will show diary events in the weekly planner when live sync is enabled.`
        : 'No personal Microsoft calendar is connected for your admin account yet. Save the app setup first, then connect your Outlook / Teams diary to see live commitments inside the weekly planner.';
    }

    if (els.btnTaskCalendarConnect) {
      els.btnTaskCalendarConnect.disabled = !(diagnostics.setupReady && settings.enabled);
    }
    if (els.btnTaskCalendarDisconnect) {
      els.btnTaskCalendarDisconnect.disabled = !currentConnection;
    }
  }

  function applyTaskCalendarSettingsResponse(payload, message, tone) {
    state.taskCalendarSettings = payload?.settings || state.taskCalendarSettings;
    state.taskCalendarDiagnostics = payload?.diagnostics || state.taskCalendarDiagnostics;
    setTaskCalendarForm(state.taskCalendarSettings || {}, state.taskCalendarDiagnostics || {});
    renderTaskCalendarStatus();
    if (message) {
      updateTaskCalendarNotice(message, tone || 'success');
    }
  }

  async function loadTaskCalendarSettings() {
    if (!state.helpers?.api) return;
    updateTaskCalendarNotice('Loading Team Tasks calendar setup…', 'warn', 'Checking the saved Microsoft app and connection details.');
    try {
      const payload = await state.helpers.api('admin-team-tasks-calendar-settings', 'POST', { action: 'get' });
      applyTaskCalendarSettingsResponse(payload, '', 'success');
      updateTaskCalendarNotice('', 'warn');
      await loadTaskCalendarStatus();
    } catch (error) {
      updateTaskCalendarNotice(
        error?.message || 'Unable to load Team Tasks calendar settings.',
        'danger',
        'The setup panel is still available, but current Microsoft calendar values could not be loaded.'
      );
    }
  }

  async function loadTaskCalendarStatus() {
    if (!state.helpers?.api) return;
    try {
      const payload = await state.helpers.api('admin-team-tasks-calendar-status', 'POST', { includeEvents: false });
      state.taskCalendarConnections = Array.isArray(payload?.connections) ? payload.connections : [];
      if (payload?.diagnostics) {
        state.taskCalendarDiagnostics = payload.diagnostics;
      }
      renderTaskCalendarStatus();
    } catch (error) {
      state.taskCalendarConnections = [];
      renderTaskCalendarStatus();
    }
  }

  async function handleTaskCalendarSave(event) {
    event?.preventDefault?.();
    try {
      const payload = await state.helpers.api('admin-team-tasks-calendar-settings', 'POST', {
        action: 'save',
        settings: readTaskCalendarForm(),
      });
      applyTaskCalendarSettingsResponse(payload, payload?.message || 'Team Tasks calendar settings saved.', 'success');
      await loadTaskCalendarStatus();
      toast('Team Tasks calendar settings saved', 'info', 2200);
      logActivity({
        label: 'Saved Team Tasks calendar settings',
        detail: state.taskCalendarSettings?.enabled ? 'Microsoft calendar sync enabled' : 'Microsoft calendar sync disabled',
        kind: 'settings',
      });
    } catch (error) {
      updateTaskCalendarNotice(error?.message || 'Unable to save Team Tasks calendar settings.', 'danger');
    }
  }

  async function handleTaskCalendarConnect() {
    if (!(state.taskCalendarDiagnostics?.setupReady && state.taskCalendarSettings?.enabled)) {
      updateTaskCalendarNotice(
        'Save the Microsoft app details first.',
        'warn',
        'Calendar connection is only available after the app details are complete and calendar sync is enabled.'
      );
      return;
    }
    try {
      const payload = await state.helpers.api('admin-team-tasks-calendar-connect', 'POST', {
        returnTo: `${window.location.origin}/admin/settings.html#taskCalendarSettings`,
      });
      if (!trimText(payload?.url, 4000)) {
        throw new Error('Microsoft calendar connection URL was not returned.');
      }
      window.location.href = payload.url;
    } catch (error) {
      updateTaskCalendarNotice(error?.message || 'Unable to start Microsoft calendar connection.', 'danger');
    }
  }

  async function handleTaskCalendarDisconnect() {
    try {
      const payload = await state.helpers.api('admin-team-tasks-calendar-disconnect', 'POST', {});
      state.taskCalendarConnections = [];
      await loadTaskCalendarStatus();
      updateTaskCalendarNotice(payload?.message || 'Your Microsoft calendar connection was removed.', 'success');
      toast('Microsoft calendar disconnected', 'info', 2200);
      logActivity({
        label: 'Disconnected Microsoft calendar',
        detail: 'Team Tasks',
        kind: 'settings',
      });
    } catch (error) {
      updateTaskCalendarNotice(error?.message || 'Unable to disconnect Microsoft calendar.', 'danger');
    }
  }

  async function loadCandidateEmailSettings() {
    if (!state.helpers?.api) return;
    updateCandidateEmailNotice('Loading candidate email settings…', 'warn', 'Checking the saved SMTP, redirect, and email template values.');
    try {
      const payload = await state.helpers.api('admin-candidate-email-settings', 'POST', { action: 'get' });
      applyCandidateEmailResponse(payload, '', 'success');
      updateCandidateEmailNotice('', 'warn');
    } catch (error) {
      const message = error?.message || 'Unable to load candidate email settings.';
      updateCandidateEmailNotice(message, 'danger', 'The settings module is still available, but the current values could not be loaded from the shared store.');
    }
  }

  async function handleCandidateEmailSave(event) {
    event?.preventDefault?.();
    try {
      const payload = await state.helpers.api('admin-candidate-email-settings', 'POST', {
        action: 'save',
        settings: readCandidateEmailForm(),
      });
      applyCandidateEmailResponse(payload, payload?.message || 'Candidate email settings saved.', 'success');
      toast('Candidate email settings saved', 'info', 2200);
      logActivity({
        label: 'Saved candidate email settings',
        detail: state.candidateEmailSettings?.senderEmail || 'Candidate email setup',
        kind: 'settings',
      });
    } catch (error) {
      updateCandidateEmailNotice(error?.message || 'Unable to save candidate email settings.', 'danger');
    }
  }

  async function handleCandidateEmailApply() {
    try {
      const managementToken = trimText(els.candidateSupabaseManagementToken?.value, 4000);
      const payload = await state.helpers.api('admin-candidate-email-settings', 'POST', {
        action: 'apply',
        settings: readCandidateEmailForm(),
        managementToken,
      });
      applyCandidateEmailResponse(payload, payload?.message || 'Candidate email settings were applied to Supabase Auth.', 'success');
      if (els.candidateSupabaseManagementToken) {
        els.candidateSupabaseManagementToken.value = '';
      }
      toast('Candidate email settings applied to Supabase', 'info', 2600);
      logActivity({
        label: 'Applied candidate email settings to Supabase',
        detail: state.candidateEmailSettings?.senderEmail || 'Candidate email setup',
        kind: 'settings',
      });
    } catch (error) {
      const details = error?.details || {};
      state.candidateEmailPatchPreview = details.patch || state.candidateEmailPatchPreview;
      if (details.diagnostics) {
        state.candidateEmailDiagnostics = details.diagnostics;
      }
      renderCandidateEmailStatus();
      updateCandidateEmailNotice(
        error?.message || 'Unable to apply candidate email settings.',
        'danger',
        details?.response?.message || 'Check the warnings on this page. If Netlify does not have a Supabase management token yet, paste a one-time Supabase personal access token into the field above before trying again.'
      );
    }
  }

  function syncProviderPreset() {
    const provider = trimText(els.candidateEmailProvider?.value, 64) || 'godaddy_microsoft365';
    const preset = PRESET_DEFAULTS[provider] || PRESET_DEFAULTS.custom;
    if (els.candidateSmtpHost && !trimText(els.candidateSmtpHost.value, 320)) {
      els.candidateSmtpHost.value = preset.smtpHost;
    }
    if (els.candidateSmtpPort && !trimText(els.candidateSmtpPort.value, 16)) {
      els.candidateSmtpPort.value = preset.smtpPort;
    }
    if (els.candidateSmtpEncryption) {
      els.candidateSmtpEncryption.value = preset.smtpEncryption;
    }
    if (provider === 'supabase_default' && els.candidateCustomSmtpEnabled) {
      els.candidateCustomSmtpEnabled.checked = false;
    }
  }

  function bindActions() {
    ['btnHealth', 'btnHealthSecondary'].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.addEventListener('click', runHealthCheck);
    });

    const clear = document.getElementById('btnClearActivity');
    if (clear) {
      clear.addEventListener('click', () => {
        state.activity = [];
        persistActivity();
        renderActivity();
        toast('Activity cleared', 'info', 2200);
      });
    }

    Array.from(document.querySelectorAll('[data-settings-link]')).forEach((link) => {
      link.addEventListener('click', () => {
        const label = link.getAttribute('data-settings-link') || link.textContent.trim();
        logActivity({
          label: `Navigated to ${label}`,
          detail: link.getAttribute('href') || '',
          kind: 'nav',
          href: link.href || null
        });
      });
    });

    els.candidateEmailSettingsForm?.addEventListener('submit', handleCandidateEmailSave);
    els.btnApplyCandidateEmailSettings?.addEventListener('click', handleCandidateEmailApply);
    els.candidateEmailProvider?.addEventListener('change', syncProviderPreset);
    els.taskCalendarSettingsForm?.addEventListener('submit', handleTaskCalendarSave);
    els.btnTaskCalendarConnect?.addEventListener('click', handleTaskCalendarConnect);
    els.btnTaskCalendarDisconnect?.addEventListener('click', handleTaskCalendarDisconnect);

    els.previewButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.candidateEmailPreviewMode = button.getAttribute('data-email-preview') || 'confirmation';
        renderCandidateEmailPreview();
      });
    });
  }

  function init({ helpers, who }) {
    state.helpers = helpers;
    state.who = who;
    cacheDom();
    setChip('settingsEnvChip', `${detectEnvironment(window.location.hostname)} environment`);
    loadActivity();
    renderActivity();
    bindActions();
    loadSettingsStatus();
    loadCandidateEmailSettings();
    loadTaskCalendarSettings();
  }

  window.HMJAdminSettings = { init };
})();
