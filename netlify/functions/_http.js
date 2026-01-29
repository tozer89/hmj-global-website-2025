// netlify/functions/_http.js
// Shared HTTP helpers for admin Netlify Functions (CORS, tracing, auth hints)

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
  const origin = header(event, 'origin');
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Vary': 'Origin',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-trace',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
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
      return { statusCode: 403, headers, body };
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
      const statusCode = err?.code || err?.statusCode || err?.status || 500;
      const payload = err?.body || JSON.stringify({ ok: false, error: err?.message || 'server_error' });
      const headers = Object.assign({}, cors);
      if (trace) headers['x-trace'] = trace;
      return { statusCode, headers, body: payload };
    }
  };
}

module.exports = { withAdminCors, buildCors };
