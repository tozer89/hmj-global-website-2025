(function () {
  'use strict';

  const FALLBACK = 'https://hmjg.netlify.app/.netlify/identity';
  const targetUrl = (window.HMJ_IDENTITY_URL || window.ADMIN_IDENTITY_URL || FALLBACK || '').replace(/\/$/, '');

  function configureIdentity(id) {
    if (!id || !targetUrl) return id;
    if (id.__hmjIdentityApi === targetUrl) return id;

    try {
      if (typeof id.setConfig === 'function') {
        id.setConfig({ APIUrl: targetUrl });
      }
    } catch (err) {
      console.warn('[HMJ] Netlify Identity setConfig failed', err);
    }

    try {
      if (typeof id.init === 'function') {
        id.init({ APIUrl: targetUrl, autologin: false });
      }
    } catch (err) {
      const msg = String((err && err.message) || '');
      if (!/already\s+initialized/i.test(msg)) {
        console.warn('[HMJ] Netlify Identity init failed', err);
      }
    }

    id.__hmjIdentityApi = targetUrl;
    return id;
  }

  function hookIdentity(id) {
    if (!id) return;
    configureIdentity(id);
    if (!id.__hmjIdentityHooked && typeof id.on === 'function') {
      id.__hmjIdentityHooked = true;
      try {
        id.on('init', () => configureIdentity(id));
      } catch (err) {
        console.warn('[HMJ] Netlify Identity listener failed', err);
      }
    }

    try {
      document.dispatchEvent(new CustomEvent('hmj:identity-change', { detail: { identity: id } }));
    } catch (err) {
      // Non-fatal: keep going even if CustomEvent support is missing.
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('[HMJ] identity event dispatch failed', err);
      }
    }
  }

  let identityValue = window.netlifyIdentity;

  try {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'netlifyIdentity');
    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(window, 'netlifyIdentity', {
        configurable: true,
        enumerable: true,
        get() {
          return identityValue;
        },
        set(value) {
          identityValue = value;
          hookIdentity(value);
        },
      });
    } else if (descriptor.get) {
      identityValue = descriptor.get.call(window);
    } else if ('value' in descriptor) {
      identityValue = descriptor.value;
    }
  } catch (err) {
    console.warn('[HMJ] Netlify Identity guard failed', err);
  }

  if (identityValue) {
    hookIdentity(identityValue);
  }

  const ensureLater = () => hookIdentity(window.netlifyIdentity || identityValue || null);

  if (!identityValue) {
    const interval = setInterval(() => {
      const id = window.netlifyIdentity;
      if (id) {
        clearInterval(interval);
        hookIdentity(id);
      }
    }, 60);
    window.addEventListener('load', () => clearInterval(interval), { once: true });
  }

  document.addEventListener('DOMContentLoaded', ensureLater);
  window.addEventListener('load', ensureLater);

  window.hmjConfigureIdentity = (force = false) => {
    const id = window.netlifyIdentity || identityValue || null;
    if (force && id) {
      delete id.__hmjIdentityApi;
    }
    hookIdentity(id);
    return id;
  };

  function setupNavAccess() {
    const admin = document.getElementById('nav-admin');
    const timesheets = document.getElementById('nav-timesheets');

    if (!admin && !timesheets) {
      return;
    }

    if (window.__hmjNavAccessInitialised) {
      return;
    }
    window.__hmjNavAccessInitialised = true;

    const rolesOf = (user) => Array.isArray(user?.app_metadata?.roles)
      ? user.app_metadata.roles
      : Array.isArray(user?.roles)
        ? user.roles
        : [];

    function requireLogin(event, destination, identity) {
      if (event) event.preventDefault();
      const id = identity || window.hmjConfigureIdentity?.() || window.netlifyIdentity || null;
      if (!id || typeof id.open !== 'function') {
        if (destination) {
          window.location.href = destination;
        }
        return;
      }
      if (destination) {
        sessionStorage.setItem('afterLogin', destination);
      }
      try {
        id.open('login');
      } catch (err) {
        console.warn('[HMJ] Netlify Identity login open failed', err);
      }
    }

    function setTimesheets(user) {
      if (!timesheets) return;
      if (user) {
        timesheets.href = '/timesheets.html';
        timesheets.removeAttribute('aria-disabled');
        timesheets.title = 'Open timesheets';
      } else {
        timesheets.href = '#';
        timesheets.setAttribute('aria-disabled', 'true');
        timesheets.title = 'Sign in to access timesheets';
      }
    }

    function setAdmin(user) {
      if (!admin) return;
      const roles = rolesOf(user);
      const isAdmin = roles.includes('admin');
      if (isAdmin) {
        admin.style.display = 'inline-block';
        admin.href = '/admin/';
        admin.removeAttribute('aria-disabled');
        admin.classList.remove('requires-admin');
        admin.textContent = 'Admin Dashboard';
        admin.title = 'Open the admin dashboard';
      } else {
        admin.style.display = 'none';
        admin.href = '/admin/';
        admin.setAttribute('aria-disabled', 'true');
        admin.classList.add('requires-admin');
        admin.textContent = 'Admin Dashboard';
        admin.title = 'Admin access only';
      }
    }

    const renderFor = (user) => {
      setTimesheets(user);
      setAdmin(user);
    };

    const attachIdentityHandlers = (identity) => {
      const id = identity || window.hmjConfigureIdentity?.() || window.netlifyIdentity || null;
      if (!id || typeof id.on !== 'function') {
        return null;
      }
      if (!id.__hmjNavHandlers) {
        id.__hmjNavHandlers = true;
        id.on('init', (user) => renderFor(user));
        id.on('login', (user) => renderFor(user));
        id.on('logout', () => renderFor(null));
      }
      return id;
    };

    const initialIdentity = attachIdentityHandlers(window.hmjConfigureIdentity?.() || window.netlifyIdentity || null);

    timesheets?.addEventListener('click', (event) => {
      const id = window.hmjConfigureIdentity?.() || window.netlifyIdentity || null;
      const user = id?.currentUser?.();
      if (user) return;
      requireLogin(event, '/timesheets.html', id);
    });

    admin?.addEventListener('click', (event) => {
      const id = window.hmjConfigureIdentity?.() || window.netlifyIdentity || null;
      const user = id?.currentUser?.();
      if (user) return;
      requireLogin(event, '/admin/', id);
    });

    document.addEventListener('hmj:identity-change', (event) => {
      const identity = attachIdentityHandlers(event?.detail?.identity || null);
      if (!identity) {
        renderFor(null);
        return;
      }
      try {
        renderFor(identity.currentUser?.() || null);
      } catch {
        renderFor(null);
      }
    });

    if (initialIdentity) {
      try {
        renderFor(initialIdentity.currentUser?.() || null);
      } catch {
        renderFor(null);
      }
    } else {
      renderFor(null);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupNavAccess);
  } else {
    setupNavAccess();
  }
})();
