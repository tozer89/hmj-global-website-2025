(function () {
  'use strict';

  const stores = {
    activity: 'hmj.admin.activity:v1'
  };

  const state = {
    helpers: null,
    who: null,
    activity: []
  };

  function safeLocalStorage(fn) {
    try {
      return fn();
    } catch (err) {
      console.warn('[HMJ]', 'localStorage unavailable', err);
      return undefined;
    }
  }

  function readStore(key, fallback) {
    return safeLocalStorage(() => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      try {
        return JSON.parse(raw);
      } catch (err) {
        console.warn('[HMJ]', 'parse failed for', key, err);
        return fallback;
      }
    });
  }

  function writeStore(key, value) {
    safeLocalStorage(() => {
      window.localStorage.setItem(key, JSON.stringify(value));
    });
  }

  function now() {
    return Date.now();
  }

  function createEl(tag, options) {
    const el = document.createElement(tag);
    if (!options) return el;
    if (options.className) el.className = options.className;
    if (options.attrs) {
      Object.entries(options.attrs).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        el.setAttribute(k, String(v));
      });
    }
    if (options.text) el.textContent = options.text;
    if (options.html) el.innerHTML = options.html;
    return el;
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return '';
    }
  }

  function formatRelative(ts) {
    const diff = now() - ts;
    const min = Math.round(diff / 60000);
    if (min < 1) return 'Just now';
    if (min === 1) return '1 min ago';
    if (min < 60) return `${min} mins ago`;
    const hours = Math.round(min / 60);
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'Yesterday' : `${days} days ago`;
  }

  function detectEnvironment(hostname) {
    if (!hostname) return 'Production';
    if (hostname.includes('localhost')) return 'Local development';
    if (hostname.includes('--')) return 'Preview';
    if (/netlify\.app$/i.test(hostname)) return 'Production';
    if (/netlify\.live$/i.test(hostname)) return 'Preview';
    return 'Production';
  }

  function toast(message, type = 'info', ms = 2600) {
    if (state.helpers?.toast) {
      state.helpers.toast(message, type, ms);
    }
  }

  function persistActivity() {
    writeStore(stores.activity, { list: state.activity });
  }

  function loadActivity() {
    const stored = readStore(stores.activity, { list: [] });
    state.activity = Array.isArray(stored?.list) ? stored.list.slice(0, 30) : [];
  }

  function logActivity(entry) {
    const item = {
      id: 'a_' + now(),
      ts: now(),
      kind: entry.kind || 'event',
      label: entry.label || 'Event',
      detail: entry.detail || '',
      href: entry.href || null
    };
    state.activity.unshift(item);
    if (state.activity.length > 30) state.activity.length = 30;
    persistActivity();
    renderActivity();
  }

  function setChip(id, text, tone) {
    const chip = document.getElementById(id);
    if (!chip) return;
    chip.textContent = text;
    if (tone) chip.dataset.tone = tone;
    else chip.removeAttribute('data-tone');
  }

  function updateSummary() {
    const summary = document.getElementById('settingsSummary');
    if (!summary) return;
    const activityCount = state.activity.length;
    summary.textContent = activityCount
      ? `Recent activity and platform diagnostics now live here. This browser currently holds ${activityCount} recent admin actions for quick reference.`
      : 'Recent activity and platform diagnostics now live here so the dashboard can stay focused on daily work.';
    setChip('settingsActivityChip', `${activityCount} recent ${activityCount === 1 ? 'action' : 'actions'}`);
  }

  function renderActivity() {
    const list = document.getElementById('activityList');
    if (!list) return;
    list.innerHTML = '';
    updateSummary();
    if (!state.activity.length) {
      const empty = createEl('li', { className: 'activity-empty', text: 'No recent local activity yet. Open a module, run a health check, or use a dashboard shortcut and it will show up here.' });
      list.appendChild(empty);
      return;
    }
    state.activity.forEach((item) => {
      const li = createEl('li');
      li.appendChild(createEl('div', { text: item.label }));
      if (item.detail) li.appendChild(createEl('div', { className: 'muted', text: item.detail }));
      li.appendChild(createEl('time', { text: formatRelative(item.ts), attrs: { datetime: new Date(item.ts).toISOString() } }));
      list.appendChild(li);
    });
  }

  function parseHealth(raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const out = {};
      if (parsed.api !== undefined) out.api = !!parsed.api;
      if (parsed.db !== undefined) out.db = !!parsed.db;
      if (parsed.storage !== undefined) out.storage = !!parsed.storage;
      return out;
    } catch {
      return null;
    }
  }

  function updateHealthChips(detail) {
    const chips = document.getElementById('settingsHealthChips');
    if (!chips) return;
    chips.hidden = false;
    const statuses = detail.raw ? parseHealth(detail.raw) : null;
    ['api', 'db', 'storage'].forEach((key) => {
      const chip = chips.querySelector(`[data-target="${key}"]`);
      if (!chip) return;
      const value = chip.querySelector('.value');
      if (!value) return;
      if (statuses && statuses[key] !== undefined) {
        const ok = statuses[key];
        chip.dataset.state = ok ? 'ok' : 'bad';
        value.textContent = ok ? 'OK' : 'Fail';
      } else {
        chip.dataset.state = detail.ok ? 'ok' : 'bad';
        value.textContent = detail.ok ? 'OK' : 'Fail';
      }
      chip.title = `Last updated ${formatTime(detail.at || now())}`;
    });
  }

  async function runHealthCheck() {
    const result = document.getElementById('healthResult');
    if (result) {
      result.hidden = false;
      result.textContent = 'Checking Netlify function…';
    }
    try {
      const res = await fetch('/.netlify/functions/supa-health', { credentials: 'include' });
      const txt = await res.text();
      let display = txt;
      try {
        display = JSON.stringify(JSON.parse(txt), null, 2);
      } catch {}
      if (result) result.textContent = display || 'OK';
      updateHealthChips({ ok: true, raw: txt, at: now() });
      toast('Health check complete', 'info', 2200);
      logActivity({ label: 'Supabase health check complete', detail: formatTime(now()), kind: 'health' });
    } catch (err) {
      if (result) result.textContent = 'Error: ' + (err.message || err);
      updateHealthChips({ ok: false, at: now() });
      toast('Health check failed', 'error', 3200);
      logActivity({ label: 'Supabase health check failed', detail: err.message || 'Unknown error', kind: 'health' });
    }
  }

  async function loadSettingsStatus() {
    if (!state.helpers?.api) {
      setChip('settingsStorageChip', 'Shared settings unavailable', 'warn');
      return;
    }
    try {
      const response = await state.helpers.api('admin-settings-get', 'POST', { keys: ['chatbot_settings'] });
      const sharedAvailable = typeof response?.source === 'string' && response.source.startsWith('supabase');
      setChip('settingsStorageChip', sharedAvailable ? 'Shared settings live' : 'Fallback mode', sharedAvailable ? 'ok' : 'warn');
    } catch (err) {
      console.warn('[HMJ]', 'settings status lookup failed', err);
      setChip('settingsStorageChip', 'Shared settings unavailable', 'warn');
    }
  }

  function bindActions() {
    const buttons = ['btnHealth', 'btnHealthSecondary'];
    buttons.forEach((id) => {
      const button = document.getElementById(id);
      if (button) {
        button.addEventListener('click', runHealthCheck);
      }
    });

    const clear = document.getElementById('btnClearActivity');
    if (clear) {
      clear.addEventListener('click', () => {
        state.activity = [];
        persistActivity();
        renderActivity();
        toast('Activity cleared', 'info', 2200);
      });
    }

    Array.from(document.querySelectorAll('[data-settings-link]')).forEach((link) => {
      link.addEventListener('click', () => {
        const label = link.getAttribute('data-settings-link') || link.textContent.trim();
        logActivity({
          label: `Navigated to ${label}`,
          detail: link.getAttribute('href') || '',
          kind: 'nav',
          href: link.href || null
        });
      });
    });
  }

  function init({ helpers, who }) {
    state.helpers = helpers;
    state.who = who;
    setChip('settingsEnvChip', `${detectEnvironment(window.location.hostname)} environment`);
    loadActivity();
    renderActivity();
    bindActions();
    loadSettingsStatus();
  }

  window.HMJAdminSettings = { init };
})();
