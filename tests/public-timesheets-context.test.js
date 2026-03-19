const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { __test } = require('../netlify/functions/_timesheet-helpers.js');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

function buildClient(responses) {
  return {
    from(table) {
      return {
        select() {
          return {
            eq(_, value) {
              return {
                async maybeSingle() {
                  return { data: responses[table]?.[String(value)] || null, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

test('timesheet assignment context resolves project, site, and client names with direct lookups', async () => {
  const client = buildClient({
    projects: { '10': { id: 10, name: 'Battery Storage Alpha', client_id: 7 } },
    sites: { '14': { id: 14, name: 'Leeds Substation', client_id: 7 } },
    clients: { '7': { id: 7, name: 'North Grid Utilities' } },
  });

  const assignment = await __test.hydrateAssignmentContext(client, {
    id: 9,
    project_id: 10,
    site_id: 14,
    client_name: null,
    client_site: null,
  });

  assert.equal(assignment.project_name, 'Battery Storage Alpha');
  assert.equal(assignment.site_name, 'Leeds Substation');
  assert.equal(assignment.client_name, 'North Grid Utilities');
});

test('timesheet page handles unmatched contractor and no-assignment states without a raw context_failed toast', () => {
  const source = read('timesheets.html');

  assert.match(source, /contractor_not_found_for_email/);
  assert.match(source, /no_active_assignment/);
  assert.match(source, /HMJ could not match this login to a contractor profile yet\./);
  assert.match(source, /No active assignment is linked to this account right now\./);
});
