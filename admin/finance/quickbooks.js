(function () {
  'use strict';

  const els = {};
  let helpersRef = null;

  function $(id) {
    return document.getElementById(id);
  }

  function setup() {
    [
      'qboWelcomeMeta',
      'qboStatusChips',
      'qboConnectionStatus',
      'qboConnectionMeta',
      'qboLastSync',
      'qboLastSyncMeta',
      'qboAlerts',
      'qboConnectionList',
      'qboRunList',
      'qboRedirectUriLabel',
      'btnConnectQbo',
      'btnSyncQbo',
      'btnDisconnectQbo',
    ].forEach((id) => { els[id] = $(id); });
  }

  function clearNode(node) {
    if (node) node.innerHTML = '';
  }

  function timeLabel(value) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return value;
    }
  }

  function statusChip(label, tone) {
    const span = document.createElement('span');
    span.className = 'finance-status';
    if (tone) span.dataset.tone = tone;
    span.textContent = label;
    return span;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(options?.body ? { 'content-type': 'application/json' } : {}),
      },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || payload?.message || 'QuickBooks request failed.');
    return payload;
  }

  function renderAlerts(diagnostics, extra = []) {
    clearNode(els.qboAlerts);
    [...(diagnostics?.warnings || []), ...extra].forEach((message) => {
      const div = document.createElement('div');
      div.className = 'finance-alert';
      div.dataset.tone = 'warn';
      div.textContent = message;
      els.qboAlerts.appendChild(div);
    });
  }

  function renderConnection(payload) {
    const diagnostics = payload.diagnostics || payload.qbo || {};
    const connection = payload.connection || diagnostics.connection || null;

    clearNode(els.qboStatusChips);
    els.qboStatusChips.appendChild(statusChip(diagnostics.connectReady ? 'Ready to connect' : 'Needs config', diagnostics.connectReady ? 'ok' : 'warn'));
    els.qboStatusChips.appendChild(statusChip(connection ? 'Connected' : 'No live connection', connection ? 'ok' : 'warn'));
    if (diagnostics.environment) els.qboStatusChips.appendChild(statusChip(`QBO ${diagnostics.environment}`, 'ok'));

    els.qboConnectionStatus.textContent = connection ? 'Connected' : (diagnostics.connectReady ? 'Ready to connect' : 'Needs config');
    els.qboConnectionMeta.textContent = connection?.companyName || diagnostics.warnings?.[0] || 'Waiting for finance status';
    els.qboLastSync.textContent = connection?.lastSyncAt ? 'Synced' : 'Not synced';
    els.qboLastSyncMeta.textContent = connection?.lastSyncAt ? timeLabel(connection.lastSyncAt) : 'No sync recorded yet';
    els.qboRedirectUriLabel.textContent = diagnostics.redirectUri || 'QuickBooks callback URL not available';

    clearNode(els.qboConnectionList);
    const items = [
      ['Environment', diagnostics.environment || 'production'],
      ['Redirect URI', diagnostics.redirectUri || 'Not resolved'],
      ['Scope', diagnostics.scope || 'com.intuit.quickbooks.accounting'],
      ['Company', connection?.companyName || 'Not connected'],
      ['Realm ID', connection?.realmId || 'Not connected'],
      ['Connected by', connection?.connectedEmail || 'Not recorded'],
      ['Last sync', connection?.lastSyncAt ? timeLabel(connection.lastSyncAt) : 'Not synced'],
      ['Last error', connection?.lastError || 'None'],
    ];
    items.forEach(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'finance-list-item';
      item.innerHTML = `<strong>${label}</strong><small>${value}</small>`;
      els.qboConnectionList.appendChild(item);
    });

    clearNode(els.qboRunList);
    const runs = payload.recentSyncRuns || [];
    if (!runs.length) {
      els.qboRunList.innerHTML = '<div class="finance-empty">No QuickBooks sync runs recorded yet.</div>';
    } else {
      runs.forEach((run) => {
        const item = document.createElement('div');
        item.className = 'finance-list-item';
        item.innerHTML = `
          <strong>${run.sync_type || 'manual'} · ${run.status || 'unknown'}</strong>
          <small>${timeLabel(run.started_at)}${run.completed_at ? ` → ${timeLabel(run.completed_at)}` : ''}</small>
          <small>${run.error_message || Object.entries(run.entity_counts || {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'No counts recorded.'}</small>
        `;
        els.qboRunList.appendChild(item);
      });
    }

    const extra = [];
    const params = new URLSearchParams(location.search);
    if (params.get('qbo_error')) extra.push(decodeURIComponent(params.get('qbo_error')));
    if (params.get('qbo') === 'connected') extra.push('QuickBooks connected successfully.');
    renderAlerts(diagnostics, extra);

    els.btnConnectQbo.disabled = !diagnostics.connectReady;
    els.btnSyncQbo.disabled = !connection;
    els.btnDisconnectQbo.disabled = !connection;
  }

  async function load() {
    const [connectionPayload, dashboardPayload] = await Promise.all([
      fetchJson('/.netlify/functions/admin-finance-qbo-connect'),
      fetchJson('/.netlify/functions/admin-finance-dashboard'),
    ]);
    renderConnection({
      ...connectionPayload,
      recentSyncRuns: dashboardPayload.finance?.recentSyncRuns || [],
    });
  }

  async function connectQbo() {
    const payload = await fetchJson(`/.netlify/functions/admin-finance-qbo-connect?action=connect&returnTo=${encodeURIComponent(location.href)}`);
    if (!payload.authUrl) throw new Error('QuickBooks connect URL was not returned.');
    location.href = payload.authUrl;
  }

  async function syncQbo() {
    helpersRef.toast('Running QuickBooks sync…', 'info', 1800);
    await fetchJson('/.netlify/functions/admin-finance-qbo-sync', { method: 'POST' });
    await load();
    helpersRef.toast('QuickBooks sync completed.', 'ok', 2600);
  }

  async function disconnectQbo() {
    await fetchJson('/.netlify/functions/admin-finance-qbo-connect', {
      method: 'POST',
      body: JSON.stringify({ action: 'disconnect' }),
    });
    await load();
    helpersRef.toast('QuickBooks connection marked as disconnected.', 'ok', 2600);
  }

  function boot() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      window.setTimeout(boot, 40);
      return;
    }
    setup();
    window.Admin.bootAdmin(async (helpers) => {
      helpersRef = helpers;
      els.qboWelcomeMeta.textContent = 'Signed in to the HMJ finance workspace';
      els.btnConnectQbo?.addEventListener('click', () => connectQbo().catch((error) => helpers.toast(error.message, 'warn', 3200)));
      els.btnSyncQbo?.addEventListener('click', () => syncQbo().catch((error) => helpers.toast(error.message, 'warn', 3200)));
      els.btnDisconnectQbo?.addEventListener('click', () => disconnectQbo().catch((error) => helpers.toast(error.message, 'warn', 3200)));
      await load();
    });
  }

  boot();
})();
