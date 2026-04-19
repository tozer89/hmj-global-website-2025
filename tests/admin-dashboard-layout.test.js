'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

test('admin dashboard keeps quick links and operations cards in one shared workspace section', () => {
  const html = read('admin/index.html');
  assert.match(html, /id="workspaceHub"/);
  assert.match(html, /All module cards in one place/);
  assert.match(html, /id="quickAccessHeading">Active admin modules/);
  assert.match(html, /id="futureModulesHeading">More Admin Areas/);
  assert.match(html, /class="workspace-hub__block quick-strip-panel"/);
  assert.match(html, /class="workspace-hub__block module-shell" id="future-modules"/);
});

test('admin dashboard places LinkedIn recommendations below the consolidated module workspace', () => {
  const html = read('admin/index.html');
  const workspaceIndex = html.indexOf('id="workspaceHub"');
  const linkedinIndex = html.indexOf('id="linkedinTestimonialsModule"');

  assert.notEqual(workspaceIndex, -1);
  assert.notEqual(linkedinIndex, -1);
  assert.ok(workspaceIndex < linkedinIndex, 'Expected the consolidated workspace hub to render before the LinkedIn module');
});
