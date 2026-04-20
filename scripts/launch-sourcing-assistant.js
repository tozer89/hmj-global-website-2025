#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const core = require('../lib/sourcing-assistant-core.js');

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

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(body || `Request failed with status ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url, timeoutMs, workflowRoot) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const result = await httpGetJson(`${url}api/health`);
      if (result?.ok && (!workflowRoot || result.workflowRoot === workflowRoot)) {
        return true;
      }
    } catch {
      // Server not up yet.
    }
    await wait(250);
  }
  return false;
}

function openTarget(target) {
  const child = spawn('open', [target], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function showDialog(message) {
  const script = `display dialog ${JSON.stringify(message)} buttons {"OK"} default button "OK" with icon stop`;
  const child = spawn('osascript', ['-e', script], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
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
    launcherState: path.join(logsDir, 'launcher-state.json'),
    sessionState: path.join(logsDir, 'dashboard-session.json'),
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

function tailFile(filePath, lines = 20) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).slice(-lines).join('\n').trim();
}

async function pickDashboardPort({ host, workflowRoot, preferredPort, maxOffset = 10, sessionPort }) {
  const ports = [];
  if (Number.isInteger(sessionPort) && sessionPort > 0) ports.push(sessionPort);
  if (Number.isInteger(preferredPort) && preferredPort > 0 && !ports.includes(preferredPort)) ports.push(preferredPort);
  for (let offset = 1; offset <= maxOffset; offset += 1) {
    const candidate = preferredPort + offset;
    if (!ports.includes(candidate)) ports.push(candidate);
  }

  for (const port of ports) {
    const url = `http://${host}:${port}/`;
    if (await waitForHealth(url, 400, workflowRoot)) {
      return { url, port, reused: true };
    }
    if (await isPortFree(host, port)) {
      return { url, port, reused: false };
    }
  }

  throw new Error(`No usable dashboard port was found from ${preferredPort} to ${preferredPort + maxOffset}.`);
}

async function main() {
  const args = parseArgs(process.argv);
  const workflowRoot = path.resolve(args['workflow-root'] || process.cwd());
  const config = core.readWorkflowConfig(workflowRoot);
  const host = '127.0.0.1';
  const timeoutMs = Number(args['timeout-ms']) || 12000;
  const logs = logPaths(workflowRoot);
  const previousSession = readJson(logs.sessionState, {});
  const dashboardScript = path.join(config.websiteRepoPath, 'scripts', 'start-sourcing-dashboard.js');
  const dashboardAssets = path.join(config.websiteRepoPath, 'sourcing-dashboard', 'index.html');

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
  });

  if (!selectedPort.reused) {
    fs.mkdirSync(logs.logsDir, { recursive: true });
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
  }

  const isHealthy = await waitForHealth(selectedPort.url, timeoutMs, workflowRoot);
  if (!isHealthy) {
    const logTail = tailFile(logs.dashboardLog, 12);
    throw new Error(`The sourcing dashboard did not become ready at ${selectedPort.url} within ${timeoutMs}ms.${logTail ? `\n\nRecent dashboard log:\n${logTail}` : ''}`);
  }

  atomicWriteJson(logs.sessionState, {
    workflowRoot,
    port: selectedPort.port,
    url: selectedPort.url,
    checkedAt: new Date().toISOString(),
  });
  atomicWriteJson(logs.launcherState, {
    ok: true,
    workflowRoot,
    url: selectedPort.url,
    port: selectedPort.port,
    checkedAt: new Date().toISOString(),
  });

  if (args['no-open'] !== 'true') {
    openTarget(selectedPort.url);
  }

  process.stdout.write(`${selectedPort.url}\n`);
}

main().catch((error) => {
  const args = parseArgs(process.argv);
  const workflowRoot = path.resolve(args['workflow-root'] || process.cwd());
  const logs = logPaths(workflowRoot);
  const message = error?.message || String(error);
  try {
    atomicWriteJson(logs.launcherState, {
      ok: false,
      workflowRoot,
      error: message,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    // Best effort only.
  }
  console.error(message);
  if (process.env.HMJ_SOURCING_NO_DIALOG !== '1') {
    showDialog(`HMJ Sourcing Assistant could not start.\n\n${message}`);
  }
  process.exitCode = 1;
});
