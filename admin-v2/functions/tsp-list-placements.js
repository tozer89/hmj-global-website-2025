const { tspFetch } = require("./_lib/tsp");

const DEFAULT_LIMIT = 50;

const normalizeStatus = (value) => {
  if (!value) return "unknown";
  return String(value).toLowerCase();
};

const normalizePlacement = (placement, index) => {
  const id = placement.id || placement.placementId || placement.uuid || `placement-${index + 1}`;
  const title = placement.title || placement.role || placement.position || "Unknown Role";
  const clientName = placement.clientName || placement.client || placement.client_name || "Unknown Client";
  const startDate = placement.startDate || placement.start || placement.start_date || null;
  const endDate = placement.endDate || placement.end || placement.end_date || null;
  const status = normalizeStatus(placement.status || placement.state || placement.activeStatus);

  return {
    id,
    title,
    clientName,
    startDate,
    endDate,
    status,
  };
};

const extractArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.placements)) return payload.placements;
  if (payload && Array.isArray(payload.assignments)) return payload.assignments;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
};

const buildMockPlacements = (limit) => {
  const mockItems = [
    {
      id: "mock-2001",
      title: "Commissioning Manager",
      clientName: "Mock Client Alpha",
      startDate: "2025-01-15",
      endDate: "2025-06-30",
      status: "active",
    },
    {
      id: "mock-2002",
      title: "QA Specialist",
      clientName: "Mock Client Beta",
      startDate: "2024-10-01",
      endDate: "2025-03-31",
      status: "inactive",
    },
    {
      id: "mock-2003",
      title: "Project Controls Engineer",
      clientName: "Mock Client Gamma",
      startDate: "2025-02-10",
      endDate: null,
      status: "active",
    },
  ];

  return mockItems.slice(0, limit);
};

exports.handler = async (event) => {
  const limitParam = parseInt(event.queryStringParameters?.limit, 10);
  const statusParam = event.queryStringParameters?.status;
  const limit = Number.isFinite(limitParam) ? Math.min(limitParam, 200) : DEFAULT_LIMIT;
  const endpoint = (process.env.TSP_PLACEMENTS_PATH || "/placements").trim() || "/placements";

  const result = await tspFetch(endpoint, { query: { limit, status: statusParam } });
  const items = extractArray(result.data);
  const normalized = items.map(normalizePlacement).slice(0, limit);

  const mocked = !result.ok || normalized.length === 0;
  const placements = mocked ? buildMockPlacements(limit) : normalized;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      mocked,
      limit,
      status: statusParam || "all",
      count: placements.length,
      placements,
      note: mocked && !result.ok ? "Placements endpoint unavailable, returning mocked data" : undefined,
    }),
  };
};
