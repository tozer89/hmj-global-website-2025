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
  const key =
    (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url) throw coded(500, 'SUPABASE_URL missing');
  if (!key) throw coded(500, 'SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * getContext(event, context, { requireAdmin?: boolean, debug?: boolean })
 * Returns: { user, roles, supabase, isAdmin }
 * Throws: 401 (no token), 403 (not admin when required)
 */
exports.getContext = async (event, context, opts = {}) => {
  const supabase = getSupabaseAdmin();

  const bearer =
    event?.headers?.authorization ||
    context?.headers?.authorization ||
    '';

  const user = context?.clientContext?.user || null;

  const rolesFromHeader = decodeRolesFromJWT(bearer);
  const rolesFromContext = user?.app_metadata?.roles || user?.roles || [];
  const roles = Array.from(new Set([...rolesFromContext, ...rolesFromHeader]));

  const allowEmails = new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
  const email = (user?.email || '').toLowerCase();
  const isAdmin = allowEmails.has(email) || roles.includes('admin') || roles.includes('superadmin');

  if (opts.debug) {
    console.log('[auth] email:', email, 'roles:', roles, 'allowlist:', [...allowEmails], 'isAdmin:', isAdmin);
  }

  if (!user) throw coded(401, 'Unauthorized');
  if (opts.requireAdmin && !isAdmin) throw coded(403, 'Forbidden');

  return { user, roles, supabase, isAdmin };
};

exports.coded = coded;
exports.getSupabaseAdmin = getSupabaseAdmin;
