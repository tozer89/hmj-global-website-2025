// netlify/functions/whoami.js
exports.handler = async (event, context) => {
  const id = context.clientContext && context.clientContext.identity;
  if (!id) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      user: id.user,    // contains your email etc.
      claims: id.token, // raw JWT claims
    }),
  };
};
