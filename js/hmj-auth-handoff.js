(function () {
  'use strict';

  const helpers = window.HMJAuthFlow || {};
  const currentScript = document.currentScript;
  const destination = currentScript?.dataset?.hmjAuthDestination || '/admin/';

  function safeString(value) {
    return typeof value === 'string' ? value : '';
  }

  function currentUrl() {
    const { pathname, search, hash } = window.location || {};
    return `${safeString(pathname)}${safeString(search)}${safeString(hash)}`;
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

    const next = helpers.buildAuthHandoffUrl(destination, window.location);
    if (!next || next === currentUrl()) return;

    try {
      window.location.replace(next);
    } catch (error) {
      console.warn('[HMJ auth] callback handoff failed', error);
    }
  }

  handoffAuthCallback();
})();
