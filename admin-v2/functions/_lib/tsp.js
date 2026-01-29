const DEFAULT_TIMEOUT_MS = 8000;
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

let cachedOAuthToken = null;
let cachedOAuthExpiry = 0;

const getEnv = () => {
  const baseUrl = (process.env.TSP_BASE_URL || "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.TSP_API_KEY || "").trim();
  const clientId = (process.env.TSP_CLIENT_ID || "").trim();
  const clientSecret = (process.env.TSP_CLIENT_SECRET || "").trim();
  const email = (process.env.TSP_EMAIL || "").trim();
  const password = (process.env.TSP_PASSWORD || "").trim();
  const accountName = (process.env.TSP_ACCOUNT_NAME || "").trim();

  return {
    baseUrl,
    apiKey,
    clientId,
    clientSecret,
    email,
    password,
    accountName,
    hasBaseUrl: Boolean(baseUrl),
    hasApiKey: Boolean(apiKey),
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    hasEmail: Boolean(email),
    hasPassword: Boolean(password),
    hasAccountName: Boolean(accountName),
  };
};

const detectAuthMethod = (env) => {
  if (env.hasClientId && env.hasClientSecret) return "oauth";
  if (env.hasEmail && env.hasPassword && env.hasAccountName) return "regular";
  if (env.hasApiKey) return "api_key";
  return "none";
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

const getOAuthToken = async (env) => {
  const now = Date.now();
  if (cachedOAuthToken && cachedOAuthExpiry > now) {
    return { ok: true, token: cachedOAuthToken };
  }

  const url = `${env.baseUrl}/oauth/token`;
  const body = {
    grant_type: "client_credentials",
    client_id: env.clientId,
    client_secret: env.clientSecret,
  };

  const { response, data, text, error } = await fetchJson(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
  const expiresInSeconds = Number(data?.expires_in || 3600);

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

const getRegularToken = async (env) => {
  const url = `${env.baseUrl}/token`;
  const body = {
    Email: env.email,
    Password: env.password,
    AccountName: env.accountName,
  };

  const { response, data, text, error } = await fetchJson(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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
      error: data?.error || text || "Token request failed",
      details: data ?? text,
    };
  }

  const token = data?.Token || data?.token || null;
  if (!token) {
    return {
      ok: false,
      status: response.status,
      error: "Token response did not include a token",
      details: data ?? text,
    };
  }

  return { ok: true, token };
};

const getAuthHeader = async () => {
  const env = getEnv();

  if (!env.hasBaseUrl) {
    return {
      ok: false,
      status: 0,
      error: "Missing TSP_BASE_URL",
    };
  }

  const method = detectAuthMethod(env);
  if (method === "oauth") {
    const tokenResult = await getOAuthToken(env);
    if (!tokenResult.ok) return tokenResult;
    return {
      ok: true,
      method,
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
      },
    };
  }

  if (method === "regular") {
    const tokenResult = await getRegularToken(env);
    if (!tokenResult.ok) return tokenResult;
    return {
      ok: true,
      method,
      headers: {
        Authorization: tokenResult.token,
      },
    };
  }

  if (method === "api_key") {
    const token = env.apiKey;
    return {
      ok: true,
      method,
      headers: {
        Authorization: token.startsWith("Bearer ") ? token : token,
      },
    };
  }

  return {
    ok: false,
    status: 0,
    error: "No authentication credentials configured",
  };
};

const fetchTsp = async (path = "/", options = {}) => {
  const env = getEnv();

  if (!env.hasBaseUrl) {
    return {
      ok: false,
      status: 0,
      error: "Missing TSP_BASE_URL",
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

  const authResult = await getAuthHeader();
  if (!authResult.ok) {
    return {
      ok: false,
      status: authResult.status || 0,
      error: authResult.error || "Authentication failed",
      details: authResult.details,
    };
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
  detectAuthMethod,
  getAuthHeader,
  fetchTsp,
};
