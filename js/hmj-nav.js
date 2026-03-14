(function () {
  'use strict';

  const TIMESHEETS_URL = 'https://hmjglobal.timesheetportal.com';
  const ADMIN_URL = '/admin/';
  const CHATBOT_SCRIPT_ID = 'hmj-chatbot-script';
  const CHATBOT_STYLE_ID = 'hmj-chatbot-style';
  const ANALYTICS_SCRIPT_ID = 'hmj-analytics-script';

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
    link.classList.add('nav-admin-link');
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

  const shouldBootChatbot = () => {
    const path = String(window.location.pathname || '/');
    if (path.startsWith('/admin')) return false;
    if (path === '/timesheets.html') return false;
    return true;
  };

  const shouldBootAnalytics = () => {
    const path = String(window.location.pathname || '/');
    if (path.startsWith('/admin')) return false;
    if (path === '/timesheets.html') return false;
    return true;
  };

  const ensureChatbotAssets = () => {
    if (!shouldBootChatbot()) return;
    if (!document.getElementById(CHATBOT_STYLE_ID)) {
      const style = document.createElement('link');
      style.id = CHATBOT_STYLE_ID;
      style.rel = 'stylesheet';
      style.href = '/assets/css/hmj-chatbot.css?v=5';
      document.head.appendChild(style);
    }
    if (!document.getElementById(CHATBOT_SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = CHATBOT_SCRIPT_ID;
      script.defer = true;
      script.src = '/js/hmj-chatbot.js?v=5';
      document.head.appendChild(script);
    }
  };

  const ensureAnalyticsAssets = () => {
    if (!shouldBootAnalytics()) return;
    if (window.HMJAnalytics && window.HMJAnalytics.__initialized) return;
    if (!document.getElementById(ANALYTICS_SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = ANALYTICS_SCRIPT_ID;
      script.defer = true;
      script.src = '/js/hmj-analytics.js?v=1';
      document.head.appendChild(script);
    }
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
    ensureAnalyticsAssets();
    ensureChatbotAssets();
  });
})();
