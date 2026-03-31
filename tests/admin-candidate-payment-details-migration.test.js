const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('admin candidate payment details endpoint migrates legacy raw bank data into secure storage', () => {
  const source = read('netlify/functions/admin-candidate-payment-details.js');

  assert.match(source, /function legacyPaymentInput\(/);
  assert.match(source, /function migrateLegacyPaymentDetails\(/);
  assert.match(source, /candidate_payment_details/);
  assert.match(source, /clearLegacyPaymentFields/);
  assert.match(source, /payment_details_migrated/);
  assert.match(source, /recordAudit/);
  assert.match(source, /bank_sort_code:\s*null/);
  assert.match(source, /bank_account:\s*null/);
  assert.match(source, /bank_iban:\s*null/);
});
