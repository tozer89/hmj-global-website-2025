const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.join(__dirname, '..', 'admin', 'timesheets.html');
const jsPath = path.join(__dirname, '..', 'admin', 'timesheets.js');
const functionPath = path.join(__dirname, '..', 'netlify', 'functions', 'admin-timesheets-list.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');
const listFn = fs.readFileSync(functionPath, 'utf8');

[
  'id="summaryBar"',
  'id="syncNotice"',
  'id="filterSearch"',
  'id="filterStatus"',
  'id="tableWrap"',
  'id="detailDrawer"',
].forEach((needle) => {
  if (!html.includes(needle)) {
    throw new Error(`Missing required timesheets element ${needle}`);
  }
});

[
  "api('/admin-timesheets-list'",
  'Live TSP mirror',
  'Timesheet Portal sync failed.',
  'Mirrored Timesheet Portal timesheets are read-only here.',
].forEach((needle) => {
  if (!html.includes(needle) && !js.includes(needle)) {
    throw new Error(`Missing expected live timesheets UI text/code: ${needle}`);
  }
});

[
  'listTimesheetPortalTimesheets',
  "source: 'timesheet_portal'",
  'Timesheet Portal returned no timesheet rows for this account or date range.',
].forEach((needle) => {
  if (!listFn.includes(needle)) {
    throw new Error(`Missing expected timesheets list behavior: ${needle}`);
  }
});

console.log('[test] admin timesheets page wired to live Timesheet Portal mirror');
