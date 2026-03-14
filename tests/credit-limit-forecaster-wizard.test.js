const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const statementImport = require('../lib/credit-limit-statement-import.js');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bootForecasterDom(options = {}) {
  const html = fs.readFileSync(path.join(process.cwd(), 'admin/credit-limit-forecaster.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://example.com/admin/credit-limit-forecaster.html',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.console = console;
  window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.URL.createObjectURL = () => 'blob:test';
  window.URL.revokeObjectURL = () => {};
  window.print = () => {};
  window.Blob = global.Blob;
  window.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

  const apiHandlers = options.apiHandlers || {};
  window.Admin = {
    bootAdmin(callback) {
      return callback({
        toast: { ok() {}, warn() {}, error() {} },
        identity: async () => ({ email: 'wizard@hmj-global.com' }),
        api: async (name, method, payload) => {
          if (name === 'admin-clients-list') return { rows: [] };
          if (apiHandlers[name]) return apiHandlers[name](payload, method);
          throw new Error('stubbed');
        },
      });
    },
  };

  window.eval(fs.readFileSync(path.join(process.cwd(), 'lib/credit-limit-forecast.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(process.cwd(), 'lib/credit-limit-statement-import.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(process.cwd(), 'admin/credit-limit-forecaster.js'), 'utf8'));
  await wait(240);
  return dom;
}

function click(window, selector) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Missing element for selector ${selector}`);
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return element;
}

function setValue(window, selector, value) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `Missing element for selector ${selector}`);
  element.value = value;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
  element.dispatchEvent(new window.Event('change', { bubbles: true }));
  return element;
}

function setFiles(window, selector, files) {
  const input = window.document.querySelector(selector);
  assert.ok(input, `Missing element for selector ${selector}`);
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: files,
  });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

async function runBasicWizard(window) {
  click(window, '#btnUseWizard');
  await wait(40);
  click(window, '[data-wizard-choice-type="mode"][data-wizard-choice-value="basic"]');
  await wait(20);
  setValue(window, '[data-wizard-field="clientName"]', 'Wizard Client');
  setValue(window, '[data-wizard-field="creditLimit"]', '500000');
  setValue(window, '[data-wizard-field="currentOutstandingBalance"]', '120000');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-opening-mode="no_receipts"]');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  setValue(window, '[data-wizard-field="contractor.currentContractors"]', '16');
  setValue(window, '[data-wizard-field="contractor.additionalContractors"]', '3');
  setValue(window, '[data-wizard-field="contractor.weeklyPayPerContractor"]', '1400');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(160);
}

test('wizard basic path populates the live form and runs the forecast', async () => {
  const dom = await bootForecasterDom();
  const { window } = dom;

  await runBasicWizard(window);

  const doc = window.document;
  assert.equal(doc.getElementById('clientName').value, 'Wizard Client');
  assert.equal(doc.getElementById('creditLimit').value, '500000');
  assert.equal(doc.getElementById('currentContractors').value, '16');
  assert.equal(doc.getElementById('additionalContractors').value, '3');
  assert.equal(doc.getElementById('openingBalanceReceiptMode').value, 'no_receipts');
  assert.match(doc.getElementById('wizardStateChip').textContent, /Populated by wizard/i);
  assert.match(doc.getElementById('resultsMeta').textContent, /Wizard Client/i);
  assert.match(doc.getElementById('validationHost').textContent, /No receipt schedule has been applied to the opening balance/i);
});

test('wizard PDF import path reviews rows and applies imported opening-balance treatment', async () => {
  const importedDraft = statementImport.materialiseImportedStatement({
    sourceType: 'pdf',
    fileName: 'debtor-statement.pdf',
    parseMethod: 'table_headers',
    confidence: 'high',
    rows: [
      { invoiceRef: 'INV-1001', invoiceDate: '2026-01-05', dueDate: '2026-01-19', outstandingAmount: 24000, currency: 'GBP' },
      { invoiceRef: 'INV-1002', invoiceDate: '2026-01-12', dueDate: '2026-01-26', outstandingAmount: 16000, currency: 'GBP' },
    ],
  }, {
    scenarioCurrency: 'GBP',
    forecastStartDate: '2026-01-05',
    paymentTerms: { type: '14_net', customNetDays: 21, receiptLagDays: 0 },
  });

  const dom = await bootForecasterDom({
    apiHandlers: {
      'admin-credit-limit-statement-parse': async () => ({
        ok: true,
        statement: importedDraft,
        warnings: [],
        aiAssistAvailable: true,
        aiAssistUsed: false,
      }),
    },
  });
  const { window } = dom;

  click(window, '#btnUseWizard');
  await wait(40);
  click(window, '[data-wizard-choice-type="mode"][data-wizard-choice-value="advanced"]');
  await wait(20);
  setValue(window, '[data-wizard-field="clientName"]', 'Import Client');
  setValue(window, '[data-wizard-field="creditLimit"]', '450000');
  setValue(window, '[data-wizard-field="currentOutstandingBalance"]', '50000');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-opening-mode="import_statement"]');
  click(window, '[data-wizard-action="next"]');
  await wait(20);

  const file = new window.File(['pdf-body'], 'debtor-statement.pdf', { type: 'application/pdf' });
  setFiles(window, '#wizardStatementUploadInput', [file]);
  await wait(140);
  assert.equal(window.document.querySelector('[data-wizard-import-row-index="0"][data-wizard-import-key="invoiceRef"]').value, 'INV-1001');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-choice-type="growth-mode"][data-wizard-choice-value="direct"]');
  setValue(window, '[data-wizard-action="set-direct-value"]', '9000');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(180);

  const doc = window.document;
  assert.equal(doc.getElementById('openingBalanceReceiptMode').value, 'import_statement');
  assert.match(doc.getElementById('openingBalancePreview').textContent, /Imported statement/i);
  assert.match(doc.getElementById('cashTimingHost').textContent, /Imported statement • INV-1001/i);
});

test('wizard weak PDF path offers AI fallback and can still complete if import is abandoned', async () => {
  let parseCalls = 0;
  const aiDraft = statementImport.materialiseImportedStatement({
    sourceType: 'pdf',
    fileName: 'weak.pdf',
    parseMethod: 'ai_assisted_json',
    confidence: 'medium',
    rows: [
      { invoiceRef: 'INV-AI-1', invoiceDate: '2026-01-05', dueDate: '2026-01-12', outstandingAmount: 12000, currency: 'GBP' },
    ],
  }, {
    scenarioCurrency: 'GBP',
    forecastStartDate: '2026-01-05',
    paymentTerms: { type: '14_net', customNetDays: 21, receiptLagDays: 0 },
  });

  const dom = await bootForecasterDom({
    apiHandlers: {
      'admin-credit-limit-statement-parse': async (payload) => {
        parseCalls += 1;
        if (payload.preferAiAssist) {
          return {
            ok: true,
            statement: aiDraft,
            warnings: [],
            aiAssistAvailable: true,
            aiAssistUsed: true,
          };
        }
        return {
          ok: false,
          warnings: ['This file could not be read confidently.'],
          aiAssistAvailable: true,
          aiAssistUsed: false,
          fallbackOptions: ['Upload Excel/CSV instead', 'Continue with manual opening-balance receipts'],
        };
      },
    },
  });
  const { window } = dom;

  click(window, '#btnUseWizard');
  await wait(40);
  click(window, '[data-wizard-choice-type="mode"][data-wizard-choice-value="advanced"]');
  setValue(window, '[data-wizard-field="clientName"]', 'Fallback Client');
  setValue(window, '[data-wizard-field="creditLimit"]', '300000');
  setValue(window, '[data-wizard-field="currentOutstandingBalance"]', '90000');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-opening-mode="import_statement"]');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  setFiles(window, '#wizardStatementUploadInput', [new window.File(['weak'], 'weak.pdf', { type: 'application/pdf' })]);
  await wait(120);
  assert.match(window.document.getElementById('wizardStepHost').textContent, /could not read this statement confidently/i);
  click(window, '[data-wizard-action="try-ai-import"]');
  await wait(140);
  assert.equal(window.document.querySelector('[data-wizard-import-row-index="0"][data-wizard-import-key="invoiceRef"]').value, 'INV-AI-1');
  assert.equal(parseCalls, 2);

  click(window, '[data-wizard-action="close"]');
  await wait(20);
  click(window, '#btnUseWizard');
  await wait(40);
  click(window, '[data-wizard-choice-type="mode"][data-wizard-choice-value="basic"]');
  setValue(window, '[data-wizard-field="clientName"]', 'Fallback Client');
  setValue(window, '[data-wizard-field="creditLimit"]', '300000');
  setValue(window, '[data-wizard-field="currentOutstandingBalance"]', '90000');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-opening-mode="import_statement"]');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  setFiles(window, '#wizardStatementUploadInput', [new window.File(['weak'], 'weak.pdf', { type: 'application/pdf' })]);
  await wait(120);
  click(window, '[data-wizard-fallback="no_receipts"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  setValue(window, '[data-wizard-field="contractor.currentContractors"]', '8');
  setValue(window, '[data-wizard-field="contractor.additionalContractors"]', '2');
  setValue(window, '[data-wizard-field="contractor.weeklyPayPerContractor"]', '1250');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(160);

  assert.equal(window.document.getElementById('openingBalanceReceiptMode').value, 'no_receipts');
  assert.match(window.document.getElementById('resultsMeta').textContent, /Fallback Client/i);
});

test('wizard direct weekly uplift path populates only the direct uplift fields', async () => {
  const dom = await bootForecasterDom();
  const { window } = dom;

  click(window, '#btnUseWizard');
  await wait(40);
  click(window, '[data-wizard-choice-type="mode"][data-wizard-choice-value="basic"]');
  setValue(window, '[data-wizard-field="clientName"]', 'Direct Client');
  setValue(window, '[data-wizard-field="creditLimit"]', '650000');
  setValue(window, '[data-wizard-field="currentOutstandingBalance"]', '110000');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-opening-mode="no_receipts"]');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-choice-type="growth-mode"][data-wizard-choice-value="direct"]');
  click(window, '[data-wizard-action="set-direct-basis"][data-value="gross"]');
  setValue(window, '[data-wizard-action="set-direct-value"]', '12000');
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(20);
  click(window, '[data-wizard-action="next"]');
  await wait(180);

  const doc = window.document;
  assert.equal(doc.getElementById('growthMode').value, 'direct');
  assert.equal(doc.getElementById('directScenarioWeeklyGross').value, '12000');
  assert.equal(doc.getElementById('directBaseWeeklyGross').value, '0');
  assert.match(doc.getElementById('activeDriverLabel').textContent, /Direct weekly uplift/i);
});

test('wizard reopens with the active scenario answers preloaded', async () => {
  const dom = await bootForecasterDom();
  const { window } = dom;

  await runBasicWizard(window);
  click(window, '#btnUseWizard');
  await wait(60);

  assert.match(window.document.getElementById('wizardTitle').textContent, /Set up this forecast with the wizard/i);
  click(window, '[data-wizard-choice-type="mode"][data-wizard-choice-value="basic"]');
  await wait(20);
  assert.equal(window.document.querySelector('[data-wizard-field="clientName"]').value, 'Wizard Client');
  assert.equal(window.document.querySelector('[data-wizard-field="creditLimit"]').value, '500000');
  assert.equal(window.document.querySelector('[data-wizard-field="currentOutstandingBalance"]').value, '120000');
});

test('wizard locks the background, keeps the footer visible, and resets body scroll on step transitions', async () => {
  const dom = await bootForecasterDom();
  const { window } = dom;
  const doc = window.document;

  click(window, '#btnUseWizard');
  await wait(60);
  assert.equal(doc.body.classList.contains('clf-modal-open'), true);
  assert.ok(doc.getElementById('wizardActionsHost').textContent.includes('Continue'));

  click(window, '[data-wizard-choice-type="mode"][data-wizard-choice-value="basic"]');
  await wait(40);
  assert.equal(doc.activeElement, doc.querySelector('[data-wizard-field="clientName"]'));

  const scrollShell = doc.getElementById('wizardBodyShell');
  scrollShell.scrollTop = 260;
  click(window, '[data-wizard-action="next"]');
  await wait(40);
  assert.equal(scrollShell.scrollTop, 0);
  assert.equal(doc.activeElement.closest('#wizardDialog') != null, true);

  click(window, '[data-wizard-action="close"]');
  await wait(40);
  assert.equal(doc.body.classList.contains('clf-modal-open'), false);
});
