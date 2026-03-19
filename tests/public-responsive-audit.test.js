const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('public responsive stylesheet is cache-busted and mobile jobs layout avoids horizontal rails', () => {
  const css = read('assets/css/public.responsive.css');
  const jobsHtml = read('jobs.html');
  const candidatesHtml = read('candidates.html');
  const contactHtml = read('contact.html');

  assert.match(jobsHtml, /public\.responsive\.css\?v=3/);
  assert.match(candidatesHtml, /public\.responsive\.css\?v=3/);
  assert.match(contactHtml, /public\.responsive\.css\?v=3/);
  assert.match(css, /\.entry-hero--jobs \.entry-hero__meta \{\s*gap: 5px;\s*flex-wrap: wrap;/);
  assert.match(css, /\.jobs-page \.jobs-overview__grid \{\s*grid-template-columns: minmax\(0, 1fr\);/);
});

test('public honeypot fields use clipped visually-hidden styles instead of off-canvas positioning', () => {
  const candidatesHtml = read('candidates.html');
  const contactHtml = read('contact.html');

  assert.doesNotMatch(candidatesHtml, /left:-9999px/);
  assert.doesNotMatch(contactHtml, /left:-9999px/);
  assert.match(candidatesHtml, /clip-path:inset\(50%\)/);
  assert.match(contactHtml, /clip-path:inset\(50%\)/);
});
