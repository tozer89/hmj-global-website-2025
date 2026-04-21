const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { chromium } = require('playwright-core');
const { startDashboardServer } = require('../lib/sourcing-dashboard-server.js');

const fixtureRoot = path.join(__dirname, 'fixtures', 'sourcing-assistant-workspace');
const websiteRepoPath = path.join(__dirname, '..');

function makeWorkspace() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hmj-sourcing-browser-'));
  fs.cpSync(fixtureRoot, tempRoot, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'launcher-config.json'), `${JSON.stringify({
    websiteRepoPath,
    dashboardPort: 4287,
  }, null, 2)}\n`, 'utf8');
  return tempRoot;
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close(() => resolve());
  });
}

function resolveChromeExecutable() {
  const candidates = [
    process.env.HMJ_SOURCING_BROWSER_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);

  return candidates.find((candidatePath) => {
    try {
      return fs.existsSync(candidatePath);
    } catch {
      return false;
    }
  }) || '';
}

test('browser smoke covers dashboard import, changed-candidate review, and recruiter note save', { timeout: 45000 }, async (t) => {
  const chromeExecutable = resolveChromeExecutable();
  if (!chromeExecutable) {
    t.skip('Google Chrome or another supported Chromium executable is not installed on this machine.');
    return;
  }

  const workspaceRoot = makeWorkspace();
  const importPath = path.join(workspaceRoot, 'browser-smoke-update.csv');
  fs.writeFileSync(importPath, [
    'candidate_id,source,source_reference_id,search_variant,candidate_name,current_title,location,summary_text,email',
    'cvl-possible-002,CV-Library,CVL-POSSIBLE-002,medium,James Byrne,Electrical Supervisor,Bradford,Updated preview text for browser smoke test with clearer mission critical evidence and package coordination detail.,james.byrne@example.com',
  ].join('\n'), 'utf8');

  const started = await startDashboardServer({
    workflowRoot: workspaceRoot,
    host: '127.0.0.1',
    port: 0,
  });

  const browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true,
    args: [
      '--disable-search-engine-choice-screen',
      '--no-default-browser-check',
      '--no-first-run',
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error?.message || String(error));
  });

  try {
    await page.goto(`http://${started.host}:${started.port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#roleList .role-item');
    await page.locator('#roleList .role-item').first().click();
    await page.waitForFunction(() => document.querySelector('#roleTitle')?.textContent.includes('Electrical Site Manager'));

    await page.locator('#importFileInput').setInputFiles(importPath);
    await page.locator('#importPostAction').selectOption('run_preview_triage');
    await page.locator('#importBatchButton').click();

    await page.waitForFunction(() => document.querySelector('#statusBox')?.textContent.includes('Imported'));
    await page.waitForSelector('#candidateList .candidate-card');
    await page.waitForFunction(() => document.querySelector('[data-filter-key="changed_since_last_import"]')?.classList.contains('active'));
    await page.waitForSelector('#candidateList [data-candidate-id="cvl-possible-002"]');
    await page.locator('#candidateList [data-candidate-id="cvl-possible-002"]').click();

    await page.waitForFunction(() => document.querySelector('#candidateDetail')?.dataset.candidateId === 'cvl-possible-002');
    await page.waitForFunction(() => document.querySelector('#candidateDetail')?.textContent.includes('Updated preview text for browser smoke test'));
    await page.waitForFunction(() => document.querySelector('#importSummary')?.textContent.includes('1 updated'));

    await page.locator('#shortlistStatus').selectOption('possible_shortlist');
    await page.locator('#shortlistBucket').selectOption('backup');
    await page.locator('#recruiterConfidence').selectOption('high');
    await page.locator('#manualScreeningSummary').fill('Browser smoke manual screen saved successfully.');
    await page.locator('#overrideReason').fill('Browser smoke validation');
    await page.locator('#saveCandidateReviewButton').click();

    await page.waitForFunction(() => document.querySelector('#statusBox')?.textContent.includes('Saved review update'));
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#candidateFilters [data-filter-key="changed_since_last_import"]');
    await page.locator('#candidateFilters [data-filter-key="changed_since_last_import"]').click();
    await page.waitForSelector('#candidateList [data-candidate-id="cvl-possible-002"]');
    await page.locator('#candidateList [data-candidate-id="cvl-possible-002"]').click();
    await page.waitForFunction(() => document.querySelector('#manualScreeningSummary')?.value.includes('Browser smoke manual screen saved successfully.'));

    assert.deepEqual(pageErrors, []);

    const summaryPath = path.join(workspaceRoot, 'roles', 'demo-electrical-site-manager', 'outputs', 'dashboard-summary.json');
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const candidate = summary.candidateDetails.find((entry) => entry.candidate_id === 'cvl-possible-002');

    assert.equal(candidate.operatorReview.manual_screening_summary, 'Browser smoke manual screen saved successfully.');
    assert.equal(candidate.operatorReview.shortlist_bucket, 'backup');
    assert.equal(candidate.operatorReview.recruiter_confidence, 'high');
    assert.equal(candidate.sessionFlags.changed_since_last_import, true);
  } finally {
    await context.close();
    await browser.close();
    await closeServer(started.server);
  }
});
