const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_BASE_URL = "https://brightwater.api.timesheetportal.com";

const { getOAuthEnv, getOAuthDebug, getAccessToken } = require("./tsp-auth");

let lastUpstream = {
  url: null,
  status: null,
};

const getEnv = () => {
  const oauthEnv = getOAuthEnv();
  const apiKey = (process.env.TSP_API_KEY || "").trim();

  return {
    baseUrl: oauthEnv.baseUrl,
    baseUrlPresent: oauthEnv.baseUrlPresent,
    clientId: oauthEnv.clientId,
    clientSecret: oauthEnv.clientSecret,
    scope: oauthEnv.scope,
    hasClientId: oauthEnv.hasClientId,
    hasClientSecret: oauthEnv.hasClientSecret,
    hasScope: oauthEnv.hasScope,
    tokenUrl: oauthEnv.tokenUrl,
    tokenUrlPresent: oauthEnv.tokenUrlPresent,
    apiKey,
    hasApiKey: Boolean(apiKey),
  };
};

const getAuthMode = (env = getEnv()) => {
  if (env.hasClientId && env.hasClientSecret) return "oauth";
  return "none";
};

const isLiveMode = (env = getEnv()) => getAuthMode(env) !== "none" && Boolean(env.baseUrl);

const getMissingEnv = (env, authMode = getAuthMode(env)) => {
  const missing = [];
  if (!env.baseUrl) missing.push("TSP_BASE_URL");

  if (authMode === "oauth" || authMode === "none") {
    if (!env.hasClientId) missing.push("TSP_OAUTH_CLIENT_ID");
    if (!env.hasClientSecret) missing.push("TSP_OAUTH_CLIENT_SECRET");
  }

  return missing;
};

const getDebugSnapshot = (env = getEnv(), options = {}) => {
  const authMode = options.authMode ?? getAuthMode(env);
  const auth = {
    mode: authMode,
    using: authMode,
  };

  if (options.tokenCached !== undefined) {
    auth.token_cached = options.tokenCached;
  }

  return {
    env: {
      tsp_base_url_present: env.baseUrlPresent,
      oauth_client_id_present: env.hasClientId,
      oauth_client_secret_present: env.hasClientSecret,
      oauth_scope_present: env.hasScope,
      tsp_api_key_present: env.hasApiKey,
      tsp_api_key_deprecated: env.hasApiKey,
      token_url_present: env.tokenUrlPresent,
    },
    missing: getMissingEnv(env, authMode),
    auth,
    oauth: getOAuthDebug(),
    upstream: {
      last_url: lastUpstream.url,
      status: lastUpstream.status,
    },
  };
};

const recordUpstream = ({ url, status }) => {
  lastUpstream = {
    url,
    status,
  };
};

const fetchJson = async (url, options = {}) => {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    let data;
    let text;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (error) {
          // Not JSON, ignore.
        }
      }
    }

    return { response, data, text };
  } catch (error) {
    return { error };
  } finally {
    clearTimeout(timeout);
  }
};

const getTspAuth = async (env = getEnv()) => {
  const authMode = getAuthMode(env);

  if (!env.baseUrl) {
    return {
      ok: false,
      status: 500,
      mode: "none",
      error: "Missing TSP base URL",
      debug: getDebugSnapshot(env, { authMode }),
    };
  }

  if (authMode === "none") {
    return {
      ok: false,
      status: 500,
      mode: "none",
      error: "Missing Timesheet Portal OAuth credentials",
      debug: getDebugSnapshot(env, { authMode }),
    };
  }

  const tokenResult = await getAccessToken(env, fetchJson);
  if (!tokenResult.ok) {
    return {
      ok: false,
      status: tokenResult.status || 500,
      mode: "oauth",
      error: tokenResult.error,
      details: tokenResult.details,
      debug: getDebugSnapshot(env, { authMode, tokenCached: tokenResult.cached }),
    };
  }

  return {
    ok: true,
    mode: "oauth",
    baseUrl: env.baseUrl,
    headers: { Authorization: `Bearer ${tokenResult.token}` },
    debug: getDebugSnapshot(env, { authMode, tokenCached: tokenResult.cached }),
  };
};

const tspFetch = async (path = "/", options = {}) => {
  const env = getEnv();
  const authMode = getAuthMode(env);
  const mode = isLiveMode(env) ? "live" : "standby";
  const authResult = await getTspAuth(env);

  if (!authResult.ok) {
    return {
      ok: false,
      status: authResult.status || 500,
      mode,
      auth_mode: authResult.mode,
      error: authResult.error,
      details: authResult.details,
      upstream: authResult.upstream,
      debug: authResult.debug,
    };
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${authResult.baseUrl}${normalizedPath}`);

  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
  }

  const headers = new Headers({
    Accept: "application/json",
    ...(options.headers || {}),
    ...(authResult.headers || {}),
  });

  let body = options.body;
  if (body && typeof body === "object" && !(body instanceof Buffer)) {
    body = JSON.stringify(body);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  const { response, data, text, error } = await fetchJson(url.toString(), {
    method: options.method || "GET",
    headers,
    body,
  });

  if (error) {
    recordUpstream({ url: url.toString(), status: 0 });
    return {
      ok: false,
      status: 0,
      mode,
      auth_mode: authResult.mode,
      error: error.name === "AbortError" ? "Request timed out" : error.message,
      upstream: { url: url.toString(), status: 0 },
      debug: getDebugSnapshot(env, { authMode, tokenCached: authResult.debug?.auth?.token_cached }),
    };
  }

  recordUpstream({ url: url.toString(), status: response.status });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      mode,
      auth_mode: authResult.mode,
      error: data?.message || data?.error || text || `Request failed with status ${response.status}`,
      details: data ?? (text ? { text: text.slice(0, 500) } : undefined),
      upstream: { url: url.toString(), status: response.status },
      debug: getDebugSnapshot(env, { authMode, tokenCached: authResult.debug?.auth?.token_cached }),
    };
  }

  return {
    ok: true,
    status: response.status,
    data,
    mode,
    auth_mode: authResult.mode,
  };
};

module.exports = {
  DEFAULT_BASE_URL,
  getEnv,
  getAuthMode,
  isLiveMode,
  getDebugSnapshot,
  getTspAuth,
  tspFetch,
  fetchJson,
};
