const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'candidates.html'), 'utf8');

const hasToolbar = /class="toolbar"/.test(html);
const hasFilters = /id="filters"/.test(html);
const hasRows = /id="rows"/.test(html);

if (!hasToolbar || !hasFilters || !hasRows) {
  throw new Error('Candidates page failed basic mount check.');
}

console.log('[test] candidates page mounted ok');
