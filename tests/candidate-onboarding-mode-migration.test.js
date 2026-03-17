const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('candidate onboarding mode migration adds the safe boolean column with a default', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260317161500_candidate_onboarding_mode.sql'),
    'utf8',
  );

  assert.match(sql, /alter table public\.candidates/i);
  assert.match(sql, /add column if not exists onboarding_mode boolean not null default false/i);
});
