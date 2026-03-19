// netlify/functions/identity-whoami.js
const { withAdminCors } = require('./_http.js');
const { rolesFromClaims, verifyIdentityToken } = require('./_auth.js');

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

async function resolveUser(event, context, options = {}) {
  const contextUser = context?.clientContext?.user || null;
  if (contextUser) return contextUser;

  const auth = event?.headers?.authorization || event?.headers?.Authorization || '';
  const bearer = String(auth).replace(/^Bearer\s+/i, '').trim();
  const cookies = parseCookies(event?.headers?.cookie || event?.headers?.Cookie || '');
  const token = bearer || cookies.nf_jwt || '';
  if (!token) return null;

  const claims = decodeJWT(token);
  const verifiedUser = await verifyIdentityToken(token, event, options);
  const email = verifiedUser?.email || claims?.email || claims?.user_metadata?.email || claims?.sub || null;
  if (!email) return null;

  const roles = Array.from(new Set([
    ...rolesFromClaims(claims),
    ...rolesFromClaims(verifiedUser),
    ...(Array.isArray(verifiedUser?.roles) ? verifiedUser.roles.map((role) => String(role || '').toLowerCase()).filter(Boolean) : [])
  ]));

  return {
    email,
    app_metadata: verifiedUser?.app_metadata || { roles },
    user_metadata: verifiedUser?.user_metadata || claims?.user_metadata || {},
    id: verifiedUser?.id || claims?.sub || 'nf'
  };
}

async function baseHandler(event, context) {
  const user = await resolveUser(event, context);
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
