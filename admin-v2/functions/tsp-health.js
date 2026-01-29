const { getEnv, tspFetch } = require("./_lib/tsp");

const REACHABLE_STATUSES = new Set([200, 401, 403]);

exports.handler = async () => {
  const env = getEnv();
  const start = Date.now();
  const result = await tspFetch("/");
  const responseTime = Date.now() - start;

  let ok = false;
  let message = "";

  if (!env.hasBaseUrl) {
    message = "Missing TSP_BASE_URL";
  } else if (result.error) {
    message = result.error;
  } else if (REACHABLE_STATUSES.has(result.status)) {
    ok = true;
    message = result.status === 200 ? "TSP reachable" : "TSP reachable (auth required)";
  } else {
    message = `Unexpected status ${result.status}`;
  }

  return {
    statusCode: ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok,
      status: result.status,
      response_time_ms: responseTime,
      message,
    }),
  };
};
