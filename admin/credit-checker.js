(function () {
  'use strict';

  const state = {
    helpers: null,
    leads: [],
    filteredLeads: [],
    currentLeadId: '',
    settings: null,
    options: null,
    stats: null,
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function setup() {
    [
      'creditCheckerWelcomeMeta',
      'creditCheckerStatsGrid',
      'btnRefreshLeads',
      'leadSearch',
      'leadStatusFilter',
      'leadQueueMeta',
      'leadTableBody',
      'leadDetailTitle',
      'leadEmailLink',
      'leadDetailEmpty',
      'leadDetailForm',
      'leadReferenceValue',
      'leadRangeValue',
      'leadNameValue',
      'leadCompanyValue',
      'leadEmailValue',
      'leadPhoneValue',
      'leadTurnoverValue',
      'leadYearsValue',
      'leadSectorValue',
      'leadCreatedAtValue',
      'leadNarrativeValue',
      'leadStatus',
      'leadAssignedTo',
      'leadFollowUpDate',
      'leadAdminNotes',
      'btnSaveLead',
      'settingsForm',
      'settingsEnabled',
      'settingsWidgetEnabled',
      'settingsWidgetEyebrow',
      'settingsWidgetTitle',
      'settingsWidgetIntro',
      'settingsWidgetButtonLabel',
      'settingsPageHeading',
      'settingsPageIntro',
      'settingsPageDisclaimer',
      'settingsThankYouMessage',
      'settingsNotificationRecipients',
      'settingsBaseRatioPercent',
      'settingsRoundStep',
      'settingsMinLimit',
      'settingsMaxMidLimit',
      'settingsMaxHighLimit',
      'settingsLowSpreadPercent',
      'settingsHighSpreadPercent',
      'settingsTurnoverGrid',
      'settingsYearsGrid',
      'settingsSectorGrid',
      'btnSaveSettings',
    ].forEach(function (id) {
      els[id] = $(id);
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

  function money(value) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  }

  function dateTime(value) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch (_) {
      return value;
    }
  }

  function labelFor(list, value) {
    const match = Array.isArray(list) ? list.find(function (item) { return item.value === value; }) : null;
    return match ? match.label : (value || '—');
  }

  function filteredStats(leads) {
    const stats = { total: leads.length, new: 0, contacted: 0, qualified: 0, closed: 0 };
    leads.forEach(function (lead) {
      const key = String(lead && lead.status || '').toLowerCase();
      if (Object.prototype.hasOwnProperty.call(stats, key)) {
        stats[key] += 1;
      }
    });
    return stats;
  }

  function currentLead() {
    return state.leads.find(function (lead) {
      return String(lead.id) === String(state.currentLeadId);
    }) || null;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        accept: 'application/json',
        ...(options && options.body ? { 'content-type': 'application/json' } : {}),
        ...((options && options.headers) || {}),
      },
      ...options,
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      throw new Error(payload.error || payload.message || 'Request failed.');
    }
    return payload;
  }

  function renderStats() {
    if (!els.creditCheckerStatsGrid) return;
    const stats = state.stats || filteredStats(state.leads);
    const cards = [
      ['Total leads', stats.total],
      ['New', stats.new],
      ['Contacted', stats.contacted],
      ['Qualified', stats.qualified],
      ['Closed', stats.closed],
    ];
    els.creditCheckerStatsGrid.innerHTML = cards.map(function (entry) {
      return `<article><span>${escapeHtml(entry[0])}</span><strong>${escapeHtml(entry[1])}</strong></article>`;
    }).join('');
  }

  function renderStatusOptions() {
    const statuses = (state.options && state.options.statuses) || [];
    const markup = statuses.map(function (item) {
      return `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`;
    }).join('');
    if (els.leadStatusFilter) {
      els.leadStatusFilter.innerHTML = '<option value="">All statuses</option>' + markup;
    }
    if (els.leadStatus) {
      els.leadStatus.innerHTML = markup;
    }
  }

  function applyFilters() {
    const search = String(els.leadSearch && els.leadSearch.value || '').trim().toLowerCase();
    const status = String(els.leadStatusFilter && els.leadStatusFilter.value || '').trim().toLowerCase();
    state.filteredLeads = state.leads.filter(function (lead) {
      const haystack = [
        lead.lead_reference,
        lead.full_name,
        lead.company_name,
        lead.email,
      ].join(' ').toLowerCase();
      if (status && String(lead.status || '').toLowerCase() !== status) return false;
      if (search && !haystack.includes(search)) return false;
      return true;
    });
  }

  function renderLeadTable() {
    if (!els.leadTableBody) return;
    applyFilters();
    const rows = state.filteredLeads;
    if (!rows.length) {
      els.leadTableBody.innerHTML = '<tr><td colspan="5" class="cca-empty">No leads match the current filter.</td></tr>';
      if (els.leadQueueMeta) {
        els.leadQueueMeta.textContent = 'No leads match the current filter.';
      }
      return;
    }

    if (els.leadQueueMeta) {
      els.leadQueueMeta.textContent = rows.length + ' lead' + (rows.length === 1 ? '' : 's') + ' shown';
    }

    els.leadTableBody.innerHTML = rows.map(function (lead) {
      const selected = String(lead.id) === String(state.currentLeadId);
      return `<tr${selected ? ' aria-current="true"' : ''}>
        <td>
          <strong>${escapeHtml(lead.company_name || '—')}</strong><br>
          <span class="cca-muted">${escapeHtml(lead.full_name || '—')}</span><br>
          <span class="cca-muted">${escapeHtml(lead.lead_reference || '')}</span>
        </td>
        <td>${escapeHtml(lead.indicative_range_label || money(lead.indicative_mid || 0))}</td>
        <td><span class="cca-tag">${escapeHtml(labelFor(state.options.statuses, lead.status))}</span></td>
        <td>${escapeHtml(dateTime(lead.created_at))}</td>
        <td><button type="button" data-open-lead="${escapeHtml(lead.id)}">Open</button></td>
      </tr>`;
    }).join('');

    els.leadTableBody.querySelectorAll('[data-open-lead]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.currentLeadId = button.getAttribute('data-open-lead');
        renderLeadTable();
        renderLeadDetail();
      });
    });
  }

  function renderLeadDetail() {
    const lead = currentLead();
    if (!lead) {
      if (els.leadDetailEmpty) els.leadDetailEmpty.hidden = false;
      if (els.leadDetailForm) els.leadDetailForm.hidden = true;
      if (els.leadDetailTitle) els.leadDetailTitle.textContent = 'Select a lead';
      if (els.leadEmailLink) els.leadEmailLink.href = 'mailto:info@hmj-global.com';
      return;
    }

    if (els.leadDetailEmpty) els.leadDetailEmpty.hidden = true;
    if (els.leadDetailForm) els.leadDetailForm.hidden = false;
    if (els.leadDetailTitle) els.leadDetailTitle.textContent = lead.company_name || 'Lead detail';
    if (els.leadEmailLink) els.leadEmailLink.href = 'mailto:' + (lead.email || 'info@hmj-global.com');

    els.leadReferenceValue.textContent = lead.lead_reference || '—';
    els.leadRangeValue.textContent = lead.indicative_range_label || money(lead.indicative_mid || 0);
    els.leadNameValue.textContent = lead.full_name || '—';
    els.leadCompanyValue.textContent = lead.company_name || '—';
    els.leadEmailValue.textContent = lead.email || '—';
    els.leadPhoneValue.textContent = lead.phone || '—';
    els.leadTurnoverValue.textContent = labelFor(state.options.turnoverBands, lead.turnover_band);
    els.leadYearsValue.textContent = labelFor(state.options.yearsTradingBands, lead.years_trading_band);
    els.leadSectorValue.textContent = labelFor(state.options.sectors, lead.sector);
    els.leadCreatedAtValue.textContent = dateTime(lead.created_at);
    els.leadNarrativeValue.textContent = (lead.result_payload && lead.result_payload.narrative) || '—';
    els.leadStatus.value = lead.status || 'new';
    els.leadAssignedTo.value = lead.assigned_to || '';
    els.leadFollowUpDate.value = lead.follow_up_date || '';
    els.leadAdminNotes.value = lead.admin_notes || '';
  }

  function renderDynamicGrid(container, items, values, options) {
    if (!container) return;
    const step = options && options.step ? options.step : '0.01';
    const suffix = options && options.suffix ? options.suffix : '';
    container.innerHTML = items.map(function (item) {
      const value = values && values[item.value] != null ? values[item.value] : '';
      return `<label>
        <span>${escapeHtml(item.label)}${suffix ? ' (' + escapeHtml(suffix) + ')' : ''}</span>
        <input type="number" step="${escapeHtml(step)}" data-setting-key="${escapeHtml(item.value)}" value="${escapeHtml(value)}" />
      </label>`;
    }).join('');
  }

  function renderSettings() {
    const settings = state.settings;
    if (!settings) return;
    els.settingsEnabled.checked = !!settings.enabled;
    els.settingsWidgetEnabled.checked = !!settings.widgetEnabled;
    els.settingsWidgetEyebrow.value = settings.widgetEyebrow || '';
    els.settingsWidgetTitle.value = settings.widgetTitle || '';
    els.settingsWidgetIntro.value = settings.widgetIntro || '';
    els.settingsWidgetButtonLabel.value = settings.widgetButtonLabel || '';
    els.settingsPageHeading.value = settings.pageHeading || '';
    els.settingsPageIntro.value = settings.pageIntro || '';
    els.settingsPageDisclaimer.value = settings.pageDisclaimer || '';
    els.settingsThankYouMessage.value = settings.thankYouMessage || '';
    els.settingsNotificationRecipients.value = Array.isArray(settings.notificationRecipients)
      ? settings.notificationRecipients.join(', ')
      : '';

    const calculator = settings.calculator || {};
    els.settingsBaseRatioPercent.value = ((Number(calculator.baseRatio || 0) * 100).toFixed(2)).replace(/\.00$/, '');
    els.settingsRoundStep.value = calculator.roundStep || '';
    els.settingsMinLimit.value = calculator.minLimit || '';
    els.settingsMaxMidLimit.value = calculator.maxMidLimit || '';
    els.settingsMaxHighLimit.value = calculator.maxHighLimit || '';
    els.settingsLowSpreadPercent.value = Math.round(Number(calculator.lowSpread || 0) * 100);
    els.settingsHighSpreadPercent.value = Math.round(Number(calculator.highSpread || 0) * 100);

    renderDynamicGrid(els.settingsTurnoverGrid, state.options.turnoverBands, calculator.turnoverBandMidpoints, {
      step: '2500',
      suffix: 'GBP midpoint',
    });
    renderDynamicGrid(els.settingsYearsGrid, state.options.yearsTradingBands, calculator.yearsTradingMultipliers, {
      step: '0.01',
      suffix: 'multiplier',
    });
    renderDynamicGrid(els.settingsSectorGrid, state.options.sectors, calculator.sectorMultipliers, {
      step: '0.01',
      suffix: 'multiplier',
    });
  }

  function readDynamicGrid(container) {
    const output = {};
    if (!container) return output;
    container.querySelectorAll('[data-setting-key]').forEach(function (input) {
      output[input.dataset.settingKey] = Number(input.value || 0);
    });
    return output;
  }

  function collectSettings() {
    return {
      enabled: !!els.settingsEnabled.checked,
      widgetEnabled: !!els.settingsWidgetEnabled.checked,
      widgetEyebrow: els.settingsWidgetEyebrow.value.trim(),
      widgetTitle: els.settingsWidgetTitle.value.trim(),
      widgetIntro: els.settingsWidgetIntro.value.trim(),
      widgetButtonLabel: els.settingsWidgetButtonLabel.value.trim(),
      pageHeading: els.settingsPageHeading.value.trim(),
      pageIntro: els.settingsPageIntro.value.trim(),
      pageDisclaimer: els.settingsPageDisclaimer.value.trim(),
      thankYouMessage: els.settingsThankYouMessage.value.trim(),
      notificationRecipients: els.settingsNotificationRecipients.value.trim(),
      calculator: {
        baseRatio: Number(els.settingsBaseRatioPercent.value || 0) / 100,
        roundStep: Number(els.settingsRoundStep.value || 0),
        minLimit: Number(els.settingsMinLimit.value || 0),
        maxMidLimit: Number(els.settingsMaxMidLimit.value || 0),
        maxHighLimit: Number(els.settingsMaxHighLimit.value || 0),
        lowSpread: Number(els.settingsLowSpreadPercent.value || 0) / 100,
        highSpread: Number(els.settingsHighSpreadPercent.value || 0) / 100,
        turnoverBandMidpoints: readDynamicGrid(els.settingsTurnoverGrid),
        yearsTradingMultipliers: readDynamicGrid(els.settingsYearsGrid),
        sectorMultipliers: readDynamicGrid(els.settingsSectorGrid),
      },
    };
  }

  async function loadBootstrap() {
    const payload = await fetchJson('/.netlify/functions/admin-credit-checker');
    state.leads = Array.isArray(payload.leads) ? payload.leads : [];
    state.settings = payload.settings || null;
    state.options = payload.options || { statuses: [], turnoverBands: [], yearsTradingBands: [], sectors: [] };
    state.stats = payload.stats || filteredStats(state.leads);
    if (!state.currentLeadId && state.leads.length) {
      state.currentLeadId = state.leads[0].id;
    }

    renderStatusOptions();
    renderStats();
    renderLeadTable();
    renderLeadDetail();
    renderSettings();
    if (els.creditCheckerWelcomeMeta) {
      els.creditCheckerWelcomeMeta.textContent = 'Signed in as ' + (payload.viewer && payload.viewer.email || 'admin user');
    }
  }

  async function saveLead(event) {
    event.preventDefault();
    const lead = currentLead();
    if (!lead) return;

    els.btnSaveLead.disabled = true;
    try {
      const payload = await fetchJson('/.netlify/functions/admin-credit-checker', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_lead',
          id: lead.id,
          status: els.leadStatus.value,
          assigned_to: els.leadAssignedTo.value,
          follow_up_date: els.leadFollowUpDate.value || null,
          admin_notes: els.leadAdminNotes.value,
        }),
      });

      state.leads = state.leads.map(function (entry) {
        return String(entry.id) === String(payload.lead.id) ? payload.lead : entry;
      });
      state.stats = filteredStats(state.leads);
      renderStats();
      renderLeadTable();
      renderLeadDetail();
      state.helpers.toast('Lead saved.', 'ok', 2200);
    } catch (error) {
      state.helpers.toast(error.message || 'Could not save lead.', 'warn', 3200);
    } finally {
      els.btnSaveLead.disabled = false;
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    els.btnSaveSettings.disabled = true;
    try {
      const payload = await fetchJson('/.netlify/functions/admin-credit-checker', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save_settings',
          settings: collectSettings(),
        }),
      });
      state.settings = payload.settings || state.settings;
      renderSettings();
      state.helpers.toast('Settings saved.', 'ok', 2200);
    } catch (error) {
      state.helpers.toast(error.message || 'Could not save settings.', 'warn', 3200);
    } finally {
      els.btnSaveSettings.disabled = false;
    }
  }

  function bindEvents() {
    if (els.leadSearch) {
      els.leadSearch.addEventListener('input', function () {
        renderLeadTable();
      });
    }
    if (els.leadStatusFilter) {
      els.leadStatusFilter.addEventListener('change', function () {
        renderLeadTable();
      });
    }
    if (els.btnRefreshLeads) {
      els.btnRefreshLeads.addEventListener('click', function () {
        loadBootstrap().catch(function (error) {
          state.helpers.toast(error.message || 'Could not refresh leads.', 'warn', 3200);
        });
      });
    }
    if (els.leadDetailForm) {
      els.leadDetailForm.addEventListener('submit', saveLead);
    }
    if (els.settingsForm) {
      els.settingsForm.addEventListener('submit', saveSettings);
    }
  }

  function boot() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function') {
      window.setTimeout(boot, 40);
      return;
    }

    setup();
    window.Admin.bootAdmin(async function (helpers) {
      state.helpers = helpers;
      bindEvents();
      try {
        await loadBootstrap();
      } catch (error) {
        helpers.toast(error.message || 'Could not load the credit checker workspace.', 'warn', 3600);
      }
    });
  }

  boot();
})();
