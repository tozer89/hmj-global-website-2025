const DEFAULT_TIMEOUT_MS = 8000;

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

const tspFetch = async (path = "/", options = {}) => {
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

  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (env.hasApiKey) {
    headers.set("Authorization", `Bearer ${env.apiKey}`);
    headers.set("X-API-Key", env.apiKey);
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method: options.method || "GET",
      headers,
      body: options.body,
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

    return {
      ok: response.ok,
      status: response.status,
      data,
      text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.name === "AbortError" ? "Request timed out" : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  getEnv,
  tspFetch,
};
