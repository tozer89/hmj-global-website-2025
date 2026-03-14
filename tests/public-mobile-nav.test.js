const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_PAGES = [
  'index.html',
  'about.html',
  'clients.html',
  'jobs.html',
  'candidates.html',
  'client-contact.html',
  'contact.html',
  'timesheets.html',
  'jobs/gold-card-electrician-slough/index.html',
];

test('public mobile menu buttons use consistent three-line markup', () => {
  PUBLIC_PAGES.forEach((page) => {
    const html = fs.readFileSync(path.join(process.cwd(), page), 'utf8');
    const burger = html.match(/<button[^>]*class="hmj-burger"[\s\S]*?<\/button>/i);

    assert.ok(burger, `${page} should include a mobile menu button`);
    assert.match(burger[0], /type="button"/i, `${page} burger should set type="button"`);
    assert.match(burger[0], /aria-controls="hmj-menu"/i, `${page} burger should target the shared nav menu`);

    const spans = burger[0].match(/<span\b/gi) || [];
    assert.equal(spans.length, 3, `${page} burger should render exactly three icon bars`);
  });
});
