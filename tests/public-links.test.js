const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = process.cwd();
const AUDIT_PAGES = [
  'index.html',
  'about.html',
  'clients.html',
  'faq.html',
  'insights.html',
  'rate-book.html',
  'jobs.html',
  'candidates.html',
  'contact.html',
  'client-contact.html',
  'timesheets.html',
  'jobs/gold-card-electrician-slough/index.html',
  'jobs/spec.html',
  'admin/index.html',
  'admin/jobs.html',
  'admin/candidates.html',
  'admin/rate-book.html',
  'admin/team-tasks.html',
  'admin/settings.html',
].filter((file) => fs.existsSync(path.join(ROOT, file)));

function readRedirects() {
  const netlifyToml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  const redirects = new Map();
  for (const match of netlifyToml.matchAll(/\[\[redirects\]\][\s\S]*?from = "([^"]+)"[\s\S]*?to = "([^"]+)"/g)) {
    redirects.set(match[1], match[2]);
  }
  return redirects;
}

function resolveLocalTarget(fromFile, href, redirects) {
  if (!href) return true;
  if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return true;
  if (/^https?:\/\//i.test(href)) return true;
  if (href.startsWith('/.netlify/functions/')) return true;

  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return true;
  if (redirects.has(clean)) return true;

  const relativeTarget = clean.startsWith('/')
    ? clean.slice(1)
    : path.join(path.dirname(fromFile), clean);

  const absoluteTarget = path.join(ROOT, relativeTarget);
  return (
    fs.existsSync(absoluteTarget)
    || fs.existsSync(`${absoluteTarget}.html`)
    || fs.existsSync(path.join(absoluteTarget, 'index.html'))
  );
}

test('audited public/admin entry pages only link to valid internal targets', () => {
  const redirects = readRedirects();
  const broken = [];

  for (const file of AUDIT_PAGES) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const document = new JSDOM(html).window.document;
    const links = Array.from(document.querySelectorAll('a[href]'));

    for (const link of links) {
      const href = (link.getAttribute('href') || '').trim();
      if (!resolveLocalTarget(file, href, redirects)) {
        broken.push({
          file,
          href,
          text: (link.textContent || '').trim().slice(0, 80),
        });
      }
    }
  }

  assert.deepEqual(broken, []);
});
