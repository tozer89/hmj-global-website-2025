const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('clients admin page wires refresh to Timesheet Portal sync and supports read-only TSP rows', () => {
  const source = read('admin/clients.html');

  assert.match(source, /admin-clients-sync-timesheet-portal/);
  assert.match(source, /Refresh from TSP/);
  assert.match(source, /Timesheet Portal derived \(read-only\)/);
  assert.match(source, /state\.autoSyncAttempted = true/);
  assert.match(source, /client_name: client\?\.name \|\| null/);
});

test('clients list endpoint falls back cleanly when the clients table is unavailable', () => {
  const source = read('netlify/functions/admin-clients-list.js');

  assert.match(source, /Could not find the table 'public\\\.clients' in the schema cache/);
  assert.match(source, /source: 'static'/);
  assert.match(source, /tableAvailable: false/);
});

test('clients sync derives client rows from TSP assignments and can upsert when the table exists', () => {
  const syncSource = read('netlify/functions/admin-clients-sync-timesheet-portal.js');
  const helperSource = read('netlify/functions/_clients-sync.js');

  assert.match(syncSource, /listTimesheetPortalAssignments/);
  assert.match(syncSource, /deriveTimesheetPortalClients/);
  assert.match(syncSource, /from\('clients'\)/);
  assert.match(helperSource, /assignment_count/);
  assert.match(helperSource, /client_code/);
});
