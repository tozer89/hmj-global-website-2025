const test = require('node:test');
const assert = require('node:assert/strict');

function withMockedModule(modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const original = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  };
  return () => {
    if (original) require.cache[resolved] = original;
    else delete require.cache[resolved];
  };
}

function loadSupabaseModule({ getContextImpl }) {
  const restoreAuth = withMockedModule('../netlify/functions/_auth.js', {
    getContext: getContextImpl,
  });
  const restoreEnv = withMockedModule('../netlify/functions/_supabase-env.js', {
    getSupabaseUrl: () => 'https://example.supabase.co',
    getSupabaseServiceKey: () => 'service-role-key',
  });
  const restoreClient = withMockedModule('@supabase/supabase-js', {
    createClient: () => ({
      from() {
        return {};
      },
    }),
  });

  delete require.cache[require.resolve('../netlify/functions/_supabase.js')];
  const mod = require('../netlify/functions/_supabase.js');

  return {
    mod,
    restore() {
      restoreAuth();
      restoreEnv();
      restoreClient();
      delete require.cache[require.resolve('../netlify/functions/_supabase.js')];
    },
  };
}

test('withSupabase blocks non-admin callers before exposing service-role data access', async () => {
  const { mod, restore } = loadSupabaseModule({
    getContextImpl: async () => {
      const error = new Error('Forbidden');
      error.code = 403;
      throw error;
    },
  });

  const handler = mod.withSupabase(async () => ({ ok: true }));
  const response = await handler({
    httpMethod: 'GET',
    headers: {
      authorization: 'Bearer test-token',
    },
  }, {});

  assert.equal(response.statusCode, 403);
  assert.match(response.body, /Forbidden/);

  restore();
});

test('withSupabase passes the verified admin user context into handlers', async () => {
  const { mod, restore } = loadSupabaseModule({
    getContextImpl: async () => ({
      user: { email: 'finance@hmj-global.com' },
      roles: ['admin'],
    }),
  });

  let seen = null;
  const handler = mod.withSupabase(async ({ user, roles }) => {
    seen = { email: user.email, roles: Array.from(roles) };
    return { ok: true };
  });

  const response = await handler({
    httpMethod: 'GET',
    headers: {
      authorization: 'Bearer test-token',
    },
  }, {});

  assert.equal(response.statusCode, 200);
  assert.deepEqual(seen, {
    email: 'finance@hmj-global.com',
    roles: ['admin'],
  });

  restore();
});
