/* Admin shared bootstrap — NO module syntax, must attach to window.
   Loads after https://identity.netlify.com/v1/netlify-identity-widget.js
   Exposes:
     - window.identity()  (alias: window.getIdentity)
     - window.bootAdmin(opts)  -> { api, toast, sel, user, email, roles, token }
     - window.sel()
     - window.toast()
*/

(function () {
  const STATE = {
    trace: 'init',
    debug: true,          // flip to false in production if you want less noise
    lastToast: 0,
    toasts: [],
    roleMap: {            // map custom app roles -> allowed
      admin: ['admin'],
      recruiter: ['admin', 'recruiter'],
      client: ['admin', 'client'],
    },
  };

  // --- tiny DOM helpers ------------------------------------------------------
  function sel(q, root) { return (root || document).querySelector(q); }
  function createEl(tag, attrs = {}, text = '') {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (text) el.textContent = text;
    return el;
  }

  // --- toast -----------------------------------------------------------------
  function ensureToastHost() {
    let host = sel('#toast');
    if (!host) {
      host = createEl('div', { id: 'toast', style: `
        position:fixed;left:16px;bottom:16px;z-index:99999;display:grid;gap:8px;
        max-width:min(520px,90vw);pointer-events:none;` });
      document.body.appendChild(host);
    }
    return host;
  }
  function toast(msg, kind = 'info', life = 4200) {
    try {
      const host = ensureToastHost();
      const item = createEl('div', { role: 'status', 'aria-live': 'polite', style: `
          pointer-events:auto;box-shadow:0 12px 28px rgba(0,0,0,.18);
          border-radius:12px;padding:10px 12px;font-weight:600;
          border:1px solid ${kind==='error'?'#c44':'#cbd5e1'};
          background:${kind==='error'?'#1f0f12':'#0b1221'};
          color:${kind==='error'?'#ffd6d6':'#e6eef7'};` }, msg);
      host.appendChild(item);
      const id = setTimeout(() => { item.remove(); }, life);
      STATE.toasts.push({ id, el: item });
      console[kind==='error'?'error':'log'](`[toast:${kind}]`, msg);
    } catch (e) {
      console.error('toast failed', e);
    }
  }

  // --- Netlify Identity readiness -------------------------------------------
  async function waitForNetlifyIdentity() {
    // If widget script didn’t load yet, inject it once (defensive).
    if (!window.netlifyIdentity) {
      await new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'https://identity.netlify.com/v1/netlify-identity-widget.js';
        s.onload = resolve;
        s.onerror = resolve; // resolve anyway; we’ll error later if still missing
        document.head.appendChild(s);
      });
    }
    // Wait a bit for the global to attach & init.
    const start = performance.now();
    while (!window.netlifyIdentity) {
      if (performance.now() - start > 3000) break;
      await new Promise(r => setTimeout(r, 50));
    }
    return window.netlifyIdentity || null;
  }

  // --- Identity factory (the function your pages call) -----------------------
  async function getIdentity(required = null) {
    STATE.trace = 'identity:start';
    const wid = await waitForNetlifyIdentity();

    if (!wid) {
      STATE.trace = 'identity:widget-missing';
      toast('Init failed: Netlify Identity widget missing', 'error');
      throw new Error('identity_widget_missing');
    }

    // Ensure widget initialized & get current user
    if (!wid.currentUser()) {
      // Try to recover a stored session silently
      try { wid.init(); } catch { /* ignore */ }
    }

    // Give it a tick to hydrate
    await new Promise(r => setTimeout(r, 0));

    const user = wid.currentUser();
    if (!user) {
      STATE.trace = 'identity:no-session';
      return {
        ok: false,
        reason: 'no_session',
        login: () => wid.open('login'),
        logout: () => wid.logout(),
      };
    }

    // Fetch JWT
    let token = null;
    try {
      token = await user.jwt();
    } catch (e) {
      STATE.trace = 'identity:jwt-failed';
      toast('Init failed: could not get JWT', 'error');
      throw e;
    }

    // Roles are carried in app_metadata.roles (Netlify Identity)
    const roles = (user?.app_metadata?.roles || []).map(String);
    const email = user?.email || '';

    // Role gate if requested
    if (required) {
      const allowed = STATE.roleMap[required] || [String(required)];
      const ok = roles.some(r => allowed.includes(r));
      if (!ok) {
        STATE.trace = 'identity:forbidden';
        return {
          ok: false,
          reason: 'forbidden',
          email, roles, token,
          logout: () => wid.logout(),
        };
      }
    }

    STATE.trace = 'identity:ok';

    // Shared API helper (Netlify Functions with Authorization header)
    async function api(path, method = 'POST', body = undefined) {
      const trace = `ts-${Math.random().toString(36).slice(2, 9)}`;
      const url = path.startsWith('/') ? `/.netlify/functions${path}` : `/.netlify/functions/${path}`;
      const opt = {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body == null ? undefined : JSON.stringify(body),
      };

      const started = performance.now();
      try {
        const res = await fetch(url, opt);
        const ms = Math.round(performance.now() - started);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.error(`[ERR] ${method} ${path} in ${ms}ms (trace ${trace}): ${text || res.status}`);
          toast(`${method} ${path} failed: ${text || res.status}`, 'error', 5000);
          throw new Error(text || `${res.status}`);
        }
        const type = res.headers.get('content-type') || '';
        const data = type.includes('application/json') ? await res.json() : await res.text();
        console.log(`[OK] ${method} ${path} in ${ms}ms (trace ${trace})`);
        return data;
      } catch (e) {
        console.error(`[ERR] ${method} ${path} (trace ${trace})`, e);
        throw e;
      }
    }

    return { ok: true, user, email, roles, token, api, toast, sel };
  }

  // --- Page bootstrapping for Admin pages -----------------------------------
  async function bootAdmin(options = {}) {
    // options: { role:'admin'|'recruiter'|'client'|null, gate:'#gate', app:'#app', debugBadge:'#debug' }
    const { role = 'admin', gate = '#gate', app = '#app', debugBadge = '#debug' } = options;
    const gateEl = sel(gate) || sel('#gate');
    const appEl  = sel(app)  || sel('#app');

    function showGate(msg) {
      if (gateEl) {
        gateEl.style.display = 'grid';
        const why = sel('.why', gateEl);
        if (why) { why.textContent = msg || ''; }
      }
      if (appEl) appEl.style.display = 'none';
    }
    function showApp() {
      if (gateEl) gateEl.style.display = 'none';
      if (appEl) appEl.style.display = '';
    }

    // Attach debug pills if present
    const dbgRoot = sel('#debug-pills') || createEl('div', { id: 'debug-pills', style:'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0' });
    const addPill = (label) => {
      const pill = createEl('span', { style:`
        background:#0b1221;border:1px solid #1f2b47;border-radius:999px;padding:4px 8px;
        color:#c7d3ea;font-size:12px` }, label);
      dbgRoot.appendChild(pill);
    };
    if (debugBadge && !sel('#debug-pills')) {
      const hdr = sel(debugBadge) || sel('.top .row') || document.body;
      hdr.appendChild(dbgRoot);
    }

    try {
      const id = await getIdentity(role); // use the same function

      if (!id.ok && id.reason === 'no_session') {
        addPill('identity: no session');
        showGate('Sign in required.');
        return { ...id, toast, sel };
      }
      if (!id.ok && id.reason === 'forbidden') {
        addPill('role: forbidden');
        toast('You do not have permission to view this page', 'error');
        showGate('Insufficient permissions.');
        return { ...id, toast, sel };
      }

      addPill('identity: ok');
      addPill(`role: ${role}`);
      showApp();

      // keyboard shortcuts like the Candidates page
      document.addEventListener('keydown', (e)=>{
        if (e.key === 'R' && !e.metaKey && !e.ctrlKey) {
          const ev = new CustomEvent('admin:refresh'); document.dispatchEvent(ev);
        }
        if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
          const s = sel('input[type="search"], input#q'); if (s) { e.preventDefault(); s.focus(); }
        }
      });

      return { ...id, toast, sel };
    } catch (e) {
      addPill('init: error');
      toast(`Init failed: ${e.message || e}`, 'error');
      showGate('Initialization error.');
      return { ok:false, error:e, toast, sel };
    }
  }

  // --- expose to window ------------------------------------------------------
  window.sel = sel;
  window.toast = toast;
  window.identity = getIdentity;     // keep the old name used by pages
  window.getIdentity = getIdentity;  // also expose a clear alias
  window.bootAdmin = bootAdmin;
})();
