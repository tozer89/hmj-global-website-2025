// netlify/functions/_auth.js
const coded = (code, msg) => Object.assign(new Error(msg), { code });

function getRolesFromJWT(bearer) {
  try {
    if (!bearer) return [];
    const token = bearer.replace(/^Bearer\s+/i, '');
    const [, payload] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return claims?.app_metadata?.roles || claims?.roles || [];
  } catch {
    return [];
  }
}

exports.getContext = async (context, opts = {}) => {
  const user = context.clientContext?.user;
  if (!user) throw coded(401, 'Unauthorized');

  // Roles may come from Netlify user OR only be present in the JWT claims.
  const headerAuth = context.headers?.authorization || context.headers?.Authorization;
  const rolesFromUser = user.app_metadata?.roles || user.roles || [];
  const rolesFromJWT  = getRolesFromJWT(headerAuth);

  const roles = Array.from(new Set([...(rolesFromUser || []), ...(rolesFromJWT || [])]));

  if (opts.requireAdmin && !roles.includes('admin')) {
    throw coded(403, 'Forbidden (admin role required)');
  }

  // return whatever else you already return here (email, id, etc.)
  return { user, roles };
};
