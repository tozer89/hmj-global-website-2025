'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

test('finance landing page exposes finance hub modules and QBO actions', () => {
  const html = read('admin/finance/index.html');
  assert.match(html, /Open 13 week cashflow/i);
  assert.match(html, /Deal Profit Calc/i);
  assert.match(html, /QuickBooks connection/i);
  assert.match(html, /Credit limit forecaster/i);
  assert.match(html, /id="btnSyncFinanceQbo"/);
});

test('cashflow page includes assumptions forms and table placeholders', () => {
  const html = read('admin/finance/cashflow.html');
  assert.match(html, /id="assumptionsForm"/);
  assert.match(html, /id="invoicePlanForm"/);
  assert.match(html, /id="overheadForm"/);
  assert.match(html, /id="cashflowTable"/);
  assert.match(html, /id="weekDetailList"/);
  assert.match(html, /id="cashflowPresetStrip"/);
  assert.match(html, /id="cashBalanceChart"/);
  assert.match(html, /id="cashflowCommentary"/);
  assert.match(html, /id="cashflowExposure"/);
});

test('quickbooks page includes connect, sync, and disconnect controls', () => {
  const html = read('admin/finance/quickbooks.html');
  assert.match(html, /id="btnConnectQbo"/);
  assert.match(html, /id="btnSyncQbo"/);
  assert.match(html, /id="btnDisconnectQbo"/);
  assert.match(html, /id="qboConnectionList"/);
  assert.match(html, /id="qboRuntimeList"/);
  assert.match(html, /id="qboWhitelistValue"/);
  assert.match(html, /id="qboConnectUrlValue"/);
  assert.match(html, /id="qboDisconnectUrlValue"/);
  assert.match(html, /id="qboAcceptedConnectionsValue"/);
  assert.match(html, /quickbooks\.js\?v=5/);
});

test('deal profit calc page exposes calculator controls and result containers', () => {
  const html = read('admin/deal-profit-calc.html');
  assert.match(html, /Deal Profit Calc/);
  assert.match(html, /id="dealProfitForm"/);
  assert.match(html, /id="startDate"/);
  assert.match(html, /id="marginModeToggle"/);
  assert.match(html, /id="financeFeeMode"/);
  assert.match(html, /id="btnApplyZodeqPreset"/);
  assert.match(html, /id="dealSummaryGrid"/);
  assert.match(html, /id="dealBreakdownTable"/);
  assert.match(html, /id="dealScenarioGrid"/);
  assert.match(html, /id="savedScenarioList"/);
  assert.match(html, /id="formulaNotesList"/);
  assert.match(html, /deal-profit-calc\.js\?v=2/);
  assert.match(html, /deal-profit-calc-core\.js\?v=2/);
});
