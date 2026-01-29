const { getEnv, isLiveMode } = require("./_lib/tsp");

exports.handler = async () => {
  const env = getEnv();

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      mode: isLiveMode() ? "live" : "standby",
      tsp_base_url: env.baseUrl,
      oauth_ready: env.hasClientId && env.hasClientSecret,
      scope_present: env.hasScope,
    }),
  };
};
