const { tspFetch } = require("./_lib/tsp");

const DEFAULT_LIMIT = 50;
const DEFAULT_USERS_PATH = "/users";

const normalizeStatus = (value) => {
  if (!value) return "unknown";
  return String(value).toLowerCase();
};

const normalizeUser = (user, index) => {
  const id = user.id || user.userId || user.uuid || `user-${index + 1}`;
  const name =
    user.name ||
    user.fullName ||
    user.displayName ||
    `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
    "Unknown User";
  const email = user.email || user.Email || user.userEmail || null;
  const status = normalizeStatus(user.status || user.state || user.activeStatus || user.isActive);

  return { id, name, email, status, raw: user };
};

const extractArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.users)) return payload.users;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
};

exports.handler = async (event) => {
  const limitParam = parseInt(event.queryStringParameters?.limit, 10);
  const limit = Number.isFinite(limitParam) ? Math.min(limitParam, 200) : DEFAULT_LIMIT;
  const endpoint = (process.env.TSP_USERS_PATH || DEFAULT_USERS_PATH).trim() || DEFAULT_USERS_PATH;

  const result = await tspFetch(endpoint, { query: { limit } });
  if (!result.ok) {
    return {
      statusCode: result.status || 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        mode: result.mode,
        status: result.status,
        error: result.error,
        details: result.details,
        debug: result.debug,
      }),
    };
  }

  const items = extractArray(result.data);
  const normalized = items.map(normalizeUser).slice(0, limit);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      mode: "live",
      limit,
      count: normalized.length,
      users: normalized.map(({ raw, ...user }) => user),
    }),
  };
};
