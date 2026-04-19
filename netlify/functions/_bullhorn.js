'use strict';

const { createHmac, randomBytes } = require('node:crypto');
const { trimString } = require('./_finance-crypto.js');
const { escapeHtml } = require('./_html.js');

const BULLHORN_PUBLIC_CALLBACK_PATH = '/api/connectors/bullhorn/callback';
const BULLHORN_FUNCTION_CALLBACK_PATH = '/.netlify/functions/admin-bullhorn-callback';
const BULLHORN_LOGIN_INFO_URL = 'https://rest.bullhornstaffing.com/rest-services/loginInfo';
const BULLHORN_DEFAULT_RETURN_PATH = '/admin/candidates.html';

function lowerText(value, maxLength) {
  return trimString(value, maxLength).toLowerCase();
}

function normaliseUrl(value) {
  const raw = trimString(value, 1000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function resolveBaseUrl(event = {}) {
  const envValue = trimString(
    process.env.HMJ_CANONICAL_SITE_URL
      || process.env.URL
      || process.env.SITE_URL
      || process.env.DEPLOY_PRIME_URL
      || '',
    1000
  );
  if (envValue) {
    const normalised = normaliseUrl(envValue);
    if (normalised) return normalised;
  }

  const origin = trimString(event?.headers?.origin, 1000);
  if (origin) {
    const normalised = normaliseUrl(origin);
    if (normalised) return normalised;
  }

  const host = trimString(event?.headers?.['x-forwarded-host'] || event?.headers?.host, 1000);
  const proto = trimString(event?.headers?.['x-forwarded-proto'], 16) || 'https';
  if (host) {
    const normalised = normaliseUrl(`${proto}://${host}`);
    if (normalised) return normalised;
  }
  return '';
}

function fallbackOrigin(event = {}) {
  return resolveBaseUrl(event) || 'https://hmj-global.com';
}

function buildBullhornReturnUrl(event = {}, path = BULLHORN_DEFAULT_RETURN_PATH, params = {}) {
  const baseUrl = fallbackOrigin(event);
  const fallback = trimString(path, 1000) || BULLHORN_DEFAULT_RETURN_PATH;
  const url = new URL(fallback, `${baseUrl}/`);
  Object.entries(params || {}).forEach(([key, value]) => {
    const next = trimString(value, 500);
    if (next) url.searchParams.set(key, next);
  });
  return url.toString();
}

function normalizeReturnTo(event = {}, rawValue, fallbackPath = BULLHORN_DEFAULT_RETURN_PATH) {
  const fallback = buildBullhornReturnUrl(event, fallbackPath);
  const candidate = trimString(rawValue, 1000);
  if (!candidate) return fallback;

  try {
    const resolved = new URL(candidate, fallbackOrigin(event));
    const fallbackUrl = new URL(fallback);
    if (resolved.origin !== fallbackUrl.origin) return fallback;
    return resolved.toString();
  } catch {
    return fallback;
  }
}

function appendQueryParams(target, params = {}) {
  const url = new URL(target, fallbackOrigin());
  Object.entries(params || {}).forEach(([key, value]) => {
    const next = trimString(value, 500);
    if (!next) return;
    url.searchParams.set(key, next);
  });
  if (/^https?:\/\//i.test(target || '')) return url.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

function resolveStateSecret() {
  return trimString(
    process.env.HMJ_FINANCE_SECRET
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_KEY
      || process.env.SUPABASE_JWT_SECRET
      || '',
    4000
  );
}

function bullhornError(message, classification, statusCode = 500, details = null) {
  const error = new Error(message);
  error.code = statusCode;
  error.statusCode = statusCode;
  error.classification = classification || 'bullhorn_error';
  if (details) error.details = details;
  return error;
}

function buildSafeBullhornMeta(meta = {}) {
  const next = {};
  Object.entries(meta || {}).forEach(([key, value]) => {
    if (value == null) return;
    const lowered = String(key || '').toLowerCase();
    if (
      lowered.includes('token')
      || lowered.includes('secret')
      || lowered.includes('code')
      || lowered.includes('state')
      || lowered.includes('authorization')
    ) {
      return;
    }
    if (typeof value === 'string') {
      next[key] = trimString(value, 500);
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      next[key] = value;
      return;
    }
    if (Array.isArray(value)) {
      next[key] = value.slice(0, 10).map((item) => trimString(item, 120));
      return;
    }
    if (typeof value === 'object') {
      next[key] = buildSafeBullhornMeta(value);
    }
  });
  return next;
}

function logBullhorn(stage, meta = {}) {
  try {
    console.log(`[bullhorn] ${stage} ${JSON.stringify(buildSafeBullhornMeta(meta))}`);
  } catch {
    console.log(`[bullhorn] ${stage}`);
  }
}

function buildSignedState(data = {}) {
  const secret = resolveStateSecret();
  if (!secret) {
    throw bullhornError(
      'Missing HMJ_FINANCE_SECRET or service secret for Bullhorn state signing.',
      'missing_config',
      500
    );
  }
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function parseSignedState(raw) {
  const secret = resolveStateSecret();
  if (!secret) {
    throw bullhornError(
      'Missing HMJ_FINANCE_SECRET or service secret for Bullhorn state signing.',
      'missing_config',
      500
    );
  }
  const value = trimString(raw, 8000);
  const dot = value.lastIndexOf('.');
  if (dot <= 0) {
    throw bullhornError('Invalid Bullhorn callback state.', 'bad_state', 400);
  }
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (expected !== signature) {
    throw bullhornError('Bullhorn callback state could not be verified.', 'bad_state', 400);
  }
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const issuedAt = Number(decoded?.iat || 0);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) {
    throw bullhornError('Bullhorn callback state is incomplete.', 'bad_state', 400);
  }
  if ((Date.now() - issuedAt) > (20 * 60 * 1000)) {
    throw bullhornError(
      'Bullhorn connection state has expired. Start the connection again.',
      'bad_state',
      400
    );
  }
  return decoded;
}

function randomNonce() {
  return randomBytes(24).toString('base64url');
}

function resolveBullhornConfig(event = {}) {
  const clientId = trimString(process.env.BULLHORN_CLIENT_ID, 240);
  const clientSecret = trimString(process.env.BULLHORN_CLIENT_SECRET, 4000);
  const apiUsername = trimString(process.env.BULLHORN_API_USERNAME, 320);
  const redirectUri = trimString(process.env.BULLHORN_REDIRECT_URI, 1000)
    || buildBullhornReturnUrl(event, BULLHORN_PUBLIC_CALLBACK_PATH);

  if (!clientId) throw bullhornError('BULLHORN_CLIENT_ID is missing.', 'missing_config', 500);
  if (!clientSecret) throw bullhornError('BULLHORN_CLIENT_SECRET is missing.', 'missing_config', 500);
  if (!apiUsername) throw bullhornError('BULLHORN_API_USERNAME is missing.', 'missing_config', 500);
  if (!redirectUri) throw bullhornError('BULLHORN_REDIRECT_URI is missing.', 'missing_config', 500);

  let parsedRedirect;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    throw bullhornError('BULLHORN_REDIRECT_URI must be an absolute URL.', 'missing_config', 500);
  }

  if (parsedRedirect.protocol !== 'https:') {
    throw bullhornError('BULLHORN_REDIRECT_URI must use HTTPS.', 'missing_config', 500);
  }
  if (parsedRedirect.pathname !== BULLHORN_PUBLIC_CALLBACK_PATH) {
    throw bullhornError(
      `BULLHORN_REDIRECT_URI must use the exact ${BULLHORN_PUBLIC_CALLBACK_PATH} path.`,
      'missing_config',
      500
    );
  }
  if (parsedRedirect.search || parsedRedirect.hash) {
    throw bullhornError(
      'BULLHORN_REDIRECT_URI must not include a query string or fragment.',
      'missing_config',
      500
    );
  }

  return {
    clientId,
    clientSecret,
    apiUsername,
    redirectUri: parsedRedirect.toString(),
    callbackPath: BULLHORN_PUBLIC_CALLBACK_PATH,
    functionCallbackPath: BULLHORN_FUNCTION_CALLBACK_PATH,
  };
}

function buildBullhornDiagnostics(event = {}, connection = null) {
  const warnings = [];
  let config = null;
  try {
    config = resolveBullhornConfig(event);
  } catch (error) {
    warnings.push(trimString(error?.message, 500) || 'Bullhorn OAuth configuration is incomplete.');
  }

  return {
    setupReady: warnings.length === 0,
    callbackUrl: config?.redirectUri || '',
    apiUsername: config?.apiUsername || '',
    connected: !!connection?.refreshToken,
    warnings,
  };
}

function normalizeOauthBaseUrl(rawValue) {
  const raw = trimString(rawValue, 1000);
  if (!raw) {
    throw bullhornError('Bullhorn loginInfo did not return an OAuth URL.', 'wrong_data_center', 502);
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw bullhornError('Bullhorn loginInfo returned an invalid OAuth URL.', 'wrong_data_center', 502);
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path.endsWith('/oauth/authorize') || path.endsWith('/oauth/token')) {
    parsed.pathname = `${path.replace(/\/(authorize|token)$/, '')}/`;
  } else if (path.endsWith('/oauth')) {
    parsed.pathname = `${path}/`;
  } else if (!path) {
    parsed.pathname = '/oauth/';
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function normalizeRestBaseUrl(rawValue) {
  const raw = trimString(rawValue, 1000);
  if (!raw) {
    throw bullhornError('Bullhorn loginInfo did not return a REST URL.', 'wrong_data_center', 502);
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw bullhornError('Bullhorn loginInfo returned an invalid REST URL.', 'wrong_data_center', 502);
  }
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/?$/, '/');
  return parsed.toString();
}

function normalizeLoginInfoPayload(payload = {}) {
  const source = Array.isArray(payload)
    ? payload[0]
    : payload && typeof payload === 'object'
      ? payload.data || payload
      : {};

  return {
    oauthBaseUrl: normalizeOauthBaseUrl(
      source.oauthUrl
        || source.oauthURL
        || source.authUrl
        || source.authURL
    ),
    restBaseUrl: normalizeRestBaseUrl(
      source.restUrl
        || source.restURL
    ),
  };
}

async function parseJsonResponse(response) {
  return response.json().catch(async () => {
    const text = await response.text().catch(() => '');
    return { raw: trimString(text, 2000) };
  });
}

async function requestBullhornJson(url, options = {}, requestOptions = {}) {
  const fetchImpl = requestOptions.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') {
    throw bullhornError('Fetch is unavailable in this runtime.', 'runtime_error', 500);
  }
  const maxAttempts = Math.max(1, Number(requestOptions.maxAttempts || 2));
  const allowRedirectRetry = requestOptions.allowRedirectRetry !== false;
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    accept: 'application/json',
    ...(options.headers || {}),
  };

  let currentUrl = trimString(url, 2000);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(currentUrl, {
      ...options,
      method,
      headers,
      redirect: 'manual',
    }).catch((error) => {
      lastError = bullhornError(
        trimString(error?.message, 400) || 'Bullhorn request failed.',
        requestOptions.classification || 'network_error',
        502
      );
      return null;
    });

    if (!response) {
      if (attempt >= maxAttempts) throw lastError;
      continue;
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = trimString(response.headers.get('location'), 2000);
      if (allowRedirectRetry && location) {
        currentUrl = location;
        lastError = bullhornError(
          'Bullhorn redirected the request to another data center.',
          'wrong_data_center',
          502,
          { location }
        );
        if (attempt < maxAttempts) continue;
      }
      throw bullhornError(
        'Bullhorn redirected the request to another data center.',
        'wrong_data_center',
        502
      );
    }

    const payload = await parseJsonResponse(response);
    if (response.ok) return payload;

    const classification = requestOptions.classification || (
      response.status === 401 ? 'expired_session' : 'bullhorn_request_failed'
    );
    const message = trimString(
      payload?.error_description
        || payload?.errorMessage
        || payload?.error
        || payload?.message
        || payload?.raw,
      400
    ) || 'Bullhorn request failed.';

    if (attempt < maxAttempts && (response.status >= 500 || response.status === 429)) {
      lastError = bullhornError(message, classification, response.status || 502, payload);
      continue;
    }

    throw bullhornError(message, classification, response.status || 502, payload);
  }

  throw lastError || bullhornError('Bullhorn request failed.', 'bullhorn_request_failed', 502);
}

async function getLoginInfo(username, options = {}) {
  const safeUsername = trimString(username, 320);
  if (!safeUsername) {
    throw bullhornError('BULLHORN_API_USERNAME is missing.', 'missing_config', 500);
  }
  const url = new URL(BULLHORN_LOGIN_INFO_URL);
  url.searchParams.set('username', safeUsername);
  const payload = await requestBullhornJson(url.toString(), {}, {
    fetchImpl: options.fetchImpl,
    classification: 'wrong_data_center',
    maxAttempts: 3,
  });
  return normalizeLoginInfoPayload(payload);
}

function buildAuthorizeUrl(options = {}) {
  const config = options.config || resolveBullhornConfig(options.event);
  const loginInfo = options.loginInfo;
  if (!loginInfo?.oauthBaseUrl) {
    throw bullhornError('Bullhorn OAuth base URL is missing.', 'missing_config', 500);
  }

  const returnTo = normalizeReturnTo(options.event, options.returnTo, BULLHORN_DEFAULT_RETURN_PATH);
  const statePayload = {
    provider: 'bullhorn',
    nonce: trimString(options.nonce, 240) || randomNonce(),
    userId: trimString(options.user?.id || options.user?.userId, 240),
    email: lowerText(options.user?.email, 320),
    returnTo,
    iat: Date.now(),
  };
  const state = buildSignedState(statePayload);
  const url = new URL('authorize', loginInfo.oauthBaseUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('action', 'Login');
  url.searchParams.set('username', config.apiUsername);

  return {
    url: url.toString(),
    state,
    redirectUri: config.redirectUri,
    returnTo,
    pendingState: {
      nonce: statePayload.nonce,
      userId: statePayload.userId,
      email: statePayload.email,
      returnTo,
    },
  };
}

async function exchangeCodeForToken(options = {}) {
  const config = options.config || resolveBullhornConfig(options.event);
  const loginInfo = options.loginInfo;
  if (!loginInfo?.oauthBaseUrl) {
    throw bullhornError('Bullhorn OAuth base URL is missing.', 'token_exchange_failure', 500);
  }

  const response = await requestBullhornJson(new URL('token', loginInfo.oauthBaseUrl).toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: trimString(options.code, 4000),
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    }).toString(),
  }, {
    fetchImpl: options.fetchImpl,
    classification: 'token_exchange_failure',
    maxAttempts: 2,
  });

  return {
    accessToken: trimString(response.access_token, 16000),
    refreshToken: trimString(response.refresh_token, 16000),
    expiresIn: Number(response.expires_in || 0),
    tokenType: trimString(response.token_type, 80),
    scope: trimString(response.scope, 2000),
    raw: response,
  };
}

async function refreshToken(options = {}) {
  const config = options.config || resolveBullhornConfig(options.event);
  const loginInfo = options.loginInfo;
  if (!loginInfo?.oauthBaseUrl) {
    throw bullhornError('Bullhorn OAuth base URL is missing.', 'token_exchange_failure', 500);
  }

  const response = await requestBullhornJson(new URL('token', loginInfo.oauthBaseUrl).toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: trimString(options.refreshToken, 4000),
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    }).toString(),
  }, {
    fetchImpl: options.fetchImpl,
    classification: 'token_exchange_failure',
    maxAttempts: 2,
  });

  return {
    accessToken: trimString(response.access_token, 16000),
    refreshToken: trimString(response.refresh_token, 16000),
    expiresIn: Number(response.expires_in || 0),
    tokenType: trimString(response.token_type, 80),
    scope: trimString(response.scope, 2000),
    raw: response,
  };
}

async function loginToRest(accessToken, loginInfo, options = {}) {
  if (!trimString(accessToken, 16000)) {
    throw bullhornError('Bullhorn access token is missing.', 'rest_login_failure', 500);
  }
  if (!loginInfo?.restBaseUrl) {
    throw bullhornError('Bullhorn REST login URL is missing.', 'rest_login_failure', 500);
  }

  const url = new URL('login', loginInfo.restBaseUrl);
  url.searchParams.set('access_token', trimString(accessToken, 16000));
  url.searchParams.set('version', '*');
  const response = await requestBullhornJson(url.toString(), {}, {
    fetchImpl: options.fetchImpl,
    classification: 'rest_login_failure',
    maxAttempts: 2,
  });

  const bhRestToken = trimString(response.BhRestToken || response.bhRestToken, 16000);
  const restUrl = trimString(response.restUrl, 1000);
  if (!bhRestToken || !restUrl) {
    throw bullhornError('Bullhorn REST login returned an incomplete session.', 'rest_login_failure', 502);
  }

  return {
    bhRestToken,
    restUrl,
    raw: response,
  };
}

function accessTokenExpiryIso(payload = {}) {
  const expiresIn = Number(payload.expiresIn || payload.expires_in || 0);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return '';
  return new Date(Date.now() + (expiresIn * 1000)).toISOString();
}

function buildOperatorErrorPage(detail) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Bullhorn Callback Error</title>
  <style>
    body{margin:0;font:16px/1.4 system-ui,sans-serif;background:#f6f7f8;color:#101418}
    main{max-width:36rem;margin:12vh auto;padding:1.25rem 1.5rem;background:#fff;border:1px solid #d7dde5;border-radius:12px}
    p{margin:.5rem 0}
    code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
  </style>
</head>
<body>
  <main>
    <p>Bullhorn callback is not configured correctly.</p>
    <p>The callback route is deployed, but the Bullhorn assistant configuration is incomplete.</p>
    <p>${escapeHtml(detail)}</p>
    <p>Check <code>BULLHORN_CLIENT_ID</code>, <code>BULLHORN_CLIENT_SECRET</code>, <code>BULLHORN_REDIRECT_URI</code>, and <code>BULLHORN_API_USERNAME</code> in Netlify.</p>
  </main>
</body>
</html>`;
}

function buildNoStoreHeaders(extra = {}) {
  return Object.assign({
    'cache-control': 'no-store, no-cache, must-revalidate, private',
    pragma: 'no-cache',
    expires: '0',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow, noarchive',
  }, extra);
}

module.exports = {
  BULLHORN_DEFAULT_RETURN_PATH,
  BULLHORN_FUNCTION_CALLBACK_PATH,
  BULLHORN_LOGIN_INFO_URL,
  BULLHORN_PUBLIC_CALLBACK_PATH,
  accessTokenExpiryIso,
  appendQueryParams,
  buildAuthorizeUrl,
  buildBullhornDiagnostics,
  buildBullhornReturnUrl,
  buildNoStoreHeaders,
  buildOperatorErrorPage,
  buildSafeBullhornMeta,
  buildSignedState,
  bullhornError,
  exchangeCodeForToken,
  getLoginInfo,
  logBullhorn,
  loginToRest,
  normalizeLoginInfoPayload,
  normalizeReturnTo,
  parseSignedState,
  randomNonce,
  refreshToken,
  requestBullhornJson,
  resolveBaseUrl,
  resolveBullhornConfig,
};
