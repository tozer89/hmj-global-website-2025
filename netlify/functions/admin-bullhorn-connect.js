'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const {
  buildAuthorizeUrl,
  buildBullhornDiagnostics,
  buildBullhornReturnUrl,
  buildNoStoreHeaders,
  getLoginInfo,
  logBullhorn,
  normalizeReturnTo,
  resolveBullhornConfig,
} = require('./_bullhorn.js');
const {
  createBullhornSettingsStore,
  normalizeConnectionForClient,
} = require('./_bullhorn-store.js');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: buildNoStoreHeaders({
      'content-type': 'application/json; charset=utf-8',
    }),
    body: JSON.stringify(payload, null, 2),
  };
}

exports.handler = withAdminCors(async (event, context) => {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) {
    return json(405, {
      ok: false,
      error: 'method_not_allowed',
    });
  }

  const { user } = await getContext(event, context, { requireAdmin: true });
  const store = createBullhornSettingsStore();
  const connection = await store.readConnection(event).catch(() => null);
  const runtimeStatus = await store.readRuntimeStatus(event).catch(() => ({}));
  const diagnostics = buildBullhornDiagnostics(event, connection);

  let config;
  try {
    config = resolveBullhornConfig(event);
  } catch (error) {
    await store.saveRuntimeStatus(event, {
      lastEvent: 'connect_blocked',
      lastEventAt: new Date().toISOString(),
      lastError: error.message,
      lastErrorAt: new Date().toISOString(),
    }).catch(() => null);
    return json(409, {
      ok: false,
      error: error.classification || 'missing_config',
      diagnostics,
      runtimeStatus,
      connection: connection ? normalizeConnectionForClient(connection) : null,
    });
  }

  const returnTo = normalizeReturnTo(
    event,
    event?.queryStringParameters?.returnTo,
    '/admin/candidates.html'
  );

  const loginInfo = await getLoginInfo(config.apiUsername);
  const auth = buildAuthorizeUrl({
    event,
    config,
    loginInfo,
    user: {
      id: user?.id || user?.sub,
      email: user?.email,
    },
    returnTo,
  });

  await store.saveRuntimeStatus(event, {
    lastEvent: 'connect_requested',
    lastEventAt: new Date().toISOString(),
    lastError: '',
    apiUsername: config.apiUsername,
    pendingAuth: auth.pendingState,
    returnTo,
    connectedEmail: String(user?.email || '').toLowerCase(),
  }).catch(() => null);

  logBullhorn('connect_requested', {
    email: user?.email,
    apiUsername: config.apiUsername,
    returnTo,
  });

  if (method === 'POST') {
    return json(200, {
      ok: true,
      authUrl: auth.url,
      redirectUri: auth.redirectUri,
      diagnostics,
      runtimeStatus: await store.readRuntimeStatus(event).catch(() => runtimeStatus),
      connection: connection ? normalizeConnectionForClient(connection) : null,
    });
  }

  if (event?.queryStringParameters?.status === '1') {
    return json(200, {
      ok: true,
      authUrl: auth.url,
      redirectUri: auth.redirectUri,
      diagnostics,
      runtimeStatus,
      connection: connection ? normalizeConnectionForClient(connection) : null,
    });
  }

  return {
    statusCode: 302,
    headers: buildNoStoreHeaders({
      location: auth.url || buildBullhornReturnUrl(event, '/admin/candidates.html', {
        bullhorn_status: 'error',
      }),
    }),
    body: '',
  };
});
