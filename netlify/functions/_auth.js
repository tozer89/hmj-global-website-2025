// netlify/functions/_auth.js
const { createClient } = require('@supabase/supabase-js');

function coded(status, message) { const e = new Error(message); e.code = status; return e; }

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader.split(';').map(v => v.trim()).filter(Boolean).map(p => {
      const i = p.indexOf('='); return i === -1 ? [p, ''] : [p.slice(0, i), decodeURIComponent(p.slice(i+1))];
    })
  );
}

function decodeJWT(token) {
  try {
    const [, payload] = (token || '').split('.');
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) || {};
  } catch { return {}; }
}

function rolesFromClaims(claims) {
  return claims?.app_metadata?.roles || claims?.roles || [];
}

function getSupabaseAdmin() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url) throw coded(500, 'SUPABASE_URL missing');
  if (!key) throw coded(500, 'SUPABASE_SERVICE_KEY missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Returns { user, roles, supabase }. Throws 401/403 on auth/role issues.
 * Accepts Identity from:
 *   - context.clientContext.user (Netlify-injected)
 *   - Authorization: Bearer <nf_jwt>
 *   - nf_jwt cookie
 */
exports.getContext = async (event, context, opts = {}) => {
  const supabase = getSupabaseAdmin();
  const debug = !!opts.debug;

  let user = context?.clientContext?.user || null;
  let roles = [];

  // Build from Authorization header/cookie if clientContext is missing
  let token =
    (event?.headers?.authorization || '').replace(/^Bearer\s+/i, '') ||
    parseCookies(event?.headers?.cookie)?.nf_jwt ||
    '';

  if (!user && token) {
    const claims = decodeJWT(token);
    const email = claims?.email || claims?.user_metadata?.email || claims?.sub || '';
    roles = rolesFromClaims(claims);
    if (email) {
      user = {
        email,
        app_metadata: { roles },
        user_metadata: claims?.user_metadata || {},
        id: claims?.sub || 'nf',
      };
    }
  }

  if (!user) throw coded(401, 'Unauthorized');

  // roles from either clientContext or jwt
  roles = roles.length ? roles : rolesFromClaims(user);
  if (opts.requireAdmin && !roles.includes('admin')) throw coded(403, 'Forbidden');

  if (debug) {
    console.log('[auth] email:', user.email, 'roles:', roles);
  }
  return { user, roles, supabase };
};

exports.coded = coded;
exports.getSupabaseAdmin = getSupabaseAdmin;
