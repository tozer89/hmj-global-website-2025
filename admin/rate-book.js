(() => {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const doc = document;
  const state = {
    helpers: null,
    user: null,
    roles: [],
    markets: [],
    settings: null,
    readOnly: true,
    source: 'loading',
    schema: false,
    error: '',
    activeMarketCode: '',
    filters: {
      search: '',
      discipline: '',
      seniority: '',
      visibility: '',
    },
    filtered: [],
    editorRoleId: '',
    editorMarketDrafts: {},
  };

  const els = {};

  function byId(id) {
    return doc.getElementById(id);
  }

  function cacheElements() {
    [
      'welcomeMeta',
      'heroVisibilityLabel',
      'heroSourceChip',
      'heroSummary',
      'publicGuideToggleBtn',
      'printPdfBtn',
      'publicGuideToggleMeta',
      'metricPublic',
      'metricHidden',
      'metricArchived',
      'metricMarkets',
      'refreshBtn',
      'downloadTemplateBtn',
      'importBtn',
      'newRoleBtn',
      'marketTabs',
      'searchInput',
      'disciplineFilter',
      'seniorityFilter',
      'visibilityFilter',
      'recalculateBtn',
      'rateBookBanner',
      'rateBookBannerTitle',
      'rateBookBannerBody',
      'resultMeta',
      'tableBody',
      'emptyState',
      'settingsForm',
      'settingsMarginLowThreshold',
      'settingsMarginLowAdd',
      'settingsMarginHighThreshold',
      'settingsMarginHighAdd',
      'settingsOtherCurrencyMessage',
      'settingsPublicDisclaimer',
      'settingsCtaLabel',
      'settingsCtaUrl',
      'saveSettingsBtn',
      'previewMeta',
      'previewCard',
      'editor',
      'editorTitle',
      'editorMeta',
      'closeEditorBtn',
      'roleForm',
      'fieldName',
      'fieldSlug',
      'fieldDisplayOrder',
      'fieldDiscipline',
      'fieldSeniority',
      'fieldNotes',
      'fieldIsPublic',
      'fieldIsActive',
      'sectorDataCentre',
      'sectorPharma',
      'sectorMissionCritical',
      'sectorEngineering',
      'editorMarketGrid',
      'archiveRoleBtn',
      'duplicateRoleBtn',
      'saveRoleBtn',
      'importInput',
    ].forEach((id) => {
      els[id] = byId(id);
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function asString(value) {
    if (typeof value === 'string') return value.trim();
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function asNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function slugify(value) {
    return asString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96);
  }

  function formatMoney(value, currency) {
    const amount = asNumber(value);
    if (amount === null) return '—';
    const code = asString(currency).toUpperCase() || 'GBP';
    try {
      return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${code}`;
    }
  }

  function calculateCharge(payRate, currency) {
    const pay = asNumber(payRate);
    if (pay === null) return null;
    const code = asString(currency).toUpperCase();
    if (code && code !== 'GBP' && code !== 'EUR') return null;
    const settings = state.settings || {};
    const lowAdd = asNumber(settings.marginLowAdd) ?? 3.5;
    const highAdd = asNumber(settings.marginHighAdd) ?? 5;
    const highThreshold = asNumber(settings.marginHighThreshold) ?? 35;
    return Number((pay + (pay >= highThreshold ? highAdd : lowAdd)).toFixed(2));
  }

  function formatDate(value) {
    const raw = asString(value);
    if (!raw) return '—';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(raw));
    } catch {
      return raw;
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getActiveMarket() {
    return state.markets.find((market) => market.code === state.activeMarketCode) || state.markets[0] || null;
  }

  function getRoleById(roleId) {
    return state.roles.find((role) => String(role.id) === String(roleId)) || null;
  }

  function isPublicGuideEnabled() {
    return !state.settings || state.settings.publicEnabled !== false;
  }

  function roleStatus(role) {
    if (!role) return 'archived';
    if (role.isActive === false) return 'archived';
    return role.isPublic ? 'public' : 'hidden';
  }

  function toast(message, type) {
    if (!state.helpers || typeof state.helpers.toast !== 'function') return;
    state.helpers.toast(message, type || 'info', 3200);
  }

  async function api(path, method, body) {
    return state.helpers.api(path, method || 'POST', body);
  }

  function updateBanner(message, tone, title) {
    if (!els.rateBookBanner) return;
    if (!message) {
      els.rateBookBanner.hidden = true;
      return;
    }
    els.rateBookBanner.hidden = false;
    els.rateBookBanner.dataset.tone = tone || 'info';
    els.rateBookBannerTitle.textContent = title || 'Rate Book';
    els.rateBookBannerBody.textContent = message;
  }

  function renderOverview() {
    const counts = state.roles.reduce((summary, role) => {
      const status = roleStatus(role);
      if (status === 'public') summary.publicCount += 1;
      else if (status === 'hidden') summary.hiddenCount += 1;
      else summary.archivedCount += 1;
      return summary;
    }, { publicCount: 0, hiddenCount: 0, archivedCount: 0 });

    els.metricPublic.textContent = String(counts.publicCount);
    els.metricHidden.textContent = String(counts.hiddenCount);
    els.metricArchived.textContent = String(counts.archivedCount);
    els.metricMarkets.textContent = String(state.markets.length);

    const publicEnabled = isPublicGuideEnabled();

    els.heroVisibilityLabel.textContent = publicEnabled
      ? (counts.publicCount
        ? `${counts.publicCount} public role${counts.publicCount === 1 ? '' : 's'} live`
        : 'Public guide live')
      : 'Public guide hidden';
    els.heroSourceChip.textContent = state.source === 'supabase' ? 'Live source' : 'Preview source';
    if (els.publicGuideToggleBtn) {
      els.publicGuideToggleBtn.disabled = !!state.readOnly;
      els.publicGuideToggleBtn.textContent = publicEnabled ? 'Hide from public site' : 'Show on public site';
      els.publicGuideToggleBtn.classList.toggle('primary', publicEnabled);
      els.publicGuideToggleBtn.classList.toggle('ghost', !publicEnabled);
    }
    if (els.publicGuideToggleMeta) {
      els.publicGuideToggleMeta.textContent = publicEnabled
        ? 'Clients can currently see the Rate Book on the live site and client resource links.'
        : 'The public Rate Book and client resource links are currently hidden, while admin editing stays available.';
    }

    if (state.readOnly && state.schema) {
      els.heroSummary.textContent = 'The Rate Book is running in seeded preview mode until the Supabase migration is applied.';
      updateBanner(state.error || 'Apply the Rate Book migration to enable live editing.', 'warn', 'Rate Book setup required');
    } else if (state.readOnly) {
      els.heroSummary.textContent = 'The Rate Book is in safe preview mode because the live storage layer is unavailable.';
      updateBanner(state.error || 'This environment is currently read-only.', 'info', 'Rate Book preview');
    } else if (!publicEnabled) {
      els.heroSummary.textContent = 'The public Rate Book is switched off, but all role and market data remain available here for editing and branded PDF exports.';
      updateBanner('', '', 'Rate Book');
    } else {
      els.heroSummary.textContent = counts.publicCount
        ? 'Published roles flow straight to the public Rate Book. Hidden and archived roles stay saved inside admin only.'
        : 'No roles are currently public, so the public Rate Book will stay empty until you switch at least one role live.';
      updateBanner(state.error || '', state.error ? 'info' : '', 'Rate Book');
    }
  }

  function populateFilters() {
    const disciplines = Array.from(new Set(state.roles.map((role) => asString(role.discipline)).filter(Boolean))).sort();
    const seniorities = Array.from(new Set(state.roles.map((role) => asString(role.seniority)).filter(Boolean))).sort();

    function fill(select, values, label) {
      if (!select) return;
      const current = select.value;
      select.innerHTML = [`<option value="">${escapeHtml(label)}</option>`]
        .concat(values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`))
        .join('');
      if (values.includes(current)) select.value = current;
    }

    fill(els.disciplineFilter, disciplines, 'All disciplines');
    fill(els.seniorityFilter, seniorities, 'All seniority');
  }

  function renderMarketTabs() {
    if (!els.marketTabs) return;
    els.marketTabs.innerHTML = state.markets.map((market) => `
      <button class="market-tab" type="button" data-market-code="${escapeHtml(market.code)}" data-active="${market.code === state.activeMarketCode ? 'true' : 'false'}">
        <span>${escapeHtml(market.name)}</span>
        <small>${escapeHtml(market.currency)}</small>
      </button>
    `).join('');
  }

  function applyFilters() {
    const search = asString(els.searchInput && els.searchInput.value).toLowerCase();
    const discipline = asString(els.disciplineFilter && els.disciplineFilter.value);
    const seniority = asString(els.seniorityFilter && els.seniorityFilter.value);
    const visibility = asString(els.visibilityFilter && els.visibilityFilter.value);
    state.filters = { search, discipline, seniority, visibility };

    state.filtered = state.roles.filter((role) => {
      if (discipline && role.discipline !== discipline) return false;
      if (seniority && role.seniority !== seniority) return false;
      if (visibility && roleStatus(role) !== visibility) return false;
      if (!search) return true;
      const haystack = [
        role.name,
        role.slug,
        role.discipline,
        role.seniority,
        Array.isArray(role.sector) ? role.sector.join(' ') : '',
        role.notes,
      ].join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }

  function renderResultMeta() {
    if (!els.resultMeta) return;
    const activeMarket = getActiveMarket();
    els.resultMeta.textContent = `${state.filtered.length} role${state.filtered.length === 1 ? '' : 's'} in ${activeMarket ? activeMarket.name : 'all markets'} view`;
  }

  function currentMarketRate(role) {
    const activeMarket = getActiveMarket();
    if (!activeMarket) return null;
    return role.ratesByMarket && role.ratesByMarket[activeMarket.code]
      ? role.ratesByMarket[activeMarket.code]
      : null;
  }

  function renderPreview(role) {
    if (!els.previewCard || !els.previewMeta) return;
    if (!role) {
      els.previewMeta.textContent = 'Select a role to preview its public presentation.';
      els.previewCard.innerHTML = '<div class="muted">No role selected.</div>';
      return;
    }
    const rates = state.markets
      .map((market) => role.ratesByMarket && role.ratesByMarket[market.code] ? role.ratesByMarket[market.code] : null)
      .filter(Boolean);
    els.previewMeta.textContent = `${role.name} · ${role.discipline} · ${role.seniority}`;
    els.previewCard.innerHTML = `
      <div class="preview-card__chips">
        ${role.isFeatured ? '<span class="preview-pill">Popular</span>' : ''}
        <span class="preview-pill">${escapeHtml(role.discipline)}</span>
        <span class="preview-pill">${escapeHtml(role.seniority)}</span>
      </div>
      <h3>${escapeHtml(role.name)}</h3>
      <p class="muted">${escapeHtml((role.sector || []).join(' • '))}</p>
      <div class="preview-card__rates">
        ${rates.map((rate) => `
          <article class="preview-rate">
            <strong>${escapeHtml(rate.marketCode)}</strong>
            <span>Pay ${escapeHtml(formatMoney(rate.payRate, rate.currency))}</span>
            <span>Charge ${escapeHtml(formatMoney(rate.chargeRate, rate.currency))}</span>
          </article>
        `).join('')}
      </div>
    `;
  }

  function renderTable() {
    applyFilters();
    renderResultMeta();

    if (!state.filtered.length) {
      els.tableBody.innerHTML = '';
      els.emptyState.hidden = false;
      renderPreview(state.roles[0] || null);
      return;
    }

    els.emptyState.hidden = true;
    const activeMarket = getActiveMarket();

    els.tableBody.innerHTML = state.filtered.map((role) => {
      const rate = currentMarketRate(role);
      const updatedAt = role.updatedAt || rate?.updatedAt || '';
      return `
        <article class="table-row" data-role-id="${escapeHtml(role.id)}">
          <div class="table-row__title">
            <strong>${escapeHtml(role.name)}</strong>
            <span class="table-row__meta">${escapeHtml((role.sector || []).join(' • ') || 'No sector tags')}</span>
          </div>
          <span>${escapeHtml(role.discipline)}</span>
          <span>${escapeHtml(role.seniority)}</span>
          <input class="inline-input" data-inline-pay type="number" step="0.01" value="${rate?.payRate != null ? escapeHtml(String(rate.payRate)) : ''}" ${state.readOnly ? 'disabled' : ''} />
          <input class="inline-input" data-inline-charge type="number" step="0.01" value="${rate?.chargeRate != null ? escapeHtml(String(rate.chargeRate)) : ''}" ${state.readOnly ? 'disabled' : ''} />
          <button class="toggle-btn" type="button" data-toggle-public data-active="${role.isPublic ? 'true' : 'false'}" ${state.readOnly ? 'disabled' : ''}>${role.isPublic ? 'Live' : 'Hidden'}</button>
          <button class="toggle-btn" type="button" data-toggle-active data-active="${role.isActive ? 'true' : 'false'}" ${state.readOnly ? 'disabled' : ''}>${role.isActive ? 'Active' : 'Archived'}</button>
          <span>${escapeHtml(formatDate(updatedAt))}</span>
          <div class="table-actions">
            <button class="btn soft small" type="button" data-edit-role="${escapeHtml(role.id)}">Edit</button>
            <button class="btn primary small" type="button" data-save-inline="${escapeHtml(role.id)}" ${state.readOnly ? 'disabled' : ''}>Save</button>
          </div>
        </article>
      `;
    }).join('');

    const previewRole = getRoleById(state.editorRoleId) || state.filtered[0] || null;
    renderPreview(previewRole);

    if (activeMarket) {
      const tableHead = byId('tableHead');
      if (tableHead) {
        const labels = tableHead.querySelectorAll('span');
        if (labels[3]) labels[3].textContent = `${activeMarket.code} pay`;
        if (labels[4]) labels[4].textContent = `${activeMarket.code} charge`;
      }
    }
  }

  function bindStaticEvents() {
    els.refreshBtn.addEventListener('click', () => {
      loadData();
    });

    if (els.publicGuideToggleBtn) {
      els.publicGuideToggleBtn.addEventListener('click', togglePublicGuide);
    }
    if (els.printPdfBtn) {
      els.printPdfBtn.addEventListener('click', printBrandedPdf);
    }

    els.searchInput.addEventListener('input', renderTable);
    els.disciplineFilter.addEventListener('change', renderTable);
    els.seniorityFilter.addEventListener('change', renderTable);
    els.visibilityFilter.addEventListener('change', renderTable);

    els.marketTabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-market-code]');
      if (!button) return;
      state.activeMarketCode = asString(button.dataset.marketCode);
      renderMarketTabs();
      renderTable();
    });

    els.tableBody.addEventListener('click', async (event) => {
      const roleId = asString(event.target.getAttribute('data-edit-role'));
      if (roleId) {
        openEditor(getRoleById(roleId));
        return;
      }

      const saveId = asString(event.target.getAttribute('data-save-inline'));
      if (saveId) {
        await saveInlineRow(saveId);
        return;
      }

      const publicToggle = event.target.closest('[data-toggle-public]');
      if (publicToggle) {
        const next = publicToggle.dataset.active !== 'true';
        publicToggle.dataset.active = next ? 'true' : 'false';
        publicToggle.textContent = next ? 'Live' : 'Hidden';
      }

      const activeToggle = event.target.closest('[data-toggle-active]');
      if (activeToggle) {
        const next = activeToggle.dataset.active !== 'true';
        activeToggle.dataset.active = next ? 'true' : 'false';
        activeToggle.textContent = next ? 'Active' : 'Archived';
      }
    });

    els.recalculateBtn.addEventListener('click', async () => {
      try {
        const result = await api('admin-rate-book-recalculate', 'POST', {
          marketCode: state.activeMarketCode,
          roleIds: state.filtered.map((role) => role.id),
        });
        toast(`Recalculated ${result.updatedCount || 0} rate${result.updatedCount === 1 ? '' : 's'}.`, 'success');
        await loadData();
      } catch (error) {
        toast(error.message || 'Unable to recalculate current market.', 'error');
      }
    });

    els.downloadTemplateBtn.addEventListener('click', downloadTemplate);
    els.importBtn.addEventListener('click', () => els.importInput.click());
    els.importInput.addEventListener('change', handleImportFile);
    els.newRoleBtn.addEventListener('click', () => openEditor(null));

    els.settingsForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveSettings();
    });

    els.closeEditorBtn.addEventListener('click', closeEditor);
    els.saveRoleBtn.addEventListener('click', async () => {
      await saveEditorRole(false);
    });
    els.archiveRoleBtn.addEventListener('click', async () => {
      await saveEditorRole(true);
    });
    els.duplicateRoleBtn.addEventListener('click', duplicateEditorRole);
    els.fieldName.addEventListener('input', () => {
      if (!els.fieldSlug.dataset.manual) {
        els.fieldSlug.value = slugify(els.fieldName.value);
      }
      updateEditorPreview();
    });
    els.fieldSlug.addEventListener('input', () => {
      els.fieldSlug.dataset.manual = els.fieldSlug.value ? 'true' : '';
    });

    [
      els.fieldDiscipline,
      els.fieldSeniority,
      els.fieldDisplayOrder,
      els.fieldNotes,
      els.fieldIsPublic,
      els.fieldIsActive,
      els.sectorDataCentre,
      els.sectorPharma,
      els.sectorMissionCritical,
      els.sectorEngineering,
    ].forEach((element) => {
      element.addEventListener('input', updateEditorPreview);
      element.addEventListener('change', updateEditorPreview);
    });
  }

  async function loadData() {
    try {
      const payload = await api('admin-rate-book-list');
      state.roles = Array.isArray(payload.roles) ? payload.roles : [];
      state.markets = Array.isArray(payload.markets) ? payload.markets : [];
      state.settings = payload.settings || null;
      state.readOnly = payload.readOnly !== false;
      state.source = asString(payload.source) || 'supabase';
      state.schema = payload.schema === true;
      state.error = asString(payload.error);
      state.activeMarketCode = state.activeMarketCode || (state.markets[0] && state.markets[0].code) || '';

      populateFilters();
      renderMarketTabs();
      renderOverview();
      renderSettings();
      renderTable();
    } catch (error) {
      state.error = error.message || 'Unable to load the Rate Book module.';
      updateBanner(state.error, 'warn', 'Rate Book unavailable');
      toast(state.error, 'error');
    }
  }

  function renderSettings() {
    if (!state.settings) return;
    els.settingsMarginLowThreshold.value = state.settings.marginLowThreshold ?? '';
    els.settingsMarginLowAdd.value = state.settings.marginLowAdd ?? '';
    els.settingsMarginHighThreshold.value = state.settings.marginHighThreshold ?? '';
    els.settingsMarginHighAdd.value = state.settings.marginHighAdd ?? '';
    els.settingsOtherCurrencyMessage.value = state.settings.otherCurrencyMessage || '';
    els.settingsPublicDisclaimer.value = state.settings.publicDisclaimer || '';
    els.settingsCtaLabel.value = state.settings.ctaLabel || '';
    els.settingsCtaUrl.value = state.settings.ctaUrl || '';
    els.saveSettingsBtn.disabled = !!state.readOnly;
    els.recalculateBtn.disabled = !!state.readOnly;
    els.importBtn.disabled = !!state.readOnly;
    els.newRoleBtn.disabled = !!state.readOnly;
  }

  function collectSettingsPayload() {
    return {
      marginLowThreshold: asNumber(els.settingsMarginLowThreshold.value),
      marginLowAdd: asNumber(els.settingsMarginLowAdd.value),
      marginHighThreshold: asNumber(els.settingsMarginHighThreshold.value),
      marginHighAdd: asNumber(els.settingsMarginHighAdd.value),
      otherCurrencyMessage: asString(els.settingsOtherCurrencyMessage.value),
      publicDisclaimer: asString(els.settingsPublicDisclaimer.value),
      ctaLabel: asString(els.settingsCtaLabel.value),
      ctaUrl: asString(els.settingsCtaUrl.value),
      publicEnabled: isPublicGuideEnabled(),
      id: state.settings && state.settings.id ? state.settings.id : undefined,
    };
  }

  async function saveSettings() {
    try {
      const result = await api('admin-rate-book-settings-save', 'POST', {
        settings: collectSettingsPayload(),
      });
      state.settings = result.settings;
      renderOverview();
      renderSettings();
      toast('Rate Book settings saved.', 'success');
    } catch (error) {
      toast(error.message || 'Unable to save settings.', 'error');
    }
  }

  async function togglePublicGuide() {
    const nextPublicEnabled = !isPublicGuideEnabled();

    try {
      const result = await api('admin-rate-book-settings-save', 'POST', {
        settings: {
          ...collectSettingsPayload(),
          publicEnabled: nextPublicEnabled,
        },
      });
      state.settings = result.settings || state.settings;
      renderOverview();
      renderSettings();
      renderTable();
      toast(
        nextPublicEnabled
          ? 'The public Rate Book is now visible on the live site.'
          : 'The public Rate Book is now hidden from the live site.',
        'success'
      );
    } catch (error) {
      toast(error.message || 'Unable to update public Rate Book visibility.', 'error');
    }
  }

  function printableRoles() {
    return state.roles
      .filter((role) => role.isActive !== false && role.isPublic !== false)
      .filter((role) => {
        if (state.filters.search) {
          const haystack = [
            role.name,
            role.slug,
            role.discipline,
            role.seniority,
            Array.isArray(role.sector) ? role.sector.join(' ') : '',
            role.notes,
          ].join(' ').toLowerCase();
          if (!haystack.includes(state.filters.search)) return false;
        }
        if (state.filters.discipline && role.discipline !== state.filters.discipline) return false;
        if (state.filters.seniority && role.seniority !== state.filters.seniority) return false;
        return true;
      });
  }

  function printableUpdatedAt(roles) {
    const timestamps = roles
      .flatMap((role) => [role.updatedAt].concat((role.marketRates || []).map((rate) => rate.updatedAt)))
      .map((value) => Date.parse(asString(value)))
      .filter((value) => Number.isFinite(value));
    if (!timestamps.length) return '';
    return new Date(Math.max(...timestamps)).toISOString();
  }

  function printTimestamp(value) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(value instanceof Date ? value : new Date(value));
    } catch {
      return asString(value);
    }
  }

  function buildPdfMarkup() {
    const roles = printableRoles();
    const markets = state.markets.filter((market) => market.isActive !== false);
    const settings = state.settings || {};
    const latest = printableUpdatedAt(roles);
    const printedAt = new Date();
    const filtersApplied = [
      state.filters.search ? `Search: ${state.filters.search}` : '',
      state.filters.discipline ? `Discipline: ${state.filters.discipline}` : '',
      state.filters.seniority ? `Seniority: ${state.filters.seniority}` : '',
    ].filter(Boolean);

    const marketHeader = markets.map((market) => `
      <th colspan="2">
        <span>${escapeHtml(market.name)}</span>
        <small>${escapeHtml(market.currency)}</small>
      </th>
    `).join('');
    const marketSubhead = markets.map(() => '<th>Pay</th><th>Charge</th>').join('');

    const bodyRows = roles.map((role) => `
      <tr>
        <td class="print-role-cell">
          <strong>${escapeHtml(role.name)}</strong>
          <span>${escapeHtml(role.discipline)} · ${escapeHtml(role.seniority)}</span>
          <small>${escapeHtml((role.sector || []).join(' • ') || 'Mission-critical support')}</small>
        </td>
        ${markets.map((market) => {
          const rate = role.ratesByMarket && role.ratesByMarket[market.code]
            ? role.ratesByMarket[market.code]
            : null;
          return `
            <td>${escapeHtml(formatMoney(rate && rate.payRate, market.currency))}</td>
            <td>${escapeHtml(formatMoney(rate && rate.chargeRate, market.currency))}</td>
          `;
        }).join('')}
      </tr>
    `).join('');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>HMJ Global Rate Book PDF</title>
  <style>
    @page { size: A4 landscape; margin: 14mm; }
    :root {
      --ink: #0f1b3f;
      --muted: #5f6f97;
      --line: #d9e1f4;
      --brand: #2f4ea2;
      --brand-soft: #eef2fb;
      --panel: #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      font: 12px/1.45 "Inter", "Segoe UI", Arial, sans-serif;
      background: #fff;
    }
    .print-shell { display: grid; gap: 18px; }
    .print-hero {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(270px, 0.7fr);
      gap: 18px;
      align-items: stretch;
    }
    .print-panel {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px;
      background: linear-gradient(180deg, rgba(238, 242, 251, 0.65), #fff);
    }
    .print-brand { display: inline-flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .print-brand img { height: 32px; width: auto; }
    .eyebrow {
      margin: 0 0 6px;
      color: var(--brand);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .18em;
      text-transform: uppercase;
    }
    h1, p { margin: 0; }
    h1 { font-size: 26px; line-height: 1.05; margin-bottom: 10px; }
    .lead { font-size: 14px; font-weight: 700; margin-bottom: 10px; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .summary-card {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      background: var(--panel);
    }
    .summary-card strong { display: block; font-size: 18px; margin-bottom: 3px; }
    .summary-card span, .meta-list span, .meta-list small, .print-footer { color: var(--muted); }
    .meta-list { display: grid; gap: 10px; }
    .meta-list strong { display: block; margin-bottom: 3px; }
    .filters-note {
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--brand-soft);
      color: var(--brand);
      font-weight: 700;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead th {
      background: var(--brand-soft);
      color: var(--brand);
      font-size: 10px;
      letter-spacing: .08em;
      text-transform: uppercase;
      padding: 10px 8px;
      border: 1px solid var(--line);
    }
    thead th small { display: block; margin-top: 2px; font-size: 9px; color: var(--muted); }
    tbody td { border: 1px solid var(--line); padding: 9px 8px; vertical-align: top; }
    tbody tr:nth-child(even) td { background: rgba(238, 242, 251, 0.38); }
    .print-role-cell strong { display: block; margin-bottom: 4px; }
    .print-role-cell span, .print-role-cell small { display: block; color: var(--muted); }
  </style>
</head>
<body>
  <div class="print-shell">
    <section class="print-hero">
      <article class="print-panel">
        <div class="print-brand">
          <img src="${escapeHtml(`${window.location.origin}/images/logo.png`)}" alt="HMJ Global logo" />
        </div>
        <p class="eyebrow">Indicative commercial guide</p>
        <h1>HMJ Global Rate Book</h1>
        <p class="lead">Indicative pay and charge rates for mission-critical construction across the UK and Europe.</p>
        <p>We support data centre, pharma, engineering and critical-infrastructure projects with fast access to trusted site and project talent. This printable guide mirrors the live HMJ Rate Book and can be shared directly with clients for planning and commercial review.</p>
      </article>
      <aside class="print-panel">
        <div class="meta-list">
          <div>
            <p class="eyebrow">How our pricing works</p>
            <strong>&pound;/&euro;${escapeHtml(String(settings.marginLowAdd ?? 3.5))} margin where pay is up to ${escapeHtml(String(settings.marginLowThreshold ?? 34))} per hour</strong>
            <small>&pound;/&euro;${escapeHtml(String(settings.marginHighAdd ?? 5))} margin where pay is ${escapeHtml(String(settings.marginHighThreshold ?? 35))} per hour or above</small>
          </div>
          <div>
            <p class="eyebrow">Issued</p>
            <strong>${escapeHtml(printTimestamp(printedAt))}</strong>
            <small>${latest ? `Latest live update ${escapeHtml(formatDate(latest))}` : 'Current public guide snapshot'}</small>
          </div>
          <div>
            <p class="eyebrow">Disclaimer</p>
            <small>${escapeHtml(asString(settings.publicDisclaimer) || 'These figures are indicative commercial guide rates and may vary based on project conditions.')}</small>
          </div>
        </div>
      </aside>
    </section>
    <section class="summary-grid">
      <article class="summary-card">
        <strong>${roles.length}</strong>
        <span>Public active roles included</span>
      </article>
      <article class="summary-card">
        <strong>${markets.length}</strong>
        <span>Markets covered</span>
      </article>
      <article class="summary-card">
        <strong>${isPublicGuideEnabled() ? 'Live' : 'Hidden'}</strong>
        <span>Current public guide status</span>
      </article>
    </section>
    ${filtersApplied.length ? `<div class="filters-note">Filtered export: ${escapeHtml(filtersApplied.join(' · '))}</div>` : ''}
    <section class="print-panel">
      <table aria-label="HMJ Global rate book table">
        <thead>
          <tr>
            <th rowspan="2" style="width: 24%;">Role</th>
            ${marketHeader}
          </tr>
          <tr>${marketSubhead}</tr>
        </thead>
        <tbody>
          ${bodyRows || `<tr><td colspan="${1 + (markets.length * 2)}">No public active roles match the current printable selection.</td></tr>`}
        </tbody>
      </table>
    </section>
    <p class="print-footer">HMJ Global Rate Book. Indicative commercial guide only. Rates may vary with scope, shift pattern, rotation, travel, accommodation, mobilisation needs, local compliance and project complexity.</p>
  </div>
  <script>
    window.addEventListener('load', function () {
      window.setTimeout(function () {
        window.print();
      }, 300);
    });
  </script>
</body>
</html>`;
  }

  function printBrandedPdf() {
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=1280,height=900');
    if (!popup) {
      toast('Please allow pop-ups to generate the branded Rate Book PDF.', 'warn');
      return;
    }
    popup.document.open();
    popup.document.write(buildPdfMarkup());
    popup.document.close();
    toast('Opened a branded print view for PDF export.', 'success');
  }

  function findRow(roleId) {
    return els.tableBody.querySelector(`[data-role-id="${CSS.escape(String(roleId))}"]`);
  }

  async function saveInlineRow(roleId) {
    const role = getRoleById(roleId);
    const row = findRow(roleId);
    const activeMarket = getActiveMarket();
    if (!role || !row || !activeMarket) return;

    const payInput = row.querySelector('[data-inline-pay]');
    const chargeInput = row.querySelector('[data-inline-charge]');
    const isPublic = row.querySelector('[data-toggle-public]')?.dataset.active === 'true';
    const isActive = row.querySelector('[data-toggle-active]')?.dataset.active === 'true';
    const existingRate = currentMarketRate(role);
    const payRate = asNumber(payInput.value);
    const chargeRate = asNumber(chargeInput.value);
    const calculatedCharge = calculateCharge(payRate, activeMarket.currency);
    const isChargeOverridden = chargeRate !== null && calculatedCharge !== null
      ? Math.abs(chargeRate - calculatedCharge) > 0.009
      : chargeRate !== null && calculatedCharge === null;

    try {
      await api('admin-rate-book-save', 'POST', {
        role: {
          id: role.id,
          slug: role.slug,
          name: role.name,
          discipline: role.discipline,
          seniority: role.seniority,
          sector: role.sector,
          displayOrder: role.displayOrder,
          notes: role.notes,
          isPublic,
          isActive,
        },
        rates: [{
          id: existingRate && existingRate.id ? existingRate.id : undefined,
          marketCode: activeMarket.code,
          marketId: activeMarket.id,
          payRate,
          chargeRate,
          isChargeOverridden,
          isFeatured: existingRate ? existingRate.isFeatured === true : role.isFeatured === true,
          effectiveFrom: existingRate && existingRate.effectiveFrom ? existingRate.effectiveFrom : undefined,
        }],
      });
      toast(`${role.name} saved for ${activeMarket.name}.`, 'success');
      await loadData();
    } catch (error) {
      toast(error.message || 'Unable to save inline rate changes.', 'error');
    }
  }

  function sectorValuesFromEditor() {
    return [
      els.sectorDataCentre.checked ? 'Data centre' : '',
      els.sectorPharma.checked ? 'Pharma' : '',
      els.sectorMissionCritical.checked ? 'Mission critical' : '',
      els.sectorEngineering.checked ? 'Engineering' : '',
    ].filter(Boolean);
  }

  function editorRoleBase(role) {
    if (role) return clone(role);
    return {
      id: '',
      slug: '',
      name: '',
      discipline: 'Project Delivery',
      seniority: 'Manager',
      sector: ['Data centre', 'Mission critical', 'Engineering'],
      isActive: true,
      isPublic: true,
      displayOrder: (state.roles.length + 1) * 10,
      notes: '',
      marketRates: [],
      ratesByMarket: {},
      isFeatured: false,
    };
  }

  function openEditor(role) {
    const draft = editorRoleBase(role);
    state.editorRoleId = draft.id || '';
    state.editorMarketDrafts = {};
    state.markets.forEach((market) => {
      const current = draft.ratesByMarket && draft.ratesByMarket[market.code]
        ? clone(draft.ratesByMarket[market.code])
        : {
          marketCode: market.code,
          marketId: market.id,
          payRate: null,
          chargeRate: null,
          isFeatured: draft.isFeatured === true,
          isChargeOverridden: false,
          effectiveFrom: '',
        };
      state.editorMarketDrafts[market.code] = current;
    });

    els.editorTitle.textContent = draft.id ? draft.name : 'Add role';
    els.editorMeta.textContent = draft.id
      ? 'Update role metadata, market rates, and public visibility.'
      : 'Create a new public Rate Book role and set its market rates.';
    els.fieldName.value = draft.name || '';
    els.fieldSlug.value = draft.slug || '';
    els.fieldSlug.dataset.manual = draft.slug ? 'true' : '';
    els.fieldDisplayOrder.value = draft.displayOrder || '';
    els.fieldDiscipline.value = draft.discipline || 'Project Delivery';
    els.fieldSeniority.value = draft.seniority || 'Manager';
    els.fieldNotes.value = draft.notes || '';
    els.fieldIsPublic.checked = draft.isPublic !== false;
    els.fieldIsActive.checked = draft.isActive !== false;
    els.sectorDataCentre.checked = (draft.sector || []).includes('Data centre');
    els.sectorPharma.checked = (draft.sector || []).includes('Pharma');
    els.sectorMissionCritical.checked = (draft.sector || []).includes('Mission critical');
    els.sectorEngineering.checked = (draft.sector || []).includes('Engineering');

    renderEditorMarketCards();
    updateEditorPreview();

    els.editor.classList.add('is-open');
    els.editor.setAttribute('aria-hidden', 'false');
    els.archiveRoleBtn.disabled = state.readOnly || !draft.id;
    els.duplicateRoleBtn.disabled = !!state.readOnly;
    els.saveRoleBtn.disabled = !!state.readOnly;
  }

  function closeEditor() {
    els.editor.classList.remove('is-open');
    els.editor.setAttribute('aria-hidden', 'true');
  }

  function renderEditorMarketCards() {
    els.editorMarketGrid.innerHTML = state.markets.map((market) => {
      const draft = state.editorMarketDrafts[market.code] || {};
      return `
        <article class="editor-market-card" data-market-card="${escapeHtml(market.code)}">
          <div class="editor-market-card__head">
            <div>
              <strong>${escapeHtml(market.name)}</strong>
              <div class="muted">${escapeHtml(market.currency)} / hour</div>
            </div>
            <label class="checkline">
              <input type="checkbox" data-market-featured ${draft.isFeatured ? 'checked' : ''} />
              Featured
            </label>
          </div>
          <div class="editor-market-card__grid">
            <label class="field">
              <span>Pay rate</span>
              <input data-market-pay type="number" step="0.01" value="${draft.payRate != null ? escapeHtml(String(draft.payRate)) : ''}" />
            </label>
            <label class="field">
              <span>Charge rate</span>
              <input data-market-charge type="number" step="0.01" value="${draft.chargeRate != null ? escapeHtml(String(draft.chargeRate)) : ''}" />
            </label>
          </div>
          <label class="checkline">
            <input type="checkbox" data-market-override ${draft.isChargeOverridden ? 'checked' : ''} />
            Manual charge override
          </label>
        </article>
      `;
    }).join('');

    els.editorMarketGrid.querySelectorAll('[data-market-card]').forEach((card) => {
      const code = asString(card.getAttribute('data-market-card'));
      ['input', 'change'].forEach((eventName) => {
        card.addEventListener(eventName, () => {
          syncEditorMarketDraft(code, card);
          updateEditorPreview();
        });
      });
    });
  }

  function syncEditorMarketDraft(code, card) {
    const current = state.editorMarketDrafts[code] || {};
    const market = state.markets.find((item) => item.code === code);
    const override = card.querySelector('[data-market-override]').checked;
    const payRate = asNumber(card.querySelector('[data-market-pay]').value);
    let chargeRate = asNumber(card.querySelector('[data-market-charge]').value);
    if (!override) {
      chargeRate = calculateCharge(payRate, market && market.currency);
      card.querySelector('[data-market-charge]').value = chargeRate !== null ? String(chargeRate) : '';
    }
    state.editorMarketDrafts[code] = {
      ...current,
      marketCode: code,
      marketId: current.marketId || market?.id || '',
      id: current.id || '',
      payRate,
      chargeRate,
      isFeatured: card.querySelector('[data-market-featured]').checked,
      isChargeOverridden: override,
      effectiveFrom: current.effectiveFrom || '',
    };
  }

  function collectEditorPayload(archiveRole) {
    state.markets.forEach((market) => {
      const card = els.editorMarketGrid.querySelector(`[data-market-card="${CSS.escape(market.code)}"]`);
      if (card) syncEditorMarketDraft(market.code, card);
    });

    return {
      role: {
        id: state.editorRoleId || undefined,
        name: asString(els.fieldName.value),
        slug: asString(els.fieldSlug.value),
        displayOrder: asNumber(els.fieldDisplayOrder.value),
        discipline: asString(els.fieldDiscipline.value),
        seniority: asString(els.fieldSeniority.value),
        notes: asString(els.fieldNotes.value),
        isPublic: els.fieldIsPublic.checked,
        isActive: archiveRole ? false : els.fieldIsActive.checked,
        sector: sectorValuesFromEditor(),
      },
      rates: Object.values(state.editorMarketDrafts)
        .filter((item) => item && (item.payRate !== null || item.chargeRate !== null))
        .map((item) => ({
          id: item.id || undefined,
          marketCode: item.marketCode,
          marketId: item.marketId,
          payRate: item.payRate,
          chargeRate: item.chargeRate,
          isChargeOverridden: item.isChargeOverridden,
          isFeatured: item.isFeatured,
          effectiveFrom: item.effectiveFrom || undefined,
        })),
    };
  }

  async function saveEditorRole(archiveRole) {
    try {
      const payload = collectEditorPayload(archiveRole);
      const result = await api('admin-rate-book-save', 'POST', payload);
      toast(archiveRole ? 'Role archived.' : 'Role saved.', 'success');
      closeEditor();
      state.editorRoleId = result.role && result.role.id ? result.role.id : '';
      await loadData();
    } catch (error) {
      toast(error.message || 'Unable to save Rate Book role.', 'error');
    }
  }

  function duplicateEditorRole() {
    const payload = collectEditorPayload(false);
    payload.role.id = undefined;
    payload.role.slug = `${payload.role.slug || slugify(payload.role.name)}-copy`;
    payload.role.name = `${payload.role.name || 'Untitled role'} Copy`;
    state.editorRoleId = '';
    openEditor({
      ...payload.role,
      id: '',
      marketRates: payload.rates.map((rate) => ({
        ...rate,
        id: '',
        marketName: state.markets.find((market) => market.code === rate.marketCode)?.name || rate.marketCode,
        currency: state.markets.find((market) => market.code === rate.marketCode)?.currency || '',
      })),
      ratesByMarket: payload.rates.reduce((acc, rate) => {
        acc[rate.marketCode] = {
          ...rate,
          id: '',
          marketName: state.markets.find((market) => market.code === rate.marketCode)?.name || rate.marketCode,
          currency: state.markets.find((market) => market.code === rate.marketCode)?.currency || '',
        };
        return acc;
      }, {}),
    });
  }

  function updateEditorPreview() {
    const role = {
      id: state.editorRoleId || '',
      name: asString(els.fieldName.value) || 'Untitled role',
      discipline: asString(els.fieldDiscipline.value),
      seniority: asString(els.fieldSeniority.value),
      sector: sectorValuesFromEditor(),
      isFeatured: Object.values(state.editorMarketDrafts).some((item) => item && item.isFeatured),
      ratesByMarket: {},
    };

    state.markets.forEach((market) => {
      const draft = state.editorMarketDrafts[market.code];
      if (!draft) return;
      role.ratesByMarket[market.code] = {
        ...draft,
        marketCode: market.code,
        marketName: market.name,
        currency: market.currency,
      };
    });
    renderPreview(role);
  }

  function downloadTemplate() {
    const header = [
      'name',
      'slug',
      'discipline',
      'seniority',
      'sector',
      'display_order',
      'is_public',
      'is_active',
      'featured',
      ...state.markets.flatMap((market) => [`${market.code}_pay`, `${market.code}_charge`]),
    ];
    const sample = [
      'Example Project Manager',
      'example-project-manager',
      'Project Delivery',
      'Manager',
      'Data centre|Mission critical|Engineering',
      '510',
      'true',
      'true',
      'true',
      ...state.markets.flatMap(() => ['60.00', '65.00']),
    ];
    const csv = [header.join(','), sample.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = url;
    link.download = 'hmj-rate-book-template.csv';
    doc.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function parseCsv(text) {
    const rows = [];
    let cell = '';
    let row = [];
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];
      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
        continue;
      }
      if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(cell);
        cell = '';
      } else if (char === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else if (char !== '\r') {
        cell += char;
      }
    }

    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }

    return rows.filter((entry) => entry.some((value) => asString(value)));
  }

  function normaliseImportRows(rows) {
    if (rows.length < 2) return [];
    const headers = rows[0].map((header) => asString(header).toLowerCase());
    const entries = [];

    for (let index = 1; index < rows.length; index += 1) {
      const raw = rows[index];
      const entry = {};
      headers.forEach((header, cellIndex) => {
        entry[header] = raw[cellIndex];
      });

      const name = asString(entry.name);
      if (!name) continue;
      const rates = {};
      state.markets.forEach((market) => {
        rates[market.code] = {
          payRate: asNumber(entry[`${market.code.toLowerCase()}_pay`]),
          chargeRate: asNumber(entry[`${market.code.toLowerCase()}_charge`]),
        };
      });

      entries.push({
        name,
        slug: asString(entry.slug),
        discipline: asString(entry.discipline),
        seniority: asString(entry.seniority),
        sector: asString(entry.sector).split('|').map((item) => item.trim()).filter(Boolean),
        displayOrder: asNumber(entry.display_order),
        isPublic: !entry.is_public || /^(true|1|yes)$/i.test(asString(entry.is_public)),
        isActive: !entry.is_active || /^(true|1|yes)$/i.test(asString(entry.is_active)),
        featured: /^(true|1|yes)$/i.test(asString(entry.featured)),
        rates,
      });
    }

    return entries;
  }

  async function handleImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const rows = normaliseImportRows(parseCsv(text));
      if (!rows.length) {
        toast('No import rows were found in that CSV.', 'warn');
        return;
      }
      const result = await api('admin-rate-book-import', 'POST', { rows });
      toast(`Imported ${result.importedCount || 0} role${result.importedCount === 1 ? '' : 's'}.`, 'success');
      await loadData();
    } catch (error) {
      toast(error.message || 'Unable to import the CSV file.', 'error');
    } finally {
      event.target.value = '';
    }
  }

  window.HMJRateBookAdmin = {
    async init({ helpers, who }) {
      state.helpers = helpers;
      state.user = who || null;
      cacheElements();
      bindStaticEvents();
      await loadData();
    },
  };
})();
