const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PAGES = [
  'index.html',
  'about.html',
  'clients.html',
  'jobs.html',
  'candidates.html',
  'contact.html',
  'client-contact.html',
  'timesheets.html',
  path.join('jobs', 'gold-card-electrician-slough', 'index.html'),
];

function readDom(file) {
  const html = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  return new JSDOM(html).window.document;
}

test('priority public pages expose unique SEO foundation metadata', () => {
  const seenTitles = new Set();

  PAGES.forEach((file) => {
    const document = readDom(file);
    const title = document.querySelector('title')?.textContent?.trim() || '';
    const description = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() || '';
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || '';
    const twitterDescription = document.querySelector('meta[name="twitter:description"]')?.getAttribute('content')?.trim() || '';
    const mainCount = document.querySelectorAll('main').length;
    const h1Count = document.querySelectorAll('h1').length;

    assert.ok(title, `${file} should have a title`);
    assert.ok(description, `${file} should have a meta description`);
    assert.ok(canonical, `${file} should have a canonical`);
    assert.ok(ogTitle, `${file} should have an og:title`);
    assert.ok(twitterDescription, `${file} should have a twitter:description`);
    assert.equal(mainCount, 1, `${file} should have one main landmark`);
    assert.equal(h1Count, 1, `${file} should have one h1`);
    assert.equal(seenTitles.has(title), false, `${file} should not duplicate another priority-page title`);
    seenTitles.add(title);
  });
});
