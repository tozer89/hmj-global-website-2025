'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin-cv-formatting deploy config includes branded media assets', () => {
  const tomlPath = path.join(__dirname, '..', 'netlify.toml');
  const text = fs.readFileSync(tomlPath, 'utf8');

  const adminBlockMatch = text.match(/\[functions\."admin-cv-formatting"\]([\s\S]*?)(?:\n\[|\n\[\[|$)/);
  assert.ok(adminBlockMatch, 'expected a function-specific config block for admin-cv-formatting');

  const block = adminBlockMatch[1];
  assert.match(
    block,
    /included_files\s*=\s*\[[\s\S]*"assets\/templates\/cv-formatting\/media\/\*"[\s\S]*\]/,
    'expected admin-cv-formatting to bundle the premium branding media assets'
  );
});
