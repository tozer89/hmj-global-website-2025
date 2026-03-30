'use strict';

const { escapeHtml } = require('./_html.js');

const CALLBACK_PATH = '/api/connectors/quickbooks/callback';
const TARGET_ENV = 'HMJ_ASSISTANT_QBO_CALLBACK_TARGET';
const ALLOWED_HOSTS_ENV = 'HMJ_ASSISTANT_QBO_ALLOWED_HOSTS';

function configError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function buildHeaders(extra = {}) {
  return Object.assign({
    'cache-control': 'no-store, no-cache, must-revalidate, private',
    'pragma': 'no-cache',
    'expires': '0',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow, noarchive',
    'content-security-policy': "default-src 'none'; img-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'content-type': 'text/html; charset=utf-8',
  }, extra);
}

function readRawQuery(event = {}) {
  const rawUrl = typeof event.rawUrl === 'string' ? event.rawUrl : '';
  const queryIndex = rawUrl.indexOf('?');
  if (queryIndex >= 0) {
    const hashIndex = rawUrl.indexOf('#', queryIndex);
    return rawUrl.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined);
  }

  if (typeof event.rawQuery === 'string') return event.rawQuery;

  if (event.multiValueQueryStringParameters && typeof event.multiValueQueryStringParameters === 'object') {
    const segments = [];
    Object.entries(event.multiValueQueryStringParameters).forEach(([key, values]) => {
      if (Array.isArray(values)) {
        values.forEach((value) => {
          segments.push(`${encodeURIComponent(key)}=${encodeURIComponent(value == null ? '' : value)}`);
        });
        return;
      }
      if (values != null) {
        segments.push(`${encodeURIComponent(key)}=${encodeURIComponent(values)}`);
      }
    });
    return segments.join('&');
  }

  if (event.queryStringParameters && typeof event.queryStringParameters === 'object') {
    const params = new URLSearchParams();
    Object.entries(event.queryStringParameters).forEach(([key, value]) => {
      if (value != null) params.append(key, value);
    });
    return params.toString();
  }

  return '';
}

function isTsNetHostname(hostname) {
  const value = String(hostname || '').trim().toLowerCase();
  return value.endsWith('.ts.net');
}

function normalizeAllowedHost(entry) {
  const raw = String(entry || '').trim();
  if (!raw) return '';

  try {
    const url = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
    return String(url.hostname || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

function parseAllowedHosts() {
  const raw = String(process.env[ALLOWED_HOSTS_ENV] || '').trim();
  if (!raw) return null;

  const hosts = raw
    .split(/[,\n\r]+/)
    .map((entry) => normalizeAllowedHost(entry))
    .filter(Boolean);

  if (!hosts.length) {
    throw configError(
      `${ALLOWED_HOSTS_ENV} is set but does not contain any valid hostnames.`,
      'invalid_allowed_hosts'
    );
  }

  return new Set(hosts);
}

function validateTargetUrl(target) {
  if (target.username || target.password) {
    throw configError(
      `${TARGET_ENV} must not include embedded credentials.`,
      'invalid_target_credentials'
    );
  }

  if (target.protocol === 'https:') {
    // Allow any explicit HTTPS target unless an allowlist narrows it further.
  } else if (target.protocol === 'http:') {
    if (!isTsNetHostname(target.hostname)) {
      throw configError(
        `${TARGET_ENV} must use HTTPS, or HTTP only for a private *.ts.net assistant host.`,
        'invalid_target_protocol'
      );
    }
  } else {
    throw configError(
      `${TARGET_ENV} must be an absolute HTTPS URL, or an HTTP URL on a private *.ts.net assistant host.`,
      'invalid_target_protocol'
    );
  }

  if (target.pathname !== CALLBACK_PATH) {
    throw configError(
      `${TARGET_ENV} must use the exact ${CALLBACK_PATH} path.`,
      'invalid_target_path'
    );
  }

  if (target.search || target.hash) {
    throw configError(
      `${TARGET_ENV} must not include its own query string or fragment.`,
      'invalid_target_suffix'
    );
  }

  const allowedHosts = parseAllowedHosts();
  if (allowedHosts && !allowedHosts.has(String(target.hostname || '').toLowerCase())) {
    throw configError(
      `${TARGET_ENV} host is not approved by ${ALLOWED_HOSTS_ENV}.`,
      'target_host_not_allowed'
    );
  }
}

function resolveTarget() {
  const raw = String(process.env[TARGET_ENV] || '').trim();
  if (!raw) {
    throw configError(`${TARGET_ENV} is not set.`, 'missing_target');
  }

  let target;
  try {
    target = new URL(raw);
  } catch {
    throw configError(`${TARGET_ENV} must be a valid absolute URL.`, 'invalid_target');
  }

  validateTargetUrl(target);
  return target;
}

function buildRedirectLocation(target, rawQuery) {
  const base = target.toString();
  if (!rawQuery) return base;
  return `${base}?${rawQuery}`;
}

function buildSuccessHtml(location) {
  const href = escapeHtml(location);
  const jsLocation = JSON.stringify(location);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta http-equiv="refresh" content="0;url=${href}">
  <title>Redirecting to HMJ Assistant</title>
  <style>
    body{margin:0;font:16px/1.4 system-ui,sans-serif;background:#f6f7f8;color:#101418}
    main{max-width:32rem;margin:12vh auto;padding:1.25rem 1.5rem;background:#fff;border:1px solid #d7dde5;border-radius:12px}
    p{margin:.5rem 0}
    a{color:#0f4f8a}
  </style>
  <script>window.location.replace(${jsLocation});</script>
</head>
<body>
  <main>
    <p>Redirecting to HMJ Assistant.</p>
    <p><a href="${href}" rel="nofollow noreferrer">Continue to HMJ Assistant</a></p>
  </main>
</body>
</html>`;
}

function buildOperatorErrorHtml(detail) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>QuickBooks Callback Bridge Error</title>
  <style>
    body{margin:0;font:16px/1.4 system-ui,sans-serif;background:#f6f7f8;color:#101418}
    main{max-width:36rem;margin:12vh auto;padding:1.25rem 1.5rem;background:#fff;border:1px solid #d7dde5;border-radius:12px}
    p{margin:.5rem 0}
    code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
  </style>
</head>
<body>
  <main>
    <p>QuickBooks callback is not configured correctly.</p>
    <p>The callback bridge is deployed, but the assistant callback target is missing or invalid.</p>
    <p>${escapeHtml(detail)}</p>
    <p>Check <code>${TARGET_ENV}</code> and, if used, <code>${ALLOWED_HOSTS_ENV}</code> in Netlify.</p>
  </main>
</body>
</html>`;
}

async function handler(event = {}) {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  if (method !== 'GET') {
    return {
      statusCode: 405,
      headers: buildHeaders({ allow: 'GET' }),
      body: buildOperatorErrorHtml('Only GET is supported for this QuickBooks callback bridge.'),
    };
  }

  let location;
  try {
    const target = resolveTarget();
    const rawQuery = readRawQuery(event);
    location = buildRedirectLocation(target, rawQuery);
  } catch (error) {
    return {
      statusCode: 500,
      headers: buildHeaders(),
      body: buildOperatorErrorHtml(error?.message || 'Assistant callback target validation failed.'),
    };
  }

  return {
    statusCode: 302,
    headers: buildHeaders({ location }),
    body: buildSuccessHtml(location),
  };
}

module.exports = {
  handler,
  __test: {
    ALLOWED_HOSTS_ENV,
    CALLBACK_PATH,
    TARGET_ENV,
    buildHeaders,
    buildRedirectLocation,
    normalizeAllowedHost,
    parseAllowedHosts,
    readRawQuery,
    resolveTarget,
    validateTargetUrl,
  },
};
