const { getEnv, getAuthMode, getDebugSnapshot, isLiveMode } = require("./_lib/tsp");

exports.handler = async () => {
  const env = getEnv();
  const authMode = getAuthMode(env);
  const mode = isLiveMode(env) ? "live" : "standby";
  const ok = mode === "live";
  const note = authMode === "api_key" ? "OAuth not configured; using API key fallback" : undefined;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok,
      mode,
      auth_mode: authMode,
      can_run: ok,
      note,
      tsp_base_url_present: env.baseUrlPresent,
      oauth_client_id_present: env.hasClientId,
      oauth_client_secret_present: env.hasClientSecret,
      oauth_scope_present: env.hasScope,
      tsp_api_key_present: env.hasApiKey,
      error: ok ? undefined : "Missing Timesheet Portal credentials",
      debug: ok ? undefined : getDebugSnapshot(env, { authMode }),
    }),
  };
};
