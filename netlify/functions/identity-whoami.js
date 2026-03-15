// netlify/functions/identity-whoami.js
const { withAdminCors } = require('./_http.js');

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    String(cookieHeader || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((segment) => {
        const index = segment.indexOf('=');
        if (index === -1) return [segment, ''];
        return [segment.slice(0, index), decodeURIComponent(segment.slice(index + 1))];
      })
  );
}

function decodeJWT(token) {
  try {
    const [, payload] = String(token || '').split('.');
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) || {};
  } catch {
    return {};
  }
}

function rolesFromClaims(claims) {
  const rawRoles = claims?.app_metadata?.roles || claims?.roles || claims?.role || [];
  const list = Array.isArray(rawRoles) ? rawRoles : [rawRoles].filter(Boolean);
  return list.map((role) => String(role || '').toLowerCase()).filter(Boolean);
}

function resolveUser(event, context) {
  const contextUser = context?.clientContext?.user || null;
  if (contextUser) return contextUser;

  const auth = event?.headers?.authorization || event?.headers?.Authorization || '';
  const bearer = String(auth).replace(/^Bearer\s+/i, '').trim();
  const cookies = parseCookies(event?.headers?.cookie || event?.headers?.Cookie || '');
  const token = bearer || cookies.nf_jwt || '';
  if (!token) return null;

  const claims = decodeJWT(token);
  const email = claims?.email || claims?.user_metadata?.email || claims?.sub || null;
  if (!email) return null;

  return {
    email,
    app_metadata: { roles: rolesFromClaims(claims) },
    user_metadata: claims?.user_metadata || {},
    id: claims?.sub || 'nf'
  };
}

async function baseHandler(event, context) {
  const user = resolveUser(event, context);
  const roles = user?.app_metadata?.roles || user?.roles || [];
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({
      ok: true,
      identityEmail: user?.email || null,
      roles,
      raw: user || null
    })
  };
}

exports.handler = withAdminCors(baseHandler, { requireToken: false });
exports.resolveUser = resolveUser;
