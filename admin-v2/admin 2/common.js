/* /admin-v2/admin/common.js — admin bootstrap + diagnostics (v15)
   Exposes:
     - window.adminReady(): Promise<helpers>
     - window.Admin.bootAdmin(mainFn)
     - window.getIdentity(requiredRole?)
     - window.apiPing()
     - window.api
   Helpers provided to pages:
     { api, sel, toast, setTrace, getTrace, identity, isMobile, gate }
*/
(function () {
  'use strict';

  // ----------------------------- Utilities -----------------------------------
  const $ = (s, root = document) => root.querySelector(s);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const isMobile = matchMedia('(max-width: 820px)').matches;

  const Debug = {
    log:  (...a) => console.log('%c[OK]',   'color:#18a058;font-weight:600', ...a),
    warn: (...a) => console.warn('%c[WARN]','color:#e6a100;font-weight:600', ...a),
    err:  (...a) => console.error('%c[ERR]','color:#b73b3b;font-weight:600', ...a),
  };

  function toast(msg, type = 'info', ms = 3600) {
    let host = $('#toast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast';
      Object.assign(host.style, {
        position:'fixed',bottom:'16px',right:'16px',zIndex:'9999',display:'grid',gap:'10px'
      });
      document.body.appendChild(host);
    }
    const n = document.createElement('div');
    n.setAttribute('role','status');
    Object.assign(n.style, {
      padding:'10px 12px',borderRadius:'10px',boxShadow:'0 10px 24px rgba(0,0,0,.18)',
      fontWeight:'600',maxWidth:'520px',border:'1px solid rgba(255,255,255,.14)',color:'#fff',
      background: type==='error' ? '#3a1418' : type==='warn' ? '#35240d' : '#0e2038'
    });
    n.textContent = String(msg);
    host.appendChild(n);
    setTimeout(() => n.remove(), ms);
  }

  // -------------------------- Allow emails (optional) -------------------------
  const ADMIN_EMAIL_ALLOWLIST = [
    'joe@hmj-global.com',
  ];

  // -------------------------- Identity helpers --------------------------------
  const IDENTITY_URL =
    window.ADMIN_IDENTITY_URL ||
    (document.querySelector('meta[name="netlify-identity-url"]')?.content) ||
    `${location.origin}/.netlify/identity`;

  async function waitWidget(maxMs = 8000) {
    let waited = 0;
    while (waited < maxMs) {
      if (window.netlifyIdentity && typeof window.netlifyIdentity.on === 'function') {
        return window.netlifyIdentity;
      }
      await sleep(50); waited += 50;
    }
    return null;
  }

  // Ensure widget initialised and hooked to the chosen Identity instance
  let widgetInitOnce;
  async function initIdentity() {
    if (widgetInitOnce) return widgetInitOnce;
    widgetInitOnce = (async () => {
      const id = await waitWidget();
      if (!id) return null;
      try { id.init({ APIUrl: IDENTITY_URL }); } catch {}
      // Wait for 'init' event to complete the cross-origin handshake (important on previews)
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        try {
          id.on('init', finish);
          // Safety timeout in case event doesn't fire
          setTimeout(finish, 1200);
        } catch { setTimeout(resolve, 1200); }
      });
      return id;
    })();
    return widgetInitOnce;
  }

  // Get a user and (crucially) a JWT. We retry briefly because the user often
  // appears before token helpers are ready on cross-origin Identity.
  async function getUserAndToken({ retries = 10, delay = 150 } = {}) {
    const id = await initIdentity();
    let user = null, token = '';

    const tryOnce = async () => {
      try { user = id?.currentUser?.() || null; } catch {}
      if (user) {
        try {
          if (typeof user.token === 'function') token = await user.token();
          else if (typeof user.jwt === 'function') token = await user.jwt();
        } catch {}
      }
      return !!token;
    };

    if (await tryOnce()) return { user, token };

    for (let i = 0; i < retries; i++) {
      await sleep(delay);
      if (await tryOnce()) return { user, token };
    }

    // As a *last resort* (when cookie is same-origin) try nf_jwt cookie
    const m = document.cookie.match(/(?:^|;\s*)nf_jwt=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);

    return { user, token };
  }

  async function identity(requiredRole /* 'admin' | ... */) {
    const { user, token } = await getUserAndToken();

    // roles from Identity (normalised)
    let roles = (user?.app_metadata?.roles || user?.roles || []).map(r => String(r).toLowerCase());
    const email = (user?.email || '').toLowerCase();

    // Allowlist can lift you to admin for *UI only*; we still prefer a token.
    const allowlistedAdmin = !!email && ADMIN_EMAIL_ALLOWLIST.includes(email);
    if (allowlistedAdmin && !roles.includes('admin')) roles.push('admin');

    const role = roles.includes('admin') ? 'admin'
              : roles.includes('recruiter') ? 'recruiter'
              : roles.includes('client') ? 'client'
              : (roles[0] || '');

    const hasRequiredRole = !requiredRole || roles.includes(requiredRole);
    const ok = !!token && hasRequiredRole;

    // Diag chip for “auth: missing” if we can see role but no token yet
    try {
      const host = $('#diagChips');
      if (host && !token) addChip(host, 'auth: missing', false);
      else if (host && token) addChip(host, 'token: ok', true);
    } catch {}

    return { ok, user, token, role, email };
  }

  window.getIdentity = identity;

  // ----------------------------- API helper -----------------------------------
  let TRACE = '';
  const setTrace = (v) => { TRACE = v || `ts-${Math.random().toString(36).slice(2)}`; return TRACE; };
  const getTrace = () => TRACE || setTrace();

  async function api(path, method = 'POST', body) {
    const url = path.startsWith('/')
      ? `/.netlify/functions${path}`.replace('//.','/.')
      : `/.netlify/functions/${path}`.replace('//.','/.');

    // 1) Try to get a token
    let { token } = await identity();

    const headers = { 'Content-Type': 'application/json', 'x-trace': getTrace() };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    Debug.log(`API → ${method} ${url}`, body || '');
    let res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined
    });

    // 2) If we *still* got 401 and we had no token, retry once after waiting
    if (res.status === 401 && !headers['Authorization']) {
      Debug.warn('API 401 with no token; retrying after short wait…');
      await sleep(250);
      const again = await identity();
      if (again.token) {
        headers['Authorization'] = `Bearer ${again.token}`;
        res = await fetch(url, {
          method,
          headers,
          credentials: 'include',
          body: body ? JSON.stringify(body) : undefined
        });
      }
    }

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

  window.api = api;

  window.apiPing = async function () {
    try {
      const j = await api('admin-audit-list', 'POST', { limit: 1 });
      Debug.log('Ping OK', j?.length || 0);
      return { ok:true, data:j };
    } catch (e) {
      Debug.err('Ping failed', e);
      return { ok:false, error:String(e.message||e) };
    }
  };

  // ------------------------------ Gate ---------------------------------------
  async function gate({ adminOnly = true } = {}) {
    const g = $('#gate'); const app = $('#app');
    const why = g ? $('.why', g) : null;

    // We need a real token if the page will call Functions.
    const who = await identity(adminOnly ? 'admin' : undefined);

    if (who.ok) {
      if (g) g.style.display = 'none';
      if (app) app.style.display = '';
      return who;
    }

    if (app) app.style.display = 'none';
    if (g) g.style.display = '';
    if (why) {
      if (!who?.token)     why.textContent = 'Sign in required (or token not ready yet). Try the “Sign out” button, then sign in again.';
      else if (adminOnly)  why.textContent = 'Admin role required.';
      else                 why.textContent = 'Access limited for your role.';
    }
    return null;
  }

  // ---------------------------- adminReady -----------------------------------
  let _readyOnce;
  window.adminReady = function () {
    if (_readyOnce) return _readyOnce;
    _readyOnce = (async () => {
      await initIdentity();
      setTrace();
      Debug.log('Bootstrap ready; trace=', getTrace(), 'identityUrl=', IDENTITY_URL);
      return { api, sel:$, toast, setTrace, getTrace, identity, isMobile, gate };
    })();
    return _readyOnce;
  };

  // ---------------------------- Boot wrapper ---------------------------------
  window.Admin = window.Admin || {};
  window.Admin.bootAdmin = async function (mainFn) {
    try {
      const helpers = await window.adminReady();
      const who = await helpers.gate({ adminOnly: true });
      if (!who) {
        toast('Restricted. Sign in with an admin account.', 'warn', 4500);
        Debug.warn('Gate blocked: no session / no admin role / no token');
        return;
      }

      const id = window.netlifyIdentity;
      if (id && typeof id.on === 'function') {
        id.on('login',  () => location.reload());
        id.on('logout', () => (location.href = '/admin-v2/admin/'));
      }

      // Optional diag chips
      try {
        const diag = $('#diagChips');
        if (diag) {
          diag.innerHTML = '';
          addChip(diag, 'init: ok', true);
          addChip(diag, 'identity: ok', true);
          addChip(diag, 'role: ' + (who.role || 'admin'), true);
        }
      } catch {}

      await Promise.resolve(mainFn(helpers));
    } catch (e) {
      Debug.err('bootAdmin error:', e);
      toast('Init failed: ' + (e.message || e), 'error', 6000);
      try {
        const g = $('#gate'); const app = $('#app');
        if (g) g.style.display = '';
        if (app) app.style.display = 'none';
      } catch {}
    }
  };

  function addChip(host, text, ok) {
    const span = document.createElement('span');
    span.textContent = text;
    Object.assign(span.style, {
      display:'inline-grid',alignItems:'center',padding:'4px 8px',borderRadius:'9999px',
      fontSize:'12px',fontWeight:'700',border:'1px solid rgba(0,0,0,.12)',
      background: ok ? '#e8f6ef' : '#fdeeee', color: ok ? '#0f5132' : '#842029'
    });
    host.appendChild(span);
  }

  Debug.log('common.js loaded v15');
})();

window.__admin_common_version = 'v15';
window.__has_admin_boot       = !!(window.Admin && window.Admin.bootAdmin);
