'use strict';

const { createHmac, randomUUID } = require('node:crypto');
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase } = require('./_supabase.js');
const { getSupabaseUrl, getSupabaseAnonKey } = require('./_supabase-env.js');
const { fetchSettings } = require('./_settings-helpers.js');
const {
  buildAssignableAdminMembers,
  fetchNetlifyIdentityUsers,
} = require('./_admin-users.js');
const {
  TEAM_TASKS_SETTINGS_KEY,
  normalizeTaskSettings,
  memberDisplayName,
  trimString,
  lowerEmail,
} = require('./_team-tasks-helpers.js');

const TOKEN_TTL_SECONDS = 60 * 20;
const JWT_SECRET_KEYS = [
  'SUPABASE_JWT_SECRET',
  'SUPABASE_JWT_SIGNING_SECRET',
  'JWT_SECRET',
];

function readJwtSecret() {
  for (const key of JWT_SECRET_KEYS) {
    const value = trimString(process.env[key], 4096);
    if (value) return { value, source: key };
  }
  return { value: '', source: null };
}

function base64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(unsigned)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${unsigned}.${signature}`;
}

function normaliseRoles(roles = []) {
  return Array.isArray(roles)
    ? roles.map((role) => trimString(role, 64).toLowerCase()).filter(Boolean)
    : [];
}

function currentSiteUrl() {
  return trimString(
    process.env.URL
      || process.env.DEPLOY_PRIME_URL
      || process.env.SITE_URL
      || '',
    500
  ).replace(/\/$/, '');
}

function displayNameFromMeta(meta, email, userId) {
  const displayName = trimString(
    meta?.display_name
      || meta?.full_name
      || meta?.name
      || meta?.label
      || '',
    160
  );
  return displayName || memberDisplayName({ email, userId });
}

async function readAdminMembers(supabase, user, context) {
  let tableRows = [];
  try {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id,user_id,email,role,is_active,meta')
      .eq('is_active', true)
      .order('email', { ascending: true });

    if (error) throw error;

    tableRows = Array.isArray(data) ? data.map((row) => ({
      id: trimString(row.id, 120),
      userId: trimString(row.user_id, 120),
      email: lowerEmail(row.email),
      displayName: displayNameFromMeta(row.meta, row.email, row.user_id),
      role: trimString(row.role, 64) || 'admin',
      isActive: row.is_active !== false,
      meta: row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : {},
    })) : [];
  } catch (error) {
    tableRows = [];
  }

  let identityUsers = [];
  try {
    identityUsers = await fetchNetlifyIdentityUsers(context);
  } catch (error) {
    console.warn('[team-tasks] Netlify Identity member lookup failed (%s)', error?.message || error);
  }

  return buildAssignableAdminMembers({
    tableRows,
    identityUsers,
    currentUser: {
      userId: trimString(user?.id || user?.sub, 120) || lowerEmail(user?.email),
      email: lowerEmail(user?.email),
      displayName: displayNameFromMeta(user?.user_metadata || {}, user?.email, user?.id),
      role: 'admin',
      isActive: true,
      meta: user?.user_metadata && typeof user.user_metadata === 'object' && !Array.isArray(user.user_metadata)
        ? user.user_metadata
        : {},
    },
  });
}

async function readSchemaStatus(supabase) {
  try {
    const checks = await Promise.all([
      supabase.from('task_items').select('id,created_by,created_by_email,assigned_to,assigned_to_email,updated_by_email,linked_module,linked_url,tags').limit(1),
      supabase.from('task_comments').select('id,created_by,created_by_email,updated_by_email').limit(1),
      supabase.from('task_reminders').select('id,recipient_user_id,recipient_email,created_by_email,updated_by_email,reminder_mode').limit(1),
      supabase.from('task_audit_log').select('id,entity_type,entity_id,source_action').limit(1),
    ]);

    const firstError = checks.find((result) => result?.error)?.error || null;
    if (firstError) {
      return {
        ready: false,
        message: firstError.message || 'Team Tasks schema is not ready yet.',
      };
    }
    return { ready: true, message: '' };
  } catch (error) {
    return {
      ready: false,
      message: error?.message || 'Team Tasks schema is not ready yet.',
    };
  }
}

function buildAccessToken({ user, roles, secret, supabaseUrl }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: 'authenticated',
    exp: now + TOKEN_TTL_SECONDS,
    iat: now,
    iss: `${supabaseUrl.replace(/\/$/, '')}/auth/v1`,
    sub: trimString(user?.id || user?.sub, 120) || `hmj-admin-${randomUUID()}`,
    email: lowerEmail(user?.email),
    role: 'authenticated',
    aal: 'aal1',
    amr: [{ method: 'password', timestamp: now }],
    session_id: randomUUID(),
    is_anonymous: false,
    app_metadata: {
      provider: 'netlify-identity',
      roles,
    },
    user_metadata: {
      email: lowerEmail(user?.email),
      full_name: trimString(
        user?.user_metadata?.full_name
          || user?.user_metadata?.name
          || user?.user_metadata?.fullName,
        160
      ),
    },
  };

  return {
    accessToken: signJwt(payload, secret),
    expiresAt: new Date((payload.exp || now) * 1000).toISOString(),
  };
}

const baseHandler = async (event, context) => {
  try {
    const { user, roles } = await getContext(event, context, { requireAdmin: true });
    const supabase = getSupabase(event);
    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    const jwtSecretInfo = readJwtSecret();

    if (!supabaseUrl || !supabaseAnonKey) {
      return {
        statusCode: 503,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          code: 'supabase_public_config_missing',
          message: 'Supabase public URL or anon key is missing for Team Tasks.',
        }),
      };
    }

    if (!jwtSecretInfo.value) {
      return {
        statusCode: 503,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          code: 'supabase_jwt_secret_missing',
          message: 'SUPABASE_JWT_SECRET is required to enable Team Tasks realtime and RLS in HMJ Admin.',
        }),
      };
    }

    const [memberRows, settingsResult, schemaStatus] = await Promise.all([
      readAdminMembers(supabase, user, context),
      fetchSettings(event, [TEAM_TASKS_SETTINGS_KEY]),
      readSchemaStatus(supabase),
    ]);

    const access = buildAccessToken({
      user,
      roles: normaliseRoles(roles),
      secret: jwtSecretInfo.value,
      supabaseUrl,
    });

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({
        ok: true,
        supabaseUrl,
        supabaseAnonKey,
        accessToken: access.accessToken,
        expiresAt: access.expiresAt,
        schemaReady: schemaStatus.ready,
        schemaMessage: schemaStatus.message || '',
        members: memberRows,
        settings: normalizeTaskSettings(settingsResult?.settings?.[TEAM_TASKS_SETTINGS_KEY]),
        emailConfigured: !!trimString(process.env.RESEND_API_KEY, 320)
          && !!trimString(process.env.TASK_REMINDER_FROM_EMAIL, 320),
        siteUrl: currentSiteUrl(),
        currentUser: {
          userId: trimString(user?.id || user?.sub, 120) || lowerEmail(user?.email),
          email: lowerEmail(user?.email),
          displayName: displayNameFromMeta(user?.user_metadata || {}, user?.email, user?.id),
          roles: normaliseRoles(roles),
        },
      }),
    };
  } catch (error) {
    const status = error?.code === 401 ? 401 : error?.code === 403 ? 403 : 500;
    return {
      statusCode: status,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        code: error?.code || 'team_tasks_config_failed',
        message: error?.message || 'Unable to prepare Team Tasks configuration.',
      }),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
