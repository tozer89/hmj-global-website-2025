const jwt = require('jsonwebtoken');

function getUser(context) {
  const u = context.clientContext && context.clientContext.user;
  if (!u) throw new Error('Unauthorized');
  return u; // contains email, sub, app_metadata, etc.
}

module.exports = { getUser };
