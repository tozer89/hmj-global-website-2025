const { tspFetch } = require("./_lib/tsp");

const DEFAULT_LIMIT = 50;
const DEFAULT_CLIENTS_PATH = "/clients";

const normalizeStatus = (value) => {
  if (!value) return "unknown";
  return String(value).toLowerCase();
};

const normalizeClient = (client, index) => {
  const id = client.id || client.clientId || client.uuid || `client-${index + 1}`;
  const name =
    client.name ||
    client.clientName ||
    client.companyName ||
    client.description ||
    client.title ||
    "Unknown Client";
  const status = normalizeStatus(client.status || client.state || client.activeStatus || client.isActive);

  return { id, name, status, raw: client };
};

const extractArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.clients)) return payload.clients;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
};

exports.handler = async (event) => {
  const limitParam = parseInt(event.queryStringParameters?.limit, 10);
  const limit = Number.isFinite(limitParam) ? Math.min(limitParam, 200) : DEFAULT_LIMIT;
  const endpoint = (process.env.TSP_CLIENTS_PATH || DEFAULT_CLIENTS_PATH).trim() || DEFAULT_CLIENTS_PATH;

  const result = await tspFetch(endpoint, { query: { limit } });
  if (!result.ok) {
    return {
      statusCode: result.status || 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        mode: result.mode,
        status: result.status,
        error: result.error,
        details: result.details,
        debug: result.debug,
      }),
    };
  }

  const items = extractArray(result.data);
  const normalized = items.map(normalizeClient).slice(0, limit);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      mode: "live",
      limit,
      count: normalized.length,
      clients: normalized.map(({ raw, ...client }) => client),
    }),
  };
};
