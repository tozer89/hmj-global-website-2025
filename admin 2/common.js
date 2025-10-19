/* /admin/common.js — shared admin bootstrap (NO <script> tags in this file) */
(function () {
  const S = (sel) => document.querySelector(sel);

  function show(el, yes) {
    if (!el) return;
    el.style.display = yes ? '' : 'none';
  }

  function toast(msg, type = 'info') {
    let box = S('#toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast';
      box.style.position = 'fixed';
      box.style.right = '16px';
      box.style.bottom = '16px';
      box.style.display = 'grid';
      box.style.gap = '8px';
      box.style.zIndex = '9999';
      document.body.appendChild(box);
    }
    const n = document.createElement('div');
    n.className = 'toast ' + type;
    n.style.cssText =
      'background:#0f172a;border:1px solid #233044;border-radius:10px;padding:10px 12px;color:#e6eef7;font:14px/1.3 system-ui;box-shadow:0 10px 30px rgba(0,0,0,.35)';
    n.textContent = msg;
    box.appendChild(n);
    setTimeout(() => n.remove(), 3000);
  }

  const isAdmin = (u) => {
    const roles =
      (u && (u.app_metadata?.roles || u.user_metadata?.roles || u.roles)) || [];
    return Array.isArray(roles) && roles.includes('admin');
  };

  async function api(path, method = 'GET', body = null) {
    const u = window.netlifyIdentity?.currentUser();
    if (!u) throw new Error('No session');
    const t = await u.jwt();
    const r = await fetch(`/.netlify/functions${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + t,
      },
      body: body ? JSON.stringify(body) : null,
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = j.error || j.message || text;
      } catch {}
      throw new Error(msg);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('bad_json_response');
    }
  }

  async function bootAdmin() {
    const gate = S('#gate') || { style: {} };
    const app = S('#app') || { style: {} };
    const u = window.netlifyIdentity?.currentUser();

    if (!u || !isAdmin(u)) {
      show(gate, true);
      show(app, false);
      const why = gate.querySelector('.why');
      if (why) why.textContent = u ? 'Your account is not an admin.' : 'You are not logged in.';
      return;
    }

    show(gate, false);
    show(app, true);

    if (typeof window.main === 'function') {
      try {
        await window.main({ api, sel: S, toast, user: u });
      } catch (e) {
        console.error(e);
        toast('Init failed: ' + (e.message || e), 'error');
      }
    }
  }

  // Identity wiring (works whether the widget loads before or after)
  document.addEventListener('DOMContentLoaded', () => {
    window.netlifyIdentity?.on('init', bootAdmin);
    window.netlifyIdentity?.on('login', () => location.reload());
    window.netlifyIdentity?.on('logout', () => (location.href = '/'));
    // If a session already exists, boot; otherwise show the gate
    setTimeout(() => {
      if (window.netlifyIdentity?.currentUser()) bootAdmin();
      else show(document.querySelector('#gate'), true);
    }, 400);
  });
})();

