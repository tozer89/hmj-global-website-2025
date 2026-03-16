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
      style.href = '/assets/css/hmj-chatbot.css?v=6';
      document.head.appendChild(style);
    }
    if (!document.getElementById(CHATBOT_SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = CHATBOT_SCRIPT_ID;
      script.defer = true;
      script.src = '/js/hmj-chatbot.js?v=6';
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

  const normalizePath = (value) => {
    const text = String(value || '').trim();
    if (!text || text.includes('://') || text.startsWith('mailto:') || text.startsWith('tel:')) {
      return '';
    }
    try {
      const url = new URL(text, window.location.origin);
      let path = String(url.pathname || '/').replace(/\/+$/, '') || '/';
      if (path === '/') return '/index.html';
      return path.toLowerCase();
    } catch {
      return '';
    }
  };

  const bindMobileMenu = () => {
    const burger = document.querySelector('.hmj-burger');
    const menu = document.getElementById('hmj-menu');
    const scrim = document.querySelector('.hmj-scrim');
    if (!burger || !menu || !scrim || burger.dataset.hmjNavBound === 'true') return;

    burger.dataset.hmjNavBound = 'true';
    const currentPath = normalizePath(window.location.pathname || '/');

    menu.querySelectorAll('a[href]').forEach((link) => {
      const targetPath = normalizePath(link.getAttribute('href') || '');
      if (targetPath && targetPath === currentPath) {
        link.setAttribute('aria-current', 'page');
      }
    });

    const openMenu = (open) => {
      burger.setAttribute('aria-expanded', String(!!open));
      menu.classList.toggle('open', !!open);
      scrim.hidden = !open;
      document.documentElement.style.overflow = open ? 'hidden' : '';
      if (document.body) {
        document.body.style.overflow = open ? 'hidden' : '';
      }
    };

    burger.addEventListener('click', () => {
      openMenu(burger.getAttribute('aria-expanded') !== 'true');
    });

    scrim.addEventListener('click', () => openMenu(false));

    menu.addEventListener('click', (event) => {
      const link = event.target.closest('a[href]');
      if (!link) return;
      requestAnimationFrame(() => openMenu(false));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') openMenu(false);
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) openMenu(false);
    });
  };

  const init = () => {
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
    bindMobileMenu();
    ensureAnalyticsAssets();
    ensureChatbotAssets();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
