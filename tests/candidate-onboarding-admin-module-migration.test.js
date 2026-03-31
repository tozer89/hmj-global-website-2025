const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('candidate onboarding admin migration adds starter workflow and consent fields safely', () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260331110000_candidate_onboarding_admin_module.sql'),
    'utf8',
  );

  assert.match(sql, /add column if not exists onboarding_status text/i);
  assert.match(sql, /add column if not exists onboarding_status_updated_at timestamptz/i);
  assert.match(sql, /add column if not exists onboarding_status_updated_by text/i);
  assert.match(sql, /add column if not exists right_to_work_evidence_type text/i);
  assert.match(sql, /add column if not exists consent_captured boolean/i);
  assert.match(sql, /add column if not exists consent_captured_at timestamptz/i);
  assert.match(sql, /create index if not exists idx_candidates_onboarding_status/i);
  assert.match(sql, /create index if not exists idx_candidates_onboarding_mode_status/i);
});
