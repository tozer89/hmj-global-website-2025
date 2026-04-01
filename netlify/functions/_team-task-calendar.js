'use strict';

const { createHmac } = require('node:crypto');
const { fetchSettings, saveSettings } = require('./_settings-helpers.js');
const { getSupabase } = require('./_supabase.js');

const TEAM_TASK_CALENDAR_SETTINGS_KEY = 'team_tasks_calendar_settings';
const MICROSOFT_DEFAULT_SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'User.Read',
  'Calendars.Read',
];

const DEFAULT_TEAM_TASK_CALENDAR_SETTINGS = {
  enabled: false,
  provider: 'microsoft',
  tenantId: 'common',
  clientId: '',
  clientSecret: '',
  scopes: MICROSOFT_DEFAULT_SCOPES,
  showExternalEvents: true,
  showTeamConnections: true,
  syncEnabled: true,
  weekStartsOn: 'monday',
  lastSavedAt: '',
  lastSavedBy: '',
};

function trimString(value, maxLength) {
  const text = typeof value === 'string'
    ? value.trim()
    : String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!Number.isInteger(maxLength) || maxLength <= 0) return text;
  return text.slice(0, maxLength);
}

function lowerEmail(value) {
  const email = trimString(value, 320).toLowerCase();
  return email || '';
}

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const raw = trimString(value, 32).toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function normalizeScopes(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value == null ? '' : value)
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean);

  const unique = [];
  const seen = new Set();
  rawValues.forEach((entry) => {
    const scope = trimString(entry, 120);
    if (!scope || seen.has(scope)) return;
    seen.add(scope);
    unique.push(scope);
  });

  MICROSOFT_DEFAULT_SCOPES.forEach((scope) => {
    if (!seen.has(scope)) unique.push(scope);
  });

  return unique;
}

function normaliseUrl(value) {
  const raw = trimString(value, 1000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function resolveBaseUrl(event = {}) {
  const envValue = trimString(
    process.env.HMJ_CANONICAL_SITE_URL
      || process.env.URL
      || process.env.DEPLOY_PRIME_URL
      || process.env.SITE_URL
      || '',
    1000
  );
  if (envValue) {
    const normalised = normaliseUrl(envValue);
    if (normalised) return normalised;
  }

  const origin = trimString(event?.headers?.origin, 1000);
  if (origin) {
    const normalised = normaliseUrl(origin);
    if (normalised) return normalised;
  }

  const host = trimString(
    event?.headers?.['x-forwarded-host']
      || event?.headers?.host,
    1000
  );
  const proto = trimString(event?.headers?.['x-forwarded-proto'], 16) || 'https';
  if (host) {
    const normalised = normaliseUrl(`${proto}://${host}`);
    if (normalised) return normalised;
  }

  return '';
}

function buildCallbackUrl(event = {}) {
  const baseUrl = resolveBaseUrl(event);
  return baseUrl ? `${baseUrl}/.netlify/functions/admin-team-tasks-calendar-callback` : '';
}

function buildTeamTasksUrl(event = {}, query = {}) {
  const baseUrl = resolveBaseUrl(event);
  if (!baseUrl) return '/admin/team-tasks.html';
  const url = new URL('/admin/team-tasks.html', `${baseUrl}/`);
  Object.entries(query || {}).forEach(([key, value]) => {
    const next = trimString(value, 500);
    if (next) url.searchParams.set(key, next);
  });
  return url.toString();
}

function normalizeCalendarSettings(input = {}, options = {}) {
  const existing = options.existing && typeof options.existing === 'object' ? options.existing : {};
  const merged = {
    ...DEFAULT_TEAM_TASK_CALENDAR_SETTINGS,
    ...existing,
  };

  const next = { ...merged };
  next.enabled = toBoolean(input.enabled, toBoolean(merged.enabled, false));
  next.provider = 'microsoft';
  next.tenantId = trimString(input.tenantId != null ? input.tenantId : merged.tenantId, 160) || 'common';
  next.clientId = trimString(input.clientId != null ? input.clientId : merged.clientId, 240);

  const incomingSecret = Object.prototype.hasOwnProperty.call(input, 'clientSecret')
    ? String(input.clientSecret == null ? '' : input.clientSecret)
    : null;
  if (toBoolean(input.clearClientSecret, false)) {
    next.clientSecret = '';
  } else if (incomingSecret != null) {
    next.clientSecret = incomingSecret.trim() || trimString(merged.clientSecret, 4000);
  } else {
    next.clientSecret = trimString(merged.clientSecret, 4000);
  }

  next.scopes = normalizeScopes(input.scopes != null ? input.scopes : merged.scopes);
  next.showExternalEvents = toBoolean(
    input.showExternalEvents,
    toBoolean(merged.showExternalEvents, true)
  );
  next.showTeamConnections = toBoolean(
    input.showTeamConnections,
    toBoolean(merged.showTeamConnections, true)
  );
  next.syncEnabled = toBoolean(
    input.syncEnabled,
    toBoolean(merged.syncEnabled, true)
  );
  next.weekStartsOn = 'monday';
  next.lastSavedAt = trimString(existing.lastSavedAt, 64);
  next.lastSavedBy = trimString(existing.lastSavedBy, 240);
  return next;
}

function redactCalendarSettings(settings = {}) {
  return {
    ...settings,
    clientSecret: '',
    clientSecretStored: !!trimString(settings.clientSecret, 4000),
  };
}

function buildCalendarDiagnostics(settings = {}, event = {}) {
  const callbackUrl = buildCallbackUrl(event);
  const baseUrl = resolveBaseUrl(event);
  const warnings = [];
  const setupReady = !!trimString(settings.clientId, 240)
    && !!trimString(settings.clientSecret, 4000)
    && !!callbackUrl;

  if (!settings.enabled) warnings.push('Microsoft calendar sync is currently disabled.');
  if (!trimString(settings.clientId, 240)) warnings.push('Add the Microsoft application client ID.');
  if (!trimString(settings.clientSecret, 4000)) warnings.push('Add the Microsoft application client secret.');
  if (!callbackUrl) warnings.push('The Netlify site URL could not be resolved for the OAuth callback.');
  if (!baseUrl) warnings.push('The public base URL could not be resolved from the current environment.');

  return {
    enabled: settings.enabled === true,
    setupReady,
    callbackUrl,
    baseUrl,
    providerLabel: 'Microsoft Outlook / Teams calendar',
    scopes: normalizeScopes(settings.scopes),
    warnings,
  };
}

async function readCalendarSettings(event) {
  const result = await fetchSettings(event, [TEAM_TASK_CALENDAR_SETTINGS_KEY]);
  const settings = normalizeCalendarSettings(result?.settings?.[TEAM_TASK_CALENDAR_SETTINGS_KEY], {});
  return {
    settings,
    redacted: redactCalendarSettings(settings),
    diagnostics: buildCalendarDiagnostics(settings, event),
    source: result?.source || 'fallback',
  };
}

async function persistCalendarSettings(event, input = {}, meta = {}) {
  const current = await readCalendarSettings(event);
  const settings = normalizeCalendarSettings(input, { existing: current.settings });
  settings.lastSavedAt = trimString(meta.savedAt, 64) || new Date().toISOString();
  settings.lastSavedBy = trimString(meta.savedBy, 240) || current.settings.lastSavedBy || '';

  await saveSettings(event, {
    [TEAM_TASK_CALENDAR_SETTINGS_KEY]: settings,
  });

  return {
    settings,
    redacted: redactCalendarSettings(settings),
    diagnostics: buildCalendarDiagnostics(settings, event),
    source: 'supabase',
  };
}

function resolveStateSecret() {
  const secret = trimString(
    process.env.TEAM_TASKS_CALENDAR_STATE_SECRET
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_KEY
      || process.env.SUPABASE_JWT_SECRET
      || '',
    4000
  );
  return secret;
}

function base64urlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(value) {
  const raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw + '==='.slice((raw.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signPayload(payload, secret) {
  return createHmac('sha256', secret)
    .update(payload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildSignedState(data = {}) {
  const secret = resolveStateSecret();
  if (!secret) {
    const error = new Error('Missing TEAM_TASKS_CALENDAR_STATE_SECRET or Supabase service credentials.');
    error.code = 500;
    throw error;
  }
  const json = JSON.stringify(data);
  const payload = base64urlEncode(json);
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

function parseSignedState(value) {
  const secret = resolveStateSecret();
  if (!secret) {
    const error = new Error('Missing TEAM_TASKS_CALENDAR_STATE_SECRET or Supabase service credentials.');
    error.code = 500;
    throw error;
  }
  const raw = trimString(value, 8000);
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) {
    const error = new Error('Invalid Microsoft calendar callback state.');
    error.code = 400;
    throw error;
  }
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (signPayload(payload, secret) !== signature) {
    const error = new Error('Microsoft calendar callback state could not be verified.');
    error.code = 400;
    throw error;
  }
  const decoded = JSON.parse(base64urlDecode(payload));
  const issuedAt = Number(decoded?.iat || 0);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) {
    const error = new Error('Microsoft calendar callback state is incomplete.');
    error.code = 400;
    throw error;
  }
  if ((Date.now() - issuedAt) > (20 * 60 * 1000)) {
    const error = new Error('Microsoft calendar callback state has expired. Start the connection again.');
    error.code = 400;
    throw error;
  }
  return decoded;
}

function buildAuthUrl({ settings, event, user, returnTo }) {
  const redirectUri = buildCallbackUrl(event);
  const tenantId = trimString(settings?.tenantId, 160) || 'common';
  const state = buildSignedState({
    provider: 'microsoft',
    userId: trimString(user?.id || user?.userId, 240),
    email: lowerEmail(user?.email),
    displayName: trimString(user?.displayName || user?.name, 240),
    returnTo: trimString(returnTo, 1000) || buildTeamTasksUrl(event),
    iat: Date.now(),
  });

  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', trimString(settings?.clientId, 240));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', normalizeScopes(settings?.scopes).join(' '));
  url.searchParams.set('prompt', 'select_account');
  url.searchParams.set('state', state);
  return {
    url: url.toString(),
    state,
    redirectUri,
  };
}

function microsoftTokenUrl(settings = {}) {
  const tenantId = trimString(settings.tenantId, 160) || 'common';
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
}

async function exchangeCodeForTokens(settings = {}, event = {}, code) {
  const redirectUri = buildCallbackUrl(event);
  const response = await fetch(microsoftTokenUrl(settings), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: trimString(settings.clientId, 240),
      client_secret: trimString(settings.clientSecret, 4000),
      grant_type: 'authorization_code',
      code: trimString(code, 4000),
      redirect_uri: redirectUri,
      scope: normalizeScopes(settings.scopes).join(' '),
    }).toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(trimString(payload.error_description, 400) || 'Microsoft token exchange failed.');
    error.code = response.status || 502;
    error.details = payload;
    throw error;
  }
  return payload;
}

async function refreshAccessToken(settings = {}, refreshToken) {
  const response = await fetch(microsoftTokenUrl(settings), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: trimString(settings.clientId, 240),
      client_secret: trimString(settings.clientSecret, 4000),
      grant_type: 'refresh_token',
      refresh_token: trimString(refreshToken, 4000),
      scope: normalizeScopes(settings.scopes).join(' '),
    }).toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(trimString(payload.error_description, 400) || 'Microsoft token refresh failed.');
    error.code = response.status || 502;
    error.details = payload;
    throw error;
  }
  return payload;
}

async function graphGet(accessToken, path, searchParams = {}) {
  const url = new URL(`https://graph.microsoft.com/v1.0${path}`);
  Object.entries(searchParams).forEach(([key, value]) => {
    const next = trimString(value, 4000);
    if (next) url.searchParams.set(key, next);
  });

  const response = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${trimString(accessToken, 8000)}`,
      accept: 'application/json',
      prefer: 'outlook.timezone="Europe/London"',
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = trimString(
      payload?.error?.message || payload?.error_description,
      400
    ) || 'Microsoft Graph request failed.';
    const error = new Error(message);
    error.code = response.status || 502;
    error.details = payload;
    throw error;
  }
  return payload;
}

async function fetchMicrosoftProfile(accessToken) {
  return graphGet(accessToken, '/me', {
    '$select': 'id,displayName,mail,userPrincipalName',
  });
}

async function fetchCalendarView(accessToken, startAt, endAt) {
  return graphGet(accessToken, '/me/calendarView', {
    startDateTime: new Date(startAt).toISOString(),
    endDateTime: new Date(endAt).toISOString(),
    '$select': 'id,subject,start,end,isAllDay,location,webLink,organizer',
    '$orderby': 'start/dateTime',
    '$top': '200',
  });
}

function tokenExpiryIso(payload = {}) {
  const expiresIn = Number(payload.expires_in || 0);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return '';
  return new Date(Date.now() + (expiresIn * 1000)).toISOString();
}

async function upsertCalendarConnection(event, data = {}) {
  const supabase = getSupabase(event);
  const row = {
    provider: 'microsoft',
    user_id: trimString(data.userId, 240),
    user_email: lowerEmail(data.userEmail),
    user_display_name: trimString(data.userDisplayName, 240),
    external_account_id: trimString(data.externalAccountId, 240),
    external_account_email: lowerEmail(data.externalAccountEmail),
    external_display_name: trimString(data.externalDisplayName, 240),
    access_token: trimString(data.accessToken, 16000),
    refresh_token: trimString(data.refreshToken, 16000),
    access_token_expires_at: trimString(data.accessTokenExpiresAt, 80) || null,
    scope: normalizeScopes(data.scope),
    sync_enabled: data.syncEnabled !== false,
    last_synced_at: trimString(data.lastSyncedAt, 80) || null,
    last_error: trimString(data.lastError, 1000) || null,
  };

  const { data: saved, error } = await supabase
    .from('task_calendar_connections')
    .upsert(row, { onConflict: 'provider,user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return saved;
}

async function listCalendarConnections(event) {
  const supabase = getSupabase(event);
  const { data, error } = await supabase
    .from('task_calendar_connections')
    .select('*')
    .eq('provider', 'microsoft')
    .order('user_display_name', { ascending: true })
    .order('user_email', { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function readUserCalendarConnection(event, identity = {}) {
  const supabase = getSupabase(event);
  const userId = trimString(identity.userId || identity.id, 240);
  const email = lowerEmail(identity.email);

  if (userId) {
    const { data, error } = await supabase
      .from('task_calendar_connections')
      .select('*')
      .eq('provider', 'microsoft')
      .eq('user_id', userId)
      .limit(1);
    if (error) throw error;
    if (Array.isArray(data) && data.length) return data[0];
  }

  if (email) {
    const { data, error } = await supabase
      .from('task_calendar_connections')
      .select('*')
      .eq('provider', 'microsoft')
      .eq('user_email', email)
      .limit(1);
    if (error) throw error;
    if (Array.isArray(data) && data.length) return data[0];
  }

  return null;
}

async function deleteUserCalendarConnection(event, identity = {}) {
  const supabase = getSupabase(event);
  const userId = trimString(identity.userId || identity.id, 240);
  const email = lowerEmail(identity.email);
  if (!userId && !email) return;

  let query = supabase
    .from('task_calendar_connections')
    .delete()
    .eq('provider', 'microsoft');

  if (userId) {
    query = query.eq('user_id', userId);
  } else {
    query = query.eq('user_email', email);
  }

  const { error } = await query;
  if (error) throw error;
}

async function updateConnectionHealth(event, connectionId, fields = {}) {
  const supabase = getSupabase(event);
  const update = {};
  if (Object.prototype.hasOwnProperty.call(fields, 'accessToken')) {
    update.access_token = trimString(fields.accessToken, 16000);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'refreshToken')) {
    update.refresh_token = trimString(fields.refreshToken, 16000);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'accessTokenExpiresAt')) {
    update.access_token_expires_at = trimString(fields.accessTokenExpiresAt, 80) || null;
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'lastSyncedAt')) {
    update.last_synced_at = trimString(fields.lastSyncedAt, 80) || null;
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'lastError')) {
    update.last_error = trimString(fields.lastError, 1000) || null;
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'syncEnabled')) {
    update.sync_enabled = fields.syncEnabled !== false;
  }
  if (!Object.keys(update).length) return null;

  const { data, error } = await supabase
    .from('task_calendar_connections')
    .update(update)
    .eq('id', trimString(connectionId, 120))
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function connectionNeedsRefresh(connection = {}) {
  const expiresAt = Date.parse(trimString(connection.access_token_expires_at, 80) || '');
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt < (Date.now() + (5 * 60 * 1000));
}

async function ensureFreshConnection(event, settings = {}, connection = {}) {
  if (!connectionNeedsRefresh(connection)) return connection;
  const payload = await refreshAccessToken(settings, connection.refresh_token);
  return updateConnectionHealth(event, connection.id, {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || connection.refresh_token,
    accessTokenExpiresAt: tokenExpiryIso(payload),
    lastError: '',
  });
}

function normalizeConnectionForClient(connection = {}, currentIdentity = {}) {
  const currentUserId = trimString(currentIdentity.userId || currentIdentity.id, 240);
  const currentEmail = lowerEmail(currentIdentity.email);
  const isCurrentUser = (
    (!!currentUserId && currentUserId === trimString(connection.user_id, 240))
    || (!!currentEmail && currentEmail === lowerEmail(connection.user_email))
  );

  return {
    id: trimString(connection.id, 120),
    provider: 'microsoft',
    userId: trimString(connection.user_id, 240),
    userEmail: lowerEmail(connection.user_email),
    userDisplayName: trimString(connection.user_display_name, 240) || trimString(connection.user_email, 240) || 'HMJ admin',
    externalAccountEmail: lowerEmail(connection.external_account_email),
    externalDisplayName: trimString(connection.external_display_name, 240) || trimString(connection.external_account_email, 240),
    syncEnabled: connection.sync_enabled !== false,
    lastSyncedAt: trimString(connection.last_synced_at, 80),
    lastError: trimString(connection.last_error, 1000),
    connected: !!trimString(connection.refresh_token, 16000),
    isCurrentUser,
  };
}

function normalizeGraphEvent(raw = {}, owner = {}) {
  const startAt = trimString(raw?.start?.dateTime, 80);
  const endAt = trimString(raw?.end?.dateTime, 80);
  return {
    id: trimString(raw.id, 240),
    ownerUserId: trimString(owner.userId, 240),
    ownerEmail: lowerEmail(owner.userEmail),
    ownerDisplayName: trimString(owner.userDisplayName, 240) || 'Connected calendar',
    provider: 'microsoft',
    title: trimString(raw.subject, 240) || 'Busy',
    startAt,
    endAt,
    isAllDay: raw.isAllDay === true,
    location: trimString(raw?.location?.displayName, 240),
    webLink: trimString(raw.webLink, 2000),
    organizer: trimString(raw?.organizer?.emailAddress?.name, 240),
    kind: 'external',
  };
}

module.exports = {
  TEAM_TASK_CALENDAR_SETTINGS_KEY,
  DEFAULT_TEAM_TASK_CALENDAR_SETTINGS,
  MICROSOFT_DEFAULT_SCOPES,
  trimString,
  lowerEmail,
  normalizeScopes,
  resolveBaseUrl,
  buildCallbackUrl,
  buildTeamTasksUrl,
  normalizeCalendarSettings,
  redactCalendarSettings,
  buildCalendarDiagnostics,
  readCalendarSettings,
  persistCalendarSettings,
  buildSignedState,
  parseSignedState,
  buildAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchMicrosoftProfile,
  fetchCalendarView,
  tokenExpiryIso,
  upsertCalendarConnection,
  listCalendarConnections,
  readUserCalendarConnection,
  deleteUserCalendarConnection,
  updateConnectionHealth,
  connectionNeedsRefresh,
  ensureFreshConnection,
  normalizeConnectionForClient,
  normalizeGraphEvent,
};
