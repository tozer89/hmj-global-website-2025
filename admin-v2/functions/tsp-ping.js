const { getEnv } = require("./_lib/tsp");

exports.handler = async () => {
  const start = Date.now();
  const env = getEnv();

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      tsp_base_url_present: env.hasBaseUrl,
      tsp_api_key_present: env.hasApiKey,
      tsp_client_id_present: env.hasClientId,
      tsp_client_secret_present: env.hasClientSecret,
      ms: Date.now() - start,
      meta: {
        authMode: env.hasClientId && env.hasClientSecret ? "oauth" : env.hasApiKey ? "apikey" : "missing",
      },
    }),
  };
};
