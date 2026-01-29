const { tspFetch } = require("./_lib/tsp");

const DEFAULT_LIMIT = 50;

const normalizeStatus = (value) => {
  if (!value) return "unknown";
  return String(value).toLowerCase();
};

const normalizeClient = (client, index) => {
  const id = client.id || client.clientId || client.uuid || `client-${index + 1}`;
  const name = client.name || client.clientName || client.title || "Unknown Client";
  const status = normalizeStatus(client.status || client.state || client.activeStatus);

  return { id, name, status };
};

const extractArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.clients)) return payload.clients;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
};

const buildMockClients = (limit) => {
  const mockItems = [
    { id: "mock-1001", name: "Mock Client Alpha", status: "active" },
    { id: "mock-1002", name: "Mock Client Beta", status: "inactive" },
    { id: "mock-1003", name: "Mock Client Gamma", status: "active" },
  ];

  return mockItems.slice(0, limit);
};

exports.handler = async (event) => {
  const limitParam = parseInt(event.queryStringParameters?.limit, 10);
  const limit = Number.isFinite(limitParam) ? Math.min(limitParam, 200) : DEFAULT_LIMIT;
  const endpoint = (process.env.TSP_CLIENTS_PATH || "/clients").trim() || "/clients";

  const result = await tspFetch(endpoint, { query: { limit } });
  const items = extractArray(result.data);
  const normalized = items.map(normalizeClient).slice(0, limit);

  const mocked = !result.ok || normalized.length === 0;
  const clients = mocked ? buildMockClients(limit) : normalized;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      mocked,
      limit,
      count: clients.length,
      clients,
      note: mocked && !result.ok ? "Clients endpoint unavailable, returning mocked data" : undefined,
    }),
  };
};
