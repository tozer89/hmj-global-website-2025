const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_TOKEN_EXPIRES_IN = 3600;
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const DEFAULT_BASE_URL = "https://brightwater.api.timesheetportal.com";

let cachedOAuthToken = null;
let cachedOAuthExpiry = 0;

const getEnv = () => {
  const baseUrl = (process.env.TSP_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const clientId = (process.env.TSP_CLIENT_ID || "").trim();
  const clientSecret = (process.env.TSP_CLIENT_SECRET || "").trim();
  const scope = (process.env.TSP_SCOPE || "").trim();
  const mode = (process.env.TSP_MODE || "").trim().toLowerCase();

  return {
    baseUrl,
    clientId,
    clientSecret,
    scope,
    mode,
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    hasScope: Boolean(scope),
  };
};

const isLiveMode = () => {
  const { mode } = getEnv();
  return mode === "live";
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

  const url = `${env.baseUrl}/oauth/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });
  if (env.scope) {
    body.set("scope", env.scope);
  }

  const { response, data, text, error } = await fetchJson(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (error) {
    return {
      ok: false,
      status: 0,
      error: error.name === "AbortError" ? "Request timed out" : error.message,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data?.error_description || data?.error || text || "OAuth token request failed",
      details: data ?? text,
    };
  }

  const accessToken = data?.access_token || data?.token || null;
  const expiresInSeconds = Number(data?.expires_in || DEFAULT_TOKEN_EXPIRES_IN);

  if (!accessToken) {
    return {
      ok: false,
      status: response.status,
      error: "OAuth response did not include an access token",
      details: data ?? text,
    };
  }

  cachedOAuthToken = accessToken;
  cachedOAuthExpiry = now + Math.max(expiresInSeconds * 1000 - TOKEN_EXPIRY_BUFFER_MS, 0);

  return { ok: true, token: accessToken };
};

const tspFetch = async (path = "/", options = {}) => {
  const env = getEnv();

  if (!env.baseUrl) {
    return {
      ok: false,
      status: 0,
      error: "Missing TSP base URL",
    };
  }

  if (!env.hasClientId || !env.hasClientSecret) {
    return {
      ok: false,
      status: 0,
      error: "Missing TSP_CLIENT_ID or TSP_CLIENT_SECRET",
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
    return tokenResult;
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
    return {
      ok: false,
      status: 0,
      error: error.name === "AbortError" ? "Request timed out" : error.message,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data?.message || data?.error || text || `Request failed with status ${response.status}`,
      details: data ?? text,
    };
  }

  return {
    ok: true,
    status: response.status,
    data,
  };
};

module.exports = {
  getEnv,
  isLiveMode,
  tspFetch,
};
