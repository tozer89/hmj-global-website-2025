// netlify/functions/whoami.js
exports.handler = async (event, context) => {
  const u = context.clientContext?.user || null;
  const authHeader = !!event.headers?.authorization;
  let roles = [];
  try {
    const payload = event.headers?.authorization?.split(' ')[1]?.split('.')[1];
    roles = payload ? (JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))?.app_metadata?.roles || []) : [];
  } catch {}
  return {
    statusCode: 200,
    body: JSON.stringify({
      hasUser: !!u,
      email: u?.email ?? null,
      sub: u?.sub ?? null,
      app_metadata: u?.app_metadata ?? null,
      roles,
      method: event.httpMethod,
      path: event.path,
      hasAuthHeader: authHeader
    })
  };
};
