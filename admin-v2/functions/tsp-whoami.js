const { tspFetch } = require("./_lib/tsp");

const DEFAULT_USERS_PATH = "/users";

const extractArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.users)) return payload.users;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
};

const matchByEmail = (users, email) => {
  if (!email) return null;
  const target = email.toLowerCase();
  return users.find((user) => {
    const candidate = user.email || user.Email || user.userEmail || "";
    return candidate.toLowerCase() === target;
  });
};

exports.handler = async () => {
  const whoamiPath = (process.env.TSP_WHOAMI_PATH || "").trim();

  if (whoamiPath) {
    const result = await tspFetch(whoamiPath);
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

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        mode: "live",
        user: result.data,
        source: "whoami",
      }),
    };
  }

  const email = (process.env.TSP_API_USER_EMAIL || "").trim();
  const usersPath = (process.env.TSP_USERS_PATH || DEFAULT_USERS_PATH).trim() || DEFAULT_USERS_PATH;
  const query = email ? { email } : { limit: 1 };
  const result = await tspFetch(usersPath, { query });

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
        note: "whoami endpoint not configured",
        debug: result.debug,
      }),
    };
  }

  const items = extractArray(result.data);
  const match = matchByEmail(items, email);
  const fallbackUser = items[0] || null;
  const user = match || fallbackUser;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      mode: "live",
      user,
      note: match
        ? undefined
        : email
          ? "No matching user found"
          : user
            ? "TSP_API_USER_EMAIL not configured; returning first user"
            : "No users returned; token reachability verified",
      source: match ? "email_lookup" : email ? "email_lookup" : "users_sample",
    }),
  };
};
