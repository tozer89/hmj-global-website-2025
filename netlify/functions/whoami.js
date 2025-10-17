// Simple echo of what Netlify thinks you are
exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      hasUser: !!user,
      user: user || null,
      // show what headers we received (helps debugging)
      receivedAuthHeader: event.headers?.authorization || null,
    }, null, 2),
  };
};
