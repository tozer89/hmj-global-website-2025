(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const doc = document;
  const state = {
    settings: null,
    markets: [],
    roles: [],
    filtered: [],
    filters: {
      search: '',
      market: '',
      discipline: '',
      seniority: '',
      currency: '',
      sector: '',
      rateType: 'charge',
      sort: 'alpha',
    },
    source: 'loading',
    error: '',
    filterTrackTimer: 0,
    trackedFilterSignature: '',
  };

  const els = {};

  function byId(id) {
    return doc.getElementById(id);
  }

  function cacheElements() {
    [
      'otherCurrencyMessage',
      'rateBookDisclaimer',
      'rateBookPrimaryCta',
      'rateBookSearch',
      'rateBookMarket',
      'rateBookDiscipline',
      'rateBookSeniority',
      'rateBookCurrency',
      'rateBookSector',
      'rateBookRateType',
      'rateBookSort',
      'rateBookClearFilters',
      'rateBookPrintBtn',
      'rateBookExportBtn',
      'rateBookSummaryCount',
      'rateBookSummaryUpdated',
      'rateBookStatus',
      'rateBookLoading',
      'rateBookEmpty',
      'rateBookResults',
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

  function formatDate(value) {
    const raw = asString(value);
    if (!raw) return 'Recently updated';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
      }).format(new Date(raw));
    } catch {
      return raw;
    }
  }

  function formatMoney(value, currency) {
    const numeric = asNumber(value);
    if (numeric === null) return 'To be discussed';
    const code = asString(currency).toUpperCase() || 'GBP';
    try {
      return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(numeric);
    } catch {
      return `${numeric.toFixed(2)} ${escapeHtml(code)}`;
    }
  }

  function hmjTrack(eventType, detail) {
    if (!window.HMJAnalytics || typeof window.HMJAnalytics.track !== 'function') return;
    window.HMJAnalytics.track(eventType, detail || {});
  }

  function setStatus(message, tone) {
    if (!els.rateBookStatus) return;
    if (!message) {
      els.rateBookStatus.hidden = true;
      els.rateBookStatus.textContent = '';
      return;
    }
    els.rateBookStatus.hidden = false;
    els.rateBookStatus.dataset.tone = tone || 'info';
    els.rateBookStatus.textContent = message;
  }

  function updateSettings() {
    const settings = state.settings || {};
    if (els.otherCurrencyMessage) {
      els.otherCurrencyMessage.textContent = asString(settings.otherCurrencyMessage) || 'Other currencies by discussion.';
    }
    if (els.rateBookDisclaimer) {
      els.rateBookDisclaimer.textContent = asString(settings.publicDisclaimer) || els.rateBookDisclaimer.textContent;
    }
    if (els.rateBookPrimaryCta) {
      els.rateBookPrimaryCta.textContent = asString(settings.ctaLabel) || 'Request tailored rates';
      els.rateBookPrimaryCta.href = asString(settings.ctaUrl) || '/clients.html#clientFormTitle';
    }
  }

  function populateSelect(select, values, defaultLabel) {
    if (!select) return;
    const current = select.value;
    const options = [`<option value="">${escapeHtml(defaultLabel)}</option>`];
    values.forEach((item) => {
      options.push(`<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`);
    });
    select.innerHTML = options.join('');
    if (values.includes(current)) select.value = current;
  }

  function populateFilters() {
    const disciplines = Array.from(new Set(state.roles.map((role) => asString(role.discipline)).filter(Boolean))).sort();
    const seniorities = Array.from(new Set(state.roles.map((role) => asString(role.seniority)).filter(Boolean))).sort();
    const currencies = Array.from(new Set(
      state.markets.map((market) => asString(market.currency)).filter(Boolean)
    )).sort();
    const sectors = Array.from(new Set(
      state.roles.flatMap((role) => Array.isArray(role.sector) ? role.sector : []).map((sector) => asString(sector)).filter(Boolean)
    )).sort();

    populateSelect(els.rateBookMarket, state.markets.map((market) => market.code), 'All markets');
    if (els.rateBookMarket) {
      Array.from(els.rateBookMarket.options).forEach((option) => {
        const market = state.markets.find((item) => item.code === option.value);
        if (market) option.textContent = market.name;
      });
    }
    populateSelect(els.rateBookDiscipline, disciplines, 'All disciplines');
    populateSelect(els.rateBookSeniority, seniorities, 'All seniority levels');
    populateSelect(els.rateBookCurrency, currencies, 'All currencies');
    populateSelect(els.rateBookSector, sectors, 'All sectors');
  }

  function readFilters() {
    state.filters.search = asString(els.rateBookSearch && els.rateBookSearch.value).toLowerCase();
    state.filters.market = asString(els.rateBookMarket && els.rateBookMarket.value).toUpperCase();
    state.filters.discipline = asString(els.rateBookDiscipline && els.rateBookDiscipline.value);
    state.filters.seniority = asString(els.rateBookSeniority && els.rateBookSeniority.value);
    state.filters.currency = asString(els.rateBookCurrency && els.rateBookCurrency.value).toUpperCase();
    state.filters.sector = asString(els.rateBookSector && els.rateBookSector.value);
    state.filters.rateType = asString(els.rateBookRateType && els.rateBookRateType.value) || 'charge';
    state.filters.sort = asString(els.rateBookSort && els.rateBookSort.value) || 'alpha';
  }

  function resetFilters() {
    [
      'rateBookSearch',
      'rateBookMarket',
      'rateBookDiscipline',
      'rateBookSeniority',
      'rateBookCurrency',
      'rateBookSector',
      'rateBookRateType',
      'rateBookSort',
    ].forEach((key) => {
      if (!els[key]) return;
      if (key === 'rateBookRateType') els[key].value = 'charge';
      else if (key === 'rateBookSort') els[key].value = 'alpha';
      else els[key].value = '';
    });
    readFilters();
    render();
    scheduleFilterTrack();
  }

  function getVisibleRates(role) {
    const marketRates = Array.isArray(role.marketRates) ? role.marketRates : [];
    return marketRates.filter((rate) => {
      if (state.filters.market && asString(rate.marketCode).toUpperCase() !== state.filters.market) return false;
      if (state.filters.currency && asString(rate.currency).toUpperCase() !== state.filters.currency) return false;
      return true;
    });
  }

  function roleSortMetric(role) {
    const visibleRates = getVisibleRates(role);
    if (!visibleRates.length) return null;
    const key = state.filters.rateType === 'pay' ? 'payRate' : 'chargeRate';
    const values = visibleRates
      .map((rate) => asNumber(rate[key]))
      .filter((value) => value !== null);
    if (!values.length) return null;
    return state.filters.sort === 'highest'
      ? Math.max(...values)
      : Math.min(...values);
  }

  function applyFilters() {
    const items = state.roles.filter((role) => {
      const visibleRates = getVisibleRates(role);
      if (!visibleRates.length) return false;
      if (state.filters.discipline && asString(role.discipline) !== state.filters.discipline) return false;
      if (state.filters.seniority && asString(role.seniority) !== state.filters.seniority) return false;
      if (state.filters.sector) {
        const sectors = Array.isArray(role.sector) ? role.sector : [];
        if (!sectors.includes(state.filters.sector)) return false;
      }
      if (!state.filters.search) return true;
      const haystack = [
        role.name,
        role.discipline,
        role.seniority,
        Array.isArray(role.sector) ? role.sector.join(' ') : '',
        visibleRates.map((rate) => `${rate.marketCode} ${rate.marketName}`).join(' '),
      ].join(' ').toLowerCase();
      return haystack.includes(state.filters.search);
    });

    items.sort((left, right) => {
      if (state.filters.sort === 'alpha') {
        return asString(left.name).localeCompare(asString(right.name), 'en-GB', { sensitivity: 'base' });
      }
      const leftMetric = roleSortMetric(left);
      const rightMetric = roleSortMetric(right);
      if (leftMetric === null && rightMetric === null) {
        return asString(left.name).localeCompare(asString(right.name), 'en-GB', { sensitivity: 'base' });
      }
      if (leftMetric === null) return 1;
      if (rightMetric === null) return -1;
      if (leftMetric === rightMetric) {
        return asString(left.name).localeCompare(asString(right.name), 'en-GB', { sensitivity: 'base' });
      }
      return state.filters.sort === 'highest'
        ? rightMetric - leftMetric
        : leftMetric - rightMetric;
    });

    state.filtered = items;
  }

  function renderSummary() {
    if (els.rateBookSummaryCount) {
      els.rateBookSummaryCount.textContent = `${state.filtered.length} role${state.filtered.length === 1 ? '' : 's'} visible`;
    }
    if (els.rateBookSummaryUpdated) {
      const timestamps = state.filtered
        .map((role) => Date.parse(role.updatedAt || ''))
        .filter((value) => Number.isFinite(value));
      const latest = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : '';
      els.rateBookSummaryUpdated.textContent = latest ? `Last updated ${formatDate(latest)}` : 'Indicative guide rates';
    }
  }

  function renderRate(rate) {
    return `
      <article class="rate-book-rate">
        <strong>${escapeHtml(rate.marketName)}</strong>
        <div class="rate-book-rate__row">
          <span>Pay</span>
          <span>${escapeHtml(formatMoney(rate.payRate, rate.currency))}/hr</span>
        </div>
        <div class="rate-book-rate__row">
          <span>Charge</span>
          <span>${escapeHtml(formatMoney(rate.chargeRate, rate.currency))}/hr</span>
        </div>
      </article>
    `;
  }

  function renderCards() {
    if (!els.rateBookResults || !els.rateBookLoading || !els.rateBookEmpty) return;
    els.rateBookLoading.hidden = true;

    if (!state.filtered.length) {
      els.rateBookResults.hidden = true;
      els.rateBookEmpty.hidden = false;
      return;
    }

    els.rateBookEmpty.hidden = true;
    els.rateBookResults.hidden = false;
    els.rateBookResults.innerHTML = state.filtered.map((role) => {
      const visibleRates = getVisibleRates(role);
      const sectors = Array.isArray(role.sector) ? role.sector : [];
      return `
        <article class="rate-book-card" data-role-slug="${escapeHtml(role.slug)}">
          <div class="rate-book-card__head">
            <div class="rate-book-card__title-wrap">
              <div class="rate-book-card__chips">
                ${role.isFeatured ? '<span class="rate-book-card__chip rate-book-card__chip--featured">Popular</span>' : ''}
                <span class="rate-book-card__chip">${escapeHtml(role.discipline)}</span>
                <span class="rate-book-card__chip">${escapeHtml(role.seniority)}</span>
              </div>
              <h3 class="rate-book-card__title">${escapeHtml(role.name)}</h3>
            </div>
            <div class="rate-book-card__tags">
              ${sectors.map((sector) => `<span class="rate-book-card__tag">${escapeHtml(sector)}</span>`).join('')}
            </div>
          </div>

          <div class="rate-book-card__meta">
            <span>Indicative hourly pay and charge rates across HMJ Global's active UK and European markets.</span>
          </div>

          <div class="rate-book-card__rates">
            ${visibleRates.map(renderRate).join('')}
          </div>

          <div class="rate-book-card__foot">
            <span class="rate-book-card__updated">Last updated ${escapeHtml(formatDate(role.updatedAt))}</span>
            <a class="rate-book-card__cta" href="${escapeHtml(asString(state.settings && state.settings.ctaUrl) || '/clients.html#clientFormTitle')}" data-analytics-event="rate_book_tailored_rates_clicked" data-analytics-label="Role tailored rates: ${escapeHtml(role.name)}">Request tailored rates</a>
          </div>
        </article>
      `;
    }).join('');
  }

  function render() {
    applyFilters();
    renderSummary();
    renderCards();
  }

  function scheduleFilterTrack() {
    window.clearTimeout(state.filterTrackTimer);
    state.filterTrackTimer = window.setTimeout(() => {
      const signature = JSON.stringify({
        ...state.filters,
        count: state.filtered.length,
      });
      if (signature === state.trackedFilterSignature) return;
      state.trackedFilterSignature = signature;
      hmjTrack('rate_book_filter_used', {
        label: state.filters.search || state.filters.market || state.filters.discipline || state.filters.sector || 'general',
        payload: {
          ...state.filters,
          result_count: state.filtered.length,
        },
      });
    }, 500);
  }

  function buildCsv() {
    const header = [
      'role',
      'discipline',
      'seniority',
      'sector',
      'market',
      'currency',
      'pay_rate',
      'charge_rate',
      'last_updated',
    ];
    const lines = [header.join(',')];
    state.filtered.forEach((role) => {
      getVisibleRates(role).forEach((rate) => {
        lines.push([
          role.name,
          role.discipline,
          role.seniority,
          (role.sector || []).join(' | '),
          rate.marketName,
          rate.currency,
          rate.payRate != null ? Number(rate.payRate).toFixed(2) : '',
          rate.chargeRate != null ? Number(rate.chargeRate).toFixed(2) : '',
          role.updatedAt || '',
        ].map((value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`).join(','));
      });
    });
    return lines.join('\n');
  }

  function exportCsv() {
    const blob = new Blob([buildCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement('a');
    link.href = url;
    link.download = 'hmj-global-rate-book.csv';
    doc.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    hmjTrack('rate_book_export_clicked', {
      label: 'Export filtered rate book CSV',
      payload: {
        filters: state.filters,
        result_count: state.filtered.length,
      },
    });
  }

  function printPage() {
    hmjTrack('rate_book_print_clicked', {
      label: 'Print rate book',
      payload: {
        filters: state.filters,
        result_count: state.filtered.length,
      },
    });
    window.print();
  }

  function bindEvents() {
    [
      'rateBookSearch',
      'rateBookMarket',
      'rateBookDiscipline',
      'rateBookSeniority',
      'rateBookCurrency',
      'rateBookSector',
      'rateBookRateType',
      'rateBookSort',
    ].forEach((key) => {
      const element = els[key];
      if (!element) return;
      element.addEventListener('input', () => {
        readFilters();
        render();
        scheduleFilterTrack();
      });
      element.addEventListener('change', () => {
        readFilters();
        render();
        scheduleFilterTrack();
      });
    });

    if (els.rateBookClearFilters) {
      els.rateBookClearFilters.addEventListener('click', resetFilters);
    }
    if (els.rateBookExportBtn) {
      els.rateBookExportBtn.addEventListener('click', exportCsv);
    }
    if (els.rateBookPrintBtn) {
      els.rateBookPrintBtn.addEventListener('click', printPage);
    }
  }

  function initReveal() {
    const nodes = Array.from(doc.querySelectorAll('[data-reveal]'));
    if (!nodes.length) return;
    if (!('IntersectionObserver' in window)) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.18 });
    nodes.forEach((node) => observer.observe(node));
  }

  async function fetchRateBook() {
    const response = await fetch('/.netlify/functions/rate-book-list', {
      headers: {
        accept: 'application/json',
      },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.ok === false) {
      throw new Error(data?.error || `Rate Book request failed with ${response.status}`);
    }
    return data;
  }

  async function init() {
    cacheElements();
    bindEvents();
    initReveal();

    if (els.rateBookLoading) els.rateBookLoading.hidden = false;
    if (els.rateBookResults) els.rateBookResults.hidden = true;
    if (els.rateBookEmpty) els.rateBookEmpty.hidden = true;

    hmjTrack('rate_book_page_viewed', {
      label: 'HMJ Global Rate Book',
    });

    try {
      const payload = await fetchRateBook();
      state.settings = payload.settings || null;
      state.markets = Array.isArray(payload.markets) ? payload.markets : [];
      state.roles = Array.isArray(payload.roles) ? payload.roles : [];
      state.source = asString(payload.source) || 'supabase';
      updateSettings();
      populateFilters();
      readFilters();
      render();

      if (state.source !== 'supabase') {
        setStatus('The Rate Book is showing seeded preview data while the live data source is unavailable.', 'info');
      } else {
        setStatus('', '');
      }
    } catch (error) {
      state.error = error?.message || 'Unable to load the Rate Book right now.';
      if (els.rateBookLoading) els.rateBookLoading.hidden = true;
      if (els.rateBookResults) els.rateBookResults.hidden = true;
      if (els.rateBookEmpty) els.rateBookEmpty.hidden = false;
      if (els.rateBookSummaryCount) els.rateBookSummaryCount.textContent = 'Rate Book unavailable';
      if (els.rateBookSummaryUpdated) els.rateBookSummaryUpdated.textContent = 'Please try again shortly';
      setStatus(state.error, 'error');
    }
  }

  init();
})();
