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

const ALLOW_HEADERS = [
  'authorization',
  'content-type',
  'netlify-csrf',
  'x-csrf-token',
  'x-netlify-csrf',
  'x-requested-with'
].join(', ');

const ALLOW_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

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

function resolveSelfOrigin(event) {
  const proto = event.headers?.['x-forwarded-proto'] || event.headers?.['X-Forwarded-Proto'] || 'https';
  const host = event.headers?.['x-forwarded-host'] || event.headers?.['X-Forwarded-Host'] || event.headers?.host || event.headers?.Host;
  if (!host) return '';
  return `${proto}://${host}`;
}

function corsHeaders(event) {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || '';
  const allowOrigin = requestOrigin || resolveSelfOrigin(event);
  const headers = {
    'access-control-allow-methods': ALLOW_METHODS.join(', '),
    'access-control-allow-headers': ALLOW_HEADERS,
    'vary': 'origin'
  };
  if (allowOrigin) {
    headers['access-control-allow-origin'] = allowOrigin;
    headers['access-control-allow-credentials'] = 'true';
  } else {
    headers['access-control-allow-origin'] = '*';
  }
  return headers;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
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

  const target = buildUrl(singleParams?.path || '', merged);

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

    Object.assign(headers, corsHeaders(event));

    const raw = response.headers.raw?.();
    const multiValueHeaders = {};
    if (raw && raw['set-cookie']) {
      multiValueHeaders['set-cookie'] = raw['set-cookie'];
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
