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
    n.style.background = type === 'error' ? '#3a1418' :
                         type === 'warn'  ? '#35240d' : '#0e2038';
    n.style.border = '1px solid rgba(255,255,255,.14)';
    n.style.color = 'white';
    n.textContent = String(msg);
    host.appendChild(n);
    setTimeout(() => n.remove(), ms);
  }

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
      window.__hmjResolvedIdentityUrl ||
      window.HMJ_IDENTITY_URL ||
      window.NETLIFY_IDENTITY_URL ||
      window.ADMIN_IDENTITY_URL ||
      ''
    ).replace(/\/$/, '');
    if (base) opts.APIUrl = base;
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

  // Public, promise-based identity snapshot used by pages & console
  async function identity(requiredRole /* 'admin' | 'recruiter' | 'client' | undefined */) {
    // try widget first, then cookie
    await waitIdentityReady(1200); // don’t block long
    let user = null; let token = '';
    try { user = await getIdentityUser(); } catch {}
    try { token = await getUserToken(user); } catch {}

    const jwtPayload = token ? decodeJwt(token) : (user && user.__hmjJwt) ? user.__hmjJwt : null;

    let rolesSource = user?.app_metadata?.roles;
    if (!rolesSource || (Array.isArray(rolesSource) && !rolesSource.length)) {
      rolesSource = user?.roles;
    }
    if ((!rolesSource || (Array.isArray(rolesSource) && !rolesSource.length)) && jwtPayload) {
      const jwtRoles = jwtPayload?.app_metadata?.roles || jwtPayload?.roles || jwtPayload?.role;
      if (Array.isArray(jwtRoles)) rolesSource = jwtRoles;
      else if (jwtRoles) rolesSource = [jwtRoles];
    }

    const roles = Array.isArray(rolesSource)
      ? rolesSource.map(r => String(r).toLowerCase()).filter(Boolean)
      : rolesSource ? [String(rolesSource).toLowerCase()] : [];

    if (user) {
      if (!user.app_metadata) user.app_metadata = {};
      if (!Array.isArray(user.app_metadata.roles) || !user.app_metadata.roles.length) {
        if (roles.length) {
          user.app_metadata.roles = roles;
        }
      }
      if (jwtPayload && !user.__hmjJwt) user.__hmjJwt = jwtPayload;
      if (!user.roles || (Array.isArray(user.roles) && !user.roles.length)) {
        if (roles.length) user.roles = roles;
      }
    }

    let email = user?.email || '';
    if (!email && jwtPayload) {
      email = jwtPayload?.email || jwtPayload?.sub || '';
    }

    const role = roles.includes('admin') ? 'admin' :
                 roles.includes('recruiter') ? 'recruiter' :
                 roles.includes('client') ? 'client' : (roles[0] || '');
    const required = requiredRole ? String(requiredRole).toLowerCase() : '';
    if (!token) {
      try {
        token = getNFJwtFromCookie();
      } catch {}
    }

    const ok = !!token && (!required || roles.includes(required) || role === required);
    return { ok, user, token, role, email };
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
    const who = await identity(adminOnly ? 'admin' : undefined);

    if (who.ok && (!adminOnly || who.role === 'admin')) {
      if (g) g.style.display = 'none';
      if (app) app.style.display = '';
      return who; // { ok, user, token, role, email }
    }

    // No session / wrong role
    if (app) app.style.display = 'none';
    if (g) g.style.display = '';
    if (why) {
      if (!who.token)       why.textContent = 'Sign in required.';
      else if (adminOnly)   why.textContent = 'Admin role required.';
      else                  why.textContent = 'Access limited for your role.';
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
  window.Admin = window.Admin || {};
  window.Admin.bootAdmin = async function bootAdmin(mainFn) {
    try {
      const helpers = await window.adminReady();

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
        toast('Restricted. Sign in with an admin account.', 'warn', 4500);
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

  Debug.log('common.js loaded');
})();
