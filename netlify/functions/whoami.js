// netlify/functions/whoami.js
exports.handler = async (event, context) => {
  const cc = context.clientContext || {};
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hasClientContext: !!cc.user,
      user: cc.user || null,
      hasAuthHeader: !!event.headers.authorization,
    }),
  };
};
