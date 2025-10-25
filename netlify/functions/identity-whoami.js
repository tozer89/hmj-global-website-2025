// netlify/functions/identity-whoami.js
const { withAdminCors } = require('./_http.js');

async function baseHandler(event, context) {
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
}

exports.handler = withAdminCors(baseHandler, { requireToken: false });
