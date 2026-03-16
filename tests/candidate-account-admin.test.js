const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPortalAuthUserUpdate,
  managedCandidatePassword,
  rewriteAuthActionLink,
  summarisePortalAuthUser,
} = require('../netlify/functions/_candidate-account-admin.js');

test('rewriteAuthActionLink replaces loopback redirects with the canonical candidate route', () => {
  const input = 'https://mftwpbpwisxyaenfoizb.supabase.co/auth/v1/verify?token=abc123&type=recovery&redirect_to=http://localhost:3000';
  const output = rewriteAuthActionLink(
    input,
    'https://hmjg.netlify.app/candidates.html?candidate_action=recovery'
  );

  assert.equal(
    output,
    'https://mftwpbpwisxyaenfoizb.supabase.co/auth/v1/verify?token=abc123&type=recovery&redirect_to=https%3A%2F%2Fhmjg.netlify.app%2Fcandidates.html%3Fcandidate_action%3Drecovery'
  );
});

test('summarisePortalAuthUser returns stable admin-facing metadata', () => {
  const summary = summarisePortalAuthUser({
    id: 'user-7',
    email: ' Person@Example.com ',
    email_confirmed_at: '2026-03-15T18:00:00.000Z',
    last_sign_in_at: '2026-03-15T19:00:00.000Z',
    created_at: '2026-03-15T17:00:00.000Z',
    updated_at: '2026-03-15T19:05:00.000Z',
    user_metadata: {
      full_name: 'Person Example',
      first_name: 'Person',
      last_name: 'Example',
    },
  });

  assert.deepEqual(summary, {
    exists: true,
    user_id: 'user-7',
    email: 'person@example.com',
    email_confirmed_at: '2026-03-15T18:00:00.000Z',
    last_sign_in_at: '2026-03-15T19:00:00.000Z',
    created_at: '2026-03-15T17:00:00.000Z',
    updated_at: '2026-03-15T19:05:00.000Z',
    full_name: 'Person Example',
    first_name: 'Person',
    last_name: 'Example',
  });
});

test('buildPortalAuthUserUpdate keeps names synced and optionally updates email', () => {
  const payload = buildPortalAuthUserUpdate(
    {
      first_name: 'Jamie',
      last_name: 'Tozer',
      email: 'jamie@example.com',
    },
    {
      email: 'old@example.com',
      user_metadata: {
        department: 'recruitment',
      },
    },
    { syncEmail: true }
  );

  assert.deepEqual(payload, {
    email: 'jamie@example.com',
    user_metadata: {
      department: 'recruitment',
      full_name: 'Jamie Tozer',
      first_name: 'Jamie',
      last_name: 'Tozer',
    },
  });
});

test('managedCandidatePassword rejects weak passwords', () => {
  assert.throws(
    () => managedCandidatePassword('short'),
    /at least 8 characters/i
  );
  assert.equal(managedCandidatePassword('secure123'), 'secure123');
});
