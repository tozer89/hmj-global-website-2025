#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEBUG_PORT = 9227;
const START_TIMEOUT_MS = 15000;
const STEP_TIMEOUT_MS = 12000;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mjs': 'text/javascript; charset=utf-8',
};

function which(command) {
  try {
    return execFileSync('which', [command], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function findChromeBinary() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    which('google-chrome'),
    which('chromium'),
    which('chromium-browser'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error('Unable to find a Chrome/Chromium binary.');
}

function send(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(body);
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, 'http://127.0.0.1');
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    return send(res, 403, 'Forbidden');
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      return send(res, error.code === 'ENOENT' ? 404 : 500, error.code || 'error');
    }

    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, MIME_TYPES[ext] || 'application/octet-stream');
  });
}

function startServer() {
  const server = http.createServer(serveStatic);
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

async function waitForJson(url, timeoutMs = START_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.json();
      }
    } catch (error) {
      // Keep polling until Chrome is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function createTarget(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  if (!response.ok) {
    throw new Error(`Could not create browser target (${response.status})`);
  }
  return response.json();
}

function createCdpClient(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let sequence = 0;

    socket.addEventListener('open', () => {
      resolve({
        async send(method, params = {}) {
          const id = ++sequence;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
          });
        },
        close() {
          socket.close();
        },
      });
    });

    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.id) return;
      const handlers = pending.get(payload.id);
      if (!handlers) return;
      pending.delete(payload.id);
      if (payload.error) {
        handlers.rej(new Error(payload.error.message || 'CDP command failed.'));
      } else {
        handlers.res(payload.result);
      }
    });

    socket.addEventListener('error', (error) => {
      reject(error);
    });

    socket.addEventListener('close', () => {
      pending.forEach(({ rej }) => rej(new Error('CDP socket closed')));
      pending.clear();
    });
  });
}

function launchChrome(chromePath) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmj-candidate-walkthrough-'));
  const process = spawn(
    chromePath,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      'about:blank',
    ],
    {
      cwd: ROOT,
      stdio: 'ignore',
    }
  );

  return {
    process,
    cleanup() {
      try {
        process.kill('SIGTERM');
      } catch (error) {
        // Ignore process cleanup failures.
      }
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore temp cleanup failures.
      }
    },
  };
}

async function runScenario(client, pageUrl) {
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  await client.send('Page.navigate', { url: pageUrl });
  await client.send('Runtime.evaluate', {
    expression: 'new Promise((resolve) => window.addEventListener("load", () => setTimeout(resolve, 250), { once: true }))',
    awaitPromise: true,
  });

  const expression = `
    (async () => {
      const email = 'tozer89+candidate-walkthrough@gmail.com';
      const password = 'StrongPass1';
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (check, timeoutMs = ${STEP_TIMEOUT_MS}) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          const result = check();
          if (result) return result;
          await wait(50);
        }
        throw new Error('Timed out waiting for browser condition');
      };
      const setValue = (selector, value) => {
        const field = document.querySelector(selector);
        if (!field) throw new Error('Missing field: ' + selector);
        field.focus();
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const click = (selector) => {
        const button = document.querySelector(selector);
        if (!button) throw new Error('Missing button: ' + selector);
        button.click();
      };
      const addSkill = (value) => {
        const input = document.getElementById('tagInput');
        input.value = value;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      };
      const checkRtw = (labelText) => {
        const labels = Array.from(document.querySelectorAll('#rtwGroup label'));
        const label = labels.find((item) => item.textContent.includes(labelText));
        if (!label) throw new Error('Missing RTW label: ' + labelText);
        const checkbox = label.querySelector('input');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      };

      await waitFor(() => document.querySelector('[data-auth-form="signin"]'));
      click('[data-scroll-to-register="true"]');
      await wait(400);
      const registerFocus = document.activeElement ? document.activeElement.id : '';

      setValue('#fname', 'Jamie');
      setValue('#lname', 'Bennett');
      setValue('#email', email);
      setValue('#phone', '+44 7700 900123');
      setValue('#address1', '1 Cable Street');
      setValue('#town', 'London');
      setValue('#postcode', 'E1 6QL');
      setValue('#country', 'United Kingdom');
      setValue('#location', 'London, United Kingdom');
      setValue('#rightToWorkStatus', 'Full right to work already in place');
      setValue('#discipline', 'Electrical (MEP)');
      setValue('#currentJobTitle', 'Lead Electrical Supervisor');
      setValue('#role', 'Lead Electrical Supervisor');
      setValue('#yearsExperience', '12');
      setValue('#qualifications', 'SSSTS, AP, IOSH');
      setValue('#sectorExperience', 'Data centres, pharma');
      setValue('#availability', 'Available in two weeks');
      setValue('#reloc', 'Maybe');
      checkRtw('United Kingdom');
      addSkill('IST');
      addSkill('QA/QC');

      const consent = Array.from(document.querySelectorAll('.candidate-consent input[type="checkbox"]'))[0];
      consent.checked = true;
      consent.dispatchEvent(new Event('change', { bubbles: true }));

      const fileInput = document.getElementById('cv');
      const file = new File(['Mock CV content'], 'candidate-cv.pdf', { type: 'application/pdf' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));

      setValue('#candidatePassword', password);
      setValue('#candidateConfirmPassword', 'WrongPass1');
      await wait(200);
      const mismatchText = document.getElementById('candidatePasswordStatus').textContent.trim();
      const mismatchDisabled = document.getElementById('submitBtn').disabled;

      setValue('#candidateConfirmPassword', password);
      await waitFor(() => !document.getElementById('submitBtn').disabled);
      document.getElementById('submitBtn').click();

      const formStatus = await waitFor(() => {
        const root = document.getElementById('candidateFormStatusRoot');
        if (!root || root.hidden) return '';
        return root.innerText.trim();
      });

      const resendButton = document.querySelector('[data-auth-action="resend-verification-from-form"]');
      if (resendButton) {
        resendButton.click();
        await waitFor(() => document.getElementById('candidateFormStatusRoot').innerText.includes('fresh verification email'));
      }
      const resendStatus = document.getElementById('candidateFormStatusRoot').innerText.trim();

      const store = window.__hmjCandidatePortalLocalMockState;
      store.usersByEmail[email].email_confirmed_at = new Date().toISOString();

      setValue('[data-auth-form="signin"] input[name="email"]', email);
      setValue('[data-auth-form="signin"] input[name="password"]', password);
      document.querySelector('[data-auth-form="signin"] button[type="submit"]').click();

      const dashboardHeading = await waitFor(() => {
        const heading = document.querySelector('.candidate-dashboard-hero h2');
        return heading ? heading.textContent.trim() : '';
      });

      setValue('[data-dashboard-form="profile"] input[name="phone"]', '+44 7700 900555');
      document.querySelector('[data-dashboard-form="profile"] button[type="submit"]').click();
      const profileSaveMessage = await waitFor(() => {
        const alert = document.querySelector('.candidate-portal-alert');
        if (!alert) return '';
        const text = alert.innerText.trim();
        return text.includes('Profile saved.') ? text : '';
      });

      click('[data-dashboard-action="signout"]');
      await waitFor(() => document.querySelector('[data-auth-form="signin"]'));

      click('[data-auth-mode="reset"]');
      await waitFor(() => document.querySelector('[data-auth-form="reset"]'));
      setValue('[data-auth-form="reset"] input[name="email"]', email);
      document.querySelector('[data-auth-form="reset"] button[type="submit"]').click();
      const resetMessage = await waitFor(() => {
        const alert = document.querySelector('.candidate-portal-alert');
        if (!alert) return '';
        const text = alert.innerText.trim();
        return text.includes('Reset link sent.') ? text : '';
      });

      return {
        registerFocus,
        mismatchText,
        mismatchDisabled,
        formStatus,
        resendStatus,
        dashboardHeading,
        profileSaveMessage,
        resetMessage,
      };
    })()
  `;

  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  return result.result.value;
}

async function main() {
  const chromePath = findChromeBinary();
  const { server, port } = await startServer();
  const chrome = launchChrome(chromePath);

  try {
    await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const target = await createTarget(
      DEBUG_PORT,
      `http://127.0.0.1:${port}/candidates.html?candidate_mock=1`
    );
    const client = await createCdpClient(target.webSocketDebuggerUrl);

    try {
      const results = await runScenario(
        client,
        `http://127.0.0.1:${port}/candidates.html?candidate_mock=1`
      );
      console.log(JSON.stringify(results, null, 2));
    } finally {
      client.close();
    }
  } finally {
    server.close();
    chrome.cleanup();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
