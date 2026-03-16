(function () {
  'use strict';

  const helpers = window.HMJAuthFlow || {};
  const currentScript = document.currentScript;
  const defaultDestination = currentScript?.dataset?.hmjAuthDestination || '/admin/';
  const inviteDestination = currentScript?.dataset?.hmjAuthInviteDestination || '/admin/complete-account.html';
  const recoveryDestination = currentScript?.dataset?.hmjAuthRecoveryDestination || '/admin/reset-password.html';
  const DIAG_ENDPOINT = '/.netlify/functions/admin-auth-event';

  function destinationForState(state) {
    const intent = safeString(state?.intent).toLowerCase();
    if (intent === 'invite') return inviteDestination;
    if (intent === 'recovery') return recoveryDestination;
    return defaultDestination;
  }

  function safeString(value) {
    return typeof value === 'string' ? value : '';
  }

  function currentUrl() {
    const { pathname, search, hash } = window.location || {};
    return `${safeString(pathname)}${safeString(search)}${safeString(hash)}`;
  }

  function environmentForHost(hostname) {
    const host = safeString(hostname).toLowerCase();
    if (!host) return 'unknown';
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return 'local';
    if (/^deploy-preview-/i.test(host) || host.includes('--')) return 'preview';
    if (host.endsWith('.netlify.app')) return 'netlify';
    if (host === 'hmj-global.com' || host === 'www.hmj-global.com') return 'production';
    return 'custom';
  }

  function emitHandoffEvent(state, next) {
    const payload = {
      ts: new Date().toISOString(),
      event: 'auth_handoff_redirect',
      status: 'redirect',
      source: 'public_page',
      intent: safeString(state?.intent).toLowerCase(),
      page: safeString(window.location?.pathname || ''),
      route: safeString(window.location?.pathname || ''),
      host: safeString(window.location?.hostname || ''),
      env: environmentForHost(window.location?.hostname || ''),
      next: safeString(next || '')
    };

    try {
      console.info('[HMJ auth]', payload);
    } catch {}

    try {
      const body = JSON.stringify(payload);
      if (navigator?.sendBeacon) {
        navigator.sendBeacon(DIAG_ENDPOINT, new Blob([body], { type: 'application/json' }));
        return;
      }
      if (typeof fetch === 'function') {
        fetch(DIAG_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          keepalive: true,
          body
        }).catch(() => {});
      }
    } catch {}
  }

  function handoffAuthCallback() {
    if (typeof helpers.parseAuthState !== 'function' || typeof helpers.buildAuthHandoffUrl !== 'function') {
      return;
    }

    const state = helpers.parseAuthState(window.location);
    if (!state?.isAuthCallback) return;
    if (typeof helpers.isAdminPath === 'function' && helpers.isAdminPath(window.location.pathname)) {
      return;
    }
    if (typeof helpers.isCandidateAuthRoute === 'function' && helpers.isCandidateAuthRoute(window.location)) {
      return;
    }

    const next = helpers.buildAuthHandoffUrl(destinationForState(state), window.location);
    if (!next || next === currentUrl()) return;

    try {
      emitHandoffEvent(state, next);
      window.location.replace(next);
    } catch (error) {
      console.warn('[HMJ auth] callback handoff failed', error);
    }
  }

  handoffAuthCallback();
})();
