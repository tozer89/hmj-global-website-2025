// netlify/functions/whoami.js
exports.handler = async (event, context) => {
  const u = context?.clientContext?.user || null;
  if (!u) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized', hint: 'No Identity user on context' }),
    };
  }
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      email: u.email,
      sub: u.sub,
      app_metadata: u.app_metadata || {},
    }),
  };
};
