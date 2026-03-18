'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const {
  getFinanceSchemaStatus,
  readFinanceConnection,
  disconnectFinanceConnection,
  normalizeConnectionForClient,
  readQboRuntimeStatus,
  saveQboRuntimeStatus,
} = require('./_finance-store.js');
const { buildQboDiagnostics, buildAuthUrl, buildReturnUrl, logQbo } = require('./_finance-qbo.js');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload, null, 2),
  };
}

module.exports.handler = withAdminCors(async (event, context) => {
  const { user } = await getContext(event, context, { requireAdmin: true });
  const schema = await getFinanceSchemaStatus(event);
  const connection = schema.ready ? await readFinanceConnection(event).catch(() => null) : null;
  const runtimeStatus = schema.ready ? await readQboRuntimeStatus(event).catch(() => ({})) : {};
  const diagnostics = buildQboDiagnostics(event, connection, schema.ready);
  const method = String(event.httpMethod || 'GET').toUpperCase();

  if (method === 'GET') {
    const returnTo = event.queryStringParameters?.returnTo || buildReturnUrl(event);
    if (event.queryStringParameters?.action === 'connect') {
      if (!diagnostics.connectReady) {
        await saveQboRuntimeStatus(event, {
          lastEvent: 'connect_blocked',
          lastEventAt: new Date().toISOString(),
          lastError: diagnostics.warnings?.[0] || 'QuickBooks is not configured yet.',
          lastErrorAt: new Date().toISOString(),
          returnTo,
        }, user?.email || '');
        return json(409, { ok: false, diagnostics, runtimeStatus });
      }
      const auth = buildAuthUrl({ event, user, returnTo });
      logQbo('connect_requested', {
        email: user?.email,
        returnTo,
        redirectUri: auth.redirectUri,
      });
      await saveQboRuntimeStatus(event, {
        lastEvent: 'connect_requested',
        lastEventAt: new Date().toISOString(),
        lastError: '',
        redirectUri: auth.redirectUri,
        returnTo,
        connectedEmail: String(user?.email || '').toLowerCase(),
        pendingAuth: auth.pendingState || null,
      }, user?.email || '');
      return json(200, { ok: true, diagnostics, runtimeStatus, authUrl: auth.url, redirectUri: auth.redirectUri });
    }
    return json(200, {
      ok: true,
      diagnostics,
      runtimeStatus,
      connection: connection ? normalizeConnectionForClient(connection) : null,
    });
  }

  const payload = event.body ? JSON.parse(event.body) : {};
  if (payload.action === 'disconnect') {
    if (connection?.id) await disconnectFinanceConnection(event, connection.id);
    await saveQboRuntimeStatus(event, {
      lastEvent: 'disconnected',
      lastEventAt: new Date().toISOString(),
      lastError: '',
      disconnectedAt: new Date().toISOString(),
    }, user?.email || '');
    return json(200, {
      ok: true,
      disconnected: true,
      diagnostics: buildQboDiagnostics(event, null, schema.ready),
      runtimeStatus: await readQboRuntimeStatus(event).catch(() => ({})),
    });
  }

  return json(400, {
    ok: false,
    error: 'unsupported_qbo_action',
  });
});
