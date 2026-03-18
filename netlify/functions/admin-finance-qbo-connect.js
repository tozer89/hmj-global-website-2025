'use strict';

const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getFinanceSchemaStatus, readFinanceConnection, disconnectFinanceConnection, normalizeConnectionForClient } = require('./_finance-store.js');
const { buildQboDiagnostics, buildAuthUrl, buildReturnUrl } = require('./_finance-qbo.js');

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
  const diagnostics = buildQboDiagnostics(event, connection, schema.ready);
  const method = String(event.httpMethod || 'GET').toUpperCase();

  if (method === 'GET') {
    const returnTo = event.queryStringParameters?.returnTo || buildReturnUrl(event);
    if (event.queryStringParameters?.action === 'connect') {
      if (!diagnostics.connectReady) {
        return json(409, { ok: false, diagnostics });
      }
      const auth = buildAuthUrl({ event, user, returnTo });
      return json(200, { ok: true, diagnostics, authUrl: auth.url, redirectUri: auth.redirectUri });
    }
    return json(200, {
      ok: true,
      diagnostics,
      connection: connection ? normalizeConnectionForClient(connection) : null,
    });
  }

  const payload = event.body ? JSON.parse(event.body) : {};
  if (payload.action === 'disconnect') {
    if (connection?.id) await disconnectFinanceConnection(event, connection.id);
    return json(200, {
      ok: true,
      disconnected: true,
      diagnostics: buildQboDiagnostics(event, null, schema.ready),
    });
  }

  return json(400, {
    ok: false,
    error: 'unsupported_qbo_action',
  });
});
