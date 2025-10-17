// netlify/functions/whoami.js
exports.handler = async (event, context) => {
  // What Netlify thinks about your request
  const user = context?.clientContext?.user || null;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // High level
      hasUser: !!user,
      // Useful bits to see
      email: user?.email || null,
      sub: user?.sub || null,
      app_metadata: user?.app_metadata || null,
      roles: user?.app_metadata?.roles || user?.roles || [],
      // Helpful when debugging
      method: event.httpMethod,
      path: event.path,
      // DO NOT log the token; just whether it was present
      hasAuthHeader: !!event.headers.authorization,
    }),
  };
};
