// netlify/functions/_auth.js
const { createClient } = require('@supabase/supabase-js');

function coded(status, message) {
  const e = new Error(message);
  e.code = status;
  return e;
}

function decodeRolesFromJWT(bearer) {
  try {
    const token = (bearer || '').replace(/^Bearer\s+/i, '');
    const payload = token.split('.')[1];
    if (!payload) return [];
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return claims?.app_metadata?.roles || claims?.roles || [];
  } catch {
    return [];
  }
}

function getSupabaseAdmin() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url) throw coded(500, 'SUPABASE_URL missing');
  if (!key) throw coded(500, 'SUPABASE_SERVICE_KEY missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Unified context fetcher.
 * - Returns: { user, roles, supabase }
 * - Throws: 401 when no user / not admin (if opts.requireAdmin)
 */
exports.getContext = async (netlifyContext, opts = {}) => {
  const supabase = getSupabaseAdmin();

  const user = netlifyContext?.clientContext?.user;
  if (!user) throw coded(401, 'Unauthorized');

  const headerAuth = netlifyContext?.headers?.authorization || '';
  const rolesFromHeader = decodeRolesFromJWT(headerAuth);
  const rolesFromContext = user.app_metadata?.roles || user.roles || [];
  const roles = Array.from(new Set([...rolesFromContext, ...rolesFromHeader]));

  if (opts.requireAdmin && !roles.includes('admin')) {
    throw coded(401, 'Forbidden'); // 401 only for auth/role issues
  }

  return { user, roles, supabase };
};

exports.coded = coded;
exports.getSupabaseAdmin = getSupabaseAdmin;
