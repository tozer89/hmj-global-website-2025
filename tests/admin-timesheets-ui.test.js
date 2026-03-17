const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8');
}

test('timesheets admin page is a live TSP mirror, not the old local editor shell', () => {
  const html = read('admin/timesheets.html');
  const js = read('admin/timesheets.js');
  const listFn = read('netlify/functions/admin-timesheets-list.js');

  assert.match(html, /Timesheet Portal mirror/);
  assert.match(html, /Mirrored Timesheet Portal timesheets are read-only here/i);
  assert.match(html, /Refresh from TSP/);
  assert.match(html, /\/admin\/timesheets\.js\?v=2/);

  assert.match(js, /api\('\/admin-timesheets-list'/);
  assert.match(js, /Live TSP mirror/);
  assert.match(js, /Timesheet Portal sync failed/);

  assert.match(listFn, /listTimesheetPortalTimesheets/);
  assert.match(listFn, /source: 'timesheet_portal'/);
  assert.match(listFn, /Edit approvals and entries in TSP/);
  assert.match(listFn, /Timesheet Portal returned no timesheet rows for this account or date range/);
  assert.doesNotMatch(listFn, /client_site,as_ref,ref,currency/);
  assert.match(listFn, /client_site,as_ref,currency/);
});
