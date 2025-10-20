/* /admin-v2/admin/common.js — admin bootstrap + diagnostics (v13)
   Exposes (globals):
     - window.adminReady(): Promise<helpers>
     - window.Admin.bootAdmin(mainFn)
     - window.getIdentity(requiredRole?)
     - window.apiPing()
     - window.api (console-friendly)
   Page helpers:
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

  // -------------------------- Optional allowlist ------------------------------
  // Add emails here if you want them treated as admin for UI bootstrapping
  const ADMIN_EMAIL_ALLOWLIST = [
    'joe@hmj-global.com',
    // 'someone@example.com',
  ];

  // -------------------------- Identity helpers -------------------------------
  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[2]) : '';
  }
  const getNFJwtFromCookie = () => getCookie('nf_jwt') || '';

  async function waitIdentityReady(maxMs = 8000) {
    let waited = 0;
    while (waited < maxMs) {
      if (window.netlifyIdentity && typeof window.netlifyIdentity.on === 'function') {
        return window.netlifyIdentity;
      }
      await sleep(100); waited += 100;
    }
    return null;
  }

  // Ensure widget is initialised on this page
  async function initIdentity() {
    const id = await waitIdentityReady(8000);
    if (!id) return null;
    try {
      // Prefer explicit override, else current origin (works for previews + prod)
      const explicit = window.ADMIN_IDENTITY_URL
        || document.querySelector('meta[name="netlify-identity-url"]')?.getAttribute('content');
      const APIUrl = explicit || `${location.origin}/.netlify/identity`;
      id.init({ APIUrl });
      Debug.log('Identity init @', APIUrl);
    } catch (e) {
      Debug.warn('Identity init skipped', e?.message || e);
    }
    return id;
  }

  async function getIdentityUser() {
    try {
      const id = window.netlifyIdentity;
      if (id && typeof id.currentUser === 'function') {
        const u = id.currentUser();
        if (u) return u;
      }
    } catch {}
    // Cookie-only session fallback
    const token = getNFJwtFromCookie();
    if (token) return { token: async () => token, jwt: async () => token, app_metadata:{}, email: undefined };
    return null;
  }

  async function identity(requiredRole /* 'admin' | 'recruiter' | 'client' */) {
    await initIdentity(); // make sure widget is alive
    let user = null; let token = '';
    try { user = await getIdentityUser(); } catch {}
    try { token = user ? (await (user.token?.() || user.jwt?.())) : '' } catch {}

    // roles from Identity (normalised to lowercase)
    let roles = (user?.app_metadata?.roles || user?.roles || [])
      .map(r => String(r).toLowerCase());

    // email (lowercased)
    const email = (user?.email || '').toLowerCase();

    // Allow-list: treat allow-listed emails as admin
    const allowlistedAdmin = !!email && ADMIN_EMAIL_ALLOWLIST.includes(email);
    if (allowlistedAdmin && !roles.includes('admin')) roles.push('admin');

    const role = roles.includes('admin') ? 'admin'
      : roles.includes('recruiter') ? 'recruiter'
      : roles.includes('client') ? 'client'
      : (roles[0] || '');

    // OK if:
    //  - we have a JWT and (no role required OR user has it)
    //  - OR (allow-listed) and the requiredRole is exactly 'admin'
    const ok = ( !!token && (!requiredRole || roles.includes(requiredRole)) )
            || ( allowlistedAdmin && requiredRole === 'admin' );

    return { ok, user, token, role, email };
  }

  // Console helper
  window.getIdentity = identity;

  // ----------------------------- API helper ----------------------------------
  let TRACE = '';
  const setTrace = (v) => { TRACE = v || `ts-${Math.random().toString(36).slice(2)}`; return TRACE; };
  const getTrace = () => TRACE || setTrace();

  async function api(path, method = 'POST', body) {
    const url = path.startsWith('/')
      ? `/.netlify/functions${path}`.replace('//.','/.')
      : `/.netlify/functions/${path}`.replace('//.','/.');

    // Always try to attach a fresh token (header beats cookie)
    let token = '';
    try { const who = await identity(); token = who.token || ''; } catch {}

    const headers = { 'Content-Type': 'application/json', 'x-trace': getTrace() };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    Debug.log(`API → ${method} ${url}`, body || '');
    const res = await fetch(url, {
      method,
      headers,
      credentials: 'include', // keeps cookie paths working if present
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

  // Expose for console diagnostics
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

    const who = await identity(adminOnly ? 'admin' : undefined);

    if (who.ok && (!adminOnly || who.role === 'admin')) {
      if (g) g.style.display = 'none';
      if (app) app.style.display = '';
      return who;
    }

    if (app) app.style.display = 'none';
    if (g) g.style.display = '';
    if (why) {
      if (!who?.token)     why.textContent = 'Sign in required.';
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
      await initIdentity();        // ensure widget is prepped on this page
      setTrace();
      Debug.log('Bootstrap ready; trace=', getTrace());
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
        Debug.warn('Gate blocked: no session / no admin role');
        return;
      }

      const id = window.netlifyIdentity;
      if (id && typeof id.on === 'function') {
        id.on('login',  () => location.reload());
        id.on('logout', () => (location.href = '/admin-v2/admin/'));
        id.on('error',  (e) => Debug.err('identity error', e));
      }

      // Optional diag chips
      try {
        const diag = $('#diagChips');
        if (diag) {
          diag.innerHTML = '';
          addChip(diag, 'init: ok', true);
          addChip(diag, 'identity: ok', true);
          addChip(diag, 'token: ok', true);
          addChip(diag, 'role: ' + (who.role || 'admin'), true);
          addChip(diag, 'trace: ' + getTrace().slice(0,10), true);
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

  Debug.log('common.js loaded');
})();

window.__admin_common_version = 'v13';
window.__has_admin_boot       = !!(window.Admin && window.Admin.bootAdmin);
