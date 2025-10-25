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

  const CANONICAL_IDENTITY_URL = 'https://hmjg.netlify.app/.netlify/identity';
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
  const IDENTITY_URL = (() => {
    const candidates = [
      ADMIN_ENV.ADMIN_IDENTITY_URL,
      window.ADMIN_IDENTITY_URL,
      IS_PREVIEW_HOST ? ORIGIN_PROXY_IDENTITY_URL : '',
      !IS_PREVIEW_HOST ? ORIGIN_IDENTITY_URL : '',
      CANONICAL_IDENTITY_URL
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const trimmed = String(candidate).trim();
      if (!trimmed) continue;
      return trimmed.replace(/\/$/, '');
    }
    return '';
  })();
  const PRODUCTION_HOSTS = ['hmjg.netlify.app'];
  const ALWAYS_ADMIN_EMAILS = String(ADMIN_ENV.ALWAYS_ADMIN_EMAILS || window.ALWAYS_ADMIN_EMAILS || '')
    .split(/[,\s]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const FORCE_ADMIN_KEY = String(ADMIN_ENV.FORCE_ADMIN_KEY || window.FORCE_ADMIN_KEY || '').trim();
  const FORCE_ADMIN_STORAGE_KEY = `hmjg:force-admin:${HOSTNAME}`;
  let previewForceAdminActive = false;
  let previewAllowlistAnnounced = false;
  let previewForceToastAnnounced = false;
  let identityCache = null;
  let identityCacheTs = 0;

  if (IDENTITY_URL) {
    window.ADMIN_IDENTITY_URL = IDENTITY_URL;
    window.__hmjResolvedIdentityUrl = IDENTITY_URL;
    if (!window.NETLIFY_IDENTITY_URL) window.NETLIFY_IDENTITY_URL = IDENTITY_URL;
    if (!window.HMJ_IDENTITY_URL) window.HMJ_IDENTITY_URL = IDENTITY_URL;
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

  function toggleForceBanner(active) {
    let banner = document.getElementById('hmjForceAdminBanner');
    if (!active || !IS_PREVIEW_HOST) {
      if (banner) banner.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'hmjForceAdminBanner';
      banner.textContent = 'ForceAdmin (preview) is ON';
      banner.style.position = 'fixed';
      banner.style.top = '14px';
      banner.style.left = '50%';
      banner.style.transform = 'translateX(-50%)';
      banner.style.padding = '7px 14px';
      banner.style.borderRadius = '999px';
      banner.style.fontSize = '12px';
      banner.style.fontWeight = '800';
      banner.style.letterSpacing = '.08em';
      banner.style.textTransform = 'uppercase';
      banner.style.background = '#40281f';
      banner.style.color = '#ffddc8';
      banner.style.border = '1px solid rgba(255,221,200,.4)';
      banner.style.zIndex = '99999';
      banner.style.boxShadow = '0 12px 30px rgba(0,0,0,.25)';
      banner.dataset.todo = 'TODO: REMOVE BEFORE PROD MERGE';
      document.body.appendChild(banner);
    }
  }

  function syncForceAdminFlag() {
    if (!IS_PREVIEW_HOST) {
      try { sessionStorage.removeItem(FORCE_ADMIN_STORAGE_KEY); } catch {}
      toggleForceBanner(false);
      return false;
    }
    let active = false;
    let keepForLoad = false;
    try {
      const params = new URLSearchParams(window.location.search || '');
      const paramPresent = params.has('forceAdmin');
      const provided = params.get('forceAdmin') || '';
      if (paramPresent) {
        if (FORCE_ADMIN_KEY && provided === FORCE_ADMIN_KEY) {
          try { sessionStorage.setItem(FORCE_ADMIN_STORAGE_KEY, '1'); } catch {}
          active = true;
          keepForLoad = true;
          toast.warn('ForceAdmin (preview) is ON', 5200); // TODO: REMOVE BEFORE PROD MERGE
          Debug.warn('ForceAdmin override active for preview host');
          try {
            params.delete('forceAdmin');
            const url = new URL(window.location.href);
            url.search = params.toString();
            window.history.replaceState({}, document.title, url.toString());
          } catch (err) {
            Debug.warn('forceAdmin history.replaceState failed', err);
          }
        } else {
          try { sessionStorage.removeItem(FORCE_ADMIN_STORAGE_KEY); } catch {}
          toast.err('ForceAdmin key invalid for this preview host.', 5200);
          Debug.warn('ForceAdmin override rejected: key mismatch');
        }
      }
      if (!keepForLoad) {
        const stored = (() => { try { return sessionStorage.getItem(FORCE_ADMIN_STORAGE_KEY); } catch { return null; } })();
        if (stored === '1' && !paramPresent) {
          try { sessionStorage.removeItem(FORCE_ADMIN_STORAGE_KEY); } catch {}
        } else if (stored === '1') {
          active = true;
        }
      }
    } catch (err) {
      Debug.warn('ForceAdmin flag sync failed', err);
      try { sessionStorage.removeItem(FORCE_ADMIN_STORAGE_KEY); } catch {}
    }
    toggleForceBanner(active);
    return active;
  }

  previewForceAdminActive = syncForceAdminFlag();

  function ensureDebugChip() {
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
      host.style.padding = '10px 14px';
      host.style.color = '#e7f1ff';
      host.style.fontSize = '12px';
      host.style.fontFamily = '"Inter", system-ui, -apple-system, Segoe UI, sans-serif';
      host.style.boxShadow = '0 18px 32px rgba(5,12,28,.45)';
      host.style.display = 'grid';
      host.style.gap = '4px';
      host.innerHTML = `
        <strong style="letter-spacing:.08em;font-size:11px;text-transform:uppercase;opacity:.7">Admin debug</strong>
        <span data-field="identity">Identity: ${IDENTITY_URL || '—'}</span>
        <span data-field="host">Host: ${HOSTNAME || '—'}</span>
        <span data-field="email">User: —</span>
        <span data-field="roles">Roles: —</span>
        <span data-field="override" style="display:none">Override: —</span>
      `;
      document.body.appendChild(host);
    }
    return host;
  }

  function updateDebugChip(session) {
    const chip = ensureDebugChip();
    if (!chip) return;
    const email = session?.email || session?.identityEmail || '—';
    const roles = Array.isArray(session?.roles) ? session.roles : (session?.role ? [session.role] : []);
    const roleText = roles.length ? roles.join(', ') : '—';
    const whoami = chip.querySelector('[data-field="email"]');
    if (whoami) whoami.textContent = `User: ${email || '—'}`;
    const rolesNode = chip.querySelector('[data-field="roles"]');
    if (rolesNode) rolesNode.textContent = `Roles: ${roleText}`;
    const identityNode = chip.querySelector('[data-field="identity"]');
    if (identityNode) identityNode.textContent = `Identity: ${IDENTITY_URL || '—'}`;
    const hostNode = chip.querySelector('[data-field="host"]');
    if (hostNode) hostNode.textContent = `Host: ${HOSTNAME || '—'}`;
    const overrideNode = chip.querySelector('[data-field="override"]');
    const overrides = [];
    if (session?.override === 'allowlist') overrides.push('Allowlist');
    if (session?.override === 'forceAdmin' || session?.forceAdmin) overrides.push('ForceAdmin');
    if (Array.isArray(session?.overrides)) {
      for (const item of session.overrides) {
        if (!overrides.includes(item)) overrides.push(item);
      }
    }
    if (previewForceAdminActive && !overrides.includes('ForceAdmin')) overrides.push('ForceAdmin');
    if (overrideNode) {
      if (overrides.length) {
        overrideNode.style.display = '';
        overrideNode.textContent = `Override: ${overrides.join(', ')}`;
      } else {
        overrideNode.style.display = 'none';
      }
    }
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
    let waited = 0;
    while (waited < maxMs) {
      const id = ensureIdentityInit();
      if (id && typeof id.on === 'function') {
        // Widget is live
        return id;
      }
      await sleep(100);
      waited += 100;
    }
    return ensureIdentityInit(); // allow fallback
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

  function applyPreviewBackups(snapshot) {
    if (!snapshot) return snapshot;
    const result = Object.assign({}, snapshot);
    const email = String(result.email || result.identityEmail || '').toLowerCase();
    const roles = Array.isArray(result.roles) ? result.roles.slice() : [];
    let ok = !!result.ok;
    const overrides = [];

    if (!ok && email && IS_PREVIEW_HOST && !PRODUCTION_HOSTS.includes(HOSTNAME)) {
      if (ALWAYS_ADMIN_EMAILS.includes(email)) {
        ok = true;
        if (!roles.includes('admin')) roles.push('admin');
        result.role = 'admin';
        result.override = 'allowlist';
        overrides.push('Allowlist');
        if (!previewAllowlistAnnounced) {
          toast.warn(`Preview override active for ${email}.`, 5200);
          Debug.warn('Preview override via allowlist', email);
          previewAllowlistAnnounced = true;
        }
      }
      if (!ok && previewForceAdminActive && FORCE_ADMIN_KEY) {
        ok = true;
        if (!roles.includes('admin')) roles.push('admin');
        result.role = 'admin';
        result.override = 'forceAdmin';
        overrides.push('ForceAdmin');
        result.forceAdmin = true;
        if (!previewForceToastAnnounced) {
          toast.warn('ForceAdmin preview override active.', 5200); // TODO: REMOVE BEFORE PROD MERGE
          Debug.warn('ForceAdmin override granting admin role');
          previewForceToastAnnounced = true;
        }
      }
    }

    result.ok = ok;
    result.roles = roles;
    if (!result.email) result.email = email;
    if (!result.identityEmail) result.identityEmail = email;
    if (overrides.length) result.overrides = overrides;
    return result;
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
        cached.ok = !!cached.token && (cached.role === required || hasRole);
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

    previewForceAdminActive = syncForceAdminFlag();

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

    if (!token && verbose) {
      toast.err('No JWT available — sign in on this host.', 5200);
      if (tokenError) Debug.warn('Token retrieval failed', tokenError);
    } else if (token && verbose) {
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

    if (whoami?.identityEmail) {
      email = whoami.identityEmail || email;
    }
    if (Array.isArray(whoami?.roles) && whoami.roles.length) {
      roles = normaliseRolesList(whoami.roles);
    }

    role = roles.includes('admin') ? 'admin' :
           roles.includes('recruiter') ? 'recruiter' :
           roles.includes('client') ? 'client' :
           (roles[0] || '');

    const base = {
      ok: !!token,
      user: user || null,
      token,
      role,
      roles,
      email,
      identityEmail: email,
      whoami: whoami || null
    };

    if (user && jwtPayload && !user.__hmjJwt) user.__hmjJwt = jwtPayload;

    base.ok = base.ok && (!required || role === required || roles.includes(required));

    const enriched = applyPreviewBackups(base);

    if (verbose) {
      if (enriched.ok) {
        toast.ok(`Gate opened for role: ${enriched.role || 'unknown'}`, 4200);
      } else {
        const reason = !enriched.token ? 'missing token' : 'no admin role';
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
    const who = await identity(adminOnly ? 'admin' : undefined, { verbose: true, forceFresh: true });

    if (who.ok && (!adminOnly || who.role === 'admin')) {
      if (g) g.style.display = 'none';
      if (app) app.style.display = '';
      toast.ok('Admin ready.', 3200);
      return who; // { ok, user, token, role, email }
    }

    // No session / wrong role
    if (app) app.style.display = 'none';
    if (g) g.style.display = '';
    if (why) {
      if (!who.token) {
        why.textContent = 'Sign in required on this host.';
      } else if (adminOnly) {
        const roles = Array.isArray(who.roles) && who.roles.length ? who.roles.join(', ') : 'none';
        why.textContent = `Admin role required. Current roles: ${roles}.`;
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
    const signOut = row.querySelector('button[onclick*="logout"],button[onclick*="netlifyIdentity"]');
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
        Debug.warn('Gate blocked: no session / no admin role');
        return;
      }

      // Debug chip line (optional)
      try {
        const diag = $('#diagChips');
        if (diag) {
          diag.innerHTML = '';
          addChip(diag, 'init: ok', true);
          addChip(diag, 'identity: ok', true);
          addChip(diag, 'token: ok', true);
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

  Debug.log('common.js loaded');
})();
