// netlify/functions/_auth.js
function getBearer(event, context) {
  const h =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    context.clientContext?.headers?.authorization ||
    "";
  if (!h || !/^Bearer\s+/i.test(h)) return null;
  return h.replace(/^Bearer\s+/i, "").trim();
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Bad token format");
  const json = Buffer.from(parts[1], "base64").toString("utf8");
  return JSON.parse(json);
}

exports.getUser = (context, event) => {
  const token = getBearer(event || {}, context || {});
  if (!token) throw new Error("Unauthorized");

  const payload = decodeJwtPayload(token);

  // Optional: simple expiry check
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    throw new Error("Unauthorized");
  }

  // Return the minimal fields we use elsewhere
  return {
    email: (payload.email || "").toLowerCase(),
    sub: payload.sub,
    app_metadata: payload.app_metadata || {},
    user_metadata: payload.user_metadata || {},
  };
};
