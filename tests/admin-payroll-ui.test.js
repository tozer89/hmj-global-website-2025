const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('payroll admin UI guards local-only actions for TSP mirrored rows', () => {
  const source = read('admin/payroll.js');

  assert.match(source, /function isReadOnlyRow\(row\)/);
  assert.match(source, /Source TSP/);
  assert.match(source, /mirrored from Timesheet Portal and are read-only here/i);
  assert.match(source, /Skipped \$\{skipped\} read-only Timesheet Portal row/);
  assert.match(source, /Source: Timesheet Portal payroll/);
});
