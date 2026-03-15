(function(){
  const WIDGET_SRC = 'https://identity.netlify.com/v1/netlify-identity-widget.js';
  const ADMIN_ENV = window.__HMJ_ADMIN_ENV || {};
  const readyQueue = [];
  const state = window.__hmjIdentityLoaderState = window.__hmjIdentityLoaderState || {
    host: '',
    apiUrl: '',
    widgetScriptInjected: false,
    widgetScriptLoaded: false,
    widgetReady: false,
    widgetError: '',
    mode: 'booting',
    updatedAt: Date.now()
  };

  const seen = new Set();
  const candidates = [];

  function emitState(patch) {
    if (patch && typeof patch === 'object') Object.assign(state, patch);
    state.updatedAt = Date.now();
    try {
      document.dispatchEvent(new CustomEvent('hmj:identity-loader-state', { detail: Object.assign({}, state) }));
    } catch (err) {
      // ignore
    }
  }

  function normalise(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    try {
      return new URL(trimmed, window.location.origin).toString().replace(/\/$/, '');
    } catch (err) {
      return trimmed.replace(/\/$/, '');
    }
  }

  function normaliseSameHost(url) {
    const normalised = normalise(url);
    if (!normalised) return '';
    try {
      const parsed = new URL(normalised, window.location.origin);
      if (parsed.origin !== window.location.origin) return '';
      return parsed.toString().replace(/\/$/, '');
    } catch (err) {
      return '';
    }
  }

  function addCandidate(url) {
    const normalised = normaliseSameHost(url);
    if (!normalised || seen.has(normalised)) return;
    seen.add(normalised);
    candidates.push(normalised);
  }

  function flushReady(instance) {
    while (readyQueue.length) {
      const cb = readyQueue.shift();
      try { cb(instance || null); }
      catch (err) { console.error('[identity] ready callback failed', err); }
    }
  }

  window.hmjIdentityReady = function(cb) {
    if (typeof cb !== 'function') return;
    const id = window.netlifyIdentity;
    if (typeof id !== 'undefined') {
      cb(id || null);
    } else {
      readyQueue.push(cb);
    }
  };

  function hasWidgetTag() {
    return !!document.querySelector(`script[src="${WIDGET_SRC}"]`);
  }

  function markReady(instance) {
    const id = typeof instance !== 'undefined' ? instance : window.netlifyIdentity;
    const available = typeof id !== 'undefined';
    emitState({
      widgetScriptInjected: hasWidgetTag(),
      widgetScriptLoaded: available,
      widgetReady: available && !!id,
      widgetError: hasWidgetTag() ? '' : 'Widget script tag missing',
      mode: available ? 'ready' : (hasWidgetTag() ? 'waiting-for-widget' : 'missing-script')
    });
    if (available) flushReady(id || null);
  }

  function observeIdentity() {
    const sync = () => markReady(window.netlifyIdentity);
    document.addEventListener('netlifyIdentityLoad', sync);
    const poll = setInterval(() => {
      sync();
      if (typeof window.netlifyIdentity !== 'undefined') {
        clearInterval(poll);
      }
    }, 120);
    setTimeout(() => clearInterval(poll), 12000);
    document.addEventListener('DOMContentLoaded', sync, { once: true });
    window.addEventListener('load', sync, { once: true });
  }

  function resolveIdentityUrl() {
    let host = '';
    let originBase = '';
    try {
      host = window.location?.hostname || '';
      originBase = String(window.location?.origin || '').replace(/\/$/, '');
    } catch (err) {
      // ignore
    }

    state.host = host || '';

    const isPreviewHost = /^deploy-preview-/i.test(host) || host.includes('--');
    const originIdentity = originBase ? `${originBase}/.netlify/identity` : '';
    const originProxyIdentity = originBase ? `${originBase}/.netlify/functions/identity-proxy` : '';
    const envIdentity = ADMIN_ENV.ADMIN_IDENTITY_URL || '';
    const inlineIdentity = window.ADMIN_IDENTITY_URL || '';
    const netlifyIdentityUrl = window.NETLIFY_IDENTITY_URL || '';
    const inlineLooksDefault = String(inlineIdentity || '').trim() === '/.netlify/identity';
    const netlifyLooksDefault = String(netlifyIdentityUrl || '').trim() === '/.netlify/identity';

    addCandidate(envIdentity);
    if (isPreviewHost) {
      addCandidate(originIdentity);
      if (inlineIdentity && !inlineLooksDefault) addCandidate(inlineIdentity);
      if (netlifyIdentityUrl && !netlifyLooksDefault) addCandidate(netlifyIdentityUrl);
      addCandidate(originProxyIdentity);
    } else {
      addCandidate(inlineIdentity);
      addCandidate(netlifyIdentityUrl);
      addCandidate(originIdentity);
    }

    return candidates[0] || '';
  }

  function configureSettings(apiUrl) {
    const resolved = normalise(apiUrl);
    if (!resolved) {
      emitState({
        mode: 'unavailable',
        widgetError: hasWidgetTag() ? 'No same-host identity API URL resolved' : 'Widget script tag missing'
      });
      flushReady(null);
      document.dispatchEvent(new CustomEvent('hmjIdentityUnavailable'));
      return '';
    }

    window.__hmjResolvedIdentityUrl = resolved;
    window.ADMIN_IDENTITY_URL = resolved;
    window.HMJ_IDENTITY_URL = resolved;
    window.NETLIFY_IDENTITY_URL = resolved;

    const settings = window.netlifyIdentitySettings = window.netlifyIdentitySettings || {};
    settings.APIUrl = resolved;

    emitState({
      apiUrl: resolved,
      widgetScriptInjected: hasWidgetTag(),
      widgetScriptLoaded: typeof window.netlifyIdentity !== 'undefined',
      widgetReady: typeof window.netlifyIdentity !== 'undefined' && !!window.netlifyIdentity,
      widgetError: hasWidgetTag() ? '' : 'Widget script tag missing',
      mode: hasWidgetTag() ? 'configured' : 'missing-script'
    });
    return resolved;
  }

  window.hmjEnsureIdentityWidget = function() {
    const apiUrl = configureSettings(resolveIdentityUrl());
    if (!apiUrl) return null;
    markReady(window.netlifyIdentity);
    return typeof window.netlifyIdentity !== 'undefined' ? window.netlifyIdentity : null;
  };

  observeIdentity();
  window.hmjEnsureIdentityWidget();
})();
