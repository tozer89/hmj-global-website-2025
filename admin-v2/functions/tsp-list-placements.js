const { tspFetch } = require("./_lib/tsp");

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;

const normalizeStatus = (value) => {
  if (!value) return "unknown";
  return String(value).toLowerCase();
};

const normalizePlacement = (placement) => {
  const id = placement.id || placement.projectId || placement.placementId || placement.uuid;
  const title = placement.title || placement.projectName || placement.role || placement.position || "Unknown Project";
  const clientName =
    placement.clientName || placement.client || placement.client_name || placement.clientCode || "—";
  const startDate = placement.startDate || placement.start || placement.start_date || placement.startDateTime || null;
  const endDate = placement.endDate || placement.end || placement.end_date || placement.endDateTime || null;
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
  if (payload && Array.isArray(payload.projects)) return payload.projects;
  if (payload && Array.isArray(payload.placements)) return payload.placements;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
};

exports.handler = async (event) => {
  const pageParam = parseInt(event.queryStringParameters?.page, 10);
  const pageSizeParam = parseInt(event.queryStringParameters?.pageSize, 10);
  const statusParam = event.queryStringParameters?.status;
  const page = Number.isFinite(pageParam) ? Math.max(pageParam, 1) : DEFAULT_PAGE;
  const pageSize = Number.isFinite(pageSizeParam) ? Math.min(Math.max(pageSizeParam, 1), 200) : DEFAULT_PAGE_SIZE;

  const result = await tspFetch("/projects", { query: { page, pageSize, status: statusParam } });
  const items = extractArray(result.data);
  const placements = items.map(normalizePlacement);

  return {
    statusCode: result.ok ? 200 : 502,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: result.ok,
      status: result.status,
      page,
      pageSize,
      statusFilter: statusParam || "all",
      count: placements.length,
      placements,
      ms: result.ms,
      raw: result.data ?? null,
      meta: {
        endpoint: "/projects",
      },
    }),
  };
};
