const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const functionPath = path.resolve(__dirname, '../netlify/functions/whoami.js');
const envPath = path.resolve(__dirname, '../netlify/functions/_supabase-env.js');
const supabaseJsPath = require.resolve('@supabase/supabase-js');

function cacheEntry(resolvedPath, exports) {
  return { id: resolvedPath, filename: resolvedPath, loaded: true, exports };
}

async function withMockedModule(targetPath, mocks, run) {
  const originals = new Map();
  delete require.cache[targetPath];

  for (const [mockPath, exports] of Object.entries(mocks)) {
    originals.set(mockPath, require.cache[mockPath]);
    require.cache[mockPath] = cacheEntry(mockPath, exports);
  }

  try {
    const loaded = require(targetPath);
    return await run(loaded);
  } finally {
    delete require.cache[targetPath];
    for (const [mockPath, original] of originals.entries()) {
      if (original) require.cache[mockPath] = original;
      else delete require.cache[mockPath];
    }
  }
}

test('whoami returns assignment counts from head-count queries', async () => {
  await withMockedModule(functionPath, {
    [envPath]: {
      getSupabaseUrl: () => 'https://example.supabase.co',
      getSupabaseServiceKey: () => 'service-role-key',
      getSupabaseAnonKey: () => '',
    },
    [supabaseJsPath]: {
      createClient: () => ({
        from(table) {
          if (table === 'contractors') {
            return {
              select() {
                return {
                  eq() {
                    return {
                      limit() {
                        return {
                          maybeSingle() {
                            return Promise.resolve({
                              data: { id: 'contractor-1', name: 'Alice Carter', email: 'alice@example.com' },
                            });
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }

          assert.equal(table, 'assignments');
          return {
            select() {
              return {
                eq() {
                  return Promise.resolve({
                    data: null,
                    count: 3,
                    error: null,
                  });
                },
              };
            },
          };
        },
      }),
    },
  }, async (mod) => {
    const response = await mod.handler({}, {
      clientContext: {
        user: {
          email: 'alice@example.com',
        },
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.identityEmail, 'alice@example.com');
    assert.equal(body.assignmentCount, 3);
    assert.equal(body.err, null);
  });
});
