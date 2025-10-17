// netlify/functions/whoami.js
exports.handler = async (event, context) => {
  // Works whether you pass a Bearer token (Authorization header)
  // or you're just logged in on this site (clientContext).
  const id = context.clientContext && context.clientContext.identity;
  if (!id) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      user: id.user,           // email, sub, app_metadata, etc.
      claims: id.token         // all JWT claims if you need to inspect them
    })
  };
};
