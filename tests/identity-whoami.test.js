const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveUser, handler } = require('../netlify/functions/identity-whoami.js');

function createJwt(email, roles) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-1',
    email,
    app_metadata: { roles: Array.isArray(roles) ? roles : [] }
  })).toString('base64url');
  return `${header}.${payload}.signature`;
}

test('resolveUser falls back to the bearer token when clientContext is empty', () => {
  const token = createJwt('admin@hmj-global.com', ['admin']);
  const user = resolveUser({
    headers: {
      authorization: `Bearer ${token}`
    }
  }, {});

  assert.deepEqual(user, {
    email: 'admin@hmj-global.com',
    app_metadata: { roles: ['admin'] },
    user_metadata: {},
    id: 'user-1'
  });
});

test('identity-whoami returns decoded email and roles without a populated clientContext', async () => {
  const token = createJwt('admin@hmj-global.com', ['admin']);
  const response = await handler({
    httpMethod: 'GET',
    headers: {
      authorization: `Bearer ${token}`
    }
  }, {});

  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.identityEmail, 'admin@hmj-global.com');
  assert.deepEqual(body.roles, ['admin']);
});
