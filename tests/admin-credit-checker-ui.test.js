'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

test('credit checker admin page includes lead review and settings controls', () => {
  const html = read('admin/credit-checker.html');
  assert.match(html, /id="creditCheckerStatsGrid"/);
  assert.match(html, /id="leadSearch"/);
  assert.match(html, /id="leadStatusFilter"/);
  assert.match(html, /id="leadTableBody"/);
  assert.match(html, /id="leadDetailForm"/);
  assert.match(html, /id="settingsForm"/);
  assert.match(html, /id="settingsTurnoverGrid"/);
  assert.match(html, /id="settingsYearsGrid"/);
  assert.match(html, /id="settingsSectorGrid"/);
  assert.match(html, /admin\.credit-checker\.css\?v=1/);
  assert.match(html, /credit-checker\.js\?v=1/);
});

test('finance workspace links to the credit checker module and dashboard data advertises it', () => {
  const financeHtml = read('admin/finance/index.html');
  const financeDashboard = read('netlify/functions/admin-finance-dashboard.js');
  assert.match(financeHtml, /href="\/admin\/credit-checker\.html"/);
  assert.match(financeHtml, /Credit checker leads/i);
  assert.match(financeDashboard, /key: 'credit_checker'/);
  assert.match(financeDashboard, /href: '\/admin\/credit-checker\.html'/);
});

test('public clients page and hidden route expose the discreet credit-check entry point', () => {
  const clientsHtml = read('clients.html');
  const creditCheckHtml = read('credit-check.html');
  assert.match(clientsHtml, /data-credit-check-public-widget/);
  assert.match(clientsHtml, /href="\/credit-check\?src=clients_rate_book"/);
  assert.match(creditCheckHtml, /robots" content="noindex,nofollow"/);
  assert.match(creditCheckHtml, /id="creditCheckForm"/);
  assert.match(creditCheckHtml, /id="creditCheckResult"/);
});

test('netlify routes protect the admin checker and rewrite the hidden public page cleanly', () => {
  const netlify = read('netlify.toml');
  assert.match(netlify, /from = "\/credit-check"[\s\S]*to = "\/credit-check\.html"/);
  assert.match(netlify, /from = "\/admin\/credit-checker\.html"[\s\S]*conditions = \{ Role = \["admin", "owner"\] \}/);
  assert.match(netlify, /to = "\/admin\/\?next=credit-checker\.html"/);
});
