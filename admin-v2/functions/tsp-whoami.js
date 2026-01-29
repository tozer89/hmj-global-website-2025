const { tspFetch, isLiveMode } = require("./_lib/tsp");

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
  if (!isLiveMode()) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        mode: "standby",
      }),
    };
  }

  const whoamiPath = (process.env.TSP_WHOAMI_PATH || "").trim();

  if (whoamiPath) {
    const result = await tspFetch(whoamiPath);
    if (!result.ok) {
      return {
        statusCode: result.status || 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: false,
          status: result.status,
          error: result.error,
          details: result.details,
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
  if (!email) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        note: "whoami endpoint not configured",
        error: "Missing TSP_API_USER_EMAIL for fallback lookup",
      }),
    };
  }

  const usersPath = (process.env.TSP_USERS_PATH || DEFAULT_USERS_PATH).trim() || DEFAULT_USERS_PATH;
  const result = await tspFetch(usersPath, {
    query: { email },
  });

  if (!result.ok) {
    return {
      statusCode: result.status || 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        status: result.status,
        error: result.error,
        details: result.details,
        note: "whoami endpoint not configured",
      }),
    };
  }

  const items = extractArray(result.data);
  const match = matchByEmail(items, email);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: Boolean(match),
      mode: "live",
      user: match || null,
      note: match ? undefined : "No matching user found",
      source: "email_lookup",
    }),
  };
};
