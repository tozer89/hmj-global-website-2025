const { getEnv, getDebugSnapshot, isLiveMode } = require("./_lib/tsp");

exports.handler = async () => {
  const env = getEnv();
  const mode = isLiveMode(env) ? "live" : "standby";
  const ok = mode === "live";

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok,
      mode,
      tsp_base_url_present: env.baseUrlPresent,
      oauth_client_id_present: env.hasClientId,
      oauth_client_secret_present: env.hasClientSecret,
      oauth_scope_present: env.hasScope,
      error: ok ? undefined : "Missing OAuth credentials for Timesheet Portal",
      debug: ok ? undefined : getDebugSnapshot(env),
    }),
  };
};
