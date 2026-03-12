(function () {
  'use strict';

  const TIMESHEETS_URL = 'https://login.timesheetportal.com/?_gl=1*wfpx6g*_gcl_au*NzU1ODYwMTI5LjE3NjkwODg5MjA.*_ga*ODQ0OTU3NzQ5LjE3NjkwODg5MTk.*_ga_9Y6DNF71JK*czE3NzMzNTY1NjEkbzMkZzAkdDE3NzMzNTY1NjEkajYwJGwwJGgw';
  const ADMIN_URL = '/admin/';

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

  const updateTimesheetsLink = (link) => {
    if (!link) return;
    link.href = TIMESHEETS_URL;
    link.removeAttribute('aria-disabled');
    link.textContent = 'Timesheets';
    link.title = 'Open Timesheets';
  };

  const updateAdminLink = (link) => {
    if (!link) return;
    link.style.display = '';
    link.href = ADMIN_URL;
    link.removeAttribute('aria-disabled');
    link.classList.remove('requires-admin');
    link.textContent = 'Admin';
    link.title = 'Open the admin sign-in page';
  };

  const applyNavLinks = (adminLink, timesheetsLink) => {
    updateTimesheetsLink(timesheetsLink);
    updateAdminLink(adminLink);
  };

  const bindIdentity = (identity, callbacks) => {
    if (!identity || typeof identity.on !== 'function') {
      return null;
    }
    if (!identity.__hmjNavBound) {
      identity.__hmjNavBound = true;
      identity.on('init', (user) => callbacks.render(user || null));
      identity.on('login', (user) => callbacks.render(user || null));
      identity.on('logout', () => {
        callbacks.render(null);
        sessionStorage.removeItem('afterLogin');
      });
    }
    return identity;
  };

  document.addEventListener('DOMContentLoaded', () => {
    const adminLink = document.getElementById('nav-admin');
    const timesheetsLink = document.getElementById('nav-timesheets');

    const render = () => applyNavLinks(adminLink, timesheetsLink);

    const callbacks = { render };

    const attachAndRender = (identity) => {
      const id = bindIdentity(identity || ensureIdentity(), callbacks);
      if (!id) {
        render();
        return;
      }
      try {
        render();
      } catch {
        render();
      }
    };

    document.addEventListener('hmj:identity-change', (event) => {
      attachAndRender(event?.detail?.identity || null);
    });

    attachAndRender(ensureIdentity());
  });
})();
