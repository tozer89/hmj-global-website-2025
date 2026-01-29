const DEFAULT_TOKEN_EXPIRES_IN = 3600;
const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const DEFAULT_BASE_URL = "https://brightwater.api.timesheetportal.com";
const DEFAULT_TOKEN_PATH = "/token";

let cachedOAuthToken = null;
let cachedOAuthExpiry = 0;

let lastOAuthAttempt = {
  at: null,
  status: null,
  error: null,
  tokenUrl: null,
};

const getOAuthEnv = () => {
  const baseUrlRaw = (process.env.TSP_BASE_URL || "").trim();
  const baseUrl = (baseUrlRaw || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const clientId = (process.env.TSP_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = (process.env.TSP_OAUTH_CLIENT_SECRET || "").trim();
  const scope = (process.env.TSP_OAUTH_SCOPE || "").trim();
  const tokenUrlRaw = (process.env.TSP_TOKEN_URL || "").trim();

  let tokenUrl = tokenUrlRaw;
  if (!tokenUrl) {
    tokenUrl = `${baseUrl}${DEFAULT_TOKEN_PATH}`;
  } else if (!/^https?:\/\//i.test(tokenUrl)) {
    tokenUrl = `${baseUrl}/${tokenUrl.replace(/^\/+/, "")}`;
  }

  return {
    baseUrl,
    baseUrlPresent: Boolean(baseUrlRaw),
    clientId,
    clientSecret,
    scope,
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    hasScope: Boolean(scope),
    tokenUrl,
    tokenUrlPresent: Boolean(tokenUrlRaw),
  };
};

const recordOAuthAttempt = ({ status, error, tokenUrl }) => {
  lastOAuthAttempt = {
    at: new Date().toISOString(),
    status,
    error,
    tokenUrl,
  };
};

const getOAuthDebug = () => ({
  last_attempt_at: lastOAuthAttempt.at,
  status: lastOAuthAttempt.status,
  error: lastOAuthAttempt.error,
  token_url: lastOAuthAttempt.tokenUrl,
});

const resetTokenCache = () => {
  cachedOAuthToken = null;
  cachedOAuthExpiry = 0;
  lastOAuthAttempt = {
    at: null,
    status: null,
    error: null,
    tokenUrl: null,
  };
};

const requestOAuthToken = async (env, fetchJson) => {
  const payload = {
    grant_type: "client_credentials",
    client_id: env.clientId,
    client_secret: env.clientSecret,
  };
  if (env.scope) {
    payload.scope = env.scope;
  }

  const body = new URLSearchParams(payload).toString();

  const { response, data, text, error } = await fetchJson(env.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (error) {
    recordOAuthAttempt({
      status: 0,
      error: error.name === "AbortError" ? "Request timed out" : error.message,
      tokenUrl: env.tokenUrl,
    });
    return { ok: false, status: 0, error: lastOAuthAttempt.error };
  }

  if (!response.ok) {
    const message = data?.error_description || data?.error || text || "OAuth token request failed";
    recordOAuthAttempt({ status: response.status, error: message, tokenUrl: env.tokenUrl });
    return {
      ok: false,
      status: response.status,
      error: message,
      details: data ?? (text ? { text: text.slice(0, 500) } : undefined),
    };
  }

  recordOAuthAttempt({ status: response.status, error: null, tokenUrl: env.tokenUrl });
  return { ok: true, status: response.status, data };
};

const getAccessToken = async (env, fetchJson) => {
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

  const result = await requestOAuthToken(env, fetchJson);

  if (!result.ok) {
    return result;
  }

  const accessToken = result.data?.access_token || result.data?.token || null;
  const expiresInSeconds = Number(result.data?.expires_in || DEFAULT_TOKEN_EXPIRES_IN);

  if (!accessToken) {
    const error = "OAuth response did not include an access token";
    recordOAuthAttempt({ status: result.status, error, tokenUrl: env.tokenUrl });
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

module.exports = {
  getOAuthEnv,
  getOAuthDebug,
  getAccessToken,
  resetTokenCache,
};
