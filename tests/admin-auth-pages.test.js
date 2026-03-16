const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readPage(fileName) {
  return fs.readFileSync(path.join(process.cwd(), 'admin', fileName), 'utf8');
}

['reset-password.html', 'complete-account.html', 'forgot-password.html'].forEach((fileName) => {
  test(`${fileName} uses the standalone HMJ auth shell without widget/common overlays`, () => {
    const html = readPage(fileName);

    assert.match(html, /<script defer src="\/assets\/js\/admin\.auth\.experience\.js\?v=5"><\/script>/);
    assert.match(html, /<link rel="stylesheet" href="\/assets\/css\/admin\.auth\.experience\.css\?v=4" \/>/);
    assert.doesNotMatch(html, /identity\.netlify\.com\/v1\/netlify-identity-widget\.js/);
    assert.doesNotMatch(html, /\/admin\/common\.js/);
  });
});
