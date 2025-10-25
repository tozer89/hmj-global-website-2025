const fetchImpl = typeof fetch === 'function' ? fetch : (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const PRODUCTION_IDENTITY_BASE = (process.env.HMJ_IDENTITY_BASE || 'https://hmjg.netlify.app/.netlify/identity').replace(/\/$/, '');

const HOP_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'authorization',
  'content-type',
  'content-length',
  'cookie',
  'if-none-match',
  'if-modified-since',
  'origin',
  'referer',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'user-agent',
  'x-csrf-token',
  'x-netlify-csrf',
  'x-nf-client-id',
  'x-nf-session-id',
  'x-requested-with'
]);

function normaliseHost(value = '') {
  if (!value) return '';
  const first = String(value).split(',')[0].trim();
  return first.replace(/:\d+$/, '');
}

function rewriteCookieDomain(cookie, host) {
  if (!cookie || !host) return cookie;
  const domainPattern = /;\s*domain=[^;]*/i;
  const name = String(cookie).split(';', 1)[0].split('=')[0].trim();
  if (name && name.startsWith('__Host-')) {
    // __Host- cookies must not specify Domain attributes
    return cookie.replace(domainPattern, '');
  }
  if (domainPattern.test(cookie)) {
    return cookie.replace(domainPattern, `; Domain=${host}`);
  }
  return `${cookie}; Domain=${host}`;
}

function normaliseHost(value = '') {
  if (!value) return '';
  const first = String(value).split(',')[0].trim();
  return first.replace(/:\d+$/, '');
}

function rewriteCookieDomain(cookie, host) {
  if (!cookie || !host) return cookie;
  const domainPattern = /;\s*domain=[^;]*/i;
  const name = String(cookie).split(';', 1)[0].split('=')[0].trim();
  if (name && name.startsWith('__Host-')) {
    // __Host- cookies must not specify Domain attributes
    return cookie.replace(domainPattern, '');
  }
  if (domainPattern.test(cookie)) {
    return cookie.replace(domainPattern, `; Domain=${host}`);
  }
  return `${cookie}; Domain=${host}`;
}

function buildUrl(pathname = '', params = {}) {
  const trimmed = String(pathname || '').replace(/^\/+/, '');
  const base = PRODUCTION_IDENTITY_BASE;
  const url = new URL(base + (trimmed ? '/' + trimmed : ''));
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'path') continue;
    if (Array.isArray(value)) {
      value.forEach((v) => search.append(key, v));
    } else if (value != null) {
      search.append(key, value);
    }
  }
  url.search = search.toString();
  return url.toString();
}

function pickHeaders(source) {
  const result = {};
  if (!source) return result;
  for (const [key, value] of Object.entries(source)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (HOP_HEADERS.has(lower)) {
      result[key] = value;
    }
  }
  return result;
}

function normaliseBody(event) {
  if (!event.body) return undefined;
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64');
  }
  return event.body;
}

function corsHeaders(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Vary': 'Origin',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-trace',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
}

function extractProxyPath(event, singleParams = {}) {
  if (singleParams?.path) {
    return singleParams.path;
  }

  const prefix = '/.netlify/functions/identity-proxy';
  const eventPath = event.path || '';
  if (eventPath.startsWith(prefix)) {
    return eventPath.slice(prefix.length).replace(/^\/+/, '');
  }

  const rawUrl = event.rawUrl || '';
  const index = rawUrl.indexOf(prefix);
  if (index !== -1) {
    return rawUrl
      .slice(index + prefix.length)
      .split('?')[0]
      .replace(/^\/+/, '');
  }

  return '';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders(event),
    };
  }

  const params = event.multiValueQueryStringParameters || {};
  const singleParams = event.queryStringParameters || {};
  const merged = { ...singleParams };
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value) && value.length > 1) {
      merged[key] = value;
    }
  }

  delete merged.path;

  const proxyPath = extractProxyPath(event, singleParams);

  const target = buildUrl(proxyPath, merged);

  try {
    const response = await fetchImpl(target, {
      method: event.httpMethod,
      headers: pickHeaders(event.headers),
      body: normaliseBody(event),
      redirect: 'manual'
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    const headers = Object.fromEntries(response.headers.entries());

    delete headers['content-length'];
    delete headers['transfer-encoding'];

    delete headers['set-cookie'];

    const cors = corsHeaders(event);
    Object.assign(headers, cors);

    const raw = typeof response.headers.raw === 'function'
      ? response.headers.raw()
      : undefined;
    const multiValueHeaders = {};
    const host = normaliseHost(
      event.headers?.['x-forwarded-host'] ||
      event.headers?.['X-Forwarded-Host'] ||
      event.headers?.host ||
      event.headers?.Host ||
      ''
    );
    const setCookieSource = raw?.['set-cookie'] || (typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : undefined);
    const setCookieValues = Array.isArray(setCookieSource)
      ? setCookieSource
      : setCookieSource
        ? [setCookieSource]
        : [];
    if (setCookieValues.length) {
      multiValueHeaders['set-cookie'] = setCookieValues.map((cookie) => rewriteCookieDomain(cookie, host));
    }
    if (raw) {
      for (const [key, values] of Object.entries(raw)) {
        if (!values || key.toLowerCase() === 'set-cookie') continue;
        if (Array.isArray(values) && values.length > 1) {
          multiValueHeaders[key] = values;
        }
      }
    }

    return {
      statusCode: response.status,
      headers,
      multiValueHeaders,
      body: buffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    console.error('identity proxy failed', err);
    return {
      statusCode: 502,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'identity_proxy_failed' })
    };
  }
};
