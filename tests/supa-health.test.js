const test = require('node:test');
const assert = require('node:assert/strict');

const { createHandler } = require('../netlify/functions/supa-health.js');

test('supa-health exposes api/db/storage statuses and falls through missing probe tables', async () => {
  const seenProbes = [];

  const handler = createHandler({
    resolveSupabaseUrl: () => ({ value: 'https://example.supabase.co', source: 'SUPABASE_URL' }),
    resolveSupabaseServiceKey: () => ({ value: 'service-role-key', source: 'SUPABASE_SERVICE_ROLE_KEY' }),
    lookup: async () => ({ address: '127.0.0.1', family: 4 }),
    fetch: async () => ({
      ok: true,
      status: 200,
      async text() {
        return '{"status":"ok"}';
      },
    }),
    createClient: () => ({
      from(table) {
        seenProbes.push(table);
        return {
          select() {
            return {
              async limit() {
                if (table === 'admin_settings') {
                  return {
                    error: {
                      message: 'relation "public.admin_settings" does not exist',
                    },
                  };
                }
                return { error: null, data: [] };
              },
            };
          },
        };
      },
      storage: {
        async listBuckets() {
          return { data: [{ id: 'candidate-docs' }], error: null };
        },
      },
    }),
  });

  const response = await handler();
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.api, true);
  assert.equal(body.db, true);
  assert.equal(body.storage, true);
  assert.deepEqual(seenProbes, ['admin_settings', 'timesheets']);
  assert.equal(body.dbProbe.table, 'timesheets');
  assert.match(body.warnings[0], /admin_settings/i);
});
