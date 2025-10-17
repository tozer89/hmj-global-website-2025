// More robust auth helper: prefer Netlify's injected user, but
// fall back to decoding the JWT from the Authorization header.
function decodeJwt(token) {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    // atob in browsers; Buffer in Node (Netlify Functions)
    const json = Buffer.from(part, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getUser(event, context) {
  // 1) Best case: Netlify already injected the user
  const injected = context?.clientContext?.user;
  if (injected?.email) return injected;

  // 2) Fallback: decode the JWT we received
  const auth =
    event?.headers?.authorization ||
    event?.headers?.Authorization ||
    '';

  if (!auth.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }

  const token = auth.slice(7).trim();
  const payload = decodeJwt(token);
  if (!payload?.email) throw new Error('Unauthorized');

  // Normalize to the same shape your code expects
  return {
    email: payload.email,
    app_metadata: payload.app_metadata || payload.app_meta_data || {},
    user_metadata: payload.user_metadata || {},
    sub: payload.sub,
  };
}

module.exports = { getUser };
