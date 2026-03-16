const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('candidate and assignment reconcile script adds payroll_ref and creates assignments table', () => {
  const source = read('scripts/add-candidate-pay-and-assignment-linking.sql');

  assert.match(source, /add column if not exists payroll_ref text/i);
  assert.match(source, /create table if not exists public\.assignments/i);
  assert.match(source, /notify pgrst, 'reload schema';/i);
});

test('live reconcile script carries the candidate and assignment schema repair', () => {
  const source = read('scripts/live-supabase-safe-reconcile.sql');

  assert.match(source, /add column if not exists payroll_ref text/i);
  assert.match(source, /create table if not exists public\.assignments/i);
  assert.match(source, /grant select, insert, update, delete on public\.assignments to service_role/i);
});
