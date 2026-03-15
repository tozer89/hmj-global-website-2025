const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAssignableAdminMembers,
  fetchNetlifyIdentityUsers,
  resolveNetlifyIdentityContext,
} = require('../netlify/functions/_admin-users.js');

test('resolveNetlifyIdentityContext strips trailing /user and returns token', () => {
  const context = {
    clientContext: {
      custom: {
        netlify: {
          url: 'https://hmjg.netlify.app/.netlify/identity/user',
          token: 'secret-token',
        },
      },
    },
  };

  assert.deepEqual(resolveNetlifyIdentityContext(context), {
    baseUrl: 'https://hmjg.netlify.app/.netlify/identity',
    token: 'secret-token',
  });
});

test('fetchNetlifyIdentityUsers reads the admin users endpoint', async () => {
  const calls = [];
  const context = {
    clientContext: {
      custom: {
        netlify: {
          url: 'https://hmjg.netlify.app/.netlify/identity',
          token: 'secret-token',
        },
      },
    },
  };

  const users = await fetchNetlifyIdentityUsers(context, {
    fetchImpl: async (url, options) => {
      calls.push({
        url: String(url),
        auth: options?.headers?.authorization,
      });
      return {
        ok: true,
        json: async () => ([
          { id: 'nf-joe', email: 'joe@hmj-global.com' },
          { id: 'nf-info', email: 'info@hmj-global.com' },
        ]),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/\.netlify\/identity\/admin\/users\?/);
  assert.equal(calls[0].auth, 'Bearer secret-token');
  assert.equal(users.length, 2);
});

test('buildAssignableAdminMembers merges stale admin_users rows with live Netlify users', () => {
  const members = buildAssignableAdminMembers({
    tableRows: [
      {
        id: 'row-joe',
        email: 'joe@hmj-global.com',
        role: 'admin',
        is_active: true,
        meta: { full_name: 'Joe Tozer-O\'Sullivan' },
      },
    ],
    identityUsers: [
      {
        id: 'nf-joe',
        email: 'joe@hmj-global.com',
        user_metadata: { full_name: 'Joe Tozer-O\'Sullivan' },
      },
      {
        id: 'nf-info',
        email: 'info@hmj-global.com',
        user_metadata: { name: 'Info@HMJ' },
      },
      {
        id: 'nf-nick',
        email: 'nick@hmj-global.com',
        user_metadata: { full_name: 'Nick Chamberlain' },
      },
    ],
    currentUser: {
      userId: 'nf-joe',
      email: 'joe@hmj-global.com',
      displayName: 'Joe Tozer-O\'Sullivan',
      role: 'admin',
      isActive: true,
    },
  });

  assert.equal(members.length, 3);

  const joe = members.find((member) => member.email === 'joe@hmj-global.com');
  const info = members.find((member) => member.email === 'info@hmj-global.com');
  const nick = members.find((member) => member.email === 'nick@hmj-global.com');

  assert.ok(joe);
  assert.equal(joe.userId, 'nf-joe');
  assert.equal(joe.displayName, 'Joe Tozer-O\'Sullivan');

  assert.ok(info);
  assert.equal(info.displayName, 'Info@HMJ');

  assert.ok(nick);
  assert.equal(nick.displayName, 'Nick Chamberlain');
});
