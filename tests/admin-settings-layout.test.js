const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();

test('settings page stacks grids early and disables aggressive word breaking for normal copy', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin', 'settings.html'), 'utf8');

  assert.match(html, /<body class="settings-page">/);
  assert.match(html, /src="\/admin\/settings\.js\?v=5"/);
  assert.match(html, /\.content-grid\{grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,460px\),1fr\)\);align-items:start\}/);
  assert.match(html, /\.settings-grid\{display:grid;gap:14px 16px;grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,280px\),1fr\)\)\}/);
  assert.match(html, /\.section-head p:last-child\{margin:0;max-width:min\(100%,60ch\);flex:1 0 min\(100%,320px\);min-width:min\(100%,320px\)\}/);
  assert.match(html, /body\.settings-page :is\([^)]*small[^)]*\)\{\s*overflow-wrap:normal !important;/);
  assert.match(html, /@media \(max-width:1480px\)\{\s*\.content-grid\{grid-template-columns:1fr\}/);
});
