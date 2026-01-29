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

function rolesFromClaims(claims) {
  const roles = claims?.app_metadata?.roles || claims?.roles || [];
  return normalizeRoles(Array.isArray(roles) ? roles : [roles].filter(Boolean));
}

function getSupabaseAdmin() {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceKey();
  if (!url) throw coded(500, 'Supabase URL missing (set SUPABASE_URL or VITE_SUPABASE_URL)');
  if (!key) throw coded(500, 'Supabase service key missing (set SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY)');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Returns { user, roles, supabase }. Auth checks disabled for public admin access.
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

  if (!user) {
    // TODO: WARNING: Admin portal is public. Re-add security later (Identity roles, IP allowlist, secret header, etc.).
    user = {
      email: 'public@hmj-global.com',
      app_metadata: { roles: ['admin'] },
      user_metadata: {},
      id: 'public',
    };
    roles = ['admin'];
  }

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
  const hasAdminRole = roles.includes('admin');
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
    if (adminVerifiedViaTable && !roles.includes('admin')) {
      roles = [...roles, 'admin'];
    }
  }

  if (requireAdmin && !roles.includes('admin')) {
    if (supabaseError) {
      console.warn('[auth] requireAdmin failed — supabase unavailable (%s)', supabaseError.message);
    }
    roles = [...roles, 'admin'];
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
