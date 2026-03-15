(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }

  const api = factory();
  root.HMJAdminAuthExperience = api;
  api.boot();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const flowHelpers = typeof window !== 'undefined' ? (window.HMJAuthFlow || {}) : {};
  const supportEmail = 'info@hmj-global.com';
  const supportMailto = `mailto:${supportEmail}?subject=${encodeURIComponent('HMJ Admin Access Help')}`;
  const PASSWORD_MIN_LENGTH = 10;
  const ADMIN_ROUTES = {
    login: '/admin/',
    forgot: '/admin/forgot-password.html',
    complete: '/admin/complete-account.html',
    reset: '/admin/reset-password.html',
    account: '/admin/account.html'
  };

  const copyByIntent = {
    invite: {
      badge: 'Invite link detected',
      title: 'Create your HMJ password',
      intro: 'This HMJ invite is ready for you to create a password and finish your admin account setup.',
      steps: [
        ['Create a new password', 'Choose a strong password for your HMJ work account.'],
        ['Confirm the setup', 'Finish the account setup securely on this page.'],
        ['Continue into admin', 'Once saved, you will be redirected back into HMJ admin.']
      ],
      recoveryHint: 'If this invite has expired or has already been used, contact HMJ access support for a fresh invite.'
    },
    recovery: {
      badge: 'Password reset link detected',
      title: 'Reset your password',
      intro: 'This HMJ password reset link is ready. Set your new password securely on this page.',
      steps: [
        ['Enter a new password', 'Choose a strong replacement password for your HMJ work account.'],
        ['Confirm the reset', 'Save the new password securely on this page.'],
        ['Return to admin', 'Once saved, HMJ will route you back into the admin area.']
      ],
      recoveryHint: 'If the link has expired, request a fresh password reset email from the HMJ admin sign-in page.'
    },
    confirmation: {
      badge: 'Confirmation link detected',
      title: 'Complete sign-in',
      intro: 'We detected an HMJ confirmation link. HMJ will route you into the safest next step.',
      steps: [
        ['Review the sign-in state', 'HMJ will confirm whether you need to sign in or continue to admin.'],
        ['Follow any secure prompt', 'If another step is required, use the HMJ sign-in page.'],
        ['Continue to admin', 'You will be redirected back into HMJ admin when ready.']
      ],
      recoveryHint: 'If the confirmation no longer works, request a new reset email or contact HMJ access support.'
    },
    session: {
      badge: 'Secure session detected',
      title: 'Finish signing in',
      intro: 'HMJ detected a secure sign-in callback and will route you into the correct admin flow.',
      steps: [
        ['Let HMJ confirm the session', 'The admin sign-in page will check your secure callback state.'],
        ['Continue safely', 'If extra action is needed, HMJ will guide you to the correct page.'],
        ['Open admin', 'You will be redirected back into HMJ admin when ready.']
      ],
      recoveryHint: 'If this secure sign-in step fails, return to HMJ admin and start a fresh password reset.'
    },
    default: {
      badge: 'Secure HMJ access',
      title: 'Secure access guidance',
      intro: 'Use your HMJ work email to sign in, request a password reset, or finish an access email on this site.',
      steps: [
        ['Sign in with your HMJ email', 'Use the HMJ admin sign-in form with your work email and password.'],
        ['Reset a forgotten password', 'Request a fresh reset email if you cannot sign in.'],
        ['Need first-time access?', 'Open your latest invite on this site, or contact HMJ access support if it has expired.']
      ],
      recoveryHint: 'Use your HMJ work email. If you never created a password and no longer have the invite email, contact HMJ access support.'
    }
  };

  function safeString(value) {
    return typeof value === 'string' ? value : '';
  }

  function select(selector, rootNode) {
    const scope = rootNode || (typeof document !== 'undefined' ? document : null);
    return scope && typeof scope.querySelector === 'function' ? scope.querySelector(selector) : null;
  }

  function selectAll(selector, rootNode) {
    const scope = rootNode || (typeof document !== 'undefined' ? document : null);
    return scope && typeof scope.querySelectorAll === 'function' ? Array.from(scope.querySelectorAll(selector)) : [];
  }

  function currentView() {
    if (typeof document === 'undefined') return '';
    return safeString(document.body?.dataset?.authView).trim().toLowerCase();
  }

  function emitAuthEvent(eventName, details) {
    try {
      window.HMJAdminAuthDiagnostics?.emit?.(eventName, details || {});
    } catch (err) {
      // Diagnostics should never break the auth flow.
    }
  }

  function onReady(callback) {
    if (typeof document === 'undefined' || typeof callback !== 'function') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
      return;
    }
    callback();
  }

  function currentLocation() {
    if (typeof window === 'undefined' || !window.location) {
      return { pathname: '/', search: '', hash: '' };
    }
    return window.location;
  }

  function parseAuthState() {
    if (typeof flowHelpers.parseAuthState === 'function') {
      return flowHelpers.parseAuthState(currentLocation());
    }
    return {
      intent: '',
      hasError: false,
      hasTokenPayload: false,
      isAuthCallback: false,
      authParams: {}
    };
  }

  function normalisePathname(pathname) {
    if (typeof flowHelpers.normalisePathname === 'function') {
      return flowHelpers.normalisePathname(pathname);
    }
    const raw = safeString(pathname).trim();
    if (!raw) return '/';
    return raw.startsWith('/') ? raw : `/${raw}`;
  }

  function currentUrl() {
    const loc = currentLocation();
    return `${safeString(loc.pathname)}${safeString(loc.search)}${safeString(loc.hash)}`;
  }

  function buildAuthHandoffUrl(destination) {
    if (typeof flowHelpers.buildAuthHandoffUrl === 'function') {
      return flowHelpers.buildAuthHandoffUrl(destination, currentLocation());
    }
    return safeString(destination).trim() || ADMIN_ROUTES.login;
  }

  function buildIntentDestination(intent, fallbackDestination) {
    const fallback = safeString(fallbackDestination).trim() || ADMIN_ROUTES.login;
    const lowered = safeString(intent).trim().toLowerCase();
    if (lowered === 'invite') return ADMIN_ROUTES.complete;
    if (lowered === 'recovery') return ADMIN_ROUTES.reset;
    return fallback;
  }

  function readNotice(search) {
    const raw = safeString(search).trim().replace(/^\?/, '');
    const params = new URLSearchParams(raw);
    return {
      notice: safeString(params.get('auth_notice')).trim().toLowerCase(),
      email: safeString(params.get('email')).trim(),
      next: safeString(params.get('next')).trim()
    };
  }

  function scrubNoticeParams() {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    try {
      const url = new URL(window.location.href);
      let changed = false;
      ['auth_notice', 'email'].forEach((key) => {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
          changed = true;
        }
      });
      if (!changed) return;
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    } catch (err) {
      // Ignore a non-fatal clean-up failure.
    }
  }

  function classifyIdentityError(error) {
    const raw = safeString(
      error?.message ||
      error?.msg ||
      error?.error ||
      error?.error_description ||
      error?.description ||
      error
    ).trim();
    const text = raw.replace(/\s+/g, ' ');
    const lower = text.toLowerCase();

    if (!text) {
      return {
        reason: 'unexpected_error',
        message: 'We could not complete that request. Please try again.'
      };
    }
    if (lower.includes('invalid login') || lower.includes('invalid email') || lower.includes('email not found') || lower.includes('no user')) {
      return {
        reason: 'invalid_credentials',
        message: 'HMJ could not sign you in with that email and password. Check the details or request a fresh password reset.'
      };
    }
    if (lower.includes('expired') || lower.includes('already been used') || lower.includes('already used')) {
      return {
        reason: 'expired_or_used_link',
        message: 'This secure email link has expired or has already been used. Request a new password email or contact HMJ access support.'
      };
    }
    if (lower.includes('invalid') || lower.includes('not valid') || lower.includes('verification failed') || lower.includes('no longer valid')) {
      return {
        reason: 'invalid_link',
        message: 'This secure email link is no longer valid. Open the newest email you received, or request a fresh password reset.'
      };
    }
    if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch')) {
      return {
        reason: 'network_error',
        message: 'HMJ could not reach the secure sign-in service just now. Check your connection and try again.'
      };
    }
    if (lower.includes('unauthorized') || lower.includes('forbidden')) {
      return {
        reason: 'session_verification_failed',
        message: 'This session could not be verified. Sign in again on the HMJ admin page.'
      };
    }
    if (lower.includes('password')) {
      return {
        reason: 'password_validation',
        message: text
      };
    }
    return {
      reason: 'unexpected_error',
      message: text
    };
  }

  function normaliseIdentityError(error) {
    return classifyIdentityError(error).message;
  }

  function getRequestedDestination() {
    return getRequestedNext() || ADMIN_ROUTES.account;
  }

  async function readAdminSnapshot() {
    try {
      if (typeof window.getIdentity === 'function') {
        return await window.getIdentity({ requiredRole: 'admin', forceFresh: true, cacheTtlMs: 0, verbose: false });
      }
    } catch (err) {
      return null;
    }
    return null;
  }

  async function maybeRedirectAuthenticatedAdmin(view, state) {
    if (view === 'account') return false;
    const snapshot = await readAdminSnapshot();
    if (!snapshot?.ok) return false;

    if (view === 'login' || view === 'forgot-password') {
      emitAuthEvent('signed_in_redirect', {
        status: 'redirect',
        source: view,
        email: snapshot.email || snapshot.identityEmail || '',
        next: getRequestedDestination()
      });
      navigateReplace(getRequestedDestination());
      return true;
    }

    if ((view === 'complete-account' || view === 'reset-password') && !state.hasTokenPayload) {
      emitAuthEvent('signed_in_redirect', {
        status: 'redirect',
        source: view,
        email: snapshot.email || snapshot.identityEmail || '',
        next: getRequestedDestination()
      });
      navigateReplace(getRequestedDestination());
      return true;
    }

    return false;
  }

  function validatePasswordPair(password, confirmPassword) {
    const pass = safeString(password);
    const confirm = safeString(confirmPassword);
    if (pass.length < PASSWORD_MIN_LENGTH) {
      return {
        ok: false,
        message: `Use at least ${PASSWORD_MIN_LENGTH} characters for your HMJ password.`
      };
    }
    if (confirm && pass !== confirm) {
      return {
        ok: false,
        message: 'The passwords do not match yet.'
      };
    }
    return { ok: true, message: '' };
  }

  function currentCopy(state) {
    const key = state.intent && copyByIntent[state.intent] ? state.intent : 'default';
    return copyByIntent[key];
  }

  function setMessage(node, text, tone) {
    if (!node) return;
    const value = safeString(text).trim();
    if (!value) {
      node.hidden = true;
      node.textContent = '';
      node.removeAttribute('data-tone');
      return;
    }
    node.hidden = false;
    node.textContent = value;
    node.setAttribute('data-tone', safeString(tone).trim() || 'info');
  }

  function setBusy(form, busy) {
    if (!form) return;
    if (busy) form.setAttribute('aria-busy', 'true');
    else form.removeAttribute('aria-busy');
  }

  function setPressed(activeName) {
    selectAll('[data-auth-toggle]').forEach((button) => {
      const isActive = safeString(button.dataset.authToggle) === activeName;
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function ensureSupportLinks() {
    selectAll('[data-auth-support-link]').forEach((node) => {
      node.setAttribute('href', supportMailto);
    });
  }

  function applyNoticeToLoginPage(messageNode, loginEmailInput, recoveryEmailInput) {
    const notice = readNotice(currentLocation().search);
    if (notice.notice === 'reset-complete') {
      setMessage(messageNode, 'Password reset complete. Sign in with your new password to continue.', 'ok');
    } else if (notice.notice === 'invite-complete') {
      setMessage(messageNode, 'Account setup complete. Sign in with your HMJ work email and new password.', 'ok');
    } else if (notice.notice === 'signed-out') {
      setMessage(messageNode, 'You have been signed out of HMJ admin.', 'info');
    }

    if (notice.email) {
      if (loginEmailInput && !safeString(loginEmailInput.value).trim()) {
        loginEmailInput.value = notice.email;
      }
      if (recoveryEmailInput && !safeString(recoveryEmailInput.value).trim()) {
        recoveryEmailInput.value = notice.email;
      }
    }

    scrubNoticeParams();
  }

  function normaliseNextTarget(input) {
    const raw = safeString(input).trim();
    if (!raw || /^([a-z]+:)?\/\//i.test(raw) || raw.includes('..')) return '';
    let candidate = raw;
    if (!candidate.startsWith('/')) {
      candidate = candidate.startsWith('admin/') ? `/${candidate}` : `/admin/${candidate}`;
    }
    try {
      const url = new URL(candidate, typeof window !== 'undefined' ? window.location.origin : 'https://example.com');
      const path = url.pathname || '';
      const file = path.split('/').pop() || '';
      if (!path.startsWith('/admin/')) return '';
      if (!/^[a-z0-9-]+\.html$/i.test(file)) return '';
      if (file.toLowerCase() === 'index.html') return '';
      return `${path}${url.search || ''}${url.hash || ''}`;
    } catch (err) {
      return '';
    }
  }

  function buildAdminEntryUrl(nextTarget, extraParams) {
    const safeNext = normaliseNextTarget(nextTarget);
    const params = new URLSearchParams();
    if (safeNext) {
      params.set('next', safeNext.replace(/^\/admin\//, ''));
    }
    const extras = extraParams && typeof extraParams === 'object' ? extraParams : {};
    Object.entries(extras).forEach(([key, value]) => {
      const text = safeString(value).trim();
      if (!text) return;
      params.set(key, text);
    });
    const suffix = params.toString();
    return suffix ? `${ADMIN_ROUTES.login}?${suffix}` : ADMIN_ROUTES.login;
  }

  function getRequestedNext() {
    const params = new URLSearchParams(safeString(currentLocation().search).replace(/^\?/, ''));
    return normaliseNextTarget(params.get('next'));
  }

  function navigateReplace(target) {
    const destination = safeString(target).trim();
    if (!destination || typeof window === 'undefined') return;
    try {
      window.location.replace(destination);
    } catch (err) {
      window.location.href = destination;
    }
  }

  async function wait(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function resolveIdentity(maxMs) {
    const timeoutMs = Number.isFinite(maxMs) ? maxMs : 6000;
    const started = Date.now();

    while ((Date.now() - started) < timeoutMs) {
      try {
        if (typeof window !== 'undefined' && typeof window.hmjEnsureIdentityWidget === 'function') {
          window.hmjEnsureIdentityWidget();
        }
      } catch (err) {
        // Ignore and retry.
      }

      try {
        if (typeof window !== 'undefined' && typeof window.hmjConfigureIdentity === 'function') {
          window.hmjConfigureIdentity(true);
        }
      } catch (err) {
        // Ignore and retry.
      }

      const identity = typeof window !== 'undefined' ? (window.netlifyIdentity || null) : null;
      if (identity) {
        try {
          if (typeof identity.init === 'function' && !identity.__hmjAuthExperienceInit) {
            identity.__hmjAuthExperienceInit = true;
            const apiUrl = safeString(
              window.ADMIN_IDENTITY_URL ||
              window.HMJ_IDENTITY_URL ||
              window.NETLIFY_IDENTITY_URL
            ).trim();
            identity.init(apiUrl ? { APIUrl: apiUrl, autologin: false } : { autologin: false });
          }
        } catch (err) {
          const message = safeString(err?.message).toLowerCase();
          if (!message.includes('already initialized')) {
            console.warn('[HMJ auth] identity init failed', err);
          }
        }
        return identity;
      }
      await wait(120);
    }

    return typeof window !== 'undefined' ? (window.netlifyIdentity || null) : null;
  }

  function resolveGoTrue(identity) {
    if (identity?.gotrue) return identity.gotrue;
    return null;
  }

  function resolveIdentityApiBase() {
    if (typeof window === 'undefined') return '/.netlify/identity';
    return safeString(
      window.ADMIN_IDENTITY_URL ||
      window.HMJ_IDENTITY_URL ||
      window.NETLIFY_IDENTITY_URL ||
      '/.netlify/identity'
    ).trim().replace(/\/$/, '') || '/.netlify/identity';
  }

  function buildIdentityEndpoint(path) {
    const cleanPath = safeString(path).trim().replace(/^\/+/, '');
    const base = resolveIdentityApiBase();
    try {
      return new URL(cleanPath ? `${base}/${cleanPath}` : `${base}/`, window.location.origin).toString();
    } catch (err) {
      return cleanPath ? `${base}/${cleanPath}` : `${base}/`;
    }
  }

  async function fetchIdentityJson(path, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const method = safeString(opts.method).trim().toUpperCase() || 'GET';
    const headers = {
      'Accept': 'application/json'
    };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (opts.token) {
      headers.Authorization = `Bearer ${opts.token}`;
    }

    const response = await fetch(buildIdentityEndpoint(path), {
      method,
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });

    const rawText = await response.text();
    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (err) {
      data = rawText ? { raw: rawText } : null;
    }

    if (!response.ok) {
      const error = new Error(
        safeString(data?.msg || data?.error_description || data?.error || rawText).trim() ||
        `Request failed (${response.status})`
      );
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data || {};
  }

  async function waitForSignedInUser(identity, fallbackUser, maxMs) {
    const timeoutMs = Number.isFinite(maxMs) ? maxMs : 4200;
    const directUser = typeof identity?.currentUser === 'function' ? identity.currentUser() : null;
    if (directUser) return directUser;

    const fallback = fallbackUser && typeof fallbackUser === 'object'
      ? (fallbackUser.user && typeof fallbackUser.user === 'object' ? fallbackUser.user : fallbackUser)
      : null;
    if (fallback) return fallback;

    const started = Date.now();
    while ((Date.now() - started) < timeoutMs) {
      await wait(140);
      const nextUser = typeof identity?.currentUser === 'function' ? identity.currentUser() : null;
      if (nextUser) return nextUser;
    }

    return fallback || null;
  }

  async function signInWithPassword(email, password) {
    const result = await fetchIdentityJson('token?grant_type=password', {
      method: 'POST',
      body: {
        email,
        password
      }
    });

    const accessToken = safeString(result?.access_token).trim();
    if (!accessToken) {
      throw new Error('No verified session was returned for this sign-in attempt. Please try again.');
    }

    const identity = await resolveIdentity(2400);
    const seededUser = Object.assign(
      {},
      result?.user && typeof result.user === 'object' ? result.user : {},
      result,
      {
        email: readUserEmail(result?.user) || safeString(result?.email).trim() || safeString(email).trim(),
        access_token: accessToken,
        refresh_token: safeString(result?.refresh_token).trim()
      }
    );

    if (identity && !identity.__hmjInitUser) {
      identity.__hmjInitUser = seededUser;
    }

    return waitForSignedInUser(identity, seededUser, 1200);
  }

  async function requestPasswordResetEmail(email) {
    await fetchIdentityJson('recover', {
      method: 'POST',
      body: {
        email
      }
    });
    return true;
  }

  async function verifyInviteWithPassword(token, password) {
    let lastError = null;
    for (const type of ['invite', 'signup']) {
      try {
        return await fetchIdentityJson('verify', {
          method: 'POST',
          body: {
            type,
            token,
            password
          }
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('We could not complete the invite verification.');
  }

  async function verifyRecoveryToken(token) {
    return fetchIdentityJson('verify', {
      method: 'POST',
      body: {
        type: 'recovery',
        token
      }
    });
  }

  async function updatePasswordWithToken(accessToken, password) {
    return fetchIdentityJson('user', {
      method: 'PUT',
      token: accessToken,
      body: {
        password
      }
    });
  }

  async function fetchUserWithToken(accessToken) {
    return fetchIdentityJson('user', {
      method: 'GET',
      token: accessToken
    });
  }

  function readAuthEmail(state) {
    return safeString(state?.authParams?.email).trim();
  }

  function readUserEmail(user) {
    if (!user || typeof user !== 'object') return '';
    return safeString(
      user.email ||
      user.user?.email ||
      user.user_metadata?.email ||
      user.user?.user_metadata?.email
    ).trim();
  }

  async function tryAutoLogin(email, password) {
    const user = await signInWithPassword(email, password);
    return !!user;
  }

  function setFieldValue(node, value) {
    if (!node) return;
    const next = safeString(value).trim();
    if (!next) return;
    if (!safeString(node.value).trim()) {
      node.value = next;
    }
  }

  function updateStatusPanel(state) {
    const title = select('#authStateTitle');
    const body = select('#authStateCopy');
    const badge = select('#authContextBadge');
    const note = select('#authRecoveryNote');
    const list = select('#authStateSteps');
    const continueButton = select('[data-auth-action="continue-token"]');
    const copy = currentCopy(state);

    if (title) title.textContent = copy.title;
    if (body) body.textContent = copy.intro;
    if (badge) badge.textContent = copy.badge;
    if (note) note.textContent = copy.recoveryHint;

    if (continueButton) {
      continueButton.hidden = !state.hasTokenPayload;
      continueButton.textContent = state.intent === 'invite'
        ? 'Continue account setup'
        : state.intent === 'recovery'
          ? 'Continue password reset'
          : 'Continue secure email link';
    }

    if (!list) return;
    list.innerHTML = '';
    copy.steps.forEach((step, index) => {
      const item = document.createElement('li');
      item.setAttribute('data-step', String(index + 1));
      const text = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = step[0];
      const small = document.createElement('span');
      small.textContent = step[1];
      text.appendChild(strong);
      text.appendChild(small);
      item.appendChild(text);
      list.appendChild(item);
    });
  }

  function bindPasswordToggles() {
    selectAll('[data-password-toggle]').forEach((button) => {
      if (button.dataset.passwordToggleBound === '1') return;
      button.dataset.passwordToggleBound = '1';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const fieldId = safeString(button.dataset.passwordToggle).trim();
        const field = fieldId ? document.getElementById(fieldId) : null;
        if (!field) return;
        const show = field.type === 'password';
        field.type = show ? 'text' : 'password';
        button.textContent = show ? 'Hide' : 'Show';
        button.setAttribute('aria-pressed', show ? 'true' : 'false');
      });
    });
  }

  function showRecoveryForm(messageNode, emailInput) {
    setPressed('reset');
    setMessage(
      messageNode,
      'Enter your HMJ work email and we will send a secure password reset email if the account is recognised.',
      'info'
    );
    emailInput?.focus();
  }

  function showSetupGuidance(messageNode) {
    setPressed('setup');
    setMessage(
      messageNode,
      'Open the latest HMJ invite on this site to create your password. If the invite has expired, contact HMJ access support for a fresh one.',
      'info'
    );
  }

  function intentRedirectUrl(state) {
    const destination = buildIntentDestination(state.intent, ADMIN_ROUTES.login);
    return buildAuthHandoffUrl(destination);
  }

  function maybeRedirectByIntent(state, view) {
    const path = normalisePathname(currentLocation().pathname);
    if (view === 'login' && state.hasTokenPayload && (state.intent === 'invite' || state.intent === 'recovery')) {
      const next = intentRedirectUrl(state);
      if (next && next !== currentUrl()) {
        emitAuthEvent('auth_handoff_redirect', {
          status: 'redirect',
          source: view,
          intent: state.intent,
          next
        });
        navigateReplace(next);
        return true;
      }
    }

    if (view === 'forgot-password' && state.hasTokenPayload && state.intent === 'recovery') {
      const next = intentRedirectUrl(state);
      if (next && next !== currentUrl()) {
        emitAuthEvent('auth_handoff_redirect', {
          status: 'redirect',
          source: view,
          intent: state.intent,
          next
        });
        navigateReplace(next);
        return true;
      }
    }

    if (view === 'complete-account' && state.intent === 'recovery') {
      const next = intentRedirectUrl(state);
      if (next && next !== currentUrl()) {
        emitAuthEvent('auth_handoff_redirect', {
          status: 'redirect',
          source: view,
          intent: state.intent,
          next
        });
        navigateReplace(next);
        return true;
      }
    }

    if (view === 'reset-password' && state.intent === 'invite') {
      const next = intentRedirectUrl(state);
      if (next && next !== currentUrl()) {
        emitAuthEvent('auth_handoff_redirect', {
          status: 'redirect',
          source: view,
          intent: state.intent,
          next
        });
        navigateReplace(next);
        return true;
      }
    }

    return false;
  }

  function initLoginView(state) {
    const messageNode = select('[data-auth-message]');
    const loginForm = select('[data-auth-login-form]');
    const loginEmail = document.getElementById('authLoginEmail');
    const loginPassword = document.getElementById('authLoginPassword');
    const loginSubmit = document.getElementById('authLoginSubmit');
    const recoveryForm = select('[data-auth-recovery-form]');
    const recoveryEmail = document.getElementById('authRecoveryEmail');
    const recoverySubmit = document.getElementById('authRecoverySubmit');
    const forgotLink = document.getElementById('authForgotLink');
    const continueButton = select('[data-auth-action="continue-token"]');
    const copy = currentCopy(state);

    emitAuthEvent('login_page_opened', {
      status: state.hasError ? 'warn' : 'info',
      intent: state.intent,
      reason: state.hasError ? classifyIdentityError(state.authParams.error_description || state.authParams.error).reason : ''
    });

    updateStatusPanel(state);

    const heading = select('#authCardHeading');
    const intro = select('#authCardIntro');
    if (heading) heading.textContent = 'Sign in to continue';
    if (intro) {
      intro.textContent = state.hasError
        ? normaliseIdentityError(state.authParams.error_description || state.authParams.error)
        : 'Use your HMJ work email and password to open the secure admin workspace.';
    }

    applyNoticeToLoginPage(messageNode, loginEmail, recoveryEmail);
    setFieldValue(loginEmail, readAuthEmail(state));
    setFieldValue(recoveryEmail, readAuthEmail(state));

    if (state.hasError) {
      setMessage(messageNode, normaliseIdentityError(state.authParams.error_description || state.authParams.error), 'error');
      emitAuthEvent('invalid_token_encountered', {
        status: 'warn',
        source: 'login',
        intent: state.intent,
        reason: classifyIdentityError(state.authParams.error_description || state.authParams.error).reason
      });
    }

    if (forgotLink) {
      const notice = readNotice(currentLocation().search);
      const email = safeString(loginEmail?.value || notice.email).trim();
      const href = buildAdminEntryUrl(notice.next, email ? { email } : {});
      forgotLink.setAttribute('href', `${ADMIN_ROUTES.forgot}${href.includes('?') ? href.slice(href.indexOf('?')) : ''}`);
      loginEmail?.addEventListener('input', () => {
        const nextEmail = safeString(loginEmail.value).trim();
        const suffix = buildAdminEntryUrl(notice.next, nextEmail ? { email: nextEmail } : {});
        forgotLink.setAttribute('href', `${ADMIN_ROUTES.forgot}${suffix.includes('?') ? suffix.slice(suffix.indexOf('?')) : ''}`);
      });
    }

    continueButton?.addEventListener('click', (event) => {
      event.preventDefault();
      if (!state.hasTokenPayload) {
        setMessage(
          messageNode,
          'Open the newest HMJ invite or password email on this site and HMJ will route you into the correct next step.',
          'info'
        );
        return;
      }
      const next = intentRedirectUrl(state);
      navigateReplace(next);
    });

    selectAll('[data-auth-toggle]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const action = safeString(button.dataset.authToggle).trim();
        if (action === 'reset') {
          showRecoveryForm(messageNode, recoveryEmail);
        } else if (action === 'setup') {
          if (state.hasTokenPayload) {
            navigateReplace(intentRedirectUrl(state));
          } else {
            showSetupGuidance(messageNode);
          }
        }
      });
    });

    loginForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = safeString(loginEmail?.value).trim();
      const password = safeString(loginPassword?.value);

      if (!email) {
        setMessage(messageNode, 'Enter your HMJ work email to sign in.', 'error');
        loginEmail?.focus();
        return;
      }
      if (!password) {
        setMessage(messageNode, 'Enter your password to continue.', 'error');
        loginPassword?.focus();
        return;
      }

      if (loginSubmit) loginSubmit.disabled = true;
      setBusy(loginForm, true);
      setMessage(messageNode, 'Signing you into HMJ admin…', 'info');

      try {
        if (!window.Admin || typeof window.Admin.finishLoginTransition !== 'function') {
          await signInWithPassword(email, password);
          navigateReplace(buildAdminEntryUrl(getRequestedNext()));
        } else {
          const user = await signInWithPassword(email, password);
          await window.Admin.finishLoginTransition(user, { timeoutMs: 9000 });
        }
      } catch (error) {
        const classified = classifyIdentityError(error);
        emitAuthEvent('login_failure', {
          status: 'error',
          source: 'login_form',
          reason: classified.reason,
          email
        });
        setMessage(messageNode, normaliseIdentityError(error), 'error');
      } finally {
        if (loginSubmit) loginSubmit.disabled = false;
        setBusy(loginForm, false);
      }
    });

    recoveryForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = safeString(recoveryEmail?.value).trim();
      if (!email) {
        setMessage(messageNode, 'Enter the HMJ work email linked to the account you need help with.', 'error');
        recoveryEmail?.focus();
        return;
      }

      if (recoverySubmit) recoverySubmit.disabled = true;
      setBusy(recoveryForm, true);
      setPressed('reset');
      emitAuthEvent('forgot_password_request_submitted', {
        status: 'pending',
        source: 'login_page',
        email
      });

      try {
        await requestPasswordResetEmail(email);
        emitAuthEvent('forgot_password_request_accepted', {
          status: 'ok',
          source: 'login_page',
          email
        });
        setMessage(
          messageNode,
          `If ${email} is recognised, a password reset email is on its way. Open the newest link on this HMJ site to finish the reset.`,
          'ok'
        );
        updateStatusPanel({
          ...state,
          intent: 'recovery',
          hasTokenPayload: false,
          hasError: false,
          authParams: {}
        });
      } catch (error) {
        const classified = classifyIdentityError(error);
        emitAuthEvent('forgot_password_request_failed', {
          status: 'error',
          source: 'login_page',
          reason: classified.reason,
          email
        });
        setMessage(messageNode, normaliseIdentityError(error), 'error');
      } finally {
        if (recoverySubmit) recoverySubmit.disabled = false;
        setBusy(recoveryForm, false);
      }
    });

    if (!state.hasError && !state.hasTokenPayload && !safeString(messageNode?.textContent).trim()) {
      setMessage(messageNode, copy.intro, 'info');
    }
  }

  function updatePasswordPageCopy(state, mode) {
    const badge = select('[data-auth-page-badge]');
    const title = select('[data-auth-page-title]');
    const intro = select('[data-auth-page-intro]');
    const copy = currentCopy(state);
    const tone = mode === 'invite' ? copyByIntent.invite : copyByIntent.recovery;

    if (badge) badge.textContent = tone.badge;
    if (title) title.textContent = tone.title;
    if (intro) intro.textContent = state.hasError
      ? normaliseIdentityError(state.authParams.error_description || state.authParams.error)
      : tone.intro;

    const hint = select('[data-auth-password-hint]');
    if (hint) {
      hint.textContent = mode === 'invite'
        ? 'Use at least 10 characters. A longer passphrase is best.'
        : 'Use at least 10 characters and avoid reusing an old password.';
    }
  }

  function updateEmailDisplay(state, fallbackEmail) {
    const emailText = safeString(fallbackEmail || readAuthEmail(state)).trim();
    const nodes = selectAll('[data-auth-email-display]');
    nodes.forEach((node) => {
      node.hidden = !emailText;
      node.textContent = emailText ? `Account: ${emailText}` : '';
    });
  }

  function missingTokenMessage(mode) {
    return mode === 'invite'
      ? 'This HMJ invite page needs a valid account setup link. Open the newest invite email or contact HMJ access support.'
      : 'This HMJ reset page needs a valid password reset link. Request a new password email and open the newest link.';
  }

  async function completePasswordFlow(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const state = opts.state || parseAuthState();
    const mode = opts.mode === 'invite' ? 'invite' : 'recovery';
    const password = safeString(opts.password);
    const accessTokenFromHash = safeString(state.authParams?.access_token).trim();
    const rawToken = safeString(
      mode === 'invite'
        ? state.authParams?.invite_token
        : state.authParams?.recovery_token
    ).trim();

    let accessToken = accessTokenFromHash;
    let userEmail = '';

    if (mode === 'invite') {
      if (!accessToken && !rawToken) {
        throw new Error(missingTokenMessage(mode));
      }
      if (!accessToken) {
        const verify = await verifyInviteWithPassword(rawToken, password);
        accessToken = safeString(verify.access_token).trim();
      } else {
        await updatePasswordWithToken(accessToken, password);
      }
    } else {
      if (!accessToken && !rawToken) {
        throw new Error(missingTokenMessage(mode));
      }
      if (!accessToken) {
        const verify = await verifyRecoveryToken(rawToken);
        accessToken = safeString(verify.access_token).trim();
      }
      await updatePasswordWithToken(accessToken, password);
    }

    if (accessToken) {
      try {
        const user = await fetchUserWithToken(accessToken);
        userEmail = readUserEmail(user);
      } catch (err) {
        userEmail = '';
      }
    }

    let autoLoggedIn = false;
    if (userEmail) {
      try {
        autoLoggedIn = await tryAutoLogin(userEmail, password);
      } catch (err) {
        autoLoggedIn = false;
      }
    }

    return {
      accessToken,
      email: userEmail,
      autoLoggedIn
    };
  }

  function initPasswordView(state, mode) {
    const messageNode = select('[data-auth-message]');
    const form = select('[data-auth-password-form]');
    const passwordInput = document.getElementById('authPassword');
    const confirmInput = document.getElementById('authPasswordConfirm');
    const submitButton = document.getElementById('authPasswordSubmit');

    updatePasswordPageCopy(state, mode);
    updateEmailDisplay(state);

    emitAuthEvent(mode === 'invite' ? 'complete_account_page_opened' : 'reset_password_page_opened', {
      status: state.hasError ? 'warn' : (state.hasTokenPayload ? 'ready' : 'warn'),
      source: mode,
      intent: state.intent
    });

    if (state.hasError) {
      setMessage(messageNode, normaliseIdentityError(state.authParams.error_description || state.authParams.error), 'error');
      emitAuthEvent('invalid_token_encountered', {
        status: 'warn',
        source: mode,
        intent: state.intent,
        reason: classifyIdentityError(state.authParams.error_description || state.authParams.error).reason
      });
    }

    if (!state.hasTokenPayload) {
      setMessage(messageNode, missingTokenMessage(mode), 'error');
      emitAuthEvent('invalid_token_encountered', {
        status: 'warn',
        source: mode,
        intent: state.intent,
        reason: 'missing_token'
      });
      if (submitButton) submitButton.disabled = true;
      return;
    }

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = safeString(passwordInput?.value);
      const confirm = safeString(confirmInput?.value);
      const validation = validatePasswordPair(password, confirm);

      if (!validation.ok) {
        setMessage(messageNode, validation.message, 'error');
        if (password.length < PASSWORD_MIN_LENGTH) {
          passwordInput?.focus();
        } else {
          confirmInput?.focus();
        }
        return;
      }

      if (submitButton) submitButton.disabled = true;
      setBusy(form, true);
      setMessage(
        messageNode,
        mode === 'invite'
          ? 'Saving your new HMJ password and finishing account setup…'
          : 'Saving your new HMJ password…',
        'info'
      );

      try {
        const result = await completePasswordFlow({ state, mode, password });
        updateEmailDisplay(state, result.email);
        emitAuthEvent(mode === 'invite' ? 'password_create_success' : 'password_reset_success', {
          status: 'ok',
          source: mode,
          email: result.email,
          intent: state.intent
        });

        const destination = result.autoLoggedIn
          ? buildAdminEntryUrl(getRequestedNext())
          : buildAdminEntryUrl(getRequestedNext(), {
              auth_notice: mode === 'invite' ? 'invite-complete' : 'reset-complete',
              email: result.email
            });

        setMessage(
          messageNode,
          mode === 'invite'
            ? 'Your HMJ password has been created successfully. Redirecting you back into admin…'
            : 'Your HMJ password has been reset successfully. Redirecting you back into admin…',
          'ok'
        );

        window.setTimeout(() => {
          navigateReplace(destination);
        }, 420);
      } catch (error) {
        const classified = classifyIdentityError(error);
        emitAuthEvent(mode === 'invite' ? 'password_create_failed' : 'password_reset_failed', {
          status: 'error',
          source: mode,
          reason: classified.reason,
          email: readAuthEmail(state)
        });
        setMessage(messageNode, normaliseIdentityError(error), 'error');
      } finally {
        if (submitButton) submitButton.disabled = false;
        setBusy(form, false);
      }
    });
  }

  function initForgotPasswordView(state) {
    const messageNode = select('[data-auth-message]');
    const form = select('[data-auth-forgot-form]');
    const emailInput = document.getElementById('authForgotEmail');
    const submitButton = document.getElementById('authForgotSubmit');
    const notice = readNotice(currentLocation().search);

    updateStatusPanel({
      ...state,
      intent: 'recovery',
      hasTokenPayload: false,
      hasError: false,
      authParams: {}
    });

    setFieldValue(emailInput, notice.email || readAuthEmail(state));
    scrubNoticeParams();
    emitAuthEvent('forgot_password_page_opened', {
      status: 'info',
      source: 'forgot_password',
      intent: state.intent
    });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = safeString(emailInput?.value).trim();
      if (!email) {
        setMessage(messageNode, 'Enter your HMJ work email so we can send a reset link.', 'error');
        emailInput?.focus();
        return;
      }

      if (submitButton) submitButton.disabled = true;
      setBusy(form, true);
      emitAuthEvent('forgot_password_request_submitted', {
        status: 'pending',
        source: 'forgot_password_page',
        email
      });

      try {
        await requestPasswordResetEmail(email);
        emitAuthEvent('forgot_password_request_accepted', {
          status: 'ok',
          source: 'forgot_password_page',
          email
        });
        setMessage(
          messageNode,
          `If ${email} is recognised, a secure HMJ password reset email is on its way. Open the newest link on this site to continue.`,
          'ok'
        );
      } catch (error) {
        const classified = classifyIdentityError(error);
        emitAuthEvent('forgot_password_request_failed', {
          status: 'error',
          source: 'forgot_password_page',
          reason: classified.reason,
          email
        });
        setMessage(messageNode, normaliseIdentityError(error), 'error');
      } finally {
        if (submitButton) submitButton.disabled = false;
        setBusy(form, false);
      }
    });
  }

  function initAccountView() {
    const gate = document.getElementById('gate');
    const app = document.getElementById('app');
    const accountEmail = document.getElementById('accountEmail');
    const accountRoles = document.getElementById('accountRoles');
    const accountSummary = document.getElementById('accountSummary');
    const resetButton = select('[data-auth-send-reset]');
    const messageNode = select('[data-auth-message]');

    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') return;

    window.Admin.bootAdmin(async (helpers) => {
      const who = await helpers.identity('admin', { forceFresh: true });
      if (!who?.ok) return;

      if (gate) gate.style.display = 'none';
      if (app) app.style.display = '';

      if (accountEmail) accountEmail.textContent = who.email || 'Unknown account';
      if (accountRoles) {
        const roles = Array.isArray(who.roles) && who.roles.length ? who.roles.join(', ') : 'admin';
        accountRoles.textContent = roles;
      }
      if (accountSummary) {
        accountSummary.textContent = `Signed in on ${window.location.hostname || 'this site'} with a verified HMJ admin session.`;
      }
      emitAuthEvent('account_page_opened', {
        status: 'ok',
        source: 'account',
        email: who.email || ''
      });

      resetButton?.addEventListener('click', async (event) => {
        event.preventDefault();
        resetButton.disabled = true;
        try {
          emitAuthEvent('forgot_password_request_submitted', {
            status: 'pending',
            source: 'account_page',
            email: who.email || ''
          });
          await requestPasswordResetEmail(who.email || '');
          emitAuthEvent('forgot_password_request_accepted', {
            status: 'ok',
            source: 'account_page',
            email: who.email || ''
          });
          setMessage(
            messageNode,
            `If ${who.email || 'that account'} is recognised, a secure HMJ password reset email is on its way.`,
            'ok'
          );
        } catch (error) {
          const classified = classifyIdentityError(error);
          emitAuthEvent('forgot_password_request_failed', {
            status: 'error',
            source: 'account_page',
            reason: classified.reason,
            email: who.email || ''
          });
          setMessage(messageNode, normaliseIdentityError(error), 'error');
        } finally {
          resetButton.disabled = false;
        }
      });
    });
  }

  function boot() {
    if (typeof document === 'undefined') return;
    const view = currentView();
    if (!view) return;

    ensureSupportLinks();
    bindPasswordToggles();

    const state = parseAuthState();
    if (maybeRedirectByIntent(state, view)) {
      return;
    }
    onReady(async () => {
      if (await maybeRedirectAuthenticatedAdmin(view, state)) {
        return;
      }

      if (view === 'login') {
        initLoginView(state);
        return;
      }

      if (view === 'complete-account') {
        initPasswordView(state, 'invite');
        return;
      }

      if (view === 'reset-password') {
        initPasswordView(state, 'recovery');
        return;
      }

      if (view === 'forgot-password') {
        initForgotPasswordView(state);
        return;
      }

      if (view === 'account') {
        initAccountView();
      }
    });
  }

  return {
    ADMIN_ROUTES,
    PASSWORD_MIN_LENGTH,
    boot,
    buildAdminEntryUrl,
    buildIntentDestination,
    classifyIdentityError,
    normaliseIdentityError,
    normaliseNextTarget,
    readNotice,
    validatePasswordPair
  };
});
