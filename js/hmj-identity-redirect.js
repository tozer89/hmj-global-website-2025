(function () {
  'use strict';

  const currentScript = document.currentScript;
  const loginFallback = '/admin/';
  const logoutFallback = '/';

  const loginDestination = currentScript?.dataset?.hmjLoginRedirect || loginFallback;
  const logoutDestination = currentScript?.dataset?.hmjLogoutRedirect ?? logoutFallback;

  const resolveIdentity = () => {
    try {
      return window.hmjConfigureIdentity?.() || window.netlifyIdentity || null;
    } catch (err) {
      if (typeof console !== 'undefined' && console?.warn) {
        console.warn('[HMJ] identity resolve failed', err);
      }
      return window.netlifyIdentity || null;
    }
  };

  const bindRedirects = (identity) => {
    if (!identity || typeof identity.on !== 'function' || identity.__hmjRedirectBound) {
      return;
    }
    identity.__hmjRedirectBound = true;
    identity.on('login', () => {
      const dest = sessionStorage.getItem('afterLogin') || loginDestination || '';
      sessionStorage.removeItem('afterLogin');
      if (dest) {
        window.location.href = dest;
      }
    });
    identity.on('logout', () => {
      sessionStorage.removeItem('afterLogin');
      if (logoutDestination) {
        window.location.href = logoutDestination;
      }
    });
  };

  document.addEventListener('hmj:identity-change', (event) => {
    bindRedirects(event?.detail?.identity || null);
  });

  document.addEventListener('DOMContentLoaded', () => {
    bindRedirects(resolveIdentity());
  });
})();
