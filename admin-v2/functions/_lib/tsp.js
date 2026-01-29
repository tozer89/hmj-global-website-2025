const DEFAULT_TIMEOUT_MS = 8000;
const TOKEN_BUFFER_MS = 2 * 60 * 1000;
const RETRY_DELAYS_MS = [0, 400, 1200];

const tokenCache = {
  token: null,
  expiresAt: 0,
  source: null,
};

const getEnv = () => {
  const baseUrl = (process.env.TSP_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.TSP_API_KEY || "").trim();
  const clientId = (process.env.TSP_CLIENT_ID || "").trim();
  const clientSecret = (process.env.TSP_CLIENT_SECRET || "").trim();

  return {
    baseUrl,
    apiKey,
    clientId,
    clientSecret,
    hasBaseUrl: Boolean(baseUrl),
    hasApiKey: Boolean(apiKey),
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
  };
};

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...requestOptions } = options;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...requestOptions, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
};

const parseResponse = async (response) => {
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

  return { data, text };
};

const requestClientCredentialsToken = async (env) => {
  const url = new URL(`${env.baseUrl}/oauth/token`);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });

  const response = await fetchWithTimeout(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const { data } = await parseResponse(response);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: "Token request failed",
      details: data,
    };
  }

  const token = data?.access_token;
  const expiresIn = Number(data?.expires_in || 3600);

  if (!token) {
    return {
      ok: false,
      status: response.status,
      error: "Token missing in response",
      details: data,
    };
  }

  return {
    ok: true,
    status: response.status,
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
};

const requestApiKeyToken = async (env) => {
  const url = new URL(`${env.baseUrl}/token`);
  const response = await fetchWithTimeout(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": env.apiKey,
    },
  });

  const { data } = await parseResponse(response);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: "API key token request failed",
      details: data,
    };
  }

  const token = data?.access_token || data?.token;
  const expiresIn = Number(data?.expires_in || 3600);

  if (!token) {
    return {
      ok: false,
      status: response.status,
      error: "API key token missing in response",
      details: data,
    };
  }

  return {
    ok: true,
    status: response.status,
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
};

const getAccessToken = async () => {
  const env = getEnv();
  const now = Date.now();

  if (tokenCache.token && tokenCache.expiresAt - TOKEN_BUFFER_MS > now) {
    return {
      ok: true,
      token: tokenCache.token,
      expiresAt: tokenCache.expiresAt,
      source: tokenCache.source,
    };
  }

  if (!env.hasBaseUrl) {
    return { ok: false, status: 0, error: "Missing TSP_BASE_URL" };
  }

  let tokenResponse;

  if (env.hasClientId && env.hasClientSecret) {
    tokenResponse = await requestClientCredentialsToken(env);
    if (tokenResponse.ok) {
      tokenCache.token = tokenResponse.token;
      tokenCache.expiresAt = tokenResponse.expiresAt;
      tokenCache.source = "oauth";
    }
  } else if (env.hasApiKey) {
    tokenResponse = await requestApiKeyToken(env);
    if (tokenResponse.ok) {
      tokenCache.token = tokenResponse.token;
      tokenCache.expiresAt = tokenResponse.expiresAt;
      tokenCache.source = "apikey";
    }
  } else {
    return {
      ok: false,
      status: 0,
      error: "Missing TSP_CLIENT_ID/TSP_CLIENT_SECRET and TSP_API_KEY",
    };
  }

  if (!tokenResponse.ok) {
    return tokenResponse;
  }

  return {
    ok: true,
    token: tokenCache.token,
    expiresAt: tokenCache.expiresAt,
    source: tokenCache.source,
  };
};

const tspFetch = async (path = "/", options = {}) => {
  const env = getEnv();
  const start = Date.now();

  if (!env.hasBaseUrl) {
    return {
      ok: false,
      status: 0,
      error: "Missing TSP_BASE_URL",
      ms: Date.now() - start,
    };
  }

  const tokenResponse = await getAccessToken();
  if (!tokenResponse.ok) {
    return {
      ok: false,
      status: tokenResponse.status || 0,
      error: tokenResponse.error || "Auth failed",
      details: tokenResponse.details,
      ms: Date.now() - start,
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

  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${tokenResponse.token}`);

  let body = options.body;
  if (
    body &&
    typeof body === "object" &&
    !(body instanceof Buffer) &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof URLSearchParams)
  ) {
    body = JSON.stringify(body);
    headers.set("Content-Type", "application/json");
  }

  let lastError;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }

    try {
      const response = await fetchWithTimeout(url.toString(), {
        method: options.method || "GET",
        headers,
        body,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });

      const { data, text } = await parseResponse(response);

      if (response.status === 429 && attempt < RETRY_DELAYS_MS.length - 1) {
        lastError = {
          ok: false,
          status: response.status,
          error: "Rate limited",
          details: data || text,
        };
        continue;
      }

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: data?.message || `Request failed with status ${response.status}`,
          details: data || text,
          ms: Date.now() - start,
        };
      }

      return {
        ok: true,
        status: response.status,
        data,
        ms: Date.now() - start,
      };
    } catch (error) {
      lastError = {
        ok: false,
        status: 0,
        error: error.name === "AbortError" ? "Request timed out" : error.message,
      };
    }
  }

  return {
    ...lastError,
    ms: Date.now() - start,
  };
};

module.exports = {
  getEnv,
  getAccessToken,
  tspFetch,
};
