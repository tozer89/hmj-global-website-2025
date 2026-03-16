const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const functionPath = path.resolve(__dirname, '../netlify/functions/job-spec-get.js');
const supabasePath = path.resolve(__dirname, '../netlify/functions/_supabase.js');
const jobsHelpersPath = path.resolve(__dirname, '../netlify/functions/_jobs-helpers.js');
const tokenPath = path.resolve(__dirname, '../netlify/functions/_job-detail-tokens.js');
const seoPath = path.resolve(__dirname, '../netlify/functions/_job-seo-optimizer.js');

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

function createSupabaseMock({ jobSpecsRow = null, jobRow = null } = {}) {
  return {
    from(table) {
      if (table === 'job_specs') {
        return {
          select(fields) {
            assert.equal(fields, '*');
            return {
              eq(column, value) {
                assert.equal(column, 'slug');
                assert.equal(value, 'quantity-surveyor-data-centre-london-uk-data-centre');
                return {
                  maybeSingle() {
                    return Promise.resolve({ data: jobSpecsRow, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'jobs') {
        return {
          select(fields) {
            assert.equal(fields, '*');
            return {
              eq(column, value) {
                assert.equal(column, 'id');
                assert.equal(value, 'qs-london-dc');
                return {
                  maybeSingle() {
                    return Promise.resolve({ data: jobRow, error: null });
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

test('job-spec-get falls back to the public job when the SEO slug is not a share-spec slug', async () => {
  const jobRow = {
    id: 'qs-london-dc',
    title: 'Quantity Surveyor - Data Centre',
    status: 'live',
    published: true,
    locationText: 'London, UK',
  };

  await withMockedModule(functionPath, {
    [supabasePath]: { getSupabase: () => createSupabaseMock({ jobRow }) },
    [jobsHelpersPath]: {
      toPublicJob: (job) => ({ ...job }),
      findStaticJob: () => null,
      isSchemaError: () => false,
      isMissingTableError: () => false,
      isPublicJob: () => true,
    },
    [tokenPath]: { verifyShareAccessToken: () => false },
    [seoPath]: { fetchStoredSeoSuggestion: async () => ({ suggestion: null, missingTable: false }) },
  }, async (mod) => {
    const response = await mod.handler({
      queryStringParameters: {
        id: 'qs-london-dc',
        slug: 'quantity-surveyor-data-centre-london-uk-data-centre',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body || '{}');
    assert.equal(body.jobId, 'qs-london-dc');
    assert.equal(body.title, 'Quantity Surveyor - Data Centre');
    assert.equal(body.job.id, 'qs-london-dc');
  });
});

test('job-spec-get returns 404 instead of 500 when neither share spec nor public job exists for a slug', async () => {
  await withMockedModule(functionPath, {
    [supabasePath]: { getSupabase: () => createSupabaseMock({ jobRow: null }) },
    [jobsHelpersPath]: {
      toPublicJob: (job) => ({ ...job }),
      findStaticJob: () => null,
      isSchemaError: () => false,
      isMissingTableError: () => false,
      isPublicJob: () => false,
    },
    [tokenPath]: { verifyShareAccessToken: () => false },
    [seoPath]: { fetchStoredSeoSuggestion: async () => ({ suggestion: null, missingTable: false }) },
  }, async (mod) => {
    const response = await mod.handler({
      queryStringParameters: {
        slug: 'quantity-surveyor-data-centre-london-uk-data-centre',
      },
    });

    assert.equal(response.statusCode, 404);
    const body = JSON.parse(response.body || '{}');
    assert.match(body.error, /not found/i);
  });
});
