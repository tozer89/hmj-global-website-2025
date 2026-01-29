const { getEnv, detectAuthMethod } = require("./_lib/tsp");

exports.handler = async () => {
  const env = getEnv();
  const authMethod = detectAuthMethod(env);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      tsp_base_url_present: env.hasBaseUrl,
      auth_method: authMethod,
      oauth_ready: env.hasClientId && env.hasClientSecret,
      regular_ready: env.hasEmail && env.hasPassword && env.hasAccountName,
      api_key_present: env.hasApiKey,
    }),
  };
};
