const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const { startDashboardServer } = require('../lib/sourcing-dashboard-server.js');
const { PRINT_TO_PDF_BASE64 } = require('./fixtures/print-to-pdf.fixture.js');

const fixtureRoot = path.join(__dirname, 'fixtures', 'sourcing-assistant-workspace');
const websiteRepoPath = path.join(__dirname, '..');
const launchScript = path.join(websiteRepoPath, 'scripts', 'launch-sourcing-assistant.js');
const startDashboardScript = path.join(websiteRepoPath, 'scripts', 'start-sourcing-dashboard.js');
const READABLE_DOCX_BASE64 = 'UEsDBBQAAAAIAIBybVzXeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMEFAAAAAgAgHJtXCAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMEFAAAAAgAgHJtXEjS6NmyAAAA7AAAABEAAAB3b3JkL2RvY3VtZW50LnhtbDWOwQrCMBBE737FkrumehApbXpQRAQRRMFrbFYtNLshiVb/3qTg5THDwNutmo/t4Y0+dEy1mM8KAUgtm44etbict9OVgBA1Gd0zYS2+GESjJtVQGm5fFilCMlAoh1o8Y3SllKF9otVhxg4pbXf2VsdU/UMO7I3z3GII6YDt5aIoltLqjoSaACTrjc03x7E4leAzojqhNvrWI+wOe9gc11eI+ImVzFumH+lGjfx7cvr/qX5QSwECFAMUAAAACACAcm1c13mE6vEAAAC4AQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAIBybVwgG4bqsgAAAC4BAAALAAAAAAAAAAAAAACAASIBAABfcmVscy8ucmVsc1BLAQIUAxQAAAAIAIBybVxI0ujZsgAAAOwAAAARAAAAAAAAAAAAAACAAf0BAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAADeAgAAAAA=';

function makeWorkspace() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hmj-sourcing-dashboard-'));
  fs.cpSync(fixtureRoot, tempRoot, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'launcher-config.json'), `${JSON.stringify({
    websiteRepoPath,
    dashboardPort: 4287,
  }, null, 2)}\n`, 'utf8');
  return tempRoot;
}

function requestJson({ method = 'GET', url, body = '' }) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method,
      agent: false,
      headers: {
        'content-type': 'application/json',
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const payload = text ? JSON.parse(text) : null;
        resolve({
          statusCode: response.statusCode,
          payload,
        });
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
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

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address?.port ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForDashboard(url, timeoutMs = 5000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const response = await requestJson({ url: `${url}/api/health` });
      if (response.statusCode === 200 && response.payload?.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Dashboard did not become healthy at ${url} within ${timeoutMs}ms.`);
}

test('dashboard server starts cleanly, serves health, and returns readable API errors', async () => {
  const workspaceRoot = makeWorkspace();
  const started = await startDashboardServer({
    workflowRoot: workspaceRoot,
    host: '127.0.0.1',
    port: 0,
  });

  try {
    const health = await requestJson({
      url: `http://${started.host}:${started.port}/api/health`,
    });
    const invalidJson = await requestJson({
      method: 'POST',
      url: `http://${started.host}:${started.port}/api/init-role`,
      body: '{bad json',
    });

    assert.equal(health.statusCode, 200);
    assert.equal(health.payload.ok, true);
    assert.equal(invalidJson.statusCode, 400);
    assert.equal(invalidJson.payload.code, 'invalid_request_json');
    assert.match(invalidJson.payload.error, /not valid JSON/i);
  } finally {
    await closeServer(started.server);
  }
});

test('dashboard server reports port conflicts clearly', async () => {
  const workspaceRoot = makeWorkspace();
  const first = await startDashboardServer({
    workflowRoot: workspaceRoot,
    host: '127.0.0.1',
    port: 0,
  });

  try {
    await assert.rejects(
      startDashboardServer({
        workflowRoot: workspaceRoot,
        host: '127.0.0.1',
        port: first.port,
      }),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /already in use/i);
        return true;
      },
    );
  } finally {
    await closeServer(first.server);
  }
});

test('launcher reuses an existing healthy dashboard instead of failing on repeat launch', async () => {
  const workspaceRoot = makeWorkspace();
  const port = await findFreePort();
  fs.writeFileSync(path.join(workspaceRoot, 'launcher-config.json'), `${JSON.stringify({
    websiteRepoPath,
    dashboardPort: port,
  }, null, 2)}\n`, 'utf8');
  const dashboardProcess = spawn(process.execPath, [
    startDashboardScript,
    '--workflow-root', workspaceRoot,
    '--port', String(port),
  ], {
    cwd: websiteRepoPath,
    stdio: 'ignore',
  });

  try {
    await waitForDashboard(`http://127.0.0.1:${port}`);
    const result = spawnSync(process.execPath, [
      launchScript,
      '--workflow-root', workspaceRoot,
      '--no-open', 'true',
      '--timeout-ms', '4000',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HMJ_SOURCING_NO_DIALOG: '1',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const sessionState = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'logs', 'dashboard-session.json'), 'utf8'));
    assert.equal(sessionState.port, port);
    assert.equal(sessionState.url, `http://127.0.0.1:${port}/`);
  } finally {
    dashboardProcess.kill('SIGTERM');
    await new Promise((resolve) => dashboardProcess.once('exit', resolve));
  }
});

test('launcher exits cleanly with a readable error when launcher-config.json is broken', () => {
  const workspaceRoot = makeWorkspace();
  fs.writeFileSync(path.join(workspaceRoot, 'launcher-config.json'), '{\n', 'utf8');

  const result = spawnSync(process.execPath, [
    launchScript,
    '--workflow-root', workspaceRoot,
    '--no-open', 'true',
    '--timeout-ms', '1000',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HMJ_SOURCING_NO_DIALOG: '1',
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /launcher-config\.json/i);
  assert.match(result.stderr, /not valid JSON/i);
});

test('launcher surfaces the dashboard URL clearly when browser open fails', async () => {
  const workspaceRoot = makeWorkspace();
  const port = await findFreePort();
  fs.writeFileSync(path.join(workspaceRoot, 'launcher-config.json'), `${JSON.stringify({
    websiteRepoPath,
    dashboardPort: port,
  }, null, 2)}\n`, 'utf8');
  const dashboardProcess = spawn(process.execPath, [
    startDashboardScript,
    '--workflow-root', workspaceRoot,
    '--port', String(port),
  ], {
    cwd: websiteRepoPath,
    stdio: 'ignore',
  });

  try {
    await waitForDashboard(`http://127.0.0.1:${port}`);
    const result = spawnSync(process.execPath, [
      launchScript,
      '--workflow-root', workspaceRoot,
      '--timeout-ms', '4000',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HMJ_SOURCING_NO_DIALOG: '1',
        HMJ_SOURCING_OPEN_BIN: '/definitely/missing/open',
      },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`http://127\\.0\\.0\\.1:${port}/`));
    const launcherState = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'logs', 'launcher-state.json'), 'utf8'));
    assert.equal(launcherState.dashboardHealthy, true);
    assert.equal(launcherState.browserOpenAttempted, true);
    assert.equal(launcherState.browserOpenSucceeded, false);
    assert.equal(launcherState.url, `http://127.0.0.1:${port}/`);
  } finally {
    dashboardProcess.kill('SIGTERM');
    await new Promise((resolve) => dashboardProcess.once('exit', resolve));
  }
});

test('dashboard API exposes role config updates and contact logging for operator review flows', async () => {
  const workspaceRoot = makeWorkspace();
  const started = await startDashboardServer({
    workflowRoot: workspaceRoot,
    host: '127.0.0.1',
    port: 0,
  });

  try {
    const importUpload = await requestJson({
      method: 'POST',
      url: `http://${started.host}:${started.port}/api/roles/demo-electrical-site-manager/import`,
      body: JSON.stringify({
        fileName: 'batch-update.csv',
        text: [
          'candidate_id,source,source_reference_id,search_variant,candidate_name,current_title,location,summary_text,email',
          'cvl-possible-002,CV-Library,CVL-POSSIBLE-002,medium,James Byrne,Electrical Supervisor,Bradford,Updated preview text for dashboard import,james.byrne@example.com',
        ].join('\n'),
        postImportAction: 'run_preview_triage',
      }),
    });

    const configUpdate = await requestJson({
      method: 'POST',
      url: `http://${started.host}:${started.port}/api/roles/demo-electrical-site-manager/config`,
      body: JSON.stringify({
        patch: {
          shortlist_target_size: 6,
          shortlist_mode: 'strict',
        },
      }),
    });

    const candidateUpdate = await requestJson({
      method: 'POST',
      url: `http://${started.host}:${started.port}/api/roles/demo-electrical-site-manager/candidates/cvl-possible-002/update`,
      body: JSON.stringify({
        patch: {
          decision: 'manual_screened',
          shortlist_status: 'possible_shortlist',
          shortlist_bucket: 'backup',
          ranking_pin: true,
          manual_screening_summary: 'Dashboard update captured a fuller recruiter review.',
          recruiter_confidence: 'high',
        },
      }),
    });

    const contactUpdate = await requestJson({
      method: 'POST',
      url: `http://${started.host}:${started.port}/api/roles/demo-electrical-site-manager/candidates/cvl-strong-001/contact`,
      body: JSON.stringify({
        stage: 'contacted',
        date: '2026-04-20',
        note: 'Manual outreach sent.',
        messageSummary: 'Shared role outline.',
      }),
    });

    const roleSummary = await requestJson({
      url: `http://${started.host}:${started.port}/api/roles/demo-electrical-site-manager`,
    });

    assert.equal(importUpload.statusCode, 200);
    assert.equal(importUpload.payload.importResult.importHistoryEntry.updated.count, 1);
    assert.equal(configUpdate.statusCode, 200);
    assert.equal(configUpdate.payload.result.roleConfig.shortlist_target_size, 6);
    assert.equal(candidateUpdate.statusCode, 200);
    assert.equal(candidateUpdate.payload.result.operatorReview.shortlist_bucket, 'backup');
    assert.equal(candidateUpdate.payload.result.operatorReview.ranking_pin, true);
    assert.equal(contactUpdate.statusCode, 200);
    assert.equal(contactUpdate.payload.result.contactEvent.stage, 'contacted');
    assert.equal(roleSummary.statusCode, 200);
    assert.equal(roleSummary.payload.role.shortlistProgress.target, 6);
    assert.equal(roleSummary.payload.role.candidateDetails.find((entry) => entry.candidate_id === 'cvl-strong-001').lifecycle.current_stage, 'contacted');
    assert.equal(roleSummary.payload.role.candidateDetails.find((entry) => entry.candidate_id === 'cvl-possible-002').operatorReview.shortlist_bucket, 'backup');
  } finally {
    await closeServer(started.server);
  }
});

test('dashboard import endpoint surfaces empty uploads clearly', async () => {
  const workspaceRoot = makeWorkspace();
  const started = await startDashboardServer({
    workflowRoot: workspaceRoot,
    host: '127.0.0.1',
    port: 0,
  });

  try {
    const response = await requestJson({
      method: 'POST',
      url: `http://${started.host}:${started.port}/api/roles/demo-electrical-site-manager/import`,
      body: JSON.stringify({
        fileName: 'empty.csv',
        text: '',
      }),
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.payload.code, 'empty_candidate_upload');
  } finally {
    await closeServer(started.server);
  }
});

test('dashboard import endpoint returns readable errors for malformed uploads', async () => {
  const workspaceRoot = makeWorkspace();
  const started = await startDashboardServer({
    workflowRoot: workspaceRoot,
    host: '127.0.0.1',
    port: 0,
  });

  try {
    const malformed = await requestJson({
      method: 'POST',
      url: `http://${started.host}:${started.port}/api/roles/demo-electrical-site-manager/import`,
      body: JSON.stringify({
        fileName: 'bad-batch.csv',
        text: [
          'candidate_id,candidate_name,current_title',
          'cvl-bad-001,Broken Candidate,Site Manager',
        ].join('\n'),
        postImportAction: 'run_preview_triage',
      }),
    });

    assert.equal(malformed.statusCode, 400);
    assert.equal(malformed.payload.code, 'invalid_candidate_csv');
    assert.match(malformed.payload.error, /missing required column/i);
  } finally {
    await closeServer(started.server);
  }
});

test('dashboard bulk CV upload endpoint parses readable files and refreshes the role summary', async () => {
  const workspaceRoot = makeWorkspace();
  const started = await startDashboardServer({
    workflowRoot: workspaceRoot,
    host: '127.0.0.1',
    port: 0,
  });

  try {
    const response = await requestJson({
      method: 'POST',
      url: `http://${started.host}:${started.port}/api/roles/demo-electrical-site-manager/bulk-cv-upload`,
      body: JSON.stringify({
        files: [
          {
            name: 'jane-candidate.pdf',
            contentType: 'application/pdf',
            size: Buffer.byteLength(Buffer.from(PRINT_TO_PDF_BASE64, 'base64')),
            data: PRINT_TO_PDF_BASE64,
          },
          {
            name: 'readable-docx.docx',
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: Buffer.byteLength(Buffer.from(READABLE_DOCX_BASE64, 'base64')),
            data: READABLE_DOCX_BASE64,
          },
        ],
        postImportAction: 'review_downloaded_cvs',
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.bulkImportResult.successfulCount, 2);
    assert.equal(response.payload.bulkImportResult.failedCount, 0);
    assert.ok(response.payload.role.roleHistory.latestBulkCvImport);
    assert.ok(response.payload.role.artifacts.bulkCvImportHistory.exists);
    assert.ok(response.payload.role.candidateDetails.some((entry) => entry.sourceAudit.import_method === 'bulk_cv_upload'));
  } finally {
    await closeServer(started.server);
  }
});

test('dashboard bulk CV upload endpoint surfaces empty uploads clearly', async () => {
  const workspaceRoot = makeWorkspace();
  const started = await startDashboardServer({
    workflowRoot: workspaceRoot,
    host: '127.0.0.1',
    port: 0,
  });

  try {
    const response = await requestJson({
      method: 'POST',
      url: `http://${started.host}:${started.port}/api/roles/demo-electrical-site-manager/bulk-cv-upload`,
      body: JSON.stringify({
        files: [],
        postImportAction: 'review_downloaded_cvs',
      }),
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.payload.code, 'empty_bulk_cv_upload');
  } finally {
    await closeServer(started.server);
  }
});
