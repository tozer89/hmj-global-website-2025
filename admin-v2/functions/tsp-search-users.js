const { tspFetch } = require("./_lib/tsp");

const extractArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.users)) return payload.users;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
};

const normalizeUser = (user) => ({
  email: user.email || user.userEmail || user.username || "—",
  firstName: user.firstName || user.givenName || user.forename || "—",
  lastName: user.lastName || user.familyName || user.surname || "—",
  role: user.role || user.userRole || user.permission || "—",
});

exports.handler = async (event) => {
  const query = (event.queryStringParameters?.q || "").trim();

  if (!query) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        status: 400,
        error: "Missing search query",
        ms: 0,
        meta: {
          endpoint: "/users/search",
        },
      }),
    };
  }

  const result = await tspFetch("/users/search", { query: { q: query } });
  const items = extractArray(result.data);
  const users = items.map(normalizeUser);

  return {
    statusCode: result.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: result.ok,
      status: result.status,
      query,
      users,
      count: users.length,
      ms: result.ms,
      raw: result.data ?? null,
      meta: {
        endpoint: "/users/search",
      },
    }),
  };
};
