const test = require('node:test');
const assert = require('node:assert/strict');

const accountAdmin = require('../netlify/functions/_candidate-account-admin.js');
const reminders = require('../netlify/functions/admin-candidate-onboarding-reminders.js');

function buildCandidateUpdateChain(store) {
  return {
    update(payload) {
      return {
        eq() {
          return {
            select() {
              return {
                async maybeSingle() {
                  store.lastUpdate = payload;
                  return {
                    data: {
                      ...(store.candidate || {}),
                      ...payload,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

test('generateCandidateAccessLink uses magiclink for an existing portal account', async () => {
  const calls = [];
  const supabase = {
    auth: {
      admin: {
        async getUserById(id) {
          assert.equal(id, 'auth-1');
          return {
            data: {
              user: {
                id: 'auth-1',
                email: 'candidate@example.com',
                user_metadata: { full_name: 'Candidate Example' },
              },
            },
            error: null,
          };
        },
        async generateLink(params) {
          calls.push(params);
          return {
            data: {
              user: { id: 'auth-1', email: 'candidate@example.com' },
              properties: {
                action_link: 'https://example.supabase.co/auth/v1/verify?token=abc',
              },
            },
            error: null,
          };
        },
      },
    },
  };

  const result = await accountAdmin.generateCandidateAccessLink(
    supabase,
    { id: 'candidate-1', email: 'candidate@example.com', auth_user_id: 'auth-1', full_name: 'Candidate Example' },
    'https://hmjg.netlify.app/candidates.html?candidate_tab=documents&candidate_focus=right_to_work'
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'magiclink');
  assert.equal(calls[0].email, 'candidate@example.com');
  assert.equal(calls[0].options.redirectTo, 'https://hmjg.netlify.app/candidates.html?candidate_tab=documents&candidate_focus=right_to_work');
  assert.equal(result.link_type, 'magiclink');
  assert.equal(result.created_account, false);
  assert.match(result.action_link, /redirect_to=https%3A%2F%2Fhmjg\.netlify\.app%2Fcandidates\.html/i);
});

test('generateCandidateAccessLink provisions an invite link when no portal account exists yet', async () => {
  const store = { candidate: { id: 'candidate-2', email: 'newstarter@example.com', first_name: 'New', last_name: 'Starter' } };
  const calls = [];
  const supabase = {
    auth: {
      admin: {
        async listUsers() {
          return { data: { users: [], total: 0 }, error: null };
        },
        async generateLink(params) {
          calls.push(params);
          return {
            data: {
              user: {
                id: 'auth-2',
                email: 'newstarter@example.com',
                user_metadata: { first_name: 'New', last_name: 'Starter', full_name: 'New Starter' },
              },
              properties: {
                action_link: 'https://example.supabase.co/auth/v1/verify?token=invite',
              },
            },
            error: null,
          };
        },
      },
    },
    from(table) {
      assert.equal(table, 'candidates');
      return buildCandidateUpdateChain(store);
    },
  };

  const result = await accountAdmin.generateCandidateAccessLink(
    supabase,
    store.candidate,
    'https://hmjg.netlify.app/candidates.html?candidate_tab=documents&candidate_docs=right_to_work'
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'invite');
  assert.equal(calls[0].options.redirectTo, 'https://hmjg.netlify.app/candidates.html?candidate_tab=documents&candidate_docs=right_to_work');
  assert.equal(result.link_type, 'invite');
  assert.equal(result.created_account, true);
  assert.equal(result.user_id, 'auth-2');
  assert.equal(store.lastUpdate.auth_user_id, 'auth-2');
});

test('reminder content explains the secure access path for candidates without a completed portal setup', () => {
  const message = reminders.buildReminderContent(
    {
      senderName: 'HMJ Global',
      senderEmail: 'info@hmj-global.com',
      supportEmail: 'info@hmj-global.com',
      footerTagline: 'Specialist recruitment for technical projects.',
      confirmationHeading: 'Confirm your HMJ candidate account',
      introCopy: 'Use the secure button below to finish your HMJ candidate account setup.',
      preheader: 'Secure access to your HMJ candidate dashboard.',
    },
    'Joseph',
    'https://hmjg.netlify.app/candidates.html?candidate_tab=documents&candidate_focus=right_to_work',
    ['right_to_work'],
    { linkType: 'invite' }
  );

  assert.match(message.html, /finish opening your candidate account/i);
  assert.match(message.html, /correct upload area/i);
  assert.match(message.subject, /right-to-work/i);
});
