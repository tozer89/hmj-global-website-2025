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

test('public pages use the shared nav script and do not embed legacy mobile-menu handlers', () => {
  PUBLIC_PAGES.forEach((page) => {
    const html = fs.readFileSync(path.join(process.cwd(), page), 'utf8');

    assert.match(html, /<script[^>]+src=["'][^"']*hmj-nav\.js[^"']*["']/i, `${page} should load the shared nav script`);
    assert.doesNotMatch(html, /const burger\s*=\s*document\.querySelector\(['"]\.hmj-burger['"]\)/i, `${page} should not embed a page-specific burger binding`);
    assert.match(html, /class="hmj-scrim"/i, `${page} should include the shared nav scrim`);
  });
});

test('shared nav script owns burger toggle and page highlighting', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'js/hmj-nav.js'), 'utf8');

  assert.match(script, /function|\=\>\s*\(?openMenu/i, 'shared nav script should define a menu toggle flow');
  assert.match(script, /aria-expanded/i, 'shared nav script should manage burger expanded state');
  assert.match(script, /classList\.toggle\(['"]open['"]/i, 'shared nav script should open and close the mobile menu');
  assert.match(script, /aria-current['"],\s*['"]page/i, 'shared nav script should mark the current public page');
});

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

test('public nav removes accounting and retains the admin entry item', () => {
  PUBLIC_PAGES.forEach((page) => {
    const html = fs.readFileSync(path.join(process.cwd(), page), 'utf8');

    assert.doesNotMatch(html, />\s*Accounting\s*</i, `${page} should not render the Accounting nav item`);
    assert.match(html, /id="nav-admin"/i, `${page} should retain the admin nav item`);
    assert.match(html, /class="[^"]*\bnav-admin-link\b[^"]*"/i, `${page} admin nav item should include the shared admin styling class`);
    assert.match(html, /id="nav-admin"[^>]*>\s*Admin\s*</i, `${page} admin nav item should use the Admin label`);
  });
});
