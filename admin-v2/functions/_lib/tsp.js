const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_TOKEN_EXPIRES_IN = 3600;
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const DEFAULT_BASE_URL = "https://brightwater.api.timesheetportal.com";
const DEFAULT_API_KEY_HEADER = "x-api-key";

let cachedOAuthToken = null;
let cachedOAuthExpiry = 0;

let lastOAuthAttempt = {
  at: null,
  status: null,
  error: null,
  bodyFormat: null,
};

let lastUpstream = {
  url: null,
  status: null,
};

const getEnv = () => {
  const baseUrlRaw = (process.env.TSP_BASE_URL || "").trim();
  const baseUrl = (baseUrlRaw || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const clientId = (process.env.TSP_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = (process.env.TSP_OAUTH_CLIENT_SECRET || "").trim();
  const scope = (process.env.TSP_OAUTH_SCOPE || "").trim();
  const apiKey = (process.env.TSP_API_KEY || "").trim();
  const apiKeyHeader = (process.env.TSP_API_KEY_HEADER || "").trim();

  return {
    baseUrl,
    baseUrlPresent: Boolean(baseUrlRaw),
    clientId,
    clientSecret,
    scope,
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    hasScope: Boolean(scope),
    apiKey,
    apiKeyHeader,
    hasApiKey: Boolean(apiKey),
  };
};

const getAuthMode = (env = getEnv()) => {
  if (env.hasClientId && env.hasClientSecret) return "oauth";
  if (env.hasApiKey) return "api_key";
  return "none";
};

const isLiveMode = (env = getEnv()) => getAuthMode(env) !== "none" && Boolean(env.baseUrl);

const getMissingEnv = (env, authMode = getAuthMode(env)) => {
  const missing = [];
  if (!env.baseUrl) missing.push("TSP_BASE_URL");

  if (authMode === "oauth") {
    if (!env.hasClientId) missing.push("TSP_OAUTH_CLIENT_ID");
    if (!env.hasClientSecret) missing.push("TSP_OAUTH_CLIENT_SECRET");
  } else if (authMode === "api_key") {
    if (!env.hasApiKey) missing.push("TSP_API_KEY");
  } else {
    if (!env.hasClientId) missing.push("TSP_OAUTH_CLIENT_ID");
    if (!env.hasClientSecret) missing.push("TSP_OAUTH_CLIENT_SECRET");
    if (!env.hasApiKey) missing.push("TSP_API_KEY");
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
    },
    missing: getMissingEnv(env, authMode),
    auth,
    oauth: {
      last_attempt_at: lastOAuthAttempt.at,
      status: lastOAuthAttempt.status,
      error: lastOAuthAttempt.error,
      body_format: lastOAuthAttempt.bodyFormat,
    },
    upstream: {
      last_url: lastUpstream.url,
      status: lastUpstream.status,
    },
  };
};

const recordOAuthAttempt = ({ status, error, bodyFormat }) => {
  lastOAuthAttempt = {
    at: new Date().toISOString(),
    status,
    error,
    bodyFormat,
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

const requestOAuthToken = async (env, bodyFormat) => {
  const url = `${env.baseUrl}/oauth/token`;
  const payload = {
    grant_type: "client_credentials",
    client_id: env.clientId,
    client_secret: env.clientSecret,
  };
  if (env.scope) {
    payload.scope = env.scope;
  }

  const isJson = bodyFormat === "json";
  const body = isJson ? JSON.stringify(payload) : new URLSearchParams(payload).toString();
  const contentType = isJson ? "application/json" : "application/x-www-form-urlencoded";

  const { response, data, text, error } = await fetchJson(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": contentType,
    },
    body,
  });

  if (error) {
    recordOAuthAttempt({
      status: 0,
      error: error.name === "AbortError" ? "Request timed out" : error.message,
      bodyFormat,
    });
    return { ok: false, status: 0, error: lastOAuthAttempt.error };
  }

  if (!response.ok) {
    const message = data?.error_description || data?.error || text || "OAuth token request failed";
    recordOAuthAttempt({ status: response.status, error: message, bodyFormat });
    return {
      ok: false,
      status: response.status,
      error: message,
      details: data ?? (text ? { text: text.slice(0, 500) } : undefined),
    };
  }

  recordOAuthAttempt({ status: response.status, error: null, bodyFormat });
  return { ok: true, status: response.status, data };
};

const getOAuthToken = async (env = getEnv()) => {
  const now = Date.now();
  if (cachedOAuthToken && cachedOAuthExpiry > now) {
    return { ok: true, token: cachedOAuthToken, cached: true };
  }

  if (!env.hasClientId || !env.hasClientSecret || !env.baseUrl) {
    return {
      ok: false,
      status: 0,
      error: "Missing OAuth credentials for Timesheet Portal",
      cached: false,
    };
  }

  let result = await requestOAuthToken(env, "form");

  if (!result.ok && result.status === 415) {
    result = await requestOAuthToken(env, "json");
  }

  if (!result.ok) {
    return result;
  }

  const accessToken = result.data?.access_token || result.data?.token || null;
  const expiresInSeconds = Number(result.data?.expires_in || DEFAULT_TOKEN_EXPIRES_IN);

  if (!accessToken) {
    const error = "OAuth response did not include an access token";
    recordOAuthAttempt({
      status: result.status,
      error,
      bodyFormat: lastOAuthAttempt.bodyFormat,
    });
    return {
      ok: false,
      status: result.status,
      error,
      details: result.data,
      cached: false,
    };
  }

  cachedOAuthToken = accessToken;
  cachedOAuthExpiry = now + Math.max(expiresInSeconds * 1000 - TOKEN_EXPIRY_BUFFER_MS, 0);

  return { ok: true, token: accessToken, cached: false };
};

const resolveApiKeyHeader = (env) => {
  const normalized = (env.apiKeyHeader || "").trim().toLowerCase();
  if (normalized === "bearer") return "bearer";
  if (normalized === "apikey" || normalized === "api-key") return "apikey";
  if (normalized === "x-api-key" || normalized === "xapikey") return "x-api-key";
  return DEFAULT_API_KEY_HEADER;
};

const getApiKeyHeaders = (env) => {
  const headerType = resolveApiKeyHeader(env);

  if (headerType === "bearer") {
    return { Authorization: `Bearer ${env.apiKey}` };
  }

  if (headerType === "apikey") {
    return { Authorization: `ApiKey ${env.apiKey}` };
  }

  return { "X-API-Key": env.apiKey };
};

const getTspAuth = async (env = getEnv()) => {
  const authMode = getAuthMode(env);
  const note = authMode === "api_key" ? "OAuth not configured; using API key fallback" : undefined;

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
      error: "Missing Timesheet Portal credentials",
      debug: getDebugSnapshot(env, { authMode }),
    };
  }

  if (authMode === "api_key") {
    return {
      ok: true,
      mode: "api_key",
      baseUrl: env.baseUrl,
      headers: getApiKeyHeaders(env),
      note,
      debug: getDebugSnapshot(env, { authMode }),
    };
  }

  const tokenResult = await getOAuthToken(env);
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
  getEnv,
  getAuthMode,
  isLiveMode,
  getDebugSnapshot,
  getTspAuth,
  tspFetch,
};
