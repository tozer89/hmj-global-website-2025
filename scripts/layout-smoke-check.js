#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const SCENARIOS = [
  { label: 'home-desktop', route: '/index.html', width: 1440, height: 1600 },
  { label: 'home-laptop', route: '/index.html', width: 1280, height: 1400 },
  { label: 'home-mobile', route: '/index.html', width: 390, height: 2200 },
  { label: 'clients-desktop', route: '/clients.html', width: 1440, height: 1800 },
  { label: 'rate-book-desktop', route: '/rate-book.html', width: 1440, height: 2200 },
  { label: 'rate-book-mobile', route: '/rate-book.html', width: 390, height: 2400 },
  { label: 'about-tablet', route: '/about.html', width: 1024, height: 1800 },
  { label: 'jobs-laptop', route: '/jobs.html', width: 1280, height: 2200 },
  { label: 'jobs-mobile', route: '/jobs.html', width: 390, height: 2200 },
  { label: 'job-detail-mobile', route: '/jobs/gold-card-electrician-slough/', width: 390, height: 2200 },
  { label: 'candidates-tablet', route: '/candidates.html', width: 900, height: 2200 },
  { label: 'contact-mobile', route: '/contact.html', width: 390, height: 2200 },
  { label: 'timesheets-mobile', route: '/timesheets.html', width: 390, height: 1800 },
  { label: 'admin-gate-desktop', route: '/admin/index.html', width: 1280, height: 1200 },
  { label: 'admin-gate-mobile', route: '/admin/index.html', width: 390, height: 1800 },
  { label: 'admin-gate-small-mobile', route: '/admin/index.html', width: 320, height: 1600 },
  { label: 'admin-jobs-gate-mobile', route: '/admin/jobs.html', width: 390, height: 1800 },
];

const ACTIVE_SCENARIOS = (() => {
  const raw = (process.env.HMJ_LAYOUT_FILTER || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!raw.length) return SCENARIOS;

  return SCENARIOS.filter((scenario) =>
    raw.some((token) => scenario.label.includes(token) || scenario.route.includes(token)),
  );
})();

const CHROME_TIMEOUT_MS = Number(process.env.HMJ_LAYOUT_TIMEOUT_MS || '25000');
const SCREENSHOT_BUDGET_MS = Number(process.env.HMJ_LAYOUT_BUDGET_MS || '4000');
const MIN_SCREENSHOT_BYTES = Number(process.env.HMJ_LAYOUT_MIN_BYTES || '25000');
const OUTPUT_DIR = path.resolve(
  process.env.HMJ_LAYOUT_OUTDIR || fs.mkdtempSync(path.join(os.tmpdir(), 'hmj-layout-smoke-')),
);

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
};

function which(command) {
  try {
    return execFileSync('which', [command], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function findChromeBinary() {
  const envPath = process.env.HMJ_LAYOUT_CHROME_PATH;
  const candidates = [
    envPath,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    which('google-chrome'),
    which('chromium'),
    which('chromium-browser'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    'Unable to find a Chrome/Chromium binary. Set HMJ_LAYOUT_CHROME_PATH to a local executable.',
  );
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

function runScenario(chrome, port, scenario) {
  const outFile = path.join(OUTPUT_DIR, `${scenario.label}.png`);
  const url = `http://127.0.0.1:${port}${scenario.route}`;

  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  execFileSync(
    chrome,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      `--window-size=${scenario.width},${scenario.height}`,
      `--virtual-time-budget=${SCREENSHOT_BUDGET_MS}`,
      `--screenshot=${outFile}`,
      url,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: CHROME_TIMEOUT_MS,
    },
  );

  const stat = fs.statSync(outFile);
  if (stat.size < MIN_SCREENSHOT_BYTES) {
    throw new Error(`Screenshot unexpectedly small (${stat.size} bytes)`);
  }

  return {
    ...scenario,
    output: outFile,
    bytes: stat.size,
  };
}

function formatSummary(results) {
  return results
    .map((result) => {
      if (!result.ok) {
        return `${result.label} failed - ${result.error}`;
      }

      const kilobytes = Math.round(result.bytes / 1024);
      return `${result.label} ok - ${result.width}x${result.height} - ${kilobytes} KB - ${result.output}`;
    })
    .join('\n');
}

async function main() {
  if (!ACTIVE_SCENARIOS.length) {
    console.log('No layout smoke scenarios matched HMJ_LAYOUT_FILTER.');
    return;
  }

  const chrome = findChromeBinary();
  const { server, port } = await startServer();

  try {
    const results = [];

    for (const scenario of ACTIVE_SCENARIOS) {
      try {
        const result = runScenario(chrome, port, scenario);
        console.error('Captured', scenario.label);
        results.push({ ...result, ok: true });
      } catch (error) {
        results.push({
          ...scenario,
          ok: false,
          error: error.message || String(error),
        });
      }
    }

    console.log(formatSummary(results));
    console.log(`Screenshots written to ${OUTPUT_DIR}`);

    if (results.some((result) => !result.ok)) {
      process.exitCode = 1;
    }
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
