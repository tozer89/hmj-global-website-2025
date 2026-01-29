const { getEnv, tspFetch } = require("./_lib/tsp");

exports.handler = async () => {
  const env = getEnv();
  const whoamiPath = (process.env.TSP_WHOAMI_PATH || "").trim();

  if (!whoamiPath) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        note: "whoami endpoint not configured",
        reachable: env.hasBaseUrl,
      }),
    };
  }

  const result = await tspFetch(whoamiPath);
  const ok = result.ok;

  return {
    statusCode: ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok,
      status: result.status,
      data: result.data ?? null,
      message: ok ? "User fetched" : result.error || "Whoami request failed",
    }),
  };
};
