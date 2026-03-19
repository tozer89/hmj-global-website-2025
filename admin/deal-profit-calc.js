(function () {
  'use strict';

  var currentModel = null;
  var currentHelpers = null;
  var storageKeys = {
    current: 'hmj.finance.dealProfit.current.v2',
    saved: 'hmj.finance.dealProfit.saved.v2',
  };
  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function trimString(value) {
    return String(value == null ? '' : value).trim();
  }

  function toNumber(value, fallback) {
    var num = Number(value);
    if (Number.isFinite(num)) return num;
    return Number.isFinite(fallback) ? fallback : 0;
  }

  function money(value, currency) {
    var amount = Number(value || 0);
    var code = String(currency || 'GBP').toUpperCase() === 'EUR' ? 'EUR' : 'GBP';
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function percent(value, digits) {
    return ''.concat(Number(value || 0).toLocaleString('en-GB', {
      minimumFractionDigits: Number.isFinite(digits) ? digits : 2,
      maximumFractionDigits: Number.isFinite(digits) ? digits : 2,
    }), '%');
  }

  function plainNumber(value, digits) {
    return Number(value || 0).toLocaleString('en-GB', {
      minimumFractionDigits: Number.isFinite(digits) ? digits : 2,
      maximumFractionDigits: Number.isFinite(digits) ? digits : 2,
    });
  }

  function timeLabel(value) {
    if (!value) return 'Not recorded';
    try {
      return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    } catch (error) {
      return value;
    }
  }

  function defaultScenarioName(input) {
    return trimString(input.dealName || input.clientName || input.candidateLabel || 'New deal scenario');
  }

  function readLocal(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      if (currentHelpers) currentHelpers.toast('Local save failed in this browser.', 'warn', 2400);
    }
  }

  function setup() {
    [
      'gate',
      'app',
      'dealProfitWelcomeMeta',
      'dealProfitStatusChips',
      'heroSelectedNetProfit',
      'heroSelectedNetMeta',
      'heroWeeklyNetProfit',
      'heroWeeklyNetMeta',
      'dealProfitAlerts',
      'dealProfitForm',
      'startDate',
      'durationPreset',
      'customWeeksField',
      'customWeeks',
      'paymentTermsPreset',
      'customPaymentDaysField',
      'customPaymentDays',
      'financeFeeMode',
      'discountFeeLabel',
      'annualInterestFeeField',
      'marginPerHourField',
      'chargeRateOverrideField',
      'showVat',
      'vatRateField',
      'dealMetricList',
      'fundingMetricList',
      'formulaNotesList',
      'dealSummaryGrid',
      'dealBreakdownTable',
      'dealScenarioGrid',
      'savedScenarioList',
      'btnSaveScenario',
      'btnDuplicateScenario',
      'btnExportScenarioCsv',
      'btnPrintScenario',
      'btnResetScenario',
      'btnApplyZodeqPreset',
    ].forEach(function (id) {
      els[id] = $(id);
    });
  }

  function createStatusChip(label, tone) {
    var span = document.createElement('span');
    span.className = 'finance-status';
    if (tone) span.dataset.tone = tone;
    span.textContent = label;
    return span;
  }

  function serialiseForm() {
    var formData = new FormData(els.dealProfitForm);
    var data = {};
    formData.forEach(function (value, key) {
      data[key] = value;
    });
    data.showVat = data.showVat === 'true';
    return data;
  }

  function syncForm(input) {
    var scenario = window.HMJDealProfitCalc.normaliseInput(input);
    Object.keys(scenario).forEach(function (key) {
      var field = els.dealProfitForm.elements[key];
      if (!field) return;
      if (field.type === 'radio') return;
      if (field.tagName === 'SELECT') {
        field.value = String(scenario[key]);
        return;
      }
      field.value = scenario[key];
    });
    var radio = els.dealProfitForm.querySelector('input[name="marginMode"][value="' + scenario.marginMode + '"]');
    if (radio) radio.checked = true;
    els.showVat.value = scenario.showVat ? 'true' : 'false';
    syncConditionalFields();
  }

  function syncConditionalFields() {
    var marginMode = trimString(els.dealProfitForm.elements.marginMode.value);
    var durationPreset = trimString(els.durationPreset.value);
    var paymentPreset = trimString(els.paymentTermsPreset.value);
    var financeFeeMode = trimString(els.financeFeeMode.value);
    var showVat = trimString(els.showVat.value) === 'true';

    els.marginPerHourField.hidden = marginMode !== 'margin_per_hour';
    els.chargeRateOverrideField.hidden = marginMode !== 'charge_rate_override';
    els.marginPerHourField.querySelector('input').disabled = marginMode !== 'margin_per_hour';
    els.chargeRateOverrideField.querySelector('input').disabled = marginMode !== 'charge_rate_override';

    els.customWeeksField.hidden = durationPreset !== 'custom';
    els.customWeeks.disabled = durationPreset !== 'custom';

    els.customPaymentDaysField.hidden = paymentPreset !== 'custom';
    els.customPaymentDays.disabled = paymentPreset !== 'custom';

    els.annualInterestFeeField.hidden = financeFeeMode === 'bundled_invoice_fee';
    els.annualInterestFeeField.querySelector('input').disabled = financeFeeMode === 'bundled_invoice_fee';
    els.discountFeeLabel.textContent = financeFeeMode === 'bundled_invoice_fee'
      ? 'Bundled service fee % of gross invoice'
      : 'Annual discounting fee %';

    els.vatRateField.hidden = !showVat;
    els.vatRateField.querySelector('input').disabled = !showVat;
  }

  function renderStatusChips(model) {
    els.dealProfitStatusChips.innerHTML = '';
    [
      createStatusChip('Internal estimate only', 'warn'),
      createStatusChip(model.input.currency, 'ok'),
      createStatusChip(model.input.workerCount + ' worker' + (model.input.workerCount === 1 ? '' : 's'), 'ok'),
      createStatusChip(model.input.paymentTermsLabel, model.input.paymentDays > 45 ? 'warn' : 'ok'),
      createStatusChip('Starts ' + model.input.startDate, 'ok'),
      createStatusChip(model.selectedPeriod.label, 'ok'),
    ].forEach(function (chip) {
      els.dealProfitStatusChips.appendChild(chip);
    });
  }

  function renderAlerts(model) {
    els.dealProfitAlerts.innerHTML = '';
    var alerts = model.warnings.slice();
    alerts.push({
      tone: 'warn',
      text: 'Use as an internal commercial estimate only. Finance cost and corporation tax treatment can vary by lender mechanics, entity structure, and final assignment terms.',
    });
    alerts.forEach(function (item) {
      var alert = document.createElement('div');
      alert.className = 'finance-alert';
      alert.dataset.tone = item.tone || 'warn';
      alert.textContent = item.text;
      els.dealProfitAlerts.appendChild(alert);
    });
  }

  function renderHero(model) {
    els.heroSelectedNetProfit.textContent = money(model.selectedPeriod.netProfit, model.input.currency);
    els.heroSelectedNetMeta.textContent = model.selectedPeriod.label + ' horizon • ' + plainNumber(model.selectedPeriod.weeks, 2) + ' weeks • starts ' + model.input.startDate + ' • avg ' + plainNumber(model.selectedPeriod.daysOutstanding, 2) + ' days outstanding';
    els.heroWeeklyNetProfit.textContent = money(model.periodMap.week.netProfit, model.input.currency);
    els.heroWeeklyNetMeta.textContent = 'Charge ' + money(model.chargeRate, model.input.currency) + '/hr • net margin ' + percent(model.metrics.netMarginPercent, 2);
  }

  function renderMetricLists(model) {
    els.dealMetricList.innerHTML = [
      {
        label: 'Charge rate',
        value: money(model.chargeRate, model.input.currency) + ' / hr',
        detail: 'Implied margin ' + money(model.impliedMarginPerHour, model.input.currency) + ' per hour',
      },
      {
        label: 'Gross margin %',
        value: percent(model.metrics.grossMarginPercent, 2),
        detail: 'Weekly gross margin against client charge',
      },
      {
        label: 'Net margin %',
        value: percent(model.metrics.netMarginPercent, 2),
        detail: 'Selected horizon net profit against revenue',
      },
      {
        label: 'Break-even margin / hr before tax',
        value: money(model.metrics.breakEvenMarginPerHourBeforeTax, model.input.currency),
        detail: 'Covers finance drag and overhead only',
      },
      {
        label: 'Break-even margin / hr after tax assumption',
        value: money(model.metrics.breakEvenMarginPerHourAfterTax, model.input.currency),
        detail: 'Grossed-up margin target using the current tax assumption',
      },
    ].map(function (item) {
      return (
        '<div class="deal-metric">' +
          '<strong>' + escapeHtml(item.value) + '</strong>' +
          '<span>' + escapeHtml(item.label) + '</span>' +
          '<span>' + escapeHtml(item.detail) + '</span>' +
        '</div>'
      );
    }).join('');

    var fundingRows = [
      {
        label: 'Gross invoice value',
        value: money(model.funding.grossInvoiceValue, model.input.currency),
        detail: 'Selected contract gross billable value',
      },
      {
        label: 'Funded amount',
        value: money(model.funding.fundedAmount, model.input.currency),
        detail: plainNumber(model.input.fundingAdvancePercent, 2) + '% advance assumption',
      },
      {
        label: 'Reserve retained',
        value: money(model.funding.reserveRetained, model.input.currency),
        detail: 'Held back until settlement clears',
      },
      {
        label: 'Total finance cost',
        value: money(model.funding.totalFinanceCost, model.input.currency),
        detail: model.input.financeFeeMode === 'bundled_invoice_fee'
          ? 'Bundled fee model across assigned invoices'
          : 'Discounting + interest across current payment terms',
      },
      {
        label: 'Net cash released after fees',
        value: money(model.funding.netCashReleasedAfterFees, model.input.currency),
        detail: 'Advance less finance cost',
      },
    ];
    if (model.input.showVat) {
      fundingRows.push({
        label: 'Illustrative VAT',
        value: money(model.selectedPeriod.vatAmount, model.input.currency),
        detail: 'Displayed only. Profit remains net of VAT.',
      });
    }

    els.fundingMetricList.innerHTML = fundingRows.map(function (item) {
      return (
        '<div class="deal-metric">' +
          '<strong>' + escapeHtml(item.value) + '</strong>' +
          '<span>' + escapeHtml(item.label) + '</span>' +
          '<span>' + escapeHtml(item.detail) + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function renderFormulaNotes(model) {
    var notes = model.input.financeFeeMode === 'bundled_invoice_fee'
      ? [
          ['Bundled service fee', 'Gross invoice value × bundled fee %. This aligns more closely with the signed Zodeq offer letter wording.'],
          ['Interest fee', 'Not applied in bundled mode unless you switch back to annualised split fees.'],
          ['Net profit', 'Gross margin less finance cost, overhead, and estimated corporation tax on positive profit only.'],
        ]
      : [
          ['Discount fee', 'Invoice value × annual discounting fee × (days outstanding ÷ 365), summed per weekly invoice.'],
          ['Interest fee', 'Funded amount × annual interest fee × (days outstanding ÷ 365), summed per weekly invoice.'],
          ['Net profit', 'Gross margin less finance cost, overhead, and estimated corporation tax on positive profit only.'],
        ];

    els.formulaNotesList.innerHTML = notes.map(function (item) {
      return (
        '<div class="finance-list-item">' +
          '<strong>' + escapeHtml(item[0]) + '</strong>' +
          '<small>' + escapeHtml(item[1]) + '</small>' +
        '</div>'
      );
    }).join('');
  }

  function renderSummaryCards(model) {
    var cards = [
      ['Charge rate', money(model.chargeRate, model.input.currency) + ' / hr', 'Current charge to client based on mode selection.'],
      ['Weekly gross margin', money(model.periodMap.week.grossMargin, model.input.currency), 'Gross margin before finance, overhead, and tax.'],
      ['Weekly finance cost', money(model.periodMap.week.totalFinanceCost, model.input.currency), model.input.financeFeeMode === 'bundled_invoice_fee' ? 'Bundled fee on the weekly invoice value.' : 'Discounting plus annualised interest on the weekly invoice.'],
      ['Weekly net profit', money(model.periodMap.week.netProfit, model.input.currency), 'Estimated weekly profit after finance, overhead, and tax.'],
      ['1 month net profit', money(model.periodMap.month.netProfit, model.input.currency), 'Using 52/12 weeks for one month.'],
      ['3 month net profit', money(model.periodMap.quarter.netProfit, model.input.currency), 'Using 13 weeks.'],
      ['6 month net profit', money(model.periodMap.half_year.netProfit, model.input.currency), 'Using 26 weeks.'],
    ];

    els.dealSummaryGrid.innerHTML = cards.map(function (card) {
      return (
        '<article class="finance-stat">' +
          '<span class="finance-kicker">' + escapeHtml(card[0]) + '</span>' +
          '<strong>' + escapeHtml(card[1]) + '</strong>' +
          '<span>' + escapeHtml(card[2]) + '</span>' +
        '</article>'
      );
    }).join('');
  }

  function renderBreakdownTable(model) {
    var header = [
      'Period',
      'Revenue / charge to client',
      'Pay cost',
      'Gross margin',
      'Discount fee',
      'Interest fee',
      'Total finance cost',
      'Overheads',
      'Profit before tax',
      'Tax',
      'Net profit',
    ];

    var rows = model.periods.map(function (row) {
      if (model.input.durationPreset !== 'custom' && row.key === model.selectedPeriod.key) {
        return Object.assign({}, row, {
          label: row.label + ' (selected contract)',
        });
      }
      return row;
    });
    if (model.input.durationPreset === 'custom') {
      rows.push(Object.assign({}, model.selectedPeriod, {
        key: 'selected',
        label: 'Selected contract',
      }));
    }

    var body = rows.map(function (row) {
      var mainRow = (
        '<tr>' +
          '<td><strong>' + escapeHtml(row.label) + '</strong><div class="deal-inline-note">' + escapeHtml(plainNumber(row.weeks, 2) + ' weeks • ' + plainNumber(row.daysOutstanding, 2) + ' avg days outstanding • ' + row.paymentTermsLabel) + '</div></td>' +
          '<td>' + escapeHtml(money(row.revenue, model.input.currency)) + '</td>' +
          '<td>' + escapeHtml(money(row.payCost, model.input.currency)) + '</td>' +
          '<td>' + escapeHtml(money(row.grossMargin, model.input.currency)) + '</td>' +
          '<td>' + escapeHtml(money(row.discountFee, model.input.currency)) + '</td>' +
          '<td>' + escapeHtml(money(row.interestFee, model.input.currency)) + '</td>' +
          '<td>' + escapeHtml(money(row.totalFinanceCost, model.input.currency)) + '</td>' +
          '<td>' + escapeHtml(money(row.overheads, model.input.currency)) + '</td>' +
          '<td>' + escapeHtml(money(row.profitBeforeTax, model.input.currency)) + '</td>' +
          '<td>' + escapeHtml(money(row.tax, model.input.currency)) + '</td>' +
          '<td><strong>' + escapeHtml(money(row.netProfit, model.input.currency)) + '</strong></td>' +
        '</tr>'
      );
      if (!model.input.showVat) return mainRow;
      return mainRow + (
        '<tr>' +
          '<td colspan="11" class="deal-inline-note">Illustrative VAT at ' + escapeHtml(percent(model.input.vatRatePercent, 2)) + ': ' + escapeHtml(money(row.vatAmount, model.input.currency)) + ' — shown for visibility only and excluded from profitability.</td>' +
        '</tr>'
      );
    }).join('');

    els.dealBreakdownTable.innerHTML = (
      '<thead><tr>' + header.map(function (item) {
        return '<th>' + escapeHtml(item) + '</th>';
      }).join('') + '</tr></thead>' +
      '<tbody>' + body + '</tbody>'
    );
  }

  function renderScenarioComparison(model) {
    var scenarios = window.HMJDealProfitCalc.buildScenarioComparison(model.input);
    els.dealScenarioGrid.innerHTML = scenarios.map(function (scenario) {
      var tone = 'ok';
      if (scenario.selectedPeriod.netProfit < 0) tone = 'danger';
      else if (scenario.selectedPeriod.totalFinanceCost > scenario.selectedPeriod.grossMargin) tone = 'warn';
      return (
        '<article class="finance-card deal-scenario-card">' +
          '<div class="deal-scenario-card__meta">' +
            '<span class="finance-status" data-tone="' + tone + '">' + escapeHtml(scenario.label) + '</span>' +
            '<span class="finance-chip">' + escapeHtml(scenario.selectedPeriod.label) + '</span>' +
          '</div>' +
          '<p>' + escapeHtml(scenario.note) + '</p>' +
          '<div class="deal-scenario-card__grid">' +
            '<div class="deal-scenario-metric"><strong>' + escapeHtml(money(scenario.selectedPeriod.netProfit, model.input.currency)) + '</strong><span>Net profit</span></div>' +
            '<div class="deal-scenario-metric"><strong>' + escapeHtml(money(scenario.selectedPeriod.totalFinanceCost, model.input.currency)) + '</strong><span>Finance cost</span></div>' +
            '<div class="deal-scenario-metric"><strong>' + escapeHtml(money(scenario.weekly.netProfit, model.input.currency)) + '</strong><span>Weekly net</span></div>' +
            '<div class="deal-scenario-metric"><strong>' + escapeHtml(percent(scenario.metrics.netMarginPercent, 2)) + '</strong><span>Net margin %</span></div>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  }

  function readSavedScenarios() {
    var rows = readLocal(storageKeys.saved, []);
    return Array.isArray(rows) ? rows : [];
  }

  function writeSavedScenarios(rows) {
    writeLocal(storageKeys.saved, rows);
  }

  function renderSavedScenarios(model) {
    var rows = readSavedScenarios();
    if (!rows.length) {
      els.savedScenarioList.innerHTML = '<div class="finance-empty">No saved pricing scenarios yet. Use save or duplicate to keep a local short-list.</div>';
      return;
    }
    els.savedScenarioList.innerHTML = rows.map(function (row) {
      var label = defaultScenarioName(row.input || {});
      var summary = window.HMJDealProfitCalc.calculateDealProfit(row.input || {}).selectedPeriod;
      return (
        '<div class="finance-list-item deal-saved-item">' +
          '<strong>' + escapeHtml(label) + '</strong>' +
          '<small>' + escapeHtml(timeLabel(row.savedAt)) + '</small>' +
          '<div class="deal-saved-item__summary">' +
            escapeHtml((row.input && row.input.clientName ? row.input.clientName + ' • ' : '') + money(summary.netProfit, (row.input && row.input.currency) || 'GBP') + ' net profit • ' + summary.label) +
          '</div>' +
          '<div class="deal-saved-item__actions">' +
            '<button class="finance-btn finance-btn--soft" type="button" data-load-scenario="' + escapeHtml(row.id) + '">Load</button>' +
            '<button class="finance-btn finance-btn--ghost" type="button" data-delete-scenario="' + escapeHtml(row.id) + '">Delete</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    els.savedScenarioList.querySelectorAll('[data-load-scenario]').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = button.getAttribute('data-load-scenario');
        var rows = readSavedScenarios();
        var match = rows.find(function (item) { return item.id === id; });
        if (!match) return;
        syncForm(match.input || {});
        recalc();
        currentHelpers.toast('Saved scenario loaded.', 'ok', 2200);
      });
    });
    els.savedScenarioList.querySelectorAll('[data-delete-scenario]').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = button.getAttribute('data-delete-scenario');
        writeSavedScenarios(readSavedScenarios().filter(function (item) { return item.id !== id; }));
        renderSavedScenarios(model);
        currentHelpers.toast('Saved scenario removed.', 'ok', 2200);
      });
    });
  }

  function persistCurrentScenario(input) {
    writeLocal(storageKeys.current, input);
  }

  function recalc(skipPersist) {
    syncConditionalFields();
    currentModel = window.HMJDealProfitCalc.calculateDealProfit(serialiseForm());
    renderStatusChips(currentModel);
    renderAlerts(currentModel);
    renderHero(currentModel);
    renderMetricLists(currentModel);
    renderFormulaNotes(currentModel);
    renderSummaryCards(currentModel);
    renderBreakdownTable(currentModel);
    renderScenarioComparison(currentModel);
    renderSavedScenarios(currentModel);
    if (!skipPersist) persistCurrentScenario(currentModel.input);
  }

  function saveScenario(asDuplicate) {
    var input = currentModel ? currentModel.input : window.HMJDealProfitCalc.normaliseInput(serialiseForm());
    var rows = readSavedScenarios();
    var label = defaultScenarioName(input);
    var scenario = {
      id: 'scenario-' + Date.now(),
      savedAt: new Date().toISOString(),
      input: Object.assign({}, input),
    };
    if (asDuplicate) {
      scenario.input = Object.assign({}, input, {
        dealName: label + ' (Copy)',
      });
    }
    rows.unshift(scenario);
    writeSavedScenarios(rows.slice(0, 12));
    renderSavedScenarios(currentModel);
    currentHelpers.toast(asDuplicate ? 'Scenario duplicated locally.' : 'Scenario saved locally.', 'ok', 2400);
  }

  function resetScenario() {
    syncForm(window.HMJDealProfitCalc.DEFAULT_INPUT);
    recalc();
    currentHelpers.toast('Calculator reset to default assumptions.', 'ok', 2200);
  }

  function exportCsv() {
    var rows = [
      ['Deal Profit Calc export'],
      ['Deal name', currentModel.input.dealName],
      ['Candidate', currentModel.input.candidateLabel],
      ['Client', currentModel.input.clientName],
      ['Start date', currentModel.input.startDate],
      ['Currency', currentModel.input.currency],
      ['Worker count', currentModel.input.workerCount],
      ['Hours per week', currentModel.input.hoursPerWeek],
      ['Charge rate', currentModel.chargeRate],
      ['Payment terms', currentModel.input.paymentTermsLabel],
      ['Representative days outstanding', currentModel.input.paymentDays],
      ['Finance fee model', currentModel.input.financeFeeMode],
      [],
      ['Period', 'Weeks', 'Revenue', 'Pay cost', 'Gross margin', 'Discount fee', 'Interest fee', 'Total finance cost', 'Overheads', 'Profit before tax', 'Tax', 'Net profit'],
    ];

    var exportPeriods = currentModel.periods.slice();
    if (currentModel.input.durationPreset === 'custom') {
      exportPeriods.push({
        key: 'selected_summary',
        label: 'Selected contract',
        weeks: currentModel.selectedPeriod.weeks,
        revenue: currentModel.selectedPeriod.revenue,
        payCost: currentModel.selectedPeriod.payCost,
        grossMargin: currentModel.selectedPeriod.grossMargin,
        discountFee: currentModel.selectedPeriod.discountFee,
        interestFee: currentModel.selectedPeriod.interestFee,
        totalFinanceCost: currentModel.selectedPeriod.totalFinanceCost,
        overheads: currentModel.selectedPeriod.overheads,
        profitBeforeTax: currentModel.selectedPeriod.profitBeforeTax,
        tax: currentModel.selectedPeriod.tax,
        netProfit: currentModel.selectedPeriod.netProfit,
      });
    }

    exportPeriods.forEach(function (period) {
      rows.push([
        period.label,
        period.weeks,
        period.revenue,
        period.payCost,
        period.grossMargin,
        period.discountFee,
        period.interestFee,
        period.totalFinanceCost,
        period.overheads,
        period.profitBeforeTax,
        period.tax,
        period.netProfit,
      ]);
    });

    var csv = rows.map(function (cols) {
      return cols.map(function (value) {
        return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\n');

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'deal-profit-calc-' + Date.now() + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function bindFormEvents() {
    els.dealProfitForm.addEventListener('input', function () {
      recalc();
    });
    els.dealProfitForm.addEventListener('change', function () {
      recalc();
    });

    els.btnSaveScenario.addEventListener('click', function () { saveScenario(false); });
    els.btnDuplicateScenario.addEventListener('click', function () { saveScenario(true); });
    els.btnExportScenarioCsv.addEventListener('click', function () {
      exportCsv();
      currentHelpers.toast('CSV export downloaded.', 'ok', 2200);
    });
    els.btnPrintScenario.addEventListener('click', function () { window.print(); });
    els.btnResetScenario.addEventListener('click', function () { resetScenario(); });
    els.btnApplyZodeqPreset.addEventListener('click', function () {
      syncForm(window.HMJDealProfitCalc.applyZodeqOfferPreset(serialiseForm()));
      recalc();
      currentHelpers.toast('Zodeq offer assumptions applied.', 'ok', 2400);
    });
  }

  function loadInitialState() {
    var stored = readLocal(storageKeys.current, window.HMJDealProfitCalc.DEFAULT_INPUT);
    syncForm(stored || window.HMJDealProfitCalc.DEFAULT_INPUT);
    recalc(true);
  }

  function boot() {
    if (!window.Admin || typeof window.Admin.bootAdmin !== 'function' || !window.HMJDealProfitCalc) {
      window.setTimeout(boot, 40);
      return;
    }
    setup();
    window.Admin.bootAdmin(async function (helpers) {
      currentHelpers = helpers;
      var who = await helpers.identity('admin').catch(function () { return null; });
      if (!who || !who.ok) {
        if (els.app) els.app.style.display = 'none';
        if (els.gate) els.gate.style.display = '';
        return;
      }
      if (els.gate) els.gate.style.display = 'none';
      if (els.app) els.app.style.display = '';
      els.dealProfitWelcomeMeta.textContent = 'Signed in as ' + (who.email || 'admin user');
      bindFormEvents();
      loadInitialState();
    });
  }

  boot();
}());
