const { getEnv } = require("./_lib/tsp");

exports.handler = async () => {
  const env = getEnv();

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      tsp_base_url_present: env.hasBaseUrl,
      tsp_api_key_present: env.hasApiKey,
    }),
  };
};
