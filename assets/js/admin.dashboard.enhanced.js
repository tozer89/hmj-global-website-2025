(function () {
  'use strict';

  const html = document.documentElement;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stores = {
    theme: 'hmj.theme',
    activity: 'hmj.admin.activity:v1',
    notes: 'hmj.admin.notes:v2',
    view: 'hmj.admin.view:v1'
  };

  const defaultView = {
    showKpis: true,
    order: 'default',
    lastVisited: []
  };

  const state = {
    helpers: null,
    who: null,
    activity: [],
    notes: [],
    view: { ...defaultView },
    paletteOpen: false,
    paletteNodes: [],
    paletteIndex: 0,
    commandsHost: null,
    shortcutsHost: null,
    navHistory: []
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

  function formatTime(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleString(undefined, {
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

  function ensureHost(id) {
    let host = document.getElementById(id);
    if (!host) {
      host = createEl('div', { attrs: { id } });
      document.body.appendChild(host);
    }
    return host;
  }

  function hmjToast(message, type = 'info', ms = 2800) {
    const host = ensureHost('toast');
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    const item = createEl('div', {
      className: 'toast-item',
      attrs: { 'data-type': type }
    });
    item.textContent = message;
    host.appendChild(item);
    requestAnimationFrame(() => {
      item.setAttribute('data-state', 'show');
    });
    const duration = Number(ms) || 2800;
    const timer = window.setTimeout(() => dismissToast(item), duration);
    item.addEventListener('pointerdown', () => dismissToast(item, timer));
    window.dispatchEvent(new CustomEvent('hmj:toast', { detail: { message, type, duration } }));
    logActivity({
      label: message,
      detail: type === 'info' ? 'Notice' : type,
      kind: 'toast'
    });
    return item;
  }

  function dismissToast(item, timer) {
    if (timer) window.clearTimeout(timer);
    if (!item) return;
    item.removeAttribute('data-state');
    const remove = () => item.remove();
    if (prefersReduced) {
      remove();
    } else {
      setTimeout(remove, 200);
    }
  }

  window.hmjToast = hmjToast;

  function initThemeToggle() {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;
    const stored = readStore(stores.theme, null);
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    let theme = stored || (systemPrefersDark ? 'dark' : 'light');
    applyTheme(theme, false);
    toggle.setAttribute('aria-pressed', theme === 'dark');
    toggle.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme, true);
      toggle.setAttribute('aria-pressed', theme === 'dark');
      writeStore(stores.theme, theme);
      hmjToast(`Theme set to ${theme}`, 'info', 2600);
    });
  }

  function applyTheme(theme, withToast) {
    html.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
    if (withToast) {
      logActivity({ label: 'Theme changed', detail: theme, kind: 'theme' });
    }
  }

  function detectEnvironment(hostname) {
    if (!hostname) return 'Production';
    if (hostname.includes('localhost')) return 'Local development';
    if (hostname.includes('--')) return 'Preview';
    if (/netlify\.app$/i.test(hostname)) return 'Production';
    if (/netlify\.live$/i.test(hostname)) return 'Preview';
    return 'Production';
  }

  function initEnvironmentBadge(projectName = 'HMJ Global') {
    const badge = document.getElementById('envMeta');
    if (!badge) return;
    const env = detectEnvironment(location.hostname);
    const label = `${env} • ${projectName}`;
    badge.textContent = label;
  }

  function initViewPreferences() {
    const toggle = document.getElementById('toggleKpis');
    const select = document.getElementById('tileOrderSelect');
    const reset = document.getElementById('resetView');
    const stored = readStore(stores.view, defaultView) || defaultView;
    state.view = { ...defaultView, ...stored };
    if (toggle) {
      toggle.checked = state.view.showKpis;
      toggle.addEventListener('change', () => {
        state.view.showKpis = !!toggle.checked;
        syncKpiVisibility();
        persistView();
        hmjToast(state.view.showKpis ? 'Showing KPIs' : 'Hiding KPIs');
      });
    }
    if (select) {
      select.value = state.view.order || 'default';
      select.addEventListener('change', () => {
        state.view.order = select.value;
        applyTileOrder();
        persistView();
        hmjToast('Tile order updated');
      });
    }
    if (reset) {
      reset.addEventListener('click', () => {
        state.view = { ...defaultView };
        if (toggle) toggle.checked = state.view.showKpis;
        if (select) select.value = state.view.order;
        syncKpiVisibility();
        applyTileOrder();
        persistView();
        hmjToast('Dashboard view reset', 'info', 2600);
      });
    }
    syncKpiVisibility();
    applyTileOrder();
  }

  function persistView() {
    writeStore(stores.view, state.view);
  }

  function syncKpiVisibility() {
    const kpis = document.getElementById('kpis');
    if (!kpis) return;
    if (state.view.showKpis) {
      kpis.hidden = false;
    } else {
      kpis.hidden = true;
    }
  }

  function applyTileOrder() {
    const grid = document.querySelector('.grid[data-tile-order]');
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll('a.card'));
    let sorted = cards;
    if (state.view.order === 'alpha') {
      sorted = cards.slice().sort((a, b) => a.textContent.trim().localeCompare(b.textContent.trim()));
    } else if (state.view.order === 'recent') {
      const history = state.view.lastVisited || [];
      const score = (href) => {
        const idx = history.indexOf(href);
        return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
      };
      sorted = cards.slice().sort((a, b) => score(a.href) - score(b.href));
    }
    sorted.forEach(card => grid.appendChild(card));
  }

  function loadActivity() {
    const stored = readStore(stores.activity, { list: [] });
    const list = Array.isArray(stored?.list) ? stored.list : [];
    state.activity = list.slice(0, 30);
  }

  function persistActivity() {
    writeStore(stores.activity, { list: state.activity });
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
    updateActivityUI();
    if (item.href && state.view.order === 'recent') {
      const existing = state.view.lastVisited || [];
      const filtered = existing.filter((link) => link !== item.href);
      filtered.unshift(item.href);
      state.view.lastVisited = filtered.slice(0, 12);
      persistView();
      applyTileOrder();
    }
  }

  function initActivityFeed() {
    loadActivity();
    const host = document.getElementById('activityFeed');
    if (!host) return;
    host.innerHTML = '';
    const header = createEl('header');
    header.appendChild(createEl('h3', { text: 'Recent activity' }));
    const clear = createEl('button', {
      className: 'btn ghost small',
      text: 'Clear activity',
      attrs: { type: 'button' }
    });
    clear.addEventListener('click', () => {
      state.activity = [];
      persistActivity();
      updateActivityUI();
      hmjToast('Activity cleared', 'info');
    });
    header.appendChild(clear);
    host.appendChild(header);
    const list = createEl('ul', { className: 'activity-list', attrs: { id: 'activityList' } });
    host.appendChild(list);
    host.appendChild(createEl('div', { className: 'calendar-glance', attrs: { id: 'calendarGlance', hidden: 'hidden' } }));
    host.appendChild(createEl('div', { className: 'risk-flags', attrs: { id: 'riskFlags', hidden: 'hidden' } }));
    host.hidden = false;
    updateActivityUI();
    requestIdleCallbackSafe(() => {
      loadCalendar();
      loadRiskFlags();
    }, 120);
  }

  function updateActivityUI() {
    const list = document.getElementById('activityList');
    if (!list) return;
    list.innerHTML = '';
    if (!state.activity.length) {
      list.parentElement?.querySelector('.empty')?.remove();
      const empty = createEl('p', { className: 'empty', text: 'Your recent clicks, health checks, and notices will appear here.' });
      empty.className = 'empty';
      list.parentElement.insertBefore(empty, list);
      return;
    }
    const existingEmpty = list.parentElement.querySelector('.empty');
    if (existingEmpty) existingEmpty.remove();
    state.activity.forEach((item) => {
      const li = createEl('li');
      li.appendChild(createEl('div', { text: item.label }));
      if (item.detail) li.appendChild(createEl('div', { text: item.detail, className: 'muted' }));
      li.appendChild(createEl('time', { text: formatRelative(item.ts), attrs: { datetime: new Date(item.ts).toISOString() } }));
      list.appendChild(li);
    });
  }

  function requestIdleCallbackSafe(fn, timeout) {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(fn, { timeout: timeout || 300 });
    } else {
      setTimeout(fn, timeout || 300);
    }
  }

  function initCards() {
    const grid = document.querySelector('.grid[data-tile-order]');
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll('a.card'));
    cards.forEach((card) => {
      card.addEventListener('click', (ev) => {
        const label = card.querySelector('h3')?.textContent?.trim() || card.textContent.trim();
        hmjToast(`Opening ${label}…`, 'info', 2000);
        logActivity({ label: `Navigated to ${label}`, detail: card.getAttribute('href'), kind: 'nav', href: card.href });
      });
      card.addEventListener('focus', () => {
        const label = card.querySelector('h3')?.textContent?.trim();
        if (label) card.setAttribute('aria-label', label);
      }, { once: true });
    });
    requestIdleCallbackSafe(() => decorateCards(cards));
  }

  async function decorateCards(cards) {
    try {
      const [jobs, timesheets] = await Promise.all([
        fetchJson('/data/jobs.json'),
        fetchJson('/data/timesheets.json')
      ]);
      if (jobs?.jobs?.length) {
        const live = jobs.jobs.filter((job) => job.published && job.status === 'live').length;
        const jobsCard = cards.find((c) => /jobs\.html$/.test(c.getAttribute('href') || ''));
        if (jobsCard && live) {
          appendBadge(jobsCard, `${live} live`, 'ok');
        }
      }
      if (timesheets?.timesheets?.length) {
        const outstanding = timesheets.timesheets.filter((sheet) => sheet.status && sheet.status.toLowerCase() !== 'approved').length;
        const timesheetCard = cards.find((c) => /timesheets\.html$/.test(c.getAttribute('href') || ''));
        if (timesheetCard && outstanding) {
          appendBadge(timesheetCard, `${outstanding} pending`, outstanding > 4 ? 'warn' : 'ok');
        }
      }
    } catch (err) {
      console.warn('[HMJ]', 'decorate cards failed', err);
    }
  }

  function appendBadge(card, text, type) {
    let badge = card.querySelector('.badge');
    if (!badge) {
      badge = createEl('span', { className: 'badge' });
      badge.setAttribute('data-type', type || 'info');
      card.appendChild(badge);
    }
    badge.textContent = text;
    badge.setAttribute('data-type', type || 'info');
  }

  async function fetchJson(url) {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(res.statusText);
      return await res.json();
    } catch (err) {
      console.warn('[HMJ]', 'fetch failed', url, err);
      return null;
    }
  }

  function initKpis() {
    const host = document.getElementById('kpis');
    if (!host) return;
    const entries = [
      { key: 'liveJobs', label: 'Live jobs', value: '—' },
      { key: 'candidatesInProcess', label: 'Candidates in process', value: '—' },
      { key: 'interviewsWeek', label: 'Interviews this week', value: '—' },
      { key: 'outstandingTimesheets', label: 'Outstanding timesheets', value: '—' },
      { key: 'nextPayRun', label: 'Next pay run', value: '—' }
    ];
    entries.forEach((item) => {
      const tile = createEl('article', { className: 'kpi-tile', attrs: { 'data-key': item.key } });
      tile.appendChild(createEl('strong', { text: item.value }));
      tile.appendChild(createEl('span', { text: item.label }));
      host.appendChild(tile);
    });
    host.hidden = !state.view.showKpis;
    requestIdleCallbackSafe(async () => {
      const kpiData = await fetchJson('/admin/kpi.json');
      if (kpiData) {
        updateKpis(host, {
          liveJobs: kpiData.liveJobs ?? kpiData.jobs ?? '—',
          candidatesInProcess: kpiData.candidates ?? kpiData.candidatesInProcess ?? '—',
          interviewsWeek: kpiData.interviews ?? kpiData.interviewsWeek ?? '—',
          outstandingTimesheets: kpiData.timesheets ?? kpiData.outstandingTimesheets ?? '—',
          nextPayRun: kpiData.nextPayRun ?? '—'
        });
      } else {
        const fallback = await buildKpiFallback();
        updateKpis(host, fallback);
      }
    }, 100);
  }

  async function buildKpiFallback() {
    const [jobs, candidates, timesheets] = await Promise.all([
      fetchJson('/data/jobs.json'),
      fetchJson('/data/candidates.json'),
      fetchJson('/data/timesheets.json')
    ]);
    const liveJobs = jobs?.jobs?.filter((job) => job.published && job.status === 'live').length || '—';
    const candidatesInProcess = candidates?.candidates?.filter((c) => /progress|process|pending/i.test(c.status || '')).length || '—';
    const outstandingTimesheets = timesheets?.timesheets?.filter((t) => t.status && t.status.toLowerCase() !== 'approved').length || '—';
    const nextPayRun = (() => {
      if (!timesheets?.timesheets?.length) return '—';
      const future = timesheets.timesheets
        .map((t) => t.payroll_batch)
        .filter(Boolean)
        .sort()
        .shift();
      return future || '—';
    })();
    return {
      liveJobs,
      candidatesInProcess,
      interviewsWeek: '—',
      outstandingTimesheets,
      nextPayRun
    };
  }

  function updateKpis(host, values) {
    Array.from(host.querySelectorAll('.kpi-tile')).forEach((tile) => {
      const key = tile.getAttribute('data-key');
      const val = values[key];
      if (val !== undefined) {
        const strong = tile.querySelector('strong');
        if (strong) strong.textContent = val === null ? '—' : String(val);
      }
    });
  }

  function initCommandPalette() {
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePalette(true);
      } else if (event.key === 'Escape' && state.paletteOpen) {
        event.preventDefault();
        togglePalette(false);
      }
    });
  }

  function collectRoutes() {
    const cards = Array.from(document.querySelectorAll('.grid[data-tile-order] a.card'));
    return cards.map((card) => ({
      label: card.querySelector('h3')?.textContent?.trim() || card.textContent.trim(),
      detail: card.querySelector('p')?.textContent?.trim() || '',
      href: card.getAttribute('href'),
      element: card
    }));
  }

  function togglePalette(open) {
    if (open && state.paletteOpen) return;
    if (!open && !state.paletteOpen) return;
    if (open) {
      buildPalette();
    } else {
      destroyPalette();
    }
  }

  function buildPalette() {
    const overlay = createEl('div', { className: 'command-overlay', attrs: { role: 'dialog', 'aria-modal': 'true' } });
    const dialog = createEl('div', { className: 'command-dialog' });
    const header = createEl('header');
    const search = createEl('input', { attrs: { type: 'search', placeholder: 'Search admin areas…', 'aria-label': 'Search admin areas' } });
    header.appendChild(search);
    const hint = createEl('div', { className: 'muted', text: 'Navigate with ↑ ↓, Enter to open, Esc to close' });
    header.appendChild(hint);
    const results = createEl('div', { className: 'command-results', attrs: { role: 'listbox' } });
    dialog.appendChild(header);
    dialog.appendChild(results);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    state.commandsHost = overlay;
    state.paletteOpen = true;
    const routes = collectRoutes();
    const recents = state.activity.filter((a) => a.kind === 'nav' && a.href).slice(0, 5);
    const items = routes.map((route) => ({ ...route, group: 'Sections' }))
      .concat(recents.map((item) => ({ label: item.label.replace('Navigated to ', ''), detail: item.detail || '', href: item.href, group: 'Recent' })));
    state.paletteNodes = [];
    renderPaletteResults(items, results);
    state.paletteIndex = 0;
    selectPaletteIndex(0);
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) togglePalette(false);
    });
    document.addEventListener('keydown', handlePaletteKeydown);
    search.addEventListener('input', () => filterPalette(items, results, search.value));
    search.focus();
  }

  function destroyPalette() {
    if (state.commandsHost) state.commandsHost.remove();
    state.commandsHost = null;
    state.paletteOpen = false;
    state.paletteNodes = [];
    document.removeEventListener('keydown', handlePaletteKeydown);
  }

  function handlePaletteKeydown(event) {
    if (!state.paletteOpen) return;
    const max = state.paletteNodes.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.paletteIndex = Math.min(max, state.paletteIndex + 1);
      selectPaletteIndex(state.paletteIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.paletteIndex = Math.max(0, state.paletteIndex - 1);
      selectPaletteIndex(state.paletteIndex);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const node = state.paletteNodes[state.paletteIndex];
      if (node) {
        node.click();
      }
    }
  }

  function renderPaletteResults(items, resultsHost) {
    resultsHost.innerHTML = '';
    if (!items.length) {
      resultsHost.appendChild(createEl('div', { className: 'muted', text: 'No matches found.' }));
      return;
    }
    let lastGroup = '';
    items.forEach((item) => {
      if (item.group && item.group !== lastGroup) {
        lastGroup = item.group;
        const label = createEl('div', { className: 'muted', text: item.group });
        label.style.padding = '8px 18px 4px';
        resultsHost.appendChild(label);
      }
      const btn = createEl('button', { attrs: { type: 'button', role: 'option' } });
      btn.dataset.href = item.href || '#';
      btn.dataset.label = item.label;
      btn.appendChild(createEl('strong', { text: item.label }));
      if (item.detail) btn.appendChild(createEl('span', { text: item.detail }));
      btn.addEventListener('click', () => {
        togglePalette(false);
        if (item.href) {
          logActivity({ label: `Navigated to ${item.label}`, detail: item.href, kind: 'nav', href: new URL(item.href, location.origin).href });
          location.href = item.href;
        }
      });
      resultsHost.appendChild(btn);
      state.paletteNodes.push(btn);
    });
  }

  function selectPaletteIndex(idx) {
    state.paletteNodes.forEach((node, i) => {
      node.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      if (i === idx) node.scrollIntoView({ block: 'nearest' });
    });
  }

  function filterPalette(items, host, query) {
    if (!query) {
      renderPaletteResults(items, host);
      state.paletteIndex = 0;
      selectPaletteIndex(0);
      return;
    }
    const q = query.toLowerCase();
    const filtered = items.filter((item) => {
      return item.label.toLowerCase().includes(q) || (item.detail && item.detail.toLowerCase().includes(q));
    });
    state.paletteNodes = [];
    renderPaletteResults(filtered, host);
    state.paletteIndex = 0;
    selectPaletteIndex(0);
  }

  function initKeyboardShortcuts() {
    let gPressed = false;
    document.addEventListener('keydown', (event) => {
      if (event.key === 'g' && !event.repeat) {
        gPressed = true;
        return;
      }
      if (gPressed) {
        const key = event.key.toLowerCase();
        const map = {
          c: '/admin/clients.html',
          n: '/admin/candidates.html',
          a: '/admin/assignments.html',
          j: '/admin/jobs.html',
          p: '/admin/payroll.html',
          t: '/admin/timesheets.html',
          r: '/admin/reports.html'
        };
        if (map[key]) {
          event.preventDefault();
          logActivity({ label: `Shortcut → ${map[key]}`, detail: 'Keyboard navigation', kind: 'nav', href: new URL(map[key], location.origin).href });
          location.href = map[key];
        }
        gPressed = false;
      }
      if (event.key === '?') {
        event.preventDefault();
        toggleShortcuts();
      }
    });
    document.addEventListener('keyup', (event) => {
      if (event.key === 'g') gPressed = false;
    });
  }

  function toggleShortcuts() {
    if (state.shortcutsHost) {
      state.shortcutsHost.remove();
      state.shortcutsHost = null;
      return;
    }
    const overlay = createEl('div', { className: 'command-overlay', attrs: { role: 'dialog', 'aria-modal': 'true' } });
    const dialog = createEl('div', { className: 'command-dialog' });
    const header = createEl('header');
    header.appendChild(createEl('h3', { text: 'Keyboard shortcuts' }));
    dialog.appendChild(header);
    const list = createEl('div', { className: 'command-results' });
    const shortcuts = [
      ['⌘K / Ctrl+K', 'Open command palette'],
      ['g c', 'Go to Clients'],
      ['g n', 'Go to Candidates'],
      ['g a', 'Go to Assignments'],
      ['g j', 'Go to Jobs'],
      ['g p', 'Go to Payroll'],
      ['g t', 'Go to Timesheets'],
      ['g r', 'Go to Reports'],
      ['?', 'Show this help'],
      ['Esc', 'Close palette/modals']
    ];
    shortcuts.forEach(([keys, desc]) => {
      const row = createEl('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.gap = '12px';
      row.style.padding = '10px 18px';
      row.appendChild(createEl('strong', { text: keys }));
      row.appendChild(createEl('span', { text: desc }));
      list.appendChild(row);
    });
    dialog.appendChild(list);
    overlay.appendChild(dialog);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) toggleShortcuts();
    });
    document.addEventListener('keydown', shortcutsEsc);
    document.body.appendChild(overlay);
    state.shortcutsHost = overlay;
  }

  function shortcutsEsc(event) {
    if (event.key === 'Escape') {
      document.removeEventListener('keydown', shortcutsEsc);
      toggleShortcuts();
    }
  }

  function initNetlifyTools() {
    const chips = document.querySelector('#netlifyTools .health-chips');
    if (!chips) return;
    const logsRow = document.querySelector('#netlifyTools .logs-row');
    window.addEventListener('hmj:admin:health', (event) => {
      const detail = event.detail || {};
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
        chip.setAttribute('data-ts', String(detail.at || now()));
        chip.title = `Last updated ${formatTime(detail.at || now())}`;
      });
      if (!detail.ok && !detail.raw) {
        hmjToast('Health check unavailable', 'warn', 3200);
      }
      logActivity({ label: detail.ok ? 'Supabase health OK' : 'Supabase health failed', detail: formatTime(detail.at || now()), kind: 'health' });
    });

    requestIdleCallbackSafe(() => {
      const knownLogs = state.helpers?.sel?.('#netlifyTools')?.dataset || {};
      const urls = {
        api: knownLogs.apiLogs,
        db: knownLogs.dbLogs,
        storage: knownLogs.storageLogs
      };
      const hasLogs = Object.values(urls).some(Boolean);
      if (logsRow) {
        if (hasLogs) {
          logsRow.hidden = false;
          Array.from(logsRow.querySelectorAll('[data-log]')).forEach((link) => {
            const key = link.getAttribute('data-log');
            const url = urls[key];
            if (url) {
              link.setAttribute('href', url);
            } else {
              link.hidden = true;
            }
          });
        } else {
          logsRow.hidden = true;
        }
      }
    }, 180);
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

  function initNotesBoard() {
    const host = document.getElementById('notesBoard');
    if (!host) return;
    loadNotes();
    host.innerHTML = '';
    const header = createEl('header');
    header.appendChild(createEl('h3', { text: 'Team Notes (local only)' }));
    const exportBtn = createEl('button', { className: 'btn ghost small', text: 'Export', attrs: { type: 'button' } });
    const importBtn = createEl('button', { className: 'btn ghost small', text: 'Import', attrs: { type: 'button' } });
    const toolbar = createEl('div', { className: 'notes-toolbar' });
    toolbar.appendChild(exportBtn);
    toolbar.appendChild(importBtn);
    header.appendChild(toolbar);
    host.appendChild(header);
    const form = createEl('form');
    const textarea = createEl('textarea', { attrs: { name: 'noteText', placeholder: 'Add a note for the team…' } });
    const metaRow = createEl('div', { className: 'notes-toolbar' });
    const tagInput = createEl('input', { attrs: { type: 'text', name: 'noteTag', placeholder: '#tag (optional)', 'aria-label': 'Note tag' } });
    const saveBtn = createEl('button', { className: 'btn ghost small', text: 'Save note', attrs: { type: 'submit' } });
    metaRow.appendChild(tagInput);
    metaRow.appendChild(saveBtn);
    form.appendChild(textarea);
    form.appendChild(metaRow);
    host.appendChild(form);
    const filterRow = createEl('div', { className: 'notes-toolbar' });
    const search = createEl('input', { attrs: { type: 'search', placeholder: 'Search notes…', 'aria-label': 'Search notes' } });
    const allBtn = createEl('button', { text: 'All', attrs: { type: 'button', 'data-filter': 'all', 'aria-pressed': 'true' } });
    const pinnedBtn = createEl('button', { text: 'Pinned', attrs: { type: 'button', 'data-filter': 'pinned', 'aria-pressed': 'false' } });
    const tagsRow = createEl('div', { className: 'notes-tags', attrs: { id: 'notesTags' } });
    filterRow.appendChild(search);
    filterRow.appendChild(allBtn);
    filterRow.appendChild(pinnedBtn);
    filterRow.appendChild(tagsRow);
    host.appendChild(filterRow);
    const list = createEl('div', { className: 'notes-list', attrs: { id: 'notesList' } });
    host.appendChild(list);
    host.hidden = false;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = textarea.value.trim();
      if (!text) return;
      const tag = tagInput.value.trim().replace(/^#/, '').toLowerCase();
      const note = {
        id: 'n_' + now(),
        text,
        tag: tag || '',
        pinned: false,
        ts: now(),
        author: (state.who?.email || '').split('@')[0] || 'admin'
      };
      state.notes.unshift(note);
      saveNotes();
      renderNotes();
      textarea.value = '';
      tagInput.value = '';
      hmjToast('Note added', 'info');
      logActivity({ label: 'Note added', detail: note.tag ? `#${note.tag}` : '', kind: 'note' });
    });

    exportBtn.addEventListener('click', () => {
      const payload = JSON.stringify({ notes: state.notes }, null, 2);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = createEl('a', { attrs: { href: url, download: 'hmj-notes.json' } });
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      hmjToast('Notes exported', 'info');
    });

    importBtn.addEventListener('click', () => {
      const input = createEl('input', { attrs: { type: 'file', accept: 'application/json' } });
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            if (Array.isArray(data?.notes)) {
              state.notes = data.notes.slice(0, 200);
              saveNotes();
              renderNotes();
              hmjToast('Notes imported', 'info');
              logActivity({ label: 'Notes imported', detail: `${state.notes.length} notes`, kind: 'note' });
            }
          } catch (err) {
            hmjToast('Import failed', 'error');
            console.error('Import failed', err);
          }
        };
        reader.readAsText(file);
      });
      input.click();
    });

    const filters = [allBtn, pinnedBtn];
    filters.forEach((btn) => {
      btn.addEventListener('click', () => {
        filters.forEach((b) => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        list.dataset.view = btn.dataset.filter;
        renderNotes();
      });
    });

    search.addEventListener('input', () => {
      list.dataset.search = search.value.toLowerCase();
      renderNotes();
    });

    renderNotes();
  }

  function loadNotes() {
    const stored = readStore(stores.notes, { notes: [] });
    state.notes = Array.isArray(stored?.notes) ? stored.notes : [];
  }

  function saveNotes() {
    writeStore(stores.notes, { notes: state.notes });
  }

  function renderNotes() {
    const list = document.getElementById('notesList');
    if (!list) return;
    list.innerHTML = '';
    const filter = list.dataset.view || 'all';
    const search = list.dataset.search || '';
    let notes = state.notes.slice();
    const tagsHost = document.getElementById('notesTags');
    if (tagsHost) {
      tagsHost.innerHTML = '';
      const tags = Array.from(new Set(notes.filter((n) => n.tag).map((n) => n.tag)));
      tags.forEach((tag) => {
        const btn = createEl('button', { text: `#${tag}`, attrs: { type: 'button', 'data-tag': tag, 'aria-pressed': 'false' } });
        btn.addEventListener('click', () => {
          const active = btn.getAttribute('aria-pressed') === 'true';
          Array.from(tagsHost.children).forEach((child) => child.setAttribute('aria-pressed', 'false'));
          if (!active) {
            btn.setAttribute('aria-pressed', 'true');
            list.dataset.tag = tag;
          } else {
            list.dataset.tag = '';
          }
          renderNotes();
        });
        tagsHost.appendChild(btn);
      });
    }
    if (filter === 'pinned') {
      notes = notes.filter((n) => n.pinned);
    }
    const tagFilter = list.dataset.tag || '';
    if (tagFilter) {
      notes = notes.filter((n) => n.tag === tagFilter);
    }
    if (search) {
      notes = notes.filter((n) => n.text.toLowerCase().includes(search));
    }
    notes.sort((a, b) => (b.pinned === a.pinned) ? b.ts - a.ts : (b.pinned ? 1 : -1));
    if (!notes.length) {
      list.appendChild(createEl('p', { className: 'notes-empty', text: 'No notes yet. Add one above!' }));
      return;
    }
    notes.forEach((note) => {
      list.appendChild(renderNoteCard(note));
    });
  }

  function renderNoteCard(note) {
    const card = createEl('article', { className: 'note-card', attrs: { 'data-id': note.id, 'data-pinned': String(note.pinned) } });
    const header = createEl('header');
    header.appendChild(createEl('div', { text: formatRelative(note.ts) }));
    header.appendChild(createEl('span', { text: note.author ? `by ${note.author}` : '' }));
    card.appendChild(header);
    const body = createEl('div', { html: renderMarkdown(note.text) });
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-label', 'Note text');
    card.appendChild(body);
    if (note.tag) {
      const foot = createEl('footer');
      foot.appendChild(createEl('div', { className: 'tag', text: `#${note.tag}` }));
      foot.appendChild(createEl('div', { text: formatTime(note.ts) }));
      card.appendChild(foot);
    }
    const actions = createEl('div', { className: 'actions' });
    const pinBtn = createEl('button', { text: note.pinned ? 'Unpin' : 'Pin', attrs: { type: 'button' } });
    const editBtn = createEl('button', { text: 'Edit', attrs: { type: 'button' } });
    const delBtn = createEl('button', { text: 'Delete', attrs: { type: 'button' } });
    actions.appendChild(pinBtn);
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    pinBtn.addEventListener('click', () => {
      note.pinned = !note.pinned;
      saveNotes();
      renderNotes();
      hmjToast(note.pinned ? 'Note pinned' : 'Note unpinned');
    });

    editBtn.addEventListener('click', () => editNote(card, note));

    delBtn.addEventListener('click', () => {
      state.notes = state.notes.filter((n) => n.id !== note.id);
      saveNotes();
      renderNotes();
      hmjToast('Note deleted', 'warn');
      logActivity({ label: 'Note deleted', detail: note.tag ? `#${note.tag}` : '', kind: 'note' });
    });

    return card;
  }

  function editNote(card, note) {
    card.innerHTML = '';
    const form = createEl('form');
    const textarea = createEl('textarea');
    textarea.value = note.text;
    const tagInput = createEl('input', { attrs: { type: 'text', value: note.tag ? `#${note.tag}` : '', 'aria-label': 'Tag' } });
    const save = createEl('button', { className: 'btn ghost small', text: 'Save', attrs: { type: 'submit' } });
    const cancel = createEl('button', { className: 'btn ghost small', text: 'Cancel', attrs: { type: 'button' } });
    form.appendChild(textarea);
    form.appendChild(tagInput);
    form.appendChild(save);
    form.appendChild(cancel);
    card.appendChild(form);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      note.text = textarea.value.trim();
      note.tag = tagInput.value.trim().replace(/^#/, '').toLowerCase();
      note.ts = now();
      saveNotes();
      renderNotes();
      hmjToast('Note updated', 'info');
      logActivity({ label: 'Note updated', detail: note.tag ? `#${note.tag}` : '', kind: 'note' });
    });
    cancel.addEventListener('click', () => {
      renderNotes();
    });
  }

  function renderMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br/>');
  }

  async function loadCalendar() {
    const host = document.getElementById('calendarGlance');
    if (!host) return;
    const data = await fetchJson('/admin/interviews.json');
    if (!data?.interviews?.length) {
      host.hidden = true;
      return;
    }
    const nowDate = new Date();
    const weekStart = new Date(nowDate);
    weekStart.setDate(nowDate.getDate() - nowDate.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const upcoming = data.interviews.filter((item) => {
      const when = new Date(item.date);
      return when >= weekStart && when < weekEnd;
    });
    if (!upcoming.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML = '';
    host.appendChild(createEl('strong', { text: 'Interviews this week' }));
    const list = createEl('ul');
    upcoming.slice(0, 6).forEach((item) => {
      const when = formatTime(new Date(item.date).getTime());
      list.appendChild(createEl('li', { text: `${when} — ${item.candidate || 'Candidate'} @ ${item.client || 'Client'}` }));
    });
    host.appendChild(list);
  }

  async function loadRiskFlags() {
    const host = document.getElementById('riskFlags');
    if (!host) return;
    const data = await fetchJson('/admin/risk-flags.json');
    if (!data?.flags?.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML = '';
    data.flags.slice(0, 5).forEach((flag) => {
      host.appendChild(createEl('div', { className: 'risk-flag', text: flag }));
    });
  }

  function initActivityHooks() {
    window.addEventListener('hmj:toast', (event) => {
      const detail = event.detail || {};
      logActivity({ label: detail.message || 'Notice', detail: detail.type || 'info', kind: 'toast' });
    });
  }

  function init({ helpers, who }) {
    state.helpers = helpers;
    state.who = who;
    if (helpers && typeof helpers.toast === 'function') {
      helpers.toast = (message, type, ms) => hmjToast(message, type, ms);
    }
    initThemeToggle();
    initEnvironmentBadge('HMJ Global Admin');
    initViewPreferences();
    initActivityFeed();
    initCards();
    initCommandPalette();
    initKeyboardShortcuts();
    initNetlifyTools();
    initNotesBoard();
    initActivityHooks();
    initKpis();
  }

  window.HMJDashboardEnhancer = { init };
})();
