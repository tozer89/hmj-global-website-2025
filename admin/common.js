// /admin/common.js
// Shared helpers for all Admin pages (candidates, clients, assignments, timesheets, reports)
(() => {
  const sel = (s) => document.querySelector(s);

  function toast(msg, type = 'info', ms = 2500) {
    // minimal toast (optional DOM target with id="toast"); falls back to console
    const box = sel('#toast');
    if (!box) return console[type === 'error' ? 'error' : 'log']('[admin]', msg);
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function isAdmin(user) {
    const roles = user?.app_metadata?.roles || user?.roles || [];
    return roles.includes('admin');
  }

  async function api(path, method = 'GET', body = null) {
    // Calls Netlify function with Identity JWT
    const u = netlifyIdentity?.currentUser();
    if (!u) throw new Error('No session');
    const token = await u.jwt();

    const res = await fetch(`/.netlify/functions${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : null,
    });

    const text = await res.text();
    if (!res.ok) {
      // return server-provided error if honest errors are enabled
      let msg = text || `HTTP ${res.status}`;
      try { msg = JSON.parse(text).error || msg; } catch {}
      throw new Error(msg);
    }
    try { return JSON.parse(text); } catch { return text; }
  }

  async function bootAdmin(init) {
    // Call this once per page with your page's init function.
    const gate = sel('#gate');
    const app  = sel('#app');

    const user = netlifyIdentity?.currentUser();
    if (!user) { gate && (gate.style.display = 'block'); return; }

    if (!isAdmin(user)) {
      if (gate) {
        gate.style.display = 'block';
        const why = gate.querySelector('.why');
        if (why) why.textContent = 'You are signed in but your JWT has no "admin" role.';
      }
      return;
    }

    app && (app.style.display = 'block');

    try {
      await init({ api, sel, toast, user });
    } catch (e) {
      console.error(e);
      toast(e.message || 'Unexpected error', 'error', 5000);
      const errBox = sel('#errorBox');
      if (errBox) errBox.textContent = e.message || String(e);
    }
  }

  // Expose to window
  window.Admin = { api, isAdmin, bootAdmin, sel, toast };
})();
