'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const { execFile } = require('node:child_process');
const core = require('./sourcing-assistant-core.js');

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(response, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  response.end(text);
}

function sendBuffer(response, statusCode, buffer, contentType = 'application/octet-stream', extraHeaders = {}) {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  response.end(buffer);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function safeJsonParse(text) {
  if (!trimString(text)) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    const parseError = new Error('Request body is not valid JSON.');
    parseError.statusCode = 400;
    parseError.code = 'invalid_request_json';
    parseError.details = { cause: error?.message || String(error) };
    throw parseError;
  }
}

function dashboardStaticDir() {
  return path.join(__dirname, '..', 'sourcing-dashboard');
}

function sendError(response, error) {
  sendJson(response, error?.statusCode || 500, {
    ok: false,
    error: error?.message || 'Unexpected dashboard error.',
    code: error?.code || 'dashboard_error',
    details: error?.details || null,
  });
}

function resolveArtifactPath(workflowRoot, roleId, relativeTarget) {
  const baseDir = roleId
    ? core.resolveRoleDir(workflowRoot, roleId)
    : path.resolve(workflowRoot);
  const resolved = path.resolve(baseDir, relativeTarget);
  if (!resolved.startsWith(baseDir)) {
    throw new Error(roleId
      ? 'Artifact path is outside the selected role folder.'
      : 'Requested path is outside the workflow folder.');
  }
  return resolved;
}

function openPath(targetPath) {
  return new Promise((resolve, reject) => {
    execFile('open', [targetPath], (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function handleApi(request, response, workflowRoot, routePath, requestUrl) {
  if (routePath === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      workflowRoot,
      roles: core.listRoleIds(workflowRoot),
    });
    return;
  }

  if (routePath === '/api/roles' && request.method === 'GET') {
    sendJson(response, 200, {
      ok: true,
      roles: core.listRoles(workflowRoot),
    });
    return;
  }

  if (routePath === '/api/role-index' && request.method === 'GET') {
    sendJson(response, 200, {
      ok: true,
      roles: core.listRoleIndex(workflowRoot),
    });
    return;
  }

  if (routePath === '/api/init-role' && request.method === 'POST') {
    const body = safeJsonParse(await readRequestBody(request));
    const result = core.scaffoldRoleWorkspace({
      workflowRoot,
      roleId: trimString(body.roleId, 120) || trimString(body.roleTitle, 120),
      roleTitle: trimString(body.roleTitle, 160),
    });
    sendJson(response, 200, { ok: true, result });
    return;
  }

  if (routePath === '/api/open-path' && request.method === 'POST') {
    const body = safeJsonParse(await readRequestBody(request));
    const roleId = trimString(body.roleId, 120);
    const relativePath = trimString(body.relativePath, 400);
    if (!relativePath) {
      sendJson(response, 400, { ok: false, error: 'relativePath is required.' });
      return;
    }
    const targetPath = resolveArtifactPath(workflowRoot, roleId, relativePath);
    await openPath(targetPath);
    sendJson(response, 200, { ok: true, targetPath });
    return;
  }

  const roleMatch = routePath.match(/^\/api\/roles\/([^/]+)$/);
  if (roleMatch && request.method === 'GET') {
    const roleId = decodeURIComponent(roleMatch[1]);
    sendJson(response, 200, {
      ok: true,
      role: core.summariseRoleFromDisk(workflowRoot, roleId),
    });
    return;
  }

  const runMatch = routePath.match(/^\/api\/roles\/([^/]+)\/run$/);
  if (runMatch && request.method === 'POST') {
    const roleId = decodeURIComponent(runMatch[1]);
    const body = safeJsonParse(await readRequestBody(request));
    const role = await core.runRoleWorkspace({
      workflowRoot,
      roleId,
      action: trimString(body.action, 80) || 'run_all',
    });
    sendJson(response, 200, {
      ok: true,
      role,
    });
    return;
  }

  const configMatch = routePath.match(/^\/api\/roles\/([^/]+)\/config$/);
  if (configMatch && request.method === 'POST') {
    const roleId = decodeURIComponent(configMatch[1]);
    const body = safeJsonParse(await readRequestBody(request));
    const result = await core.updateRoleConfig({
      workflowRoot,
      roleId,
      actor: trimString(body.actor, 80) || 'operator',
      patch: body.patch && typeof body.patch === 'object' ? body.patch : {},
    });
    sendJson(response, 200, { ok: true, result });
    return;
  }

  const updateMatch = routePath.match(/^\/api\/roles\/([^/]+)\/candidates\/([^/]+)\/update$/);
  if (updateMatch && request.method === 'POST') {
    const roleId = decodeURIComponent(updateMatch[1]);
    const candidateId = decodeURIComponent(updateMatch[2]);
    const body = safeJsonParse(await readRequestBody(request));
    const result = await core.updateCandidateOperatorState({
      workflowRoot,
      roleId,
      candidateId,
      actor: trimString(body.actor, 80) || 'operator',
      patch: body.patch && typeof body.patch === 'object' ? body.patch : {},
    });
    sendJson(response, 200, { ok: true, result });
    return;
  }

  const contactMatch = routePath.match(/^\/api\/roles\/([^/]+)\/candidates\/([^/]+)\/contact$/);
  if (contactMatch && request.method === 'POST') {
    const roleId = decodeURIComponent(contactMatch[1]);
    const candidateId = decodeURIComponent(contactMatch[2]);
    const body = safeJsonParse(await readRequestBody(request));
    const result = await core.logCandidateContactState({
      workflowRoot,
      roleId,
      candidateId,
      actor: trimString(body.actor, 80) || 'operator',
      stage: trimString(body.stage, 40),
      date: trimString(body.date, 80),
      note: trimString(body.note, 600),
      messageSummary: trimString(body.messageSummary, 1000),
    });
    sendJson(response, 200, { ok: true, result });
    return;
  }

  const artifactMatch = routePath.match(/^\/api\/roles\/([^/]+)\/artifact$/);
  if (artifactMatch && request.method === 'GET') {
    const roleId = decodeURIComponent(artifactMatch[1]);
    const relativePath = trimString(requestUrl.searchParams.get('path'), 400);
    const download = requestUrl.searchParams.get('download') === '1';
    if (!relativePath) {
      sendJson(response, 400, { ok: false, error: 'Artifact path is required.' });
      return;
    }
    const targetPath = resolveArtifactPath(workflowRoot, roleId, relativePath);
    if (!fs.existsSync(targetPath)) {
      sendJson(response, 404, { ok: false, error: 'Artifact not found.' });
      return;
    }
    const extension = path.extname(targetPath).toLowerCase();
    const contentType = extension === '.json'
      ? 'application/json; charset=utf-8'
      : extension === '.md'
        ? 'text/markdown; charset=utf-8'
        : extension === '.txt'
          ? 'text/plain; charset=utf-8'
          : extension === '.pdf'
            ? 'application/pdf'
            : extension === '.docx'
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : extension === '.doc'
                ? 'application/msword'
                : 'application/octet-stream';
    const isText = contentType.startsWith('text/') || contentType.startsWith('application/json');
    const extraHeaders = download
      ? {
        'content-disposition': `attachment; filename=\"${path.basename(targetPath).replace(/"/g, '')}\"`,
      }
      : {};
    if (isText) {
      sendBuffer(response, 200, Buffer.from(fs.readFileSync(targetPath, 'utf8'), 'utf8'), contentType, extraHeaders);
    } else {
      sendBuffer(response, 200, fs.readFileSync(targetPath), contentType, extraHeaders);
    }
    return;
  }

  sendJson(response, 404, { ok: false, error: 'Not found.' });
}

function serveStatic(response, routePath) {
  const staticDir = dashboardStaticDir();
  if (!fs.existsSync(staticDir)) {
    sendText(response, 500, 'Dashboard static assets are missing.\n');
    return;
  }
  const relativePath = routePath === '/' ? 'index.html' : routePath.replace(/^\/+/, '');
  const targetPath = path.resolve(staticDir, relativePath);
  if (!targetPath.startsWith(staticDir) || !fs.existsSync(targetPath)) {
    sendText(response, 404, 'Not found.\n');
    return;
  }
  const extension = path.extname(targetPath).toLowerCase();
  const contentType = extension === '.html'
    ? 'text/html; charset=utf-8'
    : extension === '.css'
      ? 'text/css; charset=utf-8'
      : extension === '.js'
        ? 'application/javascript; charset=utf-8'
        : 'text/plain; charset=utf-8';
  sendText(response, 200, fs.readFileSync(targetPath, 'utf8'), contentType);
}

function startDashboardServer({ workflowRoot, host = '127.0.0.1', port = core.DEFAULT_PORT }) {
  const resolvedWorkflowRoot = path.resolve(workflowRoot);
  if (!fs.existsSync(resolvedWorkflowRoot)) {
    const error = new Error(`Workflow root was not found: ${resolvedWorkflowRoot}`);
    error.statusCode = 404;
    error.code = 'missing_workflow_root';
    return Promise.reject(error);
  }
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
      const routePath = requestUrl.pathname;
      if (routePath.startsWith('/api/')) {
        await handleApi(request, response, resolvedWorkflowRoot, routePath, requestUrl);
        return;
      }
      serveStatic(response, routePath);
    } catch (error) {
      sendError(response, error);
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        error.statusCode = 409;
        error.message = `Dashboard port ${port} is already in use.`;
      }
      reject(error);
    });
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        server,
        host,
        port: typeof address === 'object' && address?.port ? address.port : port,
        workflowRoot: resolvedWorkflowRoot,
      });
    });
  });
}

module.exports = {
  startDashboardServer,
};
