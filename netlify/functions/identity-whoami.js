// netlify/functions/identity-whoami.js
exports.handler = async (event, context) => {
  const user = context?.clientContext?.user || null;
  const roles = user?.app_metadata?.roles || user?.roles || [];
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({
      ok: true,
      identityEmail: user?.email || null,
      roles,
      raw: user || null
    })
  };
};
