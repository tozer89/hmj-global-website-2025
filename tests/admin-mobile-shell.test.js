const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function createMatchMedia(width) {
  return (query) => {
    const max = /max-width:\s*(\d+)px/i.exec(query);
    const min = /min-width:\s*(\d+)px/i.exec(query);
    let matches = true;
    if (max) matches = matches && width <= Number(max[1]);
    if (min) matches = matches && width >= Number(min[1]);
    return {
      matches,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    };
  };
}

test('shared admin shell exposes a sticky mobile menu for header actions', () => {
  const html = `<!doctype html>
  <html>
    <body>
      <div class="top">
        <div class="row">
          <div class="brand">Jobs Console</div>
          <span class="pill">Admin</span>
          <div class="sp"></div>
          <a class="btn ghost" href="/">Website</a>
          <a class="btn ghost" href="/admin/">Dashboard</a>
          <button class="btn" type="button" data-admin-logout>Sign out</button>
        </div>
      </div>
    </body>
  </html>`;

  const dom = new JSDOM(html, {
    url: 'https://example.com/admin/jobs.html',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });

  const { window } = dom;
  window.matchMedia = createMatchMedia(390);
  window.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  window.console = console;
  window.netlifyIdentity = null;
  window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  window.cancelAnimationFrame = (id) => clearTimeout(id);

  const source = fs.readFileSync(path.join(process.cwd(), 'admin/common.js'), 'utf8');
  window.eval(source);
  window.__hmjEnhanceAdminTopbar(window.document);

  const trigger = window.document.querySelector('.hmj-admin-mobile-trigger');
  const menu = window.document.querySelector('.hmj-admin-top-actions');
  const backdrop = window.document.querySelector('.hmj-admin-mobile-backdrop');

  assert.ok(trigger, 'mobile trigger should be injected');
  assert.ok(menu, 'header actions should be wrapped into a mobile menu');
  assert.ok(backdrop, 'backdrop should be created for dismissing the menu');
  assert.equal(menu.querySelectorAll('a, button').length, 3, 'menu should retain the original actions');
  assert.equal(trigger.getAttribute('aria-label'), 'Open menu');

  trigger.click();
  assert.equal(window.document.body.classList.contains('hmj-admin-mobile-menu-open'), true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(trigger.getAttribute('aria-label'), 'Close menu');

  backdrop.click();
  assert.equal(window.document.body.classList.contains('hmj-admin-mobile-menu-open'), false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(trigger.getAttribute('aria-label'), 'Open menu');
});
