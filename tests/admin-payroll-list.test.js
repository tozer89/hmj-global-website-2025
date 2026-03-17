const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('payroll list hardens candidate and contractor selects against optional schema drift', () => {
  const source = read('netlify/functions/admin-payroll-list.js');

  assert.match(source, /safeSelectWithOptionalColumns/);
  assert.match(source, /'candidates',\s*\['id', 'full_name', 'first_name', 'last_name', 'email', 'phone', 'payroll_ref'\],\s*\['pay_type'\]/);
  assert.match(source, /'contractors',\s*\['id', 'name', 'email', 'phone', 'payroll_ref'\],\s*\['pay_type'\]/);
  assert.match(source, /\['pay_type', 'bank_sort_code', 'bank_sort', 'bank_account', 'bank_name', 'bank_iban', 'bank_swift', 'tax_id'\]/);
});

test('payroll list falls back cleanly when TSP sync errors occur', () => {
  const source = read('netlify/functions/admin-payroll-list.js');

  assert.match(source, /let tspSyncError = null/);
  assert.match(source, /syncError: tspSyncError/);
  assert.match(source, /timesheet_portal_payroll_failed/);
});
