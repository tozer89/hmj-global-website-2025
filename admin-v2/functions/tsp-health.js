const { tspFetch } = require("./_lib/tsp");

const DEFAULT_CLIENTS_PATH = "/clients";

exports.handler = async () => {
  const start = Date.now();
  const healthPath = (process.env.TSP_HEALTH_PATH || "").trim();
  const clientsPath = (process.env.TSP_CLIENTS_PATH || DEFAULT_CLIENTS_PATH).trim() || DEFAULT_CLIENTS_PATH;
  const path = healthPath || clientsPath;

  const result = await tspFetch(path, {
    query: healthPath ? undefined : { limit: 1 },
  });

  const responseTime = Date.now() - start;

  if (!result.ok) {
    return {
      statusCode: result.status || 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        mode: result.mode,
        auth_mode: result.auth_mode,
        status: result.status,
        response_time_ms: responseTime,
        error: result.error,
        details: result.details,
        upstream: result.upstream,
        debug: result.debug,
      }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      mode: result.mode,
      auth_mode: result.auth_mode,
      status: result.status,
      response_time_ms: responseTime,
      message: "TSP reachable",
      sample: result.data,
      path,
    }),
  };
};
