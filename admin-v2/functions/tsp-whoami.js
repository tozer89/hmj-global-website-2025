const { getEnv, tspFetch } = require("./_lib/tsp");

const extractArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.users)) return payload.users;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
};

exports.handler = async () => {
  const env = getEnv();
  const result = await tspFetch("/users", { query: { pageSize: 1 } });
  const users = extractArray(result.data);

  return {
    statusCode: result.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: result.ok,
      status: result.status,
      reachable: result.ok,
      note: "No whoami endpoint; token valid if users list succeeds",
      sampleUserCount: users.length,
      ms: result.ms,
      meta: {
        baseUrlPresent: env.hasBaseUrl,
        pageSize: 1,
      },
    }),
  };
};
