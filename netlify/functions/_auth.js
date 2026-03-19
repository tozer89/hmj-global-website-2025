// netlify/functions/_auth.js
const { createClient } = require('@supabase/supabase-js');
const { getSupabaseUrl, getSupabaseServiceKey } = require('./_supabase-env.js');

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

function normalizeRoles(list) {
  if (!Array.isArray(list)) return [];
  return list.map((role) => String(role || '').toLowerCase()).filter(Boolean);
}

function requestOrigin(event = {}) {
  const headers = event?.headers || {};
  const host = String(
    headers['x-forwarded-host']
    || headers['X-Forwarded-Host']
    || headers.host
    || headers.Host
    || ''
  ).split(',')[0].trim();
  if (!host) return '';
  const proto = String(headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https').trim() || 'https';
  return `${proto}://${host.replace(/:\d+$/, '')}`;
}

function resolveIdentityBase(event = {}) {
  const origin = requestOrigin(event);
  if (origin) return `${origin.replace(/\/$/, '')}/.netlify/identity`;

  const siteUrl = String(process.env.URL || process.env.SITE_URL || '').trim();
  if (siteUrl) {
    try {
      const parsed = new URL(siteUrl);
      return `${parsed.origin.replace(/\/$/, '')}/.netlify/identity`;
    } catch {}
  }

  return 'https://hmjg.netlify.app/.netlify/identity';
}

function hasAdminAccess(roles = []) {
  return Array.isArray(roles) && (roles.includes('admin') || roles.includes('owner'));
}

function rolesFromClaims(claims) {
  const appMeta = claims?.app_metadata && typeof claims.app_metadata === 'object' ? claims.app_metadata : {};
  const authorization = appMeta?.authorization && typeof appMeta.authorization === 'object' ? appMeta.authorization : {};
  const userMeta = claims?.user_metadata && typeof claims.user_metadata === 'object' ? claims.user_metadata : {};
  const raw = [
    appMeta.roles,
    appMeta.role,
    authorization.roles,
    authorization.role,
    claims?.roles,
    claims?.role,
    userMeta.roles,
    userMeta.role
  ];
  const roles = [];
  raw.forEach((entry) => {
    if (Array.isArray(entry)) roles.push(...entry);
    else if (entry != null) roles.push(entry);
  });
  return normalizeRoles(roles);
}

async function verifyIdentityToken(token, event = {}, opts = {}) {
  const bearer = String(token || '').trim();
  if (!bearer) return null;
  const fetchImpl = opts.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') return null;

  const target = `${resolveIdentityBase(event)}/user`;
  try {
    const response = await fetchImpl(target, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${bearer}`,
        accept: 'application/json'
      }
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function getSupabaseAdmin() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceKey();
  if (!url) throw coded(500, 'Supabase URL missing (set SUPABASE_URL or VITE_SUPABASE_URL)');
  if (!key) throw coded(500, 'Supabase service key missing (set SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY)');
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
    const verifiedUser = await verifyIdentityToken(token, event, opts);
    const email = verifiedUser?.email || claims?.email || claims?.user_metadata?.email || claims?.sub || '';
    roles = normalizeRoles([
      ...rolesFromClaims(claims),
      ...rolesFromClaims(verifiedUser),
      ...(Array.isArray(verifiedUser?.roles) ? verifiedUser.roles : [])
    ]);
    if (email) {
      user = {
        email,
        app_metadata: verifiedUser?.app_metadata || { roles },
        user_metadata: verifiedUser?.user_metadata || claims?.user_metadata || {},
        id: verifiedUser?.id || claims?.sub || 'nf',
      };
    }
  }

  if (!user) throw coded(401, 'Unauthorized');

  // roles from either clientContext or jwt
  roles = roles.length ? normalizeRoles(roles) : rolesFromClaims(user);

  let supabase = null;
  let supabaseError = null;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    const message = err?.message || '';
    const missingEnv = err?.code === 500 && /SUPABASE_/i.test(message);
    if (missingEnv) {
      supabaseError = err;
      supabase = null;
    } else {
      throw err;
    }
  }

  const requireAdmin = !!opts.requireAdmin;
  const hasAdminRole = hasAdminAccess(roles);
  let adminVerifiedViaTable = false;

  async function checkAdminTable() {
    if (!supabase || typeof supabase.from !== 'function') return false;
    const identifiers = [];
    if (user?.id) identifiers.push({ column: 'user_id', value: String(user.id) });
    if (user?.sub && user.sub !== user.id) identifiers.push({ column: 'user_id', value: String(user.sub) });
    if (user?.email) identifiers.push({ column: 'email', value: String(user.email).toLowerCase() });

    for (const { column, value } of identifiers) {
      try {
        const { data, error } = await supabase
          .from('admin_users')
          .select('user_id')
          .eq(column, value)
          .limit(1);

        if (error) {
          const msg = error.message || '';
          if (/relation .+ does not exist/i.test(msg)) {
            console.warn('[auth] admin_users table missing — allowing Identity role check only');
            return true;
          }
          console.warn('[auth] admin_users lookup failed via %s (%s)', column, msg);
          continue;
        }

        if (Array.isArray(data) && data.length) {
          return true;
        }
      } catch (err) {
        console.warn('[auth] admin_users lookup threw (%s)', err?.message || err);
      }
    }
    return false;
  }

  if (requireAdmin && !hasAdminRole) {
    adminVerifiedViaTable = await checkAdminTable();
    if (adminVerifiedViaTable && !hasAdminAccess(roles)) {
      roles = [...roles, 'admin'];
    }
  }

  if (requireAdmin && !hasAdminAccess(roles)) {
    if (supabaseError) {
      console.warn('[auth] requireAdmin failed — supabase unavailable (%s)', supabaseError.message);
    }
    throw coded(403, 'Forbidden');
  }

  if (debug) {
    console.log(
      '[auth] email:%s roles:%o supabase?:%s verifiedViaTable:%s',
      user.email,
      roles,
      !!supabase,
      adminVerifiedViaTable
    );
  }
  return { user, roles, supabase, supabaseError };
};

exports.coded = coded;
exports.getSupabaseAdmin = getSupabaseAdmin;
exports.hasAdminAccess = hasAdminAccess;
exports.rolesFromClaims = rolesFromClaims;
exports.verifyIdentityToken = verifyIdentityToken;
