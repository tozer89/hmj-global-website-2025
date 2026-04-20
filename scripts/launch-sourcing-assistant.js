#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const core = require('../lib/sourcing-assistant-core.js');

const OPEN_BIN = process.env.HMJ_SOURCING_OPEN_BIN || '/usr/bin/open';
const OSASCRIPT_BIN = '/usr/bin/osascript';

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--')
      ? argv[++index]
      : 'true';
    args[key] = value;
  }
  return args;
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function logPaths(workflowRoot) {
  const logsDir = path.join(workflowRoot, 'logs');
  return {
    logsDir,
    dashboardLog: path.join(logsDir, 'sourcing-dashboard.log'),
    launcherLog: path.join(logsDir, 'launcher-events.jsonl'),
    launcherState: path.join(logsDir, 'launcher-state.json'),
    sessionState: path.join(logsDir, 'dashboard-session.json'),
  };
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

function tailFile(filePath, lines = 20) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).slice(-lines).join('\n').trim();
}

function buildLauncherState(base = {}) {
  return {
    ok: false,
    workflowRoot: '',
    repoRoot: '',
    url: '',
    port: 0,
    selectedNodeBin: process.execPath,
    selectedOpenBin: OPEN_BIN,
    browserOpenAttempted: false,
    browserOpenSucceeded: false,
    dashboardHealthy: false,
    reusedHealthyDashboard: false,
    error: '',
    checkedAt: new Date().toISOString(),
    ...base,
  };
}

function logEvent(logs, event, payload = {}) {
  appendJsonLine(logs.launcherLog, {
    at: new Date().toISOString(),
    event,
    pid: process.pid,
    ...payload,
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, {
      agent: false,
      headers: {
        connection: 'close',
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode && response.statusCode >= 400) {
          request.destroy();
          reject(new Error(body || `Request failed with status ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
        request.destroy();
        response.destroy();
      });
    });
    request.setTimeout(1500, () => {
      request.destroy(new Error(`Health request timed out for ${url}`));
    });
    request.on('error', reject);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url, timeoutMs, workflowRoot, logs = null) {
  const startedAt = Date.now();
  let lastError = '';
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const result = await httpGetJson(`${url}api/health`);
      if (result?.ok && (!workflowRoot || result.workflowRoot === workflowRoot)) {
        if (logs) {
          logEvent(logs, 'dashboard_health_ok', {
            url,
            workflowRoot,
            elapsedMs: Date.now() - startedAt,
          });
        }
        return {
          ok: true,
          elapsedMs: Date.now() - startedAt,
          lastError,
        };
      }
      lastError = `Health check returned an unexpected workflow root for ${url}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await wait(250);
  }
  if (logs) {
    logEvent(logs, 'dashboard_health_timeout', {
      url,
      workflowRoot,
      elapsedMs: Date.now() - startedAt,
      lastError,
    });
  }
  return {
    ok: false,
    elapsedMs: Date.now() - startedAt,
    lastError,
  };
}

async function isPortFree(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function pickDashboardPort({ host, workflowRoot, preferredPort, maxOffset = 10, sessionPort, logs }) {
  const ports = [];
  if (Number.isInteger(sessionPort) && sessionPort > 0) ports.push(sessionPort);
  if (Number.isInteger(preferredPort) && preferredPort > 0 && !ports.includes(preferredPort)) ports.push(preferredPort);
  for (let offset = 1; offset <= maxOffset; offset += 1) {
    const candidate = preferredPort + offset;
    if (!ports.includes(candidate)) ports.push(candidate);
  }

  for (const port of ports) {
    const url = `http://${host}:${port}/`;
    const health = await waitForHealth(url, 2000, workflowRoot);
    if (health.ok) {
      if (logs) {
        logEvent(logs, 'dashboard_port_reused', {
          url,
          port,
          sessionPort,
          preferredPort,
        });
      }
      return { url, port, reused: true };
    }
    if (await isPortFree(host, port)) {
      if (logs) {
        logEvent(logs, 'dashboard_port_selected', {
          url,
          port,
          reused: false,
          priorHealthError: health.lastError || '',
        });
      }
      return { url, port, reused: false };
    }
    if (logs) {
      logEvent(logs, 'dashboard_port_occupied', {
        url,
        port,
        priorHealthError: health.lastError || '',
      });
    }
  }

  throw new Error(`No usable dashboard port was found from ${preferredPort} to ${preferredPort + maxOffset}.`);
}

function openTarget(target) {
  return new Promise((resolve, reject) => {
    execFile(OPEN_BIN, [target], (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout || '';
        error.stderr = stderr || '';
        reject(error);
        return;
      }
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
      });
    });
  });
}

function showDialog(message) {
  const script = `display dialog ${JSON.stringify(message)} buttons {"OK"} default button "OK" with icon stop`;
  const child = spawn(OSASCRIPT_BIN, ['-e', script], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function main() {
  const args = parseArgs(process.argv);
  const workflowRoot = path.resolve(args['workflow-root'] || process.cwd());
  const logs = logPaths(workflowRoot);
  fs.mkdirSync(logs.logsDir, { recursive: true });

  const baseState = buildLauncherState({
    workflowRoot,
    selectedNodeBin: process.execPath,
    selectedOpenBin: OPEN_BIN,
  });
  atomicWriteJson(logs.launcherState, {
    ...baseState,
    status: 'starting',
  });
  logEvent(logs, 'launcher_started', {
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    workflowRoot,
    nodeBin: process.execPath,
    openBin: OPEN_BIN,
    pathEnv: process.env.PATH || '',
  });

  const config = core.readWorkflowConfig(workflowRoot);
  const host = '127.0.0.1';
  const timeoutMs = Number(args['timeout-ms']) || 12000;
  const previousSession = readJson(logs.sessionState, {});
  const dashboardScript = path.join(config.websiteRepoPath, 'scripts', 'start-sourcing-dashboard.js');
  const dashboardAssets = path.join(config.websiteRepoPath, 'sourcing-dashboard', 'index.html');

  logEvent(logs, 'config_loaded', {
    repoRoot: config.websiteRepoPath,
    dashboardPort: config.dashboardPort,
    rolesDir: config.rolesDir,
    sessionPort: Number(previousSession?.port) || 0,
  });

  if (!fs.existsSync(workflowRoot)) {
    throw new Error(`Workflow root was not found: ${workflowRoot}`);
  }
  if (!fs.existsSync(config.websiteRepoPath)) {
    throw new Error(`Website repo path was not found: ${config.websiteRepoPath}`);
  }
  if (!fs.existsSync(dashboardScript)) {
    throw new Error(`Could not find dashboard starter script at ${dashboardScript}`);
  }
  if (!fs.existsSync(dashboardAssets)) {
    throw new Error(`Could not find dashboard static assets at ${dashboardAssets}`);
  }

  const selectedPort = await pickDashboardPort({
    host,
    workflowRoot,
    preferredPort: config.dashboardPort,
    sessionPort: Number(previousSession?.port) || null,
    logs,
  });

  if (!selectedPort.reused) {
    const logFd = fs.openSync(logs.dashboardLog, 'a');
    const child = spawn(process.execPath, [
      dashboardScript,
      '--workflow-root', workflowRoot,
      '--port', String(selectedPort.port),
    ], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      cwd: config.websiteRepoPath,
    });
    child.unref();
    fs.closeSync(logFd);
    logEvent(logs, 'dashboard_spawned', {
      pid: child.pid,
      port: selectedPort.port,
      url: selectedPort.url,
    });
  }

  const health = await waitForHealth(selectedPort.url, timeoutMs, workflowRoot, logs);
  if (!health.ok) {
    const logTail = tailFile(logs.dashboardLog, 12);
    throw new Error(`The sourcing dashboard did not become ready at ${selectedPort.url} within ${timeoutMs}ms.${health.lastError ? ` Last health error: ${health.lastError}.` : ''}${logTail ? `\n\nRecent dashboard log:\n${logTail}` : ''}`);
  }

  atomicWriteJson(logs.sessionState, {
    workflowRoot,
    repoRoot: config.websiteRepoPath,
    port: selectedPort.port,
    url: selectedPort.url,
    reusedHealthyDashboard: selectedPort.reused,
    checkedAt: new Date().toISOString(),
  });

  const successState = buildLauncherState({
    ok: true,
    status: 'dashboard_ready',
    workflowRoot,
    repoRoot: config.websiteRepoPath,
    url: selectedPort.url,
    port: selectedPort.port,
    dashboardHealthy: true,
    reusedHealthyDashboard: selectedPort.reused,
  });

  if (args['no-open'] !== 'true') {
    logEvent(logs, 'browser_open_started', {
      url: selectedPort.url,
    });
    try {
      await openTarget(selectedPort.url);
      logEvent(logs, 'browser_open_succeeded', {
        url: selectedPort.url,
      });
      atomicWriteJson(logs.launcherState, {
        ...successState,
        browserOpenAttempted: true,
        browserOpenSucceeded: true,
      });
    } catch (error) {
      const browserError = error?.message || String(error);
      logEvent(logs, 'browser_open_failed', {
        url: selectedPort.url,
        error: browserError,
        stdout: error?.stdout || '',
        stderr: error?.stderr || '',
      });
      atomicWriteJson(logs.launcherState, {
        ...successState,
        ok: false,
        status: 'browser_open_failed',
        browserOpenAttempted: true,
        browserOpenSucceeded: false,
        error: `The dashboard started at ${selectedPort.url}, but macOS could not open it automatically. ${browserError}`,
      });
      throw new Error(`The dashboard started at ${selectedPort.url}, but macOS could not open it automatically.\n\nBrowser open error: ${browserError}\n\nYou can still open this URL manually:\n${selectedPort.url}`);
    }
  } else {
    logEvent(logs, 'browser_open_skipped', {
      url: selectedPort.url,
      reason: 'no-open flag set',
    });
    atomicWriteJson(logs.launcherState, {
      ...successState,
      browserOpenAttempted: false,
      browserOpenSucceeded: false,
    });
  }

  logEvent(logs, 'launcher_completed', {
    url: selectedPort.url,
    port: selectedPort.port,
    reusedHealthyDashboard: selectedPort.reused,
  });
  process.stdout.write(`${selectedPort.url}\n`);
}

main().catch((error) => {
  const args = parseArgs(process.argv);
  const workflowRoot = path.resolve(args['workflow-root'] || process.cwd());
  const logs = logPaths(workflowRoot);
  const previousState = readJson(logs.launcherState, {});
  const message = error?.message || String(error);
  try {
    fs.mkdirSync(logs.logsDir, { recursive: true });
    logEvent(logs, 'launcher_failed', {
      error: message,
      stack: error?.stack || '',
    });
    atomicWriteJson(logs.launcherState, {
      ...buildLauncherState(previousState),
      ...previousState,
      ok: false,
      status: 'failed',
      error: message,
      checkedAt: new Date().toISOString(),
      eventsLog: logs.launcherLog,
      dashboardLog: logs.dashboardLog,
    });
  } catch {
    // Best effort only.
  }
  console.error(message);
  if (process.env.HMJ_SOURCING_NO_DIALOG !== '1') {
    showDialog(`HMJ Sourcing Assistant could not start.\n\n${message}\n\nLogs:\n${logs.launcherLog}`);
  }
  process.exitCode = 1;
});
