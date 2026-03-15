const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const functionPath = path.resolve(__dirname, '../netlify/functions/admin-jobs-bulk.js');
const authPath = path.resolve(__dirname, '../netlify/functions/_auth.js');
const httpPath = path.resolve(__dirname, '../netlify/functions/_http.js');
const supabasePath = path.resolve(__dirname, '../netlify/functions/_supabase.js');
const auditPath = path.resolve(__dirname, '../netlify/functions/_audit.js');
const jobsHelpersPath = path.resolve(__dirname, '../netlify/functions/_jobs-helpers.js');
const bulkHelpersPath = path.resolve(__dirname, '../netlify/functions/_jobs-bulk-helpers.js');

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

function createSupabaseMock({ rows, failSingleUpsert = null } = {}) {
  return {
    from(table) {
      assert.equal(table, 'jobs');
      return {
        select() {
          return {
            in(column, ids) {
              assert.equal(column, 'id');
              return Promise.resolve({
                data: (rows || []).filter((row) => ids.includes(String(row.id))),
                error: null,
              });
            },
          };
        },
        upsert(payload) {
          return {
            select() {
              if (Array.isArray(payload)) {
                return Promise.resolve({
                  data: payload,
                  error: null,
                });
              }
              return {
                single() {
                  return Promise.resolve(
                    failSingleUpsert
                      ? { data: null, error: failSingleUpsert }
                      : { data: payload, error: null }
                  );
                },
              };
            },
          };
        },
      };
    },
  };
}

function parseBody(response) {
  return JSON.parse(response.body || '{}');
}

test('admin jobs bulk edit records audit details for successful batch changes', async () => {
  const audits = [];
  const rows = [
    { id: 'job-1', title: 'Senior Planner', status: 'live', published: true, overview: 'Initial overview' },
    { id: 'job-2', title: 'QA Lead', status: 'interviewing', published: true, overview: 'Existing summary' },
  ];

  await withMockedModule(functionPath, {
    [authPath]: { getContext: async () => ({ user: { id: 'u-1', email: 'admin@hmj-global.com' } }) },
    [httpPath]: { withAdminCors: (handler) => handler },
    [supabasePath]: { getSupabase: () => createSupabaseMock({ rows }) },
    [auditPath]: { recordAudit: async (entry) => audits.push(entry) },
    [jobsHelpersPath]: {
      toJob: (row) => row,
      toDbPayload: (row) => row,
      isSchemaError: () => false,
    },
    [bulkHelpersPath]: {
      sanitiseBulkEdits: (input) => input,
      applyBulkEditsToJob: (job, edits) => ({
        ...job,
        status: edits.status || job.status,
        published: Object.prototype.hasOwnProperty.call(edits, 'published') ? edits.published : job.published,
        overview: edits.overview || job.overview,
      }),
      createDuplicateJob: (row) => ({ ...row, id: `${row.id}-copy` }),
    },
  }, async (mod) => {
    const response = await mod.handler({
      body: JSON.stringify({
        action: 'edit',
        ids: ['job-1', 'job-2'],
        edits: {
          status: 'closed',
          published: false,
          overview: { mode: 'append', value: 'Urgent delivery note' },
        },
      }),
    }, {});

    assert.equal(response.statusCode, 200);
    const body = parseBody(response);
    assert.equal(body.updatedCount, 2);
  });

  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'jobs.bulk.edit');
  assert.equal(audits[0].targetType, 'jobs_batch');
  assert.equal(audits[0].targetId, 'batch:edit:2');
  assert.deepEqual(audits[0].meta.selectedIds, ['job-1', 'job-2']);
  assert.equal(audits[0].meta.selectedCount, 2);
  assert.deepEqual(audits[0].meta.changedFields, ['status', 'published', 'overview']);
  assert.deepEqual(audits[0].meta.changeSummary.status, { mode: 'replace', value: 'closed' });
  assert.deepEqual(audits[0].meta.changeSummary.published, { mode: 'replace', value: false });
  assert.equal(audits[0].meta.changeSummary.overview.mode, 'append');
  assert.equal(audits[0].meta.changeSummary.overview.valuePreview, 'Urgent delivery note');
});

test('admin jobs bulk edit records a failed audit entry when save fails', async () => {
  const audits = [];
  const rows = [
    { id: 'job-1', title: 'Senior Planner', status: 'live', published: true },
  ];

  await withMockedModule(functionPath, {
    [authPath]: { getContext: async () => ({ user: { id: 'u-1', email: 'admin@hmj-global.com' } }) },
    [httpPath]: { withAdminCors: (handler) => handler },
    [supabasePath]: { getSupabase: () => createSupabaseMock({ rows, failSingleUpsert: new Error('Jobs table unavailable') }) },
    [auditPath]: { recordAudit: async (entry) => audits.push(entry) },
    [jobsHelpersPath]: {
      toJob: (row) => row,
      toDbPayload: (row) => row,
      isSchemaError: () => false,
    },
    [bulkHelpersPath]: {
      sanitiseBulkEdits: (input) => input,
      applyBulkEditsToJob: (job, edits) => ({ ...job, ...edits }),
      createDuplicateJob: (row) => ({ ...row, id: `${row.id}-copy` }),
    },
  }, async (mod) => {
    const response = await mod.handler({
      body: JSON.stringify({
        action: 'edit',
        ids: ['job-1'],
        edits: {
          published: false,
        },
      }),
    }, {});

    assert.equal(response.statusCode, 500);
    const body = parseBody(response);
    assert.match(body.error, /jobs table unavailable/i);
  });

  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'jobs.bulk.edit.failed');
  assert.equal(audits[0].targetId, 'job-1');
  assert.equal(audits[0].meta.outcome, 'failed');
  assert.deepEqual(audits[0].meta.selectedIds, ['job-1']);
  assert.deepEqual(audits[0].meta.changedFields, ['published']);
  assert.equal(audits[0].meta.failureCount, 1);
  assert.match(audits[0].meta.failures[0].error, /jobs table unavailable/i);
});
