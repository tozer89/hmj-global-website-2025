const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');

const { startDashboardServer } = require('../lib/sourcing-dashboard-server.js');

const fixtureRoot = path.join(__dirname, 'fixtures', 'sourcing-assistant-workspace');
const websiteRepoPath = path.join(__dirname, '..');
const launchScript = path.join(websiteRepoPath, 'scripts', 'launch-sourcing-assistant.js');
const startDashboardScript = path.join(websiteRepoPath, 'scripts', 'start-sourcing-dashboard.js');

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

    assert.equal(configUpdate.statusCode, 200);
    assert.equal(configUpdate.payload.result.roleConfig.shortlist_target_size, 6);
    assert.equal(contactUpdate.statusCode, 200);
    assert.equal(contactUpdate.payload.result.contactEvent.stage, 'contacted');
    assert.equal(roleSummary.statusCode, 200);
    assert.equal(roleSummary.payload.role.shortlistProgress.target, 6);
    assert.equal(roleSummary.payload.role.candidateDetails.find((entry) => entry.candidate_id === 'cvl-strong-001').lifecycle.current_stage, 'contacted');
  } finally {
    await closeServer(started.server);
  }
});
