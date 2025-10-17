const { getUser } = require('./_auth');

exports.handler = async (event, context) => {
  try {
    const u = getUser(event, context);
    return {
      statusCode: 200,
      body: JSON.stringify({ email: u.email, roles: u.app_metadata?.roles || [] }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (e) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
};
