// netlify/functions/_auth.js
// Minimal, dependency-free auth helper using Netlify's clientContext.

function getUser(context) {
  const u = context?.clientContext?.user;
  if (!u) {
    // Make the reason obvious while debugging
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
  return {
    id: u.sub,
    email: (u.email || '').toLowerCase(),
    roles: u.app_metadata?.roles || u.roles || []
  };
}

module.exports = { getUser };
