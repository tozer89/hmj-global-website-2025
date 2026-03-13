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
    if (id && typeof id.on === 'function') {
      cb(id);
    } else {
      readyQueue.push(cb);
    }
  };

  function markReady(instance) {
    const id = instance || window.netlifyIdentity;
    if (!id || typeof id.on !== 'function') return;
    emitState({
      widgetScriptInjected: true,
      widgetScriptLoaded: true,
      widgetReady: true,
      widgetError: '',
      mode: 'ready'
    });
    flushReady(id);
  }

  function observeIdentity() {
    const mark = () => markReady(window.netlifyIdentity);
    document.addEventListener('netlifyIdentityLoad', mark);
    const poll = setInterval(() => {
      const id = window.netlifyIdentity;
      if (id && typeof id.on === 'function') {
        clearInterval(poll);
        markReady(id);
      }
    }, 120);
    setTimeout(() => clearInterval(poll), 12000);
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
      addCandidate(originProxyIdentity);
      if (inlineIdentity && !inlineLooksDefault) addCandidate(inlineIdentity);
      if (netlifyIdentityUrl && !netlifyLooksDefault) addCandidate(netlifyIdentityUrl);
      addCandidate(originIdentity);
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
      emitState({ mode: 'unavailable', widgetError: 'No same-host identity API URL resolved' });
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

    emitState({ apiUrl: resolved, mode: 'configured' });
    return resolved;
  }

  function injectWidgetScript(force = false) {
    const current = document.getElementById('netlify-identity-widget');
    if (current && !force) {
      emitState({ widgetScriptInjected: true, mode: state.widgetReady ? 'ready' : 'script-present' });
      if (window.netlifyIdentity && typeof window.netlifyIdentity.on === 'function') {
        markReady(window.netlifyIdentity);
      }
      return current;
    }

    if (current && force) current.remove();

    const script = document.createElement('script');
    script.id = 'netlify-identity-widget';
    script.src = WIDGET_SRC;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      emitState({
        widgetScriptInjected: true,
        widgetScriptLoaded: true,
        widgetError: '',
        mode: 'script-loaded'
      });
      setTimeout(() => markReady(window.netlifyIdentity), 0);
    };
    script.onerror = () => {
      emitState({
        widgetScriptInjected: true,
        widgetScriptLoaded: false,
        widgetReady: false,
        widgetError: 'Widget script failed to load',
        mode: 'script-error'
      });
      flushReady(null);
      document.dispatchEvent(new CustomEvent('hmjIdentityUnavailable'));
    };
    emitState({ widgetScriptInjected: true, widgetError: '', mode: 'loading-script' });
    document.head.appendChild(script);
    return script;
  }

  window.hmjEnsureIdentityWidget = function(force = false) {
    const apiUrl = configureSettings(resolveIdentityUrl());
    if (!apiUrl) return null;
    return injectWidgetScript(force);
  };

  observeIdentity();
  window.hmjEnsureIdentityWidget(false);
})();
