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
    if (!id || typeof id.init !== 'function' || id.__hmjInit) return id;

    id.__hmjInit = true;
    const opts = {};
    const base = (window.ADMIN_IDENTITY_URL || '').replace(/\/$/, '');
    if (base) opts.APIUrl = base;
    try { id.init(opts); } catch (err) { Debug.warn('identity init failed', err); }

    try {
      id.on('init', () => brandIdentityWidget(id));
      id.on('open', () => brandIdentityWidget(id));
    } catch (err) {
      Debug.warn('identity brand hook failed', err);
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
        const u = id.currentUser();
        if (u) return u;
      }
    } catch {}
    // Cookie-only session: we can’t read profile, but a token may exist
    const token = getNFJwtFromCookie();
    if (token) return { token: async () => token, jwt: async () => token, email: undefined, app_metadata: {} };
    return null;
  }

  // Public, promise-based identity snapshot used by pages & console
  async function identity(requiredRole /* 'admin' | 'recruiter' | 'client' | undefined */) {
    // try widget first, then cookie
    await waitIdentityReady(1200); // don’t block long
    let user = null; let token = '';
    try { user = await getIdentityUser(); } catch {}
    try { token = user ? (await (user.token?.() || user.jwt?.())) : '' } catch {}
    const roles = (user?.app_metadata?.roles || user?.roles || []);
    const role = roles.includes('admin') ? 'admin' :
                 roles.includes('recruiter') ? 'recruiter' :
                 roles.includes('client') ? 'client' : (roles[0] || '');
    const ok = !!token && (!requiredRole || roles.includes(requiredRole) || role === requiredRole);
    return { ok, user, token, role, email: user?.email || '' };
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
    const url = path.startsWith('/') ? `/.netlify/functions${path}`.replace('//.','/.') : path;

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
      body: body ? JSON.stringify(body) : undefined
    });
    const txt = await res.text();
    let json; try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
    Debug.log('API ←', res.status, json);

    if (!res.ok) {
      const msg = json?.error || json?.message || `HTTP ${res.status}`;
      toast(msg, 'error', 5000);
      throw new Error(msg);
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
      try { const g = $('#gate'); const app = $('#app'); if (g) g.style.display = ''; if (app) app.style.display = 'none'; } catch {}
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
