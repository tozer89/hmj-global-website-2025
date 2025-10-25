(function () {
  'use strict';

  const FALLBACKS = ['/.netlify/identity', 'https://hmjg.netlify.app/.netlify/identity'];
  const targetUrl = (
    window.HMJ_IDENTITY_URL ||
    window.ADMIN_IDENTITY_URL ||
    FALLBACKS.find((item) => !!item) ||
    ''
  ).replace(/\/$/, '');

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
})();
