(function () {
  'use strict';

  const DEFAULT_AFTER_LOGIN = '/timesheets.html';

  const rolesOf = (user) => {
    if (Array.isArray(user?.app_metadata?.roles)) return user.app_metadata.roles;
    if (Array.isArray(user?.roles)) return user.roles;
    return [];
  };

  const ensureIdentity = () => {
    try {
      return window.hmjConfigureIdentity?.() || window.netlifyIdentity || null;
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[HMJ] nav identity ensure failed', err);
      }
      return window.netlifyIdentity || null;
    }
  };

  const updateTimesheetsLink = (link, user) => {
    if (!link) return;
    if (user) {
      link.href = '/timesheets.html';
      link.removeAttribute('aria-disabled');
      link.title = 'Open timesheets';
    } else {
      link.href = '#';
      link.setAttribute('aria-disabled', 'true');
      link.title = 'Sign in to access timesheets';
    }
  };

  const updateAdminLink = (link, user) => {
    if (!link) return;
    const isAdmin = rolesOf(user).includes('admin');
    if (isAdmin) {
      link.style.display = 'inline-block';
      link.href = '/admin/';
      link.removeAttribute('aria-disabled');
      link.classList.remove('requires-admin');
      link.textContent = 'Admin Dashboard';
      link.title = 'Open the admin dashboard';
    } else {
      link.style.display = 'none';
      link.href = '/admin/';
      link.setAttribute('aria-disabled', 'true');
      link.classList.add('requires-admin');
      link.textContent = 'Admin Dashboard';
      link.title = 'Admin access only';
    }
  };

  const applyUserToNav = (adminLink, timesheetsLink, user) => {
    updateTimesheetsLink(timesheetsLink, user);
    updateAdminLink(adminLink, user);
  };

  const requireLogin = (event, destination) => {
    if (event) event.preventDefault();
    const identity = ensureIdentity();
    if (!identity || typeof identity.open !== 'function') {
      if (destination) {
        window.location.href = destination;
      }
      return;
    }
    if (destination) {
      sessionStorage.setItem('afterLogin', destination);
    }
    identity.open('login');
  };

  const bindIdentity = (identity, callbacks) => {
    if (!identity || typeof identity.on !== 'function') {
      return null;
    }
    if (!identity.__hmjNavBound) {
      identity.__hmjNavBound = true;
      identity.on('init', (user) => callbacks.render(user || null));
      identity.on('login', (user) => {
        callbacks.render(user || null);
        const dest = sessionStorage.getItem('afterLogin') || DEFAULT_AFTER_LOGIN;
        sessionStorage.removeItem('afterLogin');
        if (dest) {
          window.location.href = dest;
        }
      });
      identity.on('logout', () => {
        callbacks.render(null);
        sessionStorage.removeItem('afterLogin');
        window.location.href = '/';
      });
    }
    return identity;
  };

  document.addEventListener('DOMContentLoaded', () => {
    const adminLink = document.getElementById('nav-admin');
    const timesheetsLink = document.getElementById('nav-timesheets');

    const render = (user) => applyUserToNav(adminLink, timesheetsLink, user);

    const callbacks = { render };

    timesheetsLink?.addEventListener('click', (event) => {
      const identity = ensureIdentity();
      const user = identity?.currentUser?.();
      if (user) return;
      requireLogin(event, '/timesheets.html');
    });

    adminLink?.addEventListener('click', (event) => {
      const identity = ensureIdentity();
      const user = identity?.currentUser?.();
      if (user) return;
      requireLogin(event, '/admin/');
    });

    const attachAndRender = (identity) => {
      const id = bindIdentity(identity || ensureIdentity(), callbacks);
      if (!id) {
        render(null);
        return;
      }
      try {
        render(id.currentUser?.() || null);
      } catch {
        render(null);
      }
    };

    document.addEventListener('hmj:identity-change', (event) => {
      attachAndRender(event?.detail?.identity || null);
    });

    attachAndRender(ensureIdentity());
  });
})();
