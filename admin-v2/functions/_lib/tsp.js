const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_TOKEN_EXPIRES_IN = 3600;
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const DEFAULT_BASE_URL = "https://brightwater.api.timesheetportal.com";

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

  return {
    baseUrl,
    baseUrlPresent: Boolean(baseUrlRaw),
    clientId,
    clientSecret,
    scope,
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    hasScope: Boolean(scope),
  };
};

const isLiveMode = (env = getEnv()) => env.hasClientId && env.hasClientSecret && Boolean(env.baseUrl);

const getMissingEnv = (env) => {
  const missing = [];
  if (!env.hasClientId) missing.push("TSP_OAUTH_CLIENT_ID");
  if (!env.hasClientSecret) missing.push("TSP_OAUTH_CLIENT_SECRET");
  return missing;
};

const getDebugSnapshot = (env = getEnv()) => ({
  env: {
    tsp_base_url_present: env.baseUrlPresent,
    oauth_client_id_present: env.hasClientId,
    oauth_client_secret_present: env.hasClientSecret,
    oauth_scope_present: env.hasScope,
  },
  missing: getMissingEnv(env),
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
});

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

const getOAuthToken = async () => {
  const env = getEnv();
  const now = Date.now();
  if (cachedOAuthToken && cachedOAuthExpiry > now) {
    return { ok: true, token: cachedOAuthToken };
  }

  if (!env.hasClientId || !env.hasClientSecret || !env.baseUrl) {
    return {
      ok: false,
      status: 0,
      error: "Missing OAuth credentials for Timesheet Portal",
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
    };
  }

  cachedOAuthToken = accessToken;
  cachedOAuthExpiry = now + Math.max(expiresInSeconds * 1000 - TOKEN_EXPIRY_BUFFER_MS, 0);

  return { ok: true, token: accessToken };
};

const tspFetch = async (path = "/", options = {}) => {
  const env = getEnv();
  const mode = isLiveMode(env) ? "live" : "standby";

  if (!env.baseUrl) {
    return {
      ok: false,
      status: 0,
      mode,
      error: "Missing TSP base URL",
      debug: getDebugSnapshot(env),
    };
  }

  if (!env.hasClientId || !env.hasClientSecret) {
    return {
      ok: false,
      status: 0,
      mode,
      error: "Missing OAuth credentials for Timesheet Portal",
      debug: getDebugSnapshot(env),
    };
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${env.baseUrl}${normalizedPath}`);

  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
  }

  const tokenResult = await getOAuthToken();
  if (!tokenResult.ok) {
    return {
      ...tokenResult,
      mode,
      debug: getDebugSnapshot(env),
    };
  }

  const headers = new Headers({
    Accept: "application/json",
    ...(options.headers || {}),
    Authorization: `Bearer ${tokenResult.token}`,
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
      error: error.name === "AbortError" ? "Request timed out" : error.message,
      debug: getDebugSnapshot(env),
    };
  }

  recordUpstream({ url: url.toString(), status: response.status });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      mode,
      error: data?.message || data?.error || text || `Request failed with status ${response.status}`,
      details: data ?? (text ? { text: text.slice(0, 500) } : undefined),
      debug: getDebugSnapshot(env),
    };
  }

  return {
    ok: true,
    status: response.status,
    data,
    mode,
  };
};

module.exports = {
  getEnv,
  isLiveMode,
  getDebugSnapshot,
  tspFetch,
};
