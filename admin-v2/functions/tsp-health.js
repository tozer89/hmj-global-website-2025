const { getEnv, tspFetch } = require("./_lib/tsp");

exports.handler = async () => {
  const env = getEnv();
  const result = await tspFetch("/clients", { query: { pageSize: 1 } });

  const ok = result.ok;
  const message = ok ? "TSP reachable" : result.error || "TSP unreachable";

  return {
    statusCode: ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok,
      status: result.status,
      message,
      ms: result.ms,
      meta: {
        baseUrlPresent: env.hasBaseUrl,
        pageSize: 1,
      },
    }),
  };
};
