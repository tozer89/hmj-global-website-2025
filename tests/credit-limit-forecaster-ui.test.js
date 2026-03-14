const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bootForecasterDom() {
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
  window.Admin = {
    bootAdmin(callback) {
      return callback({
        toast: { ok() {}, warn() {}, error() {} },
        identity: async () => ({ email: 'audit@hmj-global.com' }),
        api: async (name) => {
          if (name === 'admin-clients-list') return { rows: [] };
          throw new Error('stubbed');
        },
      });
    },
  };

  window.eval(fs.readFileSync(path.join(process.cwd(), 'lib/credit-limit-forecast.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(process.cwd(), 'lib/credit-limit-statement-import.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(process.cwd(), 'admin/credit-limit-forecaster.js'), 'utf8'));
  await wait(220);
  return dom;
}

test('forecaster UI shows guided progress and direct-mode operational guidance clearly', async () => {
  const dom = await bootForecasterDom();
  const { document, Event } = dom.window;

  assert.match(document.getElementById('setupGuideHost').textContent, /Account setup/i);
  assert.match(document.getElementById('compareSummary').textContent, /No comparison loaded/i);

  document.getElementById('clientName').value = 'Audit Client';
  document.getElementById('creditLimit').value = '600000';
  document.getElementById('currentOutstandingBalance').value = '150000';
  document.getElementById('paymentTermsType').value = '30_eom';
  document.getElementById('growthMode').value = 'direct';
  document.getElementById('growthMode').dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('directScenarioWeeklyGross').value = '9000';
  document.getElementById('directScenarioWeeklyGross').dispatchEvent(new Event('input', { bubbles: true }));

  await wait(520);

  const summaryText = document.getElementById('gptSummaryText').textContent.replace(/\s+/g, ' ').trim();
  const operationalText = document.getElementById('operationalGuidanceHost').textContent.replace(/\s+/g, ' ').trim();
  const stepperText = document.getElementById('setupGuideHost').textContent.replace(/\s+/g, ' ').trim();

  assert.match(summaryText, /weekly uplift/i);
  assert.doesNotMatch(summaryText, /0 additional contractors?/i);
  assert.match(operationalText, /Typical contractor impact|Not inferred/i);
  assert.match(operationalText, /\+1 contractor effect/i);
  assert.match(stepperText, /Review & calculate/i);
});
