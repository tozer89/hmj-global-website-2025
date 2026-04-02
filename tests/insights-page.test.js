const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(process.cwd(), 'insights.html'), 'utf8');
const document = new JSDOM(html).window.document;

test('insights page exposes the enhanced editorial experience hooks', () => {
  const stylesheet = document.querySelector('link[href="assets/css/insights.enhanced.css?v=1"]');
  const script = document.querySelector('script[src="assets/js/insights.enhanced.js"]');
  const filterButtons = Array.from(document.querySelectorAll('[data-insight-filter]'));
  const cards = Array.from(document.querySelectorAll('[data-insight-card]'));
  const navItems = Array.from(document.querySelectorAll('[data-insight-nav]'));
  const articles = Array.from(document.querySelectorAll('[data-insight-article]'));
  const progressBar = document.querySelector('[data-insight-progress-bar]');

  assert.ok(stylesheet, 'insights page should load the enhanced stylesheet');
  assert.ok(script, 'insights page should load the enhanced interaction script');
  assert.ok(progressBar, 'insights page should expose the progress bar hook');
  assert.equal(filterButtons.length, 5, 'insights page should expose topic filters');
  assert.equal(cards.length, 6, 'insights page should expose six preview cards');
  assert.equal(navItems.length, 6, 'insights page should expose six library nav items');
  assert.equal(articles.length, 6, 'insights page should expose six long-form articles');

  cards.forEach((card) => {
    assert.ok(card.dataset.insightCategory, 'each preview card should declare a category');
    assert.ok(card.dataset.insightTarget, 'each preview card should point to a target article');
    assert.ok(card.dataset.insightReading, 'each preview card should declare a reading time');
  });

  articles.forEach((article) => {
    assert.ok(article.getAttribute('id'), 'each article should retain an anchor id');
    assert.ok(article.dataset.insightCategory, 'each article should declare a category');
    assert.ok(article.dataset.insightSummary, 'each article should expose an active-summary hook');
  });
});
