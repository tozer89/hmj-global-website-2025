/* /admin/common.js  —  unified admin bootstrap + diagnostics
   Works with Netlify Identity widget and Netlify Functions.
   Exposes:
     - window.adminReady(): Promise<helpers>
     - window.Admin.bootAdmin(mainFn)
     - window.getIdentity(requiredRole?)    // console-friendly
     - window.apiPing()                     // console-friendly
   Helpers injected to pages (main):
     { api, sel, toast, setTrace, getTrace, identity, isMobile }
*/

(function () {
  'use strict';

  // ----------------------------------------------------------------------------
  // Utilities
  // ----------------------------------------------------------------------------
  const $ = (s, root = document) => root.querySelector(s);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isMobile = matchMedia('(max-width: 820px)').matches;

  const Debug = {
    ts: () => new Date().toISOString().split('T')[1].replace('Z', ''),
    log: (...a) => console.log('%c[OK]', 'color:#18a058;font-weight:600', ...a),
    warn: (...a) => console.warn('%c[WARN]', 'color:#e6a100;font-weight:600', ...a),
    err: (...a) => console.error('%c[ERR]', 'color:#b73b3b;font-weight:600', ...a),
  };

  const ORIGIN_BASE = (() => {
    try {
      const loc = window.location;
      if (!loc || !loc.origin || !/^https?:/i.test(loc.protocol || '')) return '';
      return String(loc.origin).replace(/\/$/, '');
    } catch (err) {
      Debug.warn('origin detection failed', err);
      return '';
    }
  })();
  const ORIGIN_IDENTITY_URL = ORIGIN_BASE ? `${ORIGIN_BASE}/.netlify/identity` : '';
  const ORIGIN_PROXY_IDENTITY_URL = ORIGIN_BASE ? `${ORIGIN_BASE}/.netlify/functions/identity-proxy` : '';
  const ADMIN_ENV = window.__HMJ_ADMIN_ENV || {};
  const HOSTNAME = (() => { try { return window.location?.hostname || ''; } catch { return ''; } })();
  const IS_PREVIEW_HOST = /^deploy-preview-/i.test(HOSTNAME) || HOSTNAME.includes('--');
  const DEBUG_CHIP_STORE = 'hmj.admin.debug-chip-expanded:v1';
  const DEBUG_CHIP_ENABLE_STORE = 'hmj.admin.debug-chip-enabled:v1';
  const DEBUG_CHIP_ENABLED = (() => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      if (params.get('debugAuth') === '1') {
        window.localStorage.setItem(DEBUG_CHIP_ENABLE_STORE, '1');
        return true;
      }
      if (params.get('debugAuth') === '0') {
        window.localStorage.removeItem(DEBUG_CHIP_ENABLE_STORE);
        return false;
      }
      return IS_PREVIEW_HOST || window.localStorage.getItem(DEBUG_CHIP_ENABLE_STORE) === '1';
    } catch {
      return IS_PREVIEW_HOST;
    }
  })();
  function normaliseIdentityCandidate(url) {
    if (!url) return '';
    const trimmed = String(url).trim();
    if (!trimmed) return '';
    try {
      const parsed = new URL(trimmed, window.location.origin);
      if (parsed.origin !== window.location.origin) return '';
      return parsed.toString().replace(/\/$/, '');
    } catch (err) {
      Debug.warn('identity candidate normalise failed', err);
      return '';
    }
  }
  const IDENTITY_URL = (() => {
    const candidates = [
      ADMIN_ENV.ADMIN_IDENTITY_URL,
      window.ADMIN_IDENTITY_URL,
      IS_PREVIEW_HOST ? ORIGIN_PROXY_IDENTITY_URL : '',
      !IS_PREVIEW_HOST ? ORIGIN_IDENTITY_URL : '',
      IS_PREVIEW_HOST ? ORIGIN_IDENTITY_URL : ''
    ];
    for (const candidate of candidates) {
      const resolved = normaliseIdentityCandidate(candidate);
      if (resolved) return resolved;
    }
    return '';
  })();
  let identityCache = null;
  let identityCacheTs = 0;

  function readDebugChipExpanded() {
    try {
      return window.localStorage.getItem(DEBUG_CHIP_STORE) === '1';
    } catch {
      return false;
    }
  }

  function writeDebugChipExpanded(expanded) {
    try {
      window.localStorage.setItem(DEBUG_CHIP_STORE, expanded ? '1' : '0');
    } catch {}
  }

  if (IDENTITY_URL) {
    window.ADMIN_IDENTITY_URL = IDENTITY_URL;
    window.__hmjResolvedIdentityUrl = IDENTITY_URL;
    window.NETLIFY_IDENTITY_URL = IDENTITY_URL;
    window.HMJ_IDENTITY_URL = IDENTITY_URL;
    Debug.log('Resolved Identity API URL →', IDENTITY_URL, IS_PREVIEW_HOST ? '(preview host)' : '');
  }

  const base64Decode = (input) => {
    if (typeof input !== 'string') return '';
    if (typeof atob === 'function') return atob(input);
    try {
      return Buffer.from(input, 'base64').toString('binary');
    } catch (err) {
      Debug.warn('base64 decode failed', err);
      return '';
    }
  };

  function decodeJwt(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    try {
      const segment = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = segment + '='.repeat((4 - segment.length % 4) % 4);
      const bin = base64Decode(padded);
      const uriEncoded = bin.split('').map((c) => '%'.concat(('00' + c.charCodeAt(0).toString(16)).slice(-2))).join('');
      const json = decodeURIComponent(uriEncoded);
      return JSON.parse(json);
    } catch (err) {
      Debug.warn('decodeJwt failed', err);
      return null;
    }
  }

  // Netlify Live (beta) attempts to open a WebSocket to `/.netlify/extension/hmr`.
  // For our admin deploys this endpoint is suspended, which previously produced
  // noisy console errors on every load. We soft-disable those connections by
  // intercepting WebSocket construction and short-circuiting when the URL
  // matches the Live endpoint. A lightweight stub is returned so that any
  // listeners still receive deterministic open/close events without triggering
  // failures elsewhere in the identity widget.
  (function disableNetlifyLive() {
    if (typeof window === 'undefined') return;
    const NativeWS = window.WebSocket;
    if (!NativeWS || NativeWS.__hmjPatched) return;

    const blocked = /\.netlify\/extension\/hmr/i;

    function createEmitter() {
      const map = new Map();
      return {
        add(type, fn) {
          if (!fn) return;
          const list = map.get(type) || [];
          if (!list.includes(fn)) map.set(type, list.concat(fn));
        },
        remove(type, fn) {
          if (!fn) return;
          const list = map.get(type) || [];
          const next = list.filter((cb) => cb !== fn);
          if (next.length) map.set(type, next); else map.delete(type);
        },
        fire(ctx, type, event) {
          const list = map.get(type) || [];
          list.forEach((cb) => {
            try { cb.call(ctx, event); } catch (err) { Debug.warn('ws listener failed', err); }
          });
        }
      };
    }

    function makeStub(url) {
      const listeners = createEmitter();
      const stub = {
        url,
        readyState: NativeWS.CLOSED,
        bufferedAmount: 0,
        extensions: '',
        protocol: '',
        binaryType: 'blob',
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        close() {},
        send() {},
        addEventListener(type, fn) { listeners.add(type, fn); },
        removeEventListener(type, fn) { listeners.remove(type, fn); },
        dispatchEvent(evt) {
          if (!evt || !evt.type) return true;
          listeners.fire(stub, evt.type, evt);
          return true;
        }
      };

      const fire = (type, detail) => {
        const evt = Object.assign({ type }, detail || {});
        if (typeof stub['on' + type] === 'function') {
          try { stub['on' + type](evt); } catch (err) { Debug.warn('ws handler failed', err); }
        }
        listeners.fire(stub, type, evt);
      };

      setTimeout(() => fire('open'), 0);
      setTimeout(() => fire('close', { code: 1000, reason: 'hmj-live-disabled' }), 0);
      return stub;
    }

    function HMJWebSocket(url, protocols) {
      if (typeof url === 'string' && blocked.test(url)) {
        Debug.warn('Blocked Netlify Live websocket', url);
        return makeStub(url);
      }
      return new NativeWS(url, protocols);
    }

    HMJWebSocket.prototype = NativeWS.prototype;
    HMJWebSocket.CONNECTING = NativeWS.CONNECTING;
    HMJWebSocket.OPEN = NativeWS.OPEN;
    HMJWebSocket.CLOSING = NativeWS.CLOSING;
    HMJWebSocket.CLOSED = NativeWS.CLOSED;
    HMJWebSocket.__hmjPatched = true;

    window.WebSocket = HMJWebSocket;
    window.WebSocket.__hmjPatched = true;
  })();

  // Small on-page toast (non-blocking)
  function toast(msg, type = 'info', ms = 3600) {
    let host = $('#toast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast';
      host.style.position = 'fixed';
      host.style.bottom = '16px';
      host.style.right = '16px';
      host.style.zIndex = '9999';
      host.style.display = 'grid';
      host.style.gap = '10px';
      document.body.appendChild(host);
    }
    const n = document.createElement('div');
    n.setAttribute('role', 'status');
    n.style.padding = '10px 12px';
    n.style.borderRadius = '10px';
    n.style.boxShadow = '0 10px 24px rgba(0,0,0,.18)';
    n.style.fontWeight = '600';
    n.style.maxWidth = '520px';
    const palette = {
      error: { bg: '#3a1418', border: '1px solid rgba(255,205,214,.25)' },
      warn:  { bg: '#35240d', border: '1px solid rgba(255,224,178,.25)' },
      ok:    { bg: '#0f3020', border: '1px solid rgba(120,255,196,.25)' },
      info:  { bg: '#0e2038', border: '1px solid rgba(255,255,255,.14)' },
    };
    const colours = palette[type] || palette.info;
    n.style.background = colours.bg;
    n.style.border = colours.border;
    n.style.color = 'white';
    n.textContent = String(msg);
    host.appendChild(n);
    setTimeout(() => n.remove(), ms);
  }

  toast.info = (msg, ms) => toast(msg, 'info', ms);
  toast.ok = (msg, ms) => toast(msg, 'ok', ms || 3600);
  toast.warn = (msg, ms) => toast(msg, 'warn', ms || 4200);
  toast.err = (msg, ms) => toast(msg, 'error', ms || 5200);

  // ----------------------------------------------------------------------------
  // Identity helpers
  // ----------------------------------------------------------------------------

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[2]) : '';
  }
  function getNFJwtFromCookie() {
    // nf_jwt is Netlify’s Session cookie; __nfsec is the CSRF/edge cookie
    return getCookie('nf_jwt') || '';
  }

  function getCurrentAdminPath() {
    try {
      const path = String(window.location?.pathname || '');
      return path || '/';
    } catch {
      return '/';
    }
  }

  function isAdminEntryPath(path = getCurrentAdminPath()) {
    return path === '/admin/' || path === '/admin/index.html';
  }

  function normaliseAdminTarget(input) {
    const raw = String(input || '').trim();
    if (!raw || /^([a-z]+:)?\/\//i.test(raw) || raw.includes('..')) return '';
    let candidate = raw;
    if (!candidate.startsWith('/')) {
      candidate = candidate.startsWith('admin/') ? `/${candidate}` : `/admin/${candidate}`;
    }
    try {
      const url = new URL(candidate, window.location.origin);
      const path = url.pathname || '';
      const file = path.split('/').pop() || '';
      if (!path.startsWith('/admin/')) return '';
      if (!/^[a-z0-9-]+\.html$/i.test(file)) return '';
      if (file.toLowerCase() === 'index.html') return '';
      return `${path}${url.search || ''}${url.hash || ''}`;
    } catch (err) {
      Debug.warn('admin target normalise failed', err);
      return '';
    }
  }

  function getRequestedAdminPath() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return normaliseAdminTarget(params.get('next') || '');
    } catch (err) {
      Debug.warn('admin next param read failed', err);
      return '';
    }
  }

  function getAdminEntryUrl(targetPath) {
    const safeTarget = normaliseAdminTarget(targetPath);
    const suffix = safeTarget ? safeTarget.replace(/^\/admin\//, '') : '';
    return suffix ? `/admin/?next=${encodeURIComponent(suffix)}` : '/admin/';
  }

  function adminTargetLabel(path) {
    const safePath = normaliseAdminTarget(path);
    if (!safePath) return 'HMJ admin';
    const file = (safePath.split('/').pop() || '').replace(/\.html$/i, '');
    const words = file.split(/[-_]+/).filter(Boolean).map((part) => {
      const lower = part.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    });
    return words.length ? words.join(' ') : 'HMJ admin';
  }

  function scrubAuthCallbackUrl() {
    try {
      const helpers = window.HMJAuthFlow || {};
      const authKeys = Array.isArray(helpers.AUTH_PARAM_KEYS)
        ? helpers.AUTH_PARAM_KEYS
        : ['invite_token', 'recovery_token', 'confirmation_token', 'email_change_token', 'access_token', 'refresh_token', 'type', 'error', 'error_description'];
      const url = new URL(window.location.href);
      let changed = false;

      authKeys.forEach((key) => {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
          changed = true;
        }
      });

      if (url.hash) {
        const parsed = typeof helpers.parseAuthState === 'function'
          ? helpers.parseAuthState({ pathname: url.pathname, search: url.search, hash: url.hash })
          : null;
        if (parsed?.isAuthCallback) {
          url.hash = '';
          changed = true;
        }
      }

      if (changed) {
        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, document.title, nextUrl);
      }
    } catch (err) {
      Debug.warn('auth callback url scrub failed', err);
    }
  }

  function ensureDebugChip() {
    if (!DEBUG_CHIP_ENABLED) return null;
    let host = document.getElementById('hmjDebugChip');
    if (!host) {
      host = document.createElement('aside');
      host.id = 'hmjDebugChip';
      host.style.position = 'fixed';
      host.style.bottom = '18px';
      host.style.left = '18px';
      host.style.zIndex = '99998';
      host.style.background = 'rgba(8,18,32,.92)';
      host.style.border = '1px solid rgba(132,158,255,.25)';
      host.style.borderRadius = '14px';
      host.style.padding = '8px 10px';
      host.style.color = '#e7f1ff';
      host.style.fontSize = '12px';
      host.style.fontFamily = '"Inter", system-ui, -apple-system, Segoe UI, sans-serif';
      host.style.boxShadow = '0 18px 32px rgba(5,12,28,.45)';
      host.style.display = 'grid';
      host.style.gap = '0';
      host.style.width = 'min(240px, calc(100vw - 36px))';
      host.innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <div style="display:grid;gap:3px;min-width:0">
            <strong style="letter-spacing:.08em;font-size:11px;text-transform:uppercase;opacity:.7">Admin debug</strong>
            <span data-field="summary" style="opacity:.86;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Session checking…</span>
          </div>
          <button
            type="button"
            data-action="toggle-debug"
            aria-expanded="false"
            style="appearance:none;border:1px solid rgba(160,185,255,.28);background:rgba(255,255,255,.08);color:#e7f1ff;border-radius:999px;padding:4px 10px;font:inherit;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap"
          >Show</button>
        </div>
        <div data-debug-body style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid rgba(160,185,255,.16);gap:4px">
          <span data-field="identity">Identity: ${IDENTITY_URL || '—'}</span>
          <span data-field="host">Host: ${HOSTNAME || '—'}</span>
          <span data-field="email">User: —</span>
          <span data-field="roles">Roles: —</span>
          <span data-field="auth">Auth: —</span>
          <span data-field="widget">Widget: checking…</span>
          <span data-field="login">Login: checking…</span>
        </div>
      `;
      const toggle = host.querySelector('[data-action="toggle-debug"]');
      if (toggle) {
        toggle.addEventListener('click', () => {
          const expanded = host.getAttribute('data-expanded') !== 'true';
          setDebugChipExpanded(host, expanded);
        });
      }
      document.body.appendChild(host);
    }
    setDebugChipExpanded(host, readDebugChipExpanded());
    return host;
  }

  function setDebugChipExpanded(host, expanded) {
    if (!host) return;
    host.setAttribute('data-expanded', expanded ? 'true' : 'false');
    host.style.padding = expanded ? '10px 14px' : '8px 10px';
    host.style.width = expanded
      ? 'min(420px, calc(100vw - 36px))'
      : 'min(240px, calc(100vw - 36px))';
    const body = host.querySelector('[data-debug-body]');
    if (body) body.style.display = expanded ? 'grid' : 'none';
    const toggle = host.querySelector('[data-action="toggle-debug"]');
    if (toggle) {
      toggle.textContent = expanded ? 'Hide' : 'Show';
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
    writeDebugChipExpanded(expanded);
  }

  function getWidgetDebugState() {
    const loader = window.__hmjIdentityLoaderState || {};
    if (loader.widgetReady) return 'ready';
    if (loader.widgetError) return `error (${loader.widgetError})`;
    if (loader.widgetScriptLoaded) return 'script loaded';
    if (loader.widgetScriptInjected) return 'loading';
    return 'not loaded';
  }

  function getLoginBindingState() {
    const button = document.querySelector('button[data-admin-login-primary]') || document.querySelector('button[data-admin-login]');
    if (!button) return 'no button';
    return button.dataset.hmjLoginBound === '1' ? 'bound' : 'not bound';
  }

  function updateDebugChip(session) {
    const chip = ensureDebugChip();
    if (!chip) return;
    const email = session?.email || session?.identityEmail || '—';
    const roles = Array.isArray(session?.roles) ? session.roles : (session?.role ? [session.role] : []);
    const roleText = roles.length ? roles.join(', ') : '—';
    const authText = session?.token
      ? 'JWT token ready'
      : session?.sessionVerified
        ? 'Verified host session cookie'
        : 'No verified session';
    const summaryNode = chip.querySelector('[data-field="summary"]');
    if (summaryNode) {
      const compactRole = roles.length ? roles[0] : 'no role';
      summaryNode.textContent = email !== '—'
        ? `${email} • ${compactRole}`
        : authText;
    }
    const whoami = chip.querySelector('[data-field="email"]');
    if (whoami) whoami.textContent = `User: ${email || '—'}`;
    const rolesNode = chip.querySelector('[data-field="roles"]');
    if (rolesNode) rolesNode.textContent = `Roles: ${roleText}`;
    const identityNode = chip.querySelector('[data-field="identity"]');
    if (identityNode) identityNode.textContent = `Identity: ${IDENTITY_URL || '—'}`;
    const hostNode = chip.querySelector('[data-field="host"]');
    if (hostNode) hostNode.textContent = `Host: ${HOSTNAME || '—'}`;
    const authNode = chip.querySelector('[data-field="auth"]');
    if (authNode) authNode.textContent = `Auth: ${authText}`;
    const widgetNode = chip.querySelector('[data-field="widget"]');
    if (widgetNode) widgetNode.textContent = `Widget: ${getWidgetDebugState()}`;
    const loginNode = chip.querySelector('[data-field="login"]');
    if (loginNode) loginNode.textContent = `Login: ${getLoginBindingState()}`;
  }

  function brandIdentityWidget(id) {
    try {
      const styleText = `
        .netlify-identity-logo {
          background: transparent !important;
        }
        .netlify-identity-logo svg,
        .netlify-identity-logo img {
          display: none !important;
        }
        .netlify-identity-logo::after {
          content: '';
          display: block;
          width: 72px;
          height: 72px;
          margin: 0 auto;
          background: url(/images/logo.png) center/contain no-repeat;
        }
      `;

      const hostDoc = document;
      if (hostDoc && !hostDoc.getElementById('hmj-identity-brand-host')) {
        const hostStyle = hostDoc.createElement('style');
        hostStyle.id = 'hmj-identity-brand-host';
        hostStyle.textContent = styleText;
        hostDoc.head.appendChild(hostStyle);
      }

      const doc = id?.iframe?.contentWindow?.document;
      if (doc && !doc.getElementById('hmj-identity-brand')) {
        const style = doc.createElement('style');
        style.id = 'hmj-identity-brand';
        style.textContent = styleText;
        doc.head.appendChild(style);
      }
    } catch (err) {
      Debug.warn('identity brand failed', err);
    }
  }

  function ensureIdentityInit() {
    const id = window.netlifyIdentity;
    if (!id || typeof id.init !== 'function') return id;
    if (id.__hmjInit) return id;

    id.__hmjInit = true;
    const opts = {};
    const base = (
      IDENTITY_URL ||
      window.__hmjResolvedIdentityUrl ||
      window.HMJ_IDENTITY_URL ||
      window.NETLIFY_IDENTITY_URL ||
      window.ADMIN_IDENTITY_URL ||
      ''
    ).replace(/\/$/, '');
    if (base) {
      opts.APIUrl = base;
      try {
        const settings = window.netlifyIdentitySettings = window.netlifyIdentitySettings || {};
        settings.APIUrl = base;
      } catch (err) {
        Debug.warn('identity settings init failed', err);
      }
    }
    try { id.init(opts); } catch (err) { Debug.warn('identity init failed', err); }

    try {
      id.on('init', () => brandIdentityWidget(id));
      id.on('open', () => brandIdentityWidget(id));
    } catch (err) {
      Debug.warn('identity brand hook failed', err);
    }

    if (!id.__hmjInitWaiter && typeof id.on === 'function') {
      id.__hmjInitWaiter = new Promise((resolve) => {
        const done = (user) => {
          if (id) id.__hmjInitUser = user || null;
          resolve(user || null);
        };
        try {
          id.on('init', (user) => done(user));
        } catch (err) {
          Debug.warn('identity init listener failed', err);
          done(null);
        }
        setTimeout(() => {
          try {
            done(id?.currentUser?.() || null);
          } catch {
            done(null);
          }
        }, 1200);
      });
    }

    return id;
  }

  async function waitIdentityReady(maxMs = 6000) {
    try {
      if (typeof window.hmjEnsureIdentityWidget === 'function') {
        window.hmjEnsureIdentityWidget();
      }
    } catch (err) {
      Debug.warn('identity widget ensure failed', err);
    }
    let waited = 0;
    while (waited < maxMs) {
      const id = ensureIdentityInit();
      if (typeof window.netlifyIdentity !== 'undefined') {
        return id || window.netlifyIdentity || null;
      }
      await sleep(100);
      waited += 100;
    }
    return ensureIdentityInit() || (typeof window.netlifyIdentity !== 'undefined' ? window.netlifyIdentity : null);
  }

  async function openIdentityDialog(mode = 'login') {
    try {
      if (typeof window.hmjEnsureIdentityWidget === 'function') {
        window.hmjEnsureIdentityWidget();
      }
      if (typeof window.hmjConfigureIdentity === 'function') {
        try { window.hmjConfigureIdentity(true); } catch (err) { Debug.warn('hmjConfigureIdentity failed', err); }
      }
      const id = await waitIdentityReady(6000);
      const ready = ensureIdentityInit() || id || window.netlifyIdentity || null;
      if (ready && typeof ready.open === 'function') {
        ready.open(mode);
        return true;
      }
    } catch (err) {
      Debug.warn('identity dialog open failed', err);
    }
    toast.err('Sign-in is still loading on this host. Refresh and try again.', 5200);
    return false;
  }

  async function logoutIdentitySession() {
    try {
      if (typeof window.hmjConfigureIdentity === 'function') {
        try { window.hmjConfigureIdentity(true); } catch (err) { Debug.warn('hmjConfigureIdentity failed', err); }
      }
      const id = await waitIdentityReady(4000);
      const ready = ensureIdentityInit() || id || window.netlifyIdentity || null;
      if (ready && typeof ready.logout === 'function') {
        ready.logout();
        return true;
      }
    } catch (err) {
      Debug.warn('identity logout failed', err);
    }
    toast.err('Sign-out is still loading on this host. Refresh and try again.', 5200);
    return false;
  }

  function matchesText(button, expected) {
    const text = String(button?.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase();
    return text === expected;
  }

  function bindIdentityButtons(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') return;

    const loginButtons = new Set(root.querySelectorAll('button[data-admin-login]'));
    const gateButton = root.querySelector('#gate [data-admin-login-primary]');
    if (gateButton) loginButtons.add(gateButton);
    root.querySelectorAll('.gate-actions button, .top button').forEach((button) => {
      if (matchesText(button, 'log in') || matchesText(button, 'log in with hmj email') || matchesText(button, 'sign in with hmj email')) {
        loginButtons.add(button);
      }
    });

    loginButtons.forEach((button) => {
      if (!button || button.dataset.hmjLoginBound === '1') return;
      button.dataset.hmjLoginBound = '1';
      button.type = 'button';
      button.style.pointerEvents = 'auto';
      button.removeAttribute('onclick');
      button.onclick = async (event) => {
        if (event) event.preventDefault();
        await openIdentityDialog('login');
      };
    });

    const signOutButtons = new Set(root.querySelectorAll('button[data-admin-logout], #btnSignOut'));
    root.querySelectorAll('.top button').forEach((button) => {
      if (matchesText(button, 'sign out')) signOutButtons.add(button);
    });

    signOutButtons.forEach((button) => {
      if (!button || button.dataset.hmjLogoutBound === '1') return;
      button.dataset.hmjLogoutBound = '1';
      button.type = 'button';
      button.style.pointerEvents = 'auto';
      button.removeAttribute('onclick');
      button.onclick = async (event) => {
        if (event) event.preventDefault();
        await logoutIdentitySession();
      };
    });

    updateDebugChip(identityCache || null);
  }

  // Resolve active user (works with widget or cookie-only)
  async function getIdentityUser() {
    try {
      const id = ensureIdentityInit();
      if (id && typeof id.currentUser === 'function') {
        let u = id.currentUser();
        if (u) return u;
        try {
          if (id.__hmjInitWaiter) {
            const resolved = await Promise.race([
              id.__hmjInitWaiter,
              sleep(1500).then(() => null)
            ]);
            if (resolved) return resolved;
          }
        } catch (err) {
          Debug.warn('identity init wait failed', err);
        }
        u = id.currentUser?.();
        if (u) return u;
        if (id.__hmjInitUser) return id.__hmjInitUser;
      }
    } catch {}
    // Cookie-only session: we can’t read profile, but a token may exist
    const token = getNFJwtFromCookie();
    if (token) {
      const payload = decodeJwt(token);
      const rawRoles = payload?.app_metadata?.roles || payload?.roles || payload?.role;
      const roles = Array.isArray(rawRoles) ? rawRoles : (rawRoles ? [rawRoles] : []);
      const email = payload?.email || payload?.sub || undefined;
      return {
        token: async () => token,
        jwt: async () => token,
        email,
        app_metadata: { roles },
        roles,
        __hmjJwt: payload
      };
    }
    return null;
  }

  function normalizeToken(raw) {
    if (!raw) return '';
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) return '';
      if (/^bearer\s+/i.test(trimmed)) return trimmed.replace(/^bearer\s+/i, '').trim();
      return trimmed;
    }
    if (typeof raw === 'object') {
      const keys = [
        'token',
        'access_token',
        'accessToken',
        'nf_jwt',
        'jwt',
        'bearer'
      ];
      for (const key of keys) {
        if (key in raw) {
          const value = raw[key];
          const normalised = normalizeToken(value);
          if (normalised) return normalised;
        }
      }
      if (Array.isArray(raw)) {
        for (const entry of raw) {
          const t = normalizeToken(entry);
          if (t) return t;
        }
      }
    }
    return '';
  }

  async function getUserToken(user) {
    if (!user) return '';
    const attempts = [];
    if (typeof user.token === 'function') attempts.push(() => user.token());
    if (typeof user.jwt === 'function') {
      attempts.push(() => user.jwt());
      attempts.push(() => user.jwt(true));
    }
    for (const attempt of attempts) {
      try {
        const v = await attempt();
        const token = normalizeToken(v);
        if (token) return token;
      } catch (err) {
        Debug.warn('token attempt failed', err);
      }
    }
    const fallbacks = [
      user?.token,
      user?.access_token,
      user?.accessToken,
      user?.session,
      user
    ];
    for (const fb of fallbacks) {
      const token = normalizeToken(fb);
      if (token) return token;
    }
    return '';
  }

  function normaliseRolesList(list) {
    if (!Array.isArray(list)) return [];
    return list.map((role) => String(role || '').toLowerCase()).filter(Boolean);
  }

  function hasVerifiedSession(snapshot) {
    return !!(snapshot?.token || snapshot?.sessionVerified);
  }

  const WHOAMI_CACHE = { token: '', data: null, ts: 0 };

  async function fetchWhoamiSnapshot(token, opts = {}) {
    if (typeof fetch !== 'function') return null;
    const key = token || '';
    const now = Date.now();
    const ttl = opts.ttlMs || 60000;
    if (!opts.force && WHOAMI_CACHE.data && WHOAMI_CACHE.token === key && (now - WHOAMI_CACHE.ts) < ttl) {
      return WHOAMI_CACHE.data;
    }
    const headers = {
      'Accept': 'application/json',
      'Cache-Control': 'no-store',
      'x-trace': typeof getTrace === 'function' ? getTrace() : ''
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch('/.netlify/functions/identity-whoami', {
        method: 'GET',
        headers,
        credentials: 'include',
        cache: 'no-store'
      });
      let data = null;
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        Debug.warn('identity-whoami failed', res.status, data);
        if (opts.verbose) toast.warn(`whoami failed (${res.status})`, 4200);
        return null;
      }
      WHOAMI_CACHE.token = key;
      WHOAMI_CACHE.data = data;
      WHOAMI_CACHE.ts = now;
      if (opts.verbose) {
        const roles = Array.isArray(data?.roles) ? data.roles.join(', ') : '—';
        toast.ok(`whoami: ${data?.identityEmail || 'unknown'} (${roles || 'no roles'})`, 3800);
      }
      return data;
    } catch (err) {
      Debug.warn('identity-whoami fetch threw', err);
      if (opts.verbose) toast.warn('whoami request failed', 4200);
      return null;
    }
  }

  // Public, promise-based identity snapshot used by pages & console
  async function identity(requiredRole /* 'admin' | 'recruiter' | 'client' | undefined */, options) {
    let opts = {};
    if (typeof requiredRole === 'object' && requiredRole !== null && options == null) {
      opts = Object.assign({}, requiredRole);
      requiredRole = opts.requiredRole || opts.role || undefined;
    } else {
      opts = typeof options === 'object' && options !== null ? Object.assign({}, options) : {};
    }
    if (requiredRole && !opts.requiredRole) opts.requiredRole = requiredRole;

    const verbose = !!opts.verbose;
    const forceFresh = !!opts.forceFresh;
    const required = opts.requiredRole ? String(opts.requiredRole).toLowerCase() : '';
    const cacheTtlMs = opts.cacheTtlMs || 4000;
    const now = Date.now();

    if (!forceFresh && identityCache && (now - identityCacheTs) < cacheTtlMs) {
      const cached = Object.assign({}, identityCache);
      if (required) {
        const hasRole = Array.isArray(cached.roles) && cached.roles.includes(required);
        cached.ok = hasVerifiedSession(cached) && (cached.role === required || hasRole);
      }
      if (verbose && cached.ok) {
        toast.ok(`Gate opened for role: ${cached.role || 'unknown'}`, 3800);
      }
      if (verbose && !cached.ok) {
        toast.err('Gate blocked: cached snapshot not authorized', 4200);
      }
      updateDebugChip(cached);
      return cached;
    }

    const id = ensureIdentityInit();
    if (verbose && id) toast.ok('Identity widget ready', 3200);

    await waitIdentityReady(6000);

    let user = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { user = await getIdentityUser(); }
      catch (err) { Debug.warn('getIdentityUser failed', err); }
      if (user) break;
      await sleep(350);
    }

    if (user && verbose) {
      toast.ok('User present, fetching JWT', 3600);
    }

    let token = '';
    let tokenError = null;
    if (user) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          token = await getUserToken(user);
        } catch (err) {
          tokenError = err;
          token = '';
        }
        if (token) break;
        await sleep(320);
      }
    }

    if (!token) {
      try { token = getNFJwtFromCookie(); }
      catch (err) { Debug.warn('nf_jwt cookie read failed', err); }
      if (token && verbose) toast.warn('Using nf_jwt cookie fallback', 4200);
    }

    if (token && verbose) {
      toast.ok('JWT acquired', 3600);
    }

    let roles = [];
    let role = '';
    let email = user?.email || '';
    let jwtPayload = null;

    if (token) {
      jwtPayload = decodeJwt(token);
      if (jwtPayload) {
        const jwtEmail = jwtPayload?.email || jwtPayload?.user_metadata?.email || jwtPayload?.sub || '';
        if (!email && jwtEmail) email = jwtEmail;
        const payloadRoles = jwtPayload?.app_metadata?.roles || jwtPayload?.roles || jwtPayload?.role;
        if (payloadRoles) {
          roles = Array.isArray(payloadRoles) ? payloadRoles : [payloadRoles];
          roles = normaliseRolesList(roles);
        }
      }
    }

    if (!roles.length && user?.app_metadata?.roles) {
      roles = normaliseRolesList(user.app_metadata.roles);
    }
    if (!roles.length && Array.isArray(user?.roles)) {
      roles = normaliseRolesList(user.roles);
    }

    let whoami = null;
    try {
      whoami = await fetchWhoamiSnapshot(token, { verbose: verbose && !!token });
    } catch (err) {
      Debug.warn('whoami snapshot failed', err);
    }

    if (!token && user && whoami?.identityEmail) {
      try {
        const refreshedUser = await getIdentityUser();
        if (refreshedUser) user = refreshedUser;
        token = await getUserToken(user);
        if (token && verbose) {
          toast.ok('JWT acquired after session verification', 3600);
        }
      } catch (err) {
        tokenError = tokenError || err;
        Debug.warn('late token retrieval failed', err);
      }
    }

    if (whoami?.identityEmail) {
      email = whoami.identityEmail || email;
    }
    if (Array.isArray(whoami?.roles) && whoami.roles.length) {
      roles = normaliseRolesList(whoami.roles);
    }

    if (token && !jwtPayload) {
      jwtPayload = decodeJwt(token);
      if (jwtPayload) {
        const jwtEmail = jwtPayload?.email || jwtPayload?.user_metadata?.email || jwtPayload?.sub || '';
        if (!email && jwtEmail) email = jwtEmail;
        if (!roles.length) {
          const payloadRoles = jwtPayload?.app_metadata?.roles || jwtPayload?.roles || jwtPayload?.role;
          if (payloadRoles) {
            roles = normaliseRolesList(Array.isArray(payloadRoles) ? payloadRoles : [payloadRoles]);
          }
        }
      }
    }

    role = roles.includes('admin') ? 'admin' :
           roles.includes('recruiter') ? 'recruiter' :
           roles.includes('client') ? 'client' :
           (roles[0] || '');

    const sessionVerified = !!token || !!whoami?.identityEmail;
    const authMode = token ? 'jwt' : (sessionVerified ? 'cookie' : 'none');

    const base = {
      ok: sessionVerified,
      user: user || null,
      token,
      tokenAvailable: !!token,
      sessionVerified,
      authMode,
      role,
      roles,
      email,
      identityEmail: email,
      whoami: whoami || null
    };

    if (user && jwtPayload && !user.__hmjJwt) user.__hmjJwt = jwtPayload;

    base.ok = base.ok && (!required || role === required || roles.includes(required));

    const enriched = Object.assign({}, base);

    if (verbose) {
      if (enriched.ok) {
        if (enriched.token) {
          toast.ok(`Gate opened for role: ${enriched.role || 'unknown'}`, 4200);
        } else {
          toast.warn(`Gate opened using verified host session for role: ${enriched.role || 'unknown'}`, 4600);
        }
      } else {
        const reason = !enriched.sessionVerified ? 'missing session' : 'no admin role';
        if (!enriched.sessionVerified) {
          toast.err('No verified admin session available on this host. Sign in again on this host.', 5200);
          if (tokenError) Debug.warn('Token retrieval failed', tokenError);
        }
        toast.err(`Gate blocked: ${reason}`, 5200);
        Debug.warn(`Gate blocked: ${reason}`);
      }
    }

    identityCache = enriched;
    identityCacheTs = Date.now();
    updateDebugChip(enriched);
    return enriched;
  }

  // Console helpers (intentionally global)
  window.getIdentity = identity;

  // ----------------------------------------------------------------------------
  // API helper (robust)
  // ----------------------------------------------------------------------------
  let TRACE = ''; // correlation id shown in UI + sent to server
  const setTrace = (v) => { TRACE = v || `ts-${Math.random().toString(36).slice(2)}`; return TRACE; };
  const getTrace = () => TRACE || setTrace();

  async function api(path, method = 'POST', body) {
    const rawPath = String(path || '');
    const isAbsolute = /^https?:\/\//i.test(rawPath);
    let url = rawPath;
    if (!isAbsolute) {
      const hasLeadingSlash = rawPath.startsWith('/');
      const trimmed = rawPath.replace(/^\/+/, '');
      url = hasLeadingSlash
        ? `/.netlify/functions/${trimmed}`.replace('/.netlify/functions//', '/.netlify/functions/')
        : `/.netlify/functions/${trimmed}`;
    }

    // Get a token — widget user or cookie
    let token = '';
    try {
      const who = await identity(); // no role restriction at this level
      token = who.token || '';
    } catch {}

    const headers = {
      'Content-Type': 'application/json',
      'x-trace': getTrace()
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    Debug.log(`API → ${method} ${url}`, body || '');
    const res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: body && method !== 'GET' && method !== 'HEAD' ? JSON.stringify(body) : undefined
    });
    const txt = await res.text();
    let json; try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
    Debug.log('API ←', res.status, json);

    if (!res.ok) {
      const msg = json?.error || json?.message || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.details = json;
      if (res.status !== 401 && res.status !== 403) {
        toast(msg, 'error', 5000);
      }
      throw err;
    }
    return json;
  }

  window.apiPing = async function apiPing() {
    try {
      const j = await api('/admin-audit-list', 'POST', { limit: 1 });
      Debug.log('Ping OK', j?.length || 0);
      return { ok: true, data: j };
    } catch (e) {
      Debug.err('Ping failed', e);
      return { ok: false, error: String(e.message || e) };
    }
  };

  // ----------------------------------------------------------------------------
  // Gate: shows #gate or #app with helpful reasons
  // ----------------------------------------------------------------------------
  async function gate({ adminOnly = true } = {}) {
    const g = $('#gate'); const app = $('#app');
    const why = g ? $('.why', g) : null;
    const heading = g ? $('[data-gate-heading], strong, h1, h2', g) : null;
    const button = g ? $('[data-admin-login-primary], button[data-admin-login], button', g) : null;
    const signOut = document.querySelector('[data-admin-logout]');
    const who = await identity(adminOnly ? 'admin' : undefined, { verbose: false, forceFresh: true });
    const currentPath = getCurrentAdminPath();
    const targetPath = isAdminEntryPath(currentPath) ? getRequestedAdminPath() : normaliseAdminTarget(currentPath);
    const targetLabel = adminTargetLabel(targetPath);

    if (signOut) {
      const showSignOut = !!(who && who.sessionVerified);
      signOut.hidden = !showSignOut;
      if (showSignOut) signOut.removeAttribute('aria-hidden');
      else signOut.setAttribute('aria-hidden', 'true');
    }
    if (who.sessionVerified) {
      scrubAuthCallbackUrl();
    }

    if (who.ok && (!adminOnly || who.role === 'admin')) {
      if (g) g.style.display = 'none';
      if (app) app.style.display = '';
      return who; // { ok, user, token, role, email }
    }

    // No session / wrong role
    if (app) app.style.display = 'none';
    if (g) g.style.display = '';
    if (heading) {
      heading.textContent = !who.sessionVerified ? 'HMJ admin sign-in' : 'Admin access required';
    }
    if (button) {
      button.type = 'button';
      if (!button.textContent || /log\s*in/i.test(button.textContent) || /sign\s*in/i.test(button.textContent)) {
        button.textContent = 'Open secure sign-in';
      }
      button.onclick = async (event) => {
        if (event) event.preventDefault();
        await openIdentityDialog('login');
      };
    }
    bindIdentityButtons(g || document);
    if (why) {
      if (!who.sessionVerified) {
        why.textContent = targetPath
          ? `Sign in with your HMJ staff email to continue to ${targetLabel}.`
          : 'Sign in with your HMJ staff email to access HMJ admin on this site.';
      } else if (adminOnly) {
        const roles = Array.isArray(who.roles) && who.roles.length ? who.roles.join(', ') : 'none';
        const identityEmail = who.email || who.identityEmail || 'this account';
        why.textContent = targetPath
          ? `You are signed in as ${identityEmail}, but this account does not have HMJ admin access to open ${targetLabel}. Current roles: ${roles}. Use Sign out above if you need to switch accounts.`
          : `You are signed in as ${identityEmail}, but this account does not have HMJ admin access on this site. Current roles: ${roles}. Use Sign out above if you need to switch accounts.`;
      } else {
        why.textContent = 'Access limited for your role.';
      }
    }
    return null;
  }

  // ----------------------------------------------------------------------------
  // adminReady(): returns helpers when identity widget is ready (or fallback)
  // ----------------------------------------------------------------------------
  let _readyOnce;
  window.adminReady = function adminReady() {
    if (_readyOnce) return _readyOnce;
    _readyOnce = (async () => {
      try {
        await waitIdentityReady(4000); // non-fatal if not ready yet
        setTrace(); // ensure we always have one
        Debug.log('Bootstrap ready; trace=', getTrace());
        return { api, sel: $, toast, setTrace, getTrace, identity, isMobile, gate };
      } catch (e) {
        // Don’t throw — provide helpers anyway
        Debug.err('adminReady failed (continuing with fallbacks):', e);
        return { api, sel: $, toast, setTrace, getTrace, identity, isMobile, gate };
      }
    })();
    return _readyOnce;
  };

  // ----------------------------------------------------------------------------
  // Admin.bootAdmin(mainFn): page-safe entrypoint
  // ----------------------------------------------------------------------------

  async function runWhoamiDiagnostics() {
    try {
      const snapshot = await identity({ requiredRole: 'admin', forceFresh: true });
      const diag = await fetchWhoamiSnapshot(snapshot.token, { force: true });
      if (diag && diag.identityEmail) {
        const roles = Array.isArray(diag.roles) ? diag.roles : [];
        if (roles.length) {
          toast.ok(`whoami → ${diag.identityEmail} (${roles.join(', ')})`, 4600);
        } else {
          toast.err(`whoami → ${diag.identityEmail} (no roles). Sign out/in on this host.`, 6200);
        }
      } else {
        toast.err('whoami returned no identity data.', 5200);
      }
    } catch (err) {
      Debug.err('whoami diagnostics failed', err);
      toast.err('whoami diagnostics failed: ' + (err?.message || err), 5200);
    }
  }

  function injectPreviewDebugButton() {
    if (!IS_PREVIEW_HOST) return;
    const row = document.querySelector('.top .row');
    if (!row || row.querySelector('[data-preview-debug]')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ghost small';
    btn.textContent = 'Debug';
    btn.setAttribute('data-preview-debug', '1');
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      runWhoamiDiagnostics();
    });
    const signOut = row.querySelector('button[data-admin-logout], #btnSignOut') ||
      Array.from(row.querySelectorAll('button')).find((button) => matchesText(button, 'sign out'));
    if (signOut && signOut.parentElement === row) {
      row.insertBefore(btn, signOut);
    } else {
      row.appendChild(btn);
    }
  }

  window.Admin = window.Admin || {};
  window.Admin.bootAdmin = async function bootAdmin(mainFn) {
    try {
      const helpers = await window.adminReady();
      const currentPath = getCurrentAdminPath();
      const entryPage = isAdminEntryPath(currentPath);

      bindIdentityButtons(document);
      injectPreviewDebugButton();

      // Hook Identity events once so that a successful login triggers a reload
      // even if the initial gate check blocks the user. Without this the page
      // would stay on the gate screen after logging in via the widget.
      const id = window.netlifyIdentity;
      if (id && typeof id.on === 'function' && !id.__hmjHooks) {
        id.__hmjHooks = true;
        id.on('login', () => {
          try {
            location.reload();
          } catch (err) {
            Debug.warn('reload after login failed', err);
          }
        });
        id.on('logout', () => {
          try {
            location.href = '/admin/';
          } catch (err) {
            Debug.warn('redirect after logout failed', err);
          }
        });
      }

      const who = await helpers.gate({ adminOnly: true });
      if (!who) {
        if (!entryPage) {
          const target = getAdminEntryUrl(currentPath);
          if (target && target !== `${window.location.pathname}${window.location.search}`) {
            try {
              window.location.replace(target);
              return;
            } catch (err) {
              Debug.warn('redirect to admin entry failed', err);
            }
          }
        }
        Debug.warn('Gate blocked: no session / no admin role');
        return;
      }

      if (entryPage) {
        const requestedPath = getRequestedAdminPath();
        if (requestedPath) {
          try {
            window.location.replace(requestedPath);
            return;
          } catch (err) {
            Debug.warn('redirect to requested admin page failed', err);
          }
        }
      }

      // Debug chip line (optional)
      try {
        const diag = $('#diagChips');
        if (diag) {
          diag.innerHTML = '';
          addChip(diag, 'init: ok', true);
          addChip(diag, 'identity: ok', true);
          addChip(diag, who.token ? 'token: ok' : 'auth: cookie session', true);
          addChip(diag, 'role: ' + (who.role || 'admin'), true);
        }
      } catch {}

      // Run the page’s main code
      await Promise.resolve(mainFn(helpers));
    } catch (e) {
      Debug.err('bootAdmin error:', e);
      toast('Init failed: ' + (e.message || e), 'error', 6000);
      // keep the gate visible
      try {
        const g = $('#gate');
        const app = $('#app');
        if (g) g.style.display = '';
        if (app) app.style.display = 'none';
        bindIdentityButtons(document);
        const heading = g ? $('strong, h1, h2', g) : null;
        const why = g ? $('.why', g) : null;
        if (heading) heading.textContent = 'HMJ admin sign-in';
        if (why) why.textContent = 'Admin failed to finish loading cleanly. You can still sign in again on this host, or refresh and try again.';
      } catch {}
    }
  };

  function addChip(host, text, ok) {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.display = 'inline-grid';
    span.style.alignItems = 'center';
    span.style.padding = '4px 8px';
    span.style.borderRadius = '9999px';
    span.style.fontSize = '12px';
    span.style.fontWeight = '700';
    span.style.border = '1px solid rgba(0,0,0,.12)';
    span.style.background = ok ? '#e8f6ef' : '#fdeeee';
    span.style.color = ok ? '#0f5132' : '#842029';
    host.appendChild(span);
  }

  ensureDebugChip();
  bindIdentityButtons(document);
  document.addEventListener('hmj:identity-loader-state', () => updateDebugChip(identityCache || null));
  document.addEventListener('hmjIdentityUnavailable', () => updateDebugChip(identityCache || null));

  Debug.log('common.js loaded');
})();
