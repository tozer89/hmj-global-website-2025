// /admin/common.js
// Shared helpers for ALL admin pages

// Exports a small Admin namespace on window
window.Admin = (() => {
  const sel = s => document.querySelector(s);
  const noop = () => {};

  function toast(msg) {
    console.log('[admin]', msg);
  }

  async function api(path, method = 'GET', body = null) {
    const u = netlifyIdentity.currentUser();
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
    if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
    try { return JSON.parse(text); } catch { return text; }
  }

  function isAdmin(u) {
    const roles = u?.app_metadata?.roles || u?.roles || [];
    return roles.includes('admin');
  }

  async function bootAdmin(main = noop) {
    const gate = sel('#gate');
    const app  = sel('#app');

    const u = netlifyIdentity.currentUser();
    if (!u || !isAdmin(u)) {
      if (gate) gate.style.display = 'block';
      if (app)  app.style.display  = 'none';
      return;
    }

    if (app) app.style.display = 'block';
    if (gate) gate.style.display = 'none';

    try {
      await main({ api, sel, toast, user: u });
    } catch (e) {
      console.error(e);
      const box = sel('#errorBox');
      if (box) box.textContent = e.message;
      toast(e.message);
    }
  }

  return { api, sel, toast, isAdmin, bootAdmin };
})();
