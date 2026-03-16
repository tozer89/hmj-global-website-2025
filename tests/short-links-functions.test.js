const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const adminFunctionPath = path.resolve(__dirname, '../netlify/functions/admin-short-links.js');
const redirectFunctionPath = path.resolve(__dirname, '../netlify/functions/short-link-go.js');
const authPath = path.resolve(__dirname, '../netlify/functions/_auth.js');
const httpPath = path.resolve(__dirname, '../netlify/functions/_http.js');
const supabasePath = path.resolve(__dirname, '../netlify/functions/_supabase.js');

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

function parseBody(response) {
  return JSON.parse(response.body || '{}');
}

function createAdminSupabase({ existingSlugs = [], insertRow = null, listRows = [] } = {}) {
  return {
    from(table) {
      assert.equal(table, 'short_links');
      return {
        select(fields) {
          if (fields === 'slug') {
            return {
              like(column, pattern) {
                assert.equal(column, 'slug');
                assert.ok(pattern.endsWith('%'));
                return {
                  limit(limitValue) {
                    assert.ok(limitValue >= 1);
                    return Promise.resolve({
                      data: existingSlugs.map((slug) => ({ slug })),
                      error: null,
                    });
                  },
                };
              },
            };
          }

          return {
            order(column, options) {
              assert.equal(column, 'created_at');
              assert.deepEqual(options, { ascending: false });
              return {
                limit(limitValue) {
                  assert.ok(limitValue >= 1);
                  return Promise.resolve({ data: listRows, error: null });
                },
              };
            },
          };
        },
        insert(payload) {
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: insertRow || {
                      id: 101,
                      slug: payload.slug,
                      title: payload.title,
                      destination_url: payload.destination_url,
                      created_at: '2026-03-13T12:00:00Z',
                      created_by: payload.created_by,
                      created_by_email: payload.created_by_email,
                      is_active: payload.is_active,
                      click_count: 0,
                      last_used_at: null,
                    },
                    error: null,
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

test('admin short-links POST auto-generates a variant and returns a branded URL', async () => {
  const supabase = createAdminSupabase({
    existingSlugs: ['candidate-pack'],
  });

  await withMockedModule(adminFunctionPath, {
    [authPath]: { getContext: async () => ({ user: { id: 'u-1', email: 'admin@hmj-global.com' } }) },
    [httpPath]: { withAdminCors: (handler) => handler },
    [supabasePath]: { getSupabase: () => supabase },
  }, async (mod) => {
    const response = await mod.handler({
      httpMethod: 'POST',
      headers: { host: 'hmj-global.com', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({
        title: 'Candidate Pack',
        destinationUrl: 'https://example.com/forms/candidate-pack',
      }),
    }, {});

    assert.equal(response.statusCode, 200);
    const body = parseBody(response);
    assert.equal(body.ok, true);
    assert.equal(body.item.slug, 'candidate-pack-2');
    assert.equal(body.item.shortUrl, 'https://hmj-global.com/go/candidate-pack-2');
    assert.equal(body.item.destinationUrl, 'https://example.com/forms/candidate-pack');
  });
});

test('admin short-links POST returns a suggestion when a custom slug is already taken', async () => {
  const supabase = createAdminSupabase({
    existingSlugs: ['candidate-pack', 'candidate-pack-2'],
  });

  await withMockedModule(adminFunctionPath, {
    [authPath]: { getContext: async () => ({ user: { id: 'u-1', email: 'admin@hmj-global.com' } }) },
    [httpPath]: { withAdminCors: (handler) => handler },
    [supabasePath]: { getSupabase: () => supabase },
  }, async (mod) => {
    const response = await mod.handler({
      httpMethod: 'POST',
      headers: { host: 'hmj-global.com', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({
        title: 'Candidate Pack',
        destinationUrl: 'https://example.com/forms/candidate-pack',
        slug: 'candidate-pack',
      }),
    }, {});

    assert.equal(response.statusCode, 409);
    const body = parseBody(response);
    assert.equal(body.code, 'slug_taken');
    assert.equal(body.suggestedSlug, 'candidate-pack-3');
  });
});

test('admin short-links GET lists recent links with public HMJ URLs', async () => {
  const supabase = createAdminSupabase({
    listRows: [
      {
        id: 11,
        slug: 'planner-dublin',
        title: 'Planner Dublin',
        destination_url: 'https://example.com/jobs/planner-dublin',
        created_at: '2026-03-13T10:15:00Z',
        created_by: 'u-1',
        created_by_email: 'admin@hmj-global.com',
        is_active: true,
        click_count: 4,
        last_used_at: '2026-03-13T11:15:00Z',
      },
    ],
  });

  await withMockedModule(adminFunctionPath, {
    [authPath]: { getContext: async () => ({ user: { id: 'u-1', email: 'admin@hmj-global.com' } }) },
    [httpPath]: { withAdminCors: (handler) => handler },
    [supabasePath]: { getSupabase: () => supabase },
  }, async (mod) => {
    const response = await mod.handler({
      httpMethod: 'GET',
      headers: { host: 'hmj-global.com', 'x-forwarded-proto': 'https' },
      rawUrl: 'https://hmj-global.com/.netlify/functions/admin-short-links?limit=6',
    }, {});

    assert.equal(response.statusCode, 200);
    const body = parseBody(response);
    assert.equal(body.ok, true);
    assert.equal(body.storageReady, true);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].shortUrl, 'https://hmj-global.com/go/planner-dublin');
  });
});

test('public short-link redirect resolves the slug, appends passthrough query params, and updates usage', async () => {
  const updates = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'short_links');
      return {
        select(fields) {
          assert.equal(fields, 'slug, destination_url, is_active, click_count');
          return {
            eq(column, value) {
              assert.equal(column, 'slug');
              assert.equal(value, 'candidate-pack');
              return {
                limit(limitValue) {
                  assert.equal(limitValue, 1);
                  return {
                    maybeSingle() {
                      return Promise.resolve({
                        data: {
                          slug: 'candidate-pack',
                          destination_url: 'https://example.com/forms/candidate-pack?source=hmj',
                          is_active: true,
                          click_count: 3,
                        },
                        error: null,
                      });
                    },
                  };
                },
              };
            },
          };
        },
        update(payload) {
          updates.push(payload);
          return {
            eq(column, value) {
              assert.equal(column, 'slug');
              assert.equal(value, 'candidate-pack');
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };

  await withMockedModule(redirectFunctionPath, {
    [supabasePath]: { getSupabase: () => supabase },
  }, async (mod) => {
    const response = await mod.handler({
      queryStringParameters: {
        slug: 'candidate-pack',
        ref: 'crm',
      },
    });

    assert.equal(response.statusCode, 302);
    assert.equal(
      response.headers.location,
      'https://example.com/forms/candidate-pack?source=hmj&ref=crm'
    );
    assert.equal(updates.length, 1);
    assert.equal(updates[0].click_count, 4);
    assert.ok(updates[0].last_used_at);
  });
});

test('public short-link redirect falls back to a published job detail route when no stored short link exists', async () => {
  const supabase = {
    from(table) {
      if (table === 'short_links') {
        return {
          select(fields) {
            assert.equal(fields, 'slug, destination_url, is_active, click_count');
            return {
              eq(column, value) {
                assert.equal(column, 'slug');
                assert.equal(value, 'planner-dublin');
                return {
                  limit(limitValue) {
                    assert.equal(limitValue, 1);
                    return {
                      maybeSingle() {
                        return Promise.resolve({ data: null, error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      assert.equal(table, 'jobs');
      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, 'published');
              assert.equal(value, true);
              return {
                eq(innerColumn, innerValue) {
                  assert.equal(innerColumn, 'id');
                  assert.equal(innerValue, 'planner-dublin');
                  return {
                    limit(limitValue) {
                      assert.equal(limitValue, 1);
                      return {
                        maybeSingle() {
                          return Promise.resolve({
                            data: {
                              id: 'planner-dublin',
                              title: 'Project Planner — Data Centre',
                              location_text: 'Dublin, Ireland Data Centre',
                              published: true,
                            },
                            error: null,
                          });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  await withMockedModule(redirectFunctionPath, {
    [supabasePath]: { getSupabase: () => supabase },
  }, async (mod) => {
    const response = await mod.handler({
      queryStringParameters: {
        slug: 'planner-dublin',
      },
    });

    assert.equal(response.statusCode, 302);
    assert.equal(
      response.headers.location,
      '/jobs/spec.html?id=planner-dublin&slug=project-planner-data-centre-dublin-ireland-data-centre'
    );
  });
});
