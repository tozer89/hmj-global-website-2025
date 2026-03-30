// netlify/functions/_http.js
// Shared HTTP helpers for admin Netlify Functions (CORS, tracing, auth hints)

// ---------------------------------------------------------------------------
// CORS allowlist — only origins on this list receive credentialed CORS headers.
// Reflecting arbitrary Origin values with Access-Control-Allow-Credentials:true
// would allow any website to make credentialed requests to admin endpoints.
//
// To add a new allowed origin (e.g. a staging branch), append it here.
// process.env.URL is injected by Netlify and equals the current deploy URL,
// covering branch-deploy and deploy-preview contexts automatically.
// ---------------------------------------------------------------------------
function buildAllowedOrigins() {
  const staticOrigins = new Set([
    'https://hmj-global.com',
    'https://www.hmj-global.com',
    'https://hmjg.netlify.app',
  ]);
  // Include the Netlify-injected deploy URL so branch/preview deploys work.
  const deployUrl = (process.env.URL || process.env.DEPLOY_URL || '').trim().replace(/\/$/, '');
  if (deployUrl && /^https?:\/\//i.test(deployUrl)) {
    staticOrigins.add(deployUrl.toLowerCase());
  }
  return staticOrigins;
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

function header(event, name) {
  if (!event || !event.headers) return '';
  const direct = event.headers[name];
  if (direct) return direct;
  const lower = name.toLowerCase();
  for (const key of Object.keys(event.headers)) {
    if (key.toLowerCase() === lower) return event.headers[key];
  }
  return '';
}

function buildCors(event) {
  const requestOrigin = (header(event, 'origin') || '').trim().toLowerCase().replace(/\/$/, '');
  // Only grant credentialed CORS to origins on the allowlist.
  // Unrecognised origins receive no ACAO header, which causes the browser to
  // block the response — correct and intentional behaviour.
  const allowedOrigin = requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : null;

  const headers = {
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-trace',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    String(cookieHeader)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((segment) => {
        const index = segment.indexOf('=');
        if (index === -1) return [segment, ''];
        const key = segment.slice(0, index);
        const value = decodeURIComponent(segment.slice(index + 1));
        return [key, value];
      })
  );
}

function hasToken(event) {
  const auth = header(event, 'authorization');
  if (auth && /bearer\s+\S+/i.test(auth)) return true;
  const cookies = parseCookies(header(event, 'cookie'));
  if (cookies.nf_jwt) return true;
  if (cookies['nf_jwt']) return true;
  return false;
}

function withAdminCors(handler, options = {}) {
  const requireToken = options.requireToken !== false;
  return async function wrapped(event = {}, context = {}) {
    const cors = buildCors(event);
    const trace = header(event, 'x-trace');
    if (trace) {
      console.log(`[#hmjg] trace=${trace} ${event.httpMethod || ''} ${event.path || event.rawUrl || ''}`);
    }

    if ((event.httpMethod || '').toUpperCase() === 'OPTIONS') {
      return { statusCode: 200, headers: cors };
    }

    if (requireToken && !hasToken(event)) {
      const body = JSON.stringify({ ok: false, error: 'missing token', msg: 'missing token' });
      const headers = Object.assign({}, cors);
      if (trace) headers['x-trace'] = trace;
      console.warn('[#hmjg] admin function missing token', event.path || event.rawUrl || '');
      return { statusCode: 401, headers, body };
    }

    try {
      const result = await handler(event, context);
      if (!result) {
        return { statusCode: 204, headers: cors };
      }
      const next = Object.assign({}, result);
      next.headers = Object.assign({}, cors, result.headers || {});
      if (trace) {
        next.headers['x-trace'] = trace;
      }
      return next;
    } catch (err) {
      console.error('[#hmjg] admin function error', err?.message || err);
      const rawStatus = err?.statusCode ?? err?.status ?? err?.code;
      const parsedStatus = Number.parseInt(String(rawStatus ?? ''), 10);
      const statusCode = Number.isInteger(parsedStatus) && parsedStatus >= 100 && parsedStatus <= 599
        ? parsedStatus
        : 500;
      const payload = err?.body || JSON.stringify({ ok: false, error: err?.message || 'server_error' });
      const headers = Object.assign({}, cors);
      if (trace) headers['x-trace'] = trace;
      return { statusCode, headers, body: payload };
    }
  };
}

module.exports = { withAdminCors, buildCors };
