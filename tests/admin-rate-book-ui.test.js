'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

test('admin dashboard exposes the Rate Book quick access tile', () => {
  const html = read('admin/index.html');
  assert.match(html, /Rate Book/);
  assert.match(html, /Manage public role rates, market comparisons, margin rules, and client-facing rate-guide settings/i);
  assert.match(html, /href="\/admin\/rate-book\.html"/);
});

test('rate book admin page includes market tabs, settings form, preview panel, and editor shell', () => {
  const html = read('admin/rate-book.html');
  assert.match(html, /id="marketTabs"/);
  assert.match(html, /id="settingsForm"/);
  assert.match(html, /id="previewCard"/);
  assert.match(html, /id="tableBody"/);
  assert.match(html, /id="editor"/);
  assert.match(html, /id="editorMarketGrid"/);
  assert.match(html, /admin\.rate-book\.css\?v=1/);
  assert.match(html, /rate-book\.js\?v=1/);
});

test('rate book route is protected and public route is redirected cleanly', () => {
  const netlify = read('netlify.toml');
  assert.match(netlify, /from = "\/rate-book"[\s\S]*to = "\/rate-book\.html"/);
  assert.match(netlify, /from = "\/admin\/rate-book\.html"[\s\S]*conditions = \{ Role = \["admin", "owner"\] \}/);
  assert.match(netlify, /to = "\/admin\/\?next=rate-book\.html"/);
});

test('rate book frontend calls the expected secure backend endpoints', () => {
  const source = read('admin/rate-book.js');
  assert.match(source, /admin-rate-book-list/);
  assert.match(source, /admin-rate-book-save/);
  assert.match(source, /admin-rate-book-settings-save/);
  assert.match(source, /admin-rate-book-import/);
  assert.match(source, /admin-rate-book-recalculate/);
});
