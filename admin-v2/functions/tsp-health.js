const { fetchTsp } = require("./_lib/tsp");

const DEFAULT_CLIENTS_PATH = "/clients";

exports.handler = async () => {
  const start = Date.now();
  const healthPath = (process.env.TSP_HEALTH_PATH || "").trim();
  const clientsPath = (process.env.TSP_CLIENTS_PATH || DEFAULT_CLIENTS_PATH).trim() || DEFAULT_CLIENTS_PATH;
  const path = healthPath || clientsPath;

  const result = await fetchTsp(path, {
    query: healthPath ? undefined : { limit: 1 },
  });

  const responseTime = Date.now() - start;

  if (!result.ok) {
    return {
      statusCode: result.status || 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        status: result.status,
        response_time_ms: responseTime,
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
      status: result.status,
      response_time_ms: responseTime,
      message: "TSP reachable",
      sample: result.data,
      path,
    }),
  };
};
